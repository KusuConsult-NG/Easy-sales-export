/**
 * SYNC ALL FIREBASE AUTH EMAILS TO SUPABASE
 * 1. Fetch UIDs from Supabase public.users where email is NULL or empty string
 * 2. Look up each UID in Firebase Auth using Google OAuth2 + Identity Toolkit accounts:lookup REST API
 * 3. Match found emails and names
 * 4. Perform fast bulk updates to Supabase
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: require('ws') } }
);

function createJWT(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url');
  const unsigned = header + '.' + payload;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(privateKey, 'base64url');
  return unsigned + '.' + signature;
}

function getOAuthToken() {
  return new Promise((resolve, reject) => {
    const jwt = createJWT(process.env.FIREBASE_CLIENT_EMAIL, process.env.FIREBASE_PRIVATE_KEY);
    const postData = 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt;
    const req = https.request({
      hostname: 'oauth2.googleapis.com', port: 443, path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const parsed = JSON.parse(data);
        if (parsed.access_token) resolve(parsed.access_token);
        else reject(new Error('OAuth error: ' + JSON.stringify(parsed)));
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function lookupFirebaseAccounts(token, localIds) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ localId: localIds });
    const req = https.request({
      hostname: 'identitytoolkit.googleapis.com',
      port: 443,
      path: '/v1/projects/' + (process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'easy-sales-hub') + '/accounts:lookup',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function runSync() {
  console.log('=== SYNCING FIREBASE AUTH EMAILS TO SUPABASE ===\n');

  const token = await getOAuthToken();
  console.log('✅ OAuth2 token obtained.');

  // Fetch all users with NULL/empty email
  let allTargetUsers = [];
  let offset = 0;
  const PAGE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, raw_data')
      .or('email.is.null,email.eq.')
      .range(offset, offset + PAGE - 1);

    if (error || !data || data.length === 0) break;
    allTargetUsers = allTargetUsers.concat(data);
    offset += data.length;
    if (data.length < PAGE) break;
  }

  console.log(`Total target users with NULL/empty email in Supabase: ${allTargetUsers.length}`);

  // Exclude skeleton backfills if desireable, or check all of them
  const realTargets = allTargetUsers.filter(u => u.raw_data?._system_skeleton_backfill !== true);
  console.log(`Real users to look up in Firebase Auth: ${realTargets.length}`);

  const matches = [];
  const BATCH = 100;

  for (let i = 0; i < realTargets.length; i += BATCH) {
    const chunk = realTargets.slice(i, i + BATCH);
    const uids = chunk.map(u => u.id);

    try {
      const res = await lookupFirebaseAccounts(token, uids);
      const fbUsers = res.users || [];

      for (const fbUser of fbUsers) {
        if (fbUser.localId && fbUser.email) {
          const matchedUser = chunk.find(c => c.id === fbUser.localId);
          matches.push({
            id: fbUser.localId,
            email: fbUser.email.toLowerCase().trim(),
            displayName: fbUser.displayName || matchedUser?.raw_data?.fullName || '',
            existingRawData: matchedUser?.raw_data || {}
          });
        }
      }
      console.log(`Lookup progress: ${Math.min(i + BATCH, realTargets.length)}/${realTargets.length} (Found ${matches.length} matching emails)...`);
    } catch (e) {
      console.error(`Batch lookup error at index ${i}:`, e.message);
    }
  }

  console.log(`\n✅ TOTAL MATCHES FOUND IN FIREBASE AUTH: ${matches.length}`);

  if (matches.length === 0) {
    console.log('No matching emails found in Firebase Auth for these UIDs.');
    return;
  }

  // Write matches to scratch file for record keeping
  fs.writeFileSync('scratch/firebase-email-matches.json', JSON.stringify(matches, null, 2));

  // Perform updates in Supabase
  console.log('\nUpdating Supabase users with recovered emails...');
  let updatedCount = 0;

  for (const match of matches) {
    const updatedRaw = {
      ...match.existingRawData,
      email: match.email,
      fullName: match.displayName || match.existingRawData.fullName || '',
      profileComplete: true
    };

    const { error } = await supabase
      .from('users')
      .update({
        email: match.email,
        raw_data: updatedRaw,
        updated_at: new Date().toISOString()
      })
      .eq('id', match.id);

    if (error) {
      console.error(`Failed to update ${match.id}:`, error.message);
    } else {
      updatedCount++;
    }
  }

  console.log(`\n🎉 HEALING COMPLETE: Updated ${updatedCount} user profiles in Supabase with verified emails from Firebase Auth!`);
}

runSync().catch(console.error);
