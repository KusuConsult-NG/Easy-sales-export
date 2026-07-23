/**
 * FIX v4: Email sync using the actual firebase-admin SDK (modular)
 * not the project shim.
 * 
 * For Firebase UID users: use firebase-admin/auth getUsers batch
 * For Supabase UUID users: use Supabase Auth paginated list
 */

const path = require('path');
// Force use of REAL firebase-admin, not the local shim
// The shim is in ./node_modules/firebase-admin but we need the real one
// Let's use it via the proper module path

require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: require('ws') } }
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Initialize real Firebase Admin
let firebaseAuth = null;
try {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');

  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (privateKey && privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  const apps = getApps();
  const app = apps.length > 0 ? apps[0] : initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    })
  });
  firebaseAuth = getAuth(app);
  console.log('✅ Firebase Admin initialized');
} catch (e) {
  console.error('⚠️  Firebase Admin not available:', e.message);
}

async function fixEmails() {
  console.log('\n=== Email Sync Fix v4 ===\n');

  const { count: nullBefore } = await supabase.from('users')
    .select('*', { count: 'exact', head: true }).is('email', null);
  console.log('NULL email BEFORE fix:', nullBefore);

  // Fetch all null-email users
  let allNullUsers = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase.from('users')
      .select('id, email, raw_data').is('email', null).range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allNullUsers = allNullUsers.concat(data);
    offset += data.length;
    if (data.length < 1000) break;
  }
  console.log(`Fetched ${allNullUsers.length} users with NULL email`);

  const supabaseUUIDUsers = allNullUsers.filter(u => UUID_RE.test(u.id));
  const firebaseUIDUsers = allNullUsers.filter(u => !UUID_RE.test(u.id));
  console.log(`  Supabase UUID IDs: ${supabaseUUIDUsers.length}`);
  console.log(`  Firebase UID IDs: ${firebaseUIDUsers.length}\n`);

  const emailMap = {};

  // ── 1. Supabase Auth — paginate all users ──────────────────────────────────
  if (supabaseUUIDUsers.length > 0) {
    console.log('Fetching Supabase Auth users (all pages)...');
    let page = 1;
    let sbTotal = 0;
    while (true) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (error || !data?.users?.length) break;
      for (const u of data.users) {
        if (u.id && u.email) emailMap[u.id] = u.email;
      }
      sbTotal += data.users.length;
      process.stdout.write(`  Page ${page}: ${sbTotal} fetched, ${Object.keys(emailMap).length} with email\r`);
      if (!data.nextPage || data.users.length < 1000) break;
      page = data.nextPage;
    }
    console.log(`\n  Supabase Auth done: ${sbTotal} fetched, ${Object.keys(emailMap).length} emails`);
  }

  // ── 2. Firebase Auth — batch getUsers ─────────────────────────────────────
  if (firebaseUIDUsers.length > 0 && firebaseAuth) {
    console.log(`\nFetching ${firebaseUIDUsers.length} Firebase UIDs...`);
    let fbFound = 0;
    for (let i = 0; i < firebaseUIDUsers.length; i += 100) {
      const chunk = firebaseUIDUsers.slice(i, i + 100);
      try {
        const result = await firebaseAuth.getUsers(chunk.map(u => ({ uid: u.id })));
        for (const fu of result.users) {
          if (fu.uid && fu.email) { emailMap[fu.uid] = fu.email; fbFound++; }
        }
      } catch (e) { console.error(`\n  Firebase chunk ${i} error:`, e.message); }
      process.stdout.write(`  Firebase: ${Math.min(i + 100, firebaseUIDUsers.length)}/${firebaseUIDUsers.length} (${fbFound} emails found)\r`);
    }
    console.log(`\n  Firebase done: ${fbFound} emails found`);
  }

  // ── 3. raw_data.email fallback ─────────────────────────────────────────────
  let rawFallback = 0;
  for (const u of allNullUsers) {
    if (!emailMap[u.id]) {
      const rawEmail = (u.raw_data?.email || '').trim();
      if (rawEmail.includes('@')) { emailMap[u.id] = rawEmail; rawFallback++; }
    }
  }
  console.log(`\n  raw_data fallback: ${rawFallback} emails`);

  console.log(`\nTotal mapped: ${Object.keys(emailMap).length} / ${allNullUsers.length}`);
  console.log('Applying updates...');

  let fixed = 0, notFound = 0, failed = 0;
  for (const user of allNullUsers) {
    const email = emailMap[user.id];
    if (!email) { notFound++; continue; }

    const { error } = await supabase.from('users')
      .update({
        email,
        raw_data: { ...(user.raw_data || {}), email },
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    if (error) failed++;
    else fixed++;
    if ((fixed + failed) % 50 === 0) process.stdout.write(`  Applied: ${fixed + failed}/${Object.keys(emailMap).length}\r`);
  }

  console.log(`\n\n=== RESULTS ===`);
  console.log(`✅ Emails fixed: ${fixed}`);
  console.log(`⚠️  Not found in any Auth system: ${notFound}`);
  console.log(`❌ Update errors: ${failed}`);

  const { count: nullAfter } = await supabase.from('users').select('*', { count: 'exact', head: true }).is('email', null);
  console.log(`\nNULL BEFORE: ${nullBefore} → AFTER: ${nullAfter}`);
}

fixEmails().catch(console.error);
