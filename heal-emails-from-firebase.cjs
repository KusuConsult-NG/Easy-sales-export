/**
 * HEAL ALL USERS: Fetch authentic email addresses from Firebase Auth REST API
 * and sync them back to Supabase public.users (both SQL column and raw_data JSONB).
 */

const https = require('https');
const crypto = require('crypto');
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

function batchGetFirebaseUsers(token, localIds) {
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

async function healAllUserEmails() {
  console.log('=== HEALING USER EMAILS FROM FIREBASE AUTH ===\n');

  // Get OAuth token for Firebase Admin REST API
  const token = await getOAuthToken();
  console.log('✅ Obtained Firebase OAuth2 Access Token.');

  // Fetch all users with NULL or empty email from Supabase
  let targetUsers = [];
  let offset = 0;
  const PAGE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, raw_data')
      .or('email.is.null,email.eq.')
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error('Fetch error from Supabase:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    targetUsers = targetUsers.concat(data);
    offset += data.length;
    if (data.length < PAGE) break;
  }

  console.log(`Total users in Supabase needing email sync: ${targetUsers.length}`);

  let healedCount = 0;
  let notFoundInFirebase = 0;
  let errorCount = 0;

  const BATCH_SIZE = 100;
  for (let i = 0; i < targetUsers.length; i += BATCH_SIZE) {
    const batch = targetUsers.slice(i, i + BATCH_SIZE);
    const uids = batch.map(u => u.id);

    try {
      const fbResult = await batchGetFirebaseUsers(token, uids);
      const fbUsers = fbResult.users || [];
      const fbMap = new Map();
      fbUsers.forEach(u => fbMap.set(u.localId, u));

      for (const user of batch) {
        const fbUser = fbMap.get(user.id);
        if (fbUser && fbUser.email) {
          const email = fbUser.email.toLowerCase().trim();
          const fullName = fbUser.displayName || user.raw_data?.fullName || '';

          const updatedRawData = {
            ...(user.raw_data || {}),
            email: email,
            fullName: fullName || user.raw_data?.fullName,
            profileComplete: true
          };

          const { error: updateErr } = await supabase
            .from('users')
            .update({
              email: email,
              raw_data: updatedRawData,
              updated_at: new Date().toISOString()
            })
            .eq('id', user.id);

          if (updateErr) {
            console.error(`Failed to update ${user.id}:`, updateErr.message);
            errorCount++;
          } else {
            healedCount++;
          }
        } else {
          notFoundInFirebase++;
        }
      }

      console.log(`  Processed ${Math.min(i + BATCH_SIZE, targetUsers.length)}/${targetUsers.length} users (Healed: ${healedCount})...`);
    } catch (batchErr) {
      console.error(`Error processing batch starting at index ${i}:`, batchErr.message);
      errorCount += batch.length;
    }
  }

  console.log('\n=== HEALING SUMMARY ===');
  console.log(`✅ Successfully Healed Emails: ${healedCount}`);
  console.log(`⚠️ Not Found in Firebase Auth: ${notFoundInFirebase}`);
  console.log(`❌ Errors: ${errorCount}`);

  // Verification
  const { count: nullAfter } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .or('email.is.null,email.eq.');

  console.log(`\nRemaining NULL/empty emails in Supabase: ${nullAfter}`);
}

healAllUserEmails().catch(console.error);
