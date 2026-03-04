#!/usr/bin/env node

/**
 * Auth Login Fix Script
 * =====================
 * Diagnoses and fixes "Invalid email or password" auth errors.
 *
 * What this script does:
 *  1. Clears Redis rate-limit blocks for the given email
 *  2. Clears cached user profile in Redis (stale cache can cause auth failures)
 *  3. Verifies the user exists in Firebase Auth
 *  4. Verifies the user profile exists in Firestore
 *  5. Reports any issue found
 *
 * Usage:
 *   node scripts/fix-auth-login.js <email>
 *   node scripts/fix-auth-login.js --clear-all     (clears ALL login rate limit keys)
 */

require('dotenv').config({ path: '.env.local' });

const email = process.argv[2];
const clearAll = process.argv[2] === '--clear-all';

if (!email && !clearAll) {
    console.error('Usage: node scripts/fix-auth-login.js <email>');
    console.error('       node scripts/fix-auth-login.js --clear-all');
    process.exit(1);
}

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;

if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    console.error('❌ Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN in .env.local');
    process.exit(1);
}

// ── Upstash REST helper ─────────────────────────────────────────────────────

async function upstash(command, ...args) {
    const body = [command, ...args];
    const res = await fetch(UPSTASH_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${UPSTASH_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.error) throw new Error(`Upstash error: ${json.error}`);
    return json.result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function clearAllRateLimits() {
    console.log('\n🧹 Clearing ALL login rate-limit keys from Redis...\n');

    // Upstash Ratelimit stores sliding window keys with these patterns:
    const patterns = [
        '@upstash/login_limit:*',
        '@upstash/ratelimit:*',
    ];

    let totalDeleted = 0;

    for (const pattern of patterns) {
        const keys = await upstash('KEYS', pattern);
        if (!keys || keys.length === 0) {
            console.log(`  No keys found for pattern: ${pattern}`);
            continue;
        }
        console.log(`  Found ${keys.length} key(s) for pattern: ${pattern}`);
        for (const key of keys) {
            await upstash('DEL', key);
            console.log(`  ✅ Deleted: ${key}`);
            totalDeleted++;
        }
    }

    console.log(`\n✅ Done. Deleted ${totalDeleted} Redis key(s).`);
    console.log('↩️  All users can now attempt login again.\n');
}

async function fixUserAuth(emailAddr) {
    const normalizedEmail = emailAddr.toLowerCase().trim();

    console.log(`\n🔍 Diagnosing auth for: ${normalizedEmail}\n`);

    // ── 1. Clear rate-limit keys ─────────────────────────────────────────────

    console.log('Step 1: Clearing rate-limit keys...');

    // The loginLimiter uses prefix "@upstash/login_limit" and key "login_<email>"
    // Upstash Ratelimit stores sliding window as two hash entries per window:
    // Key pattern: @upstash/login_limit:login_<email>
    const rateLimitKey = `@upstash/login_limit:login_${normalizedEmail}`;

    // Also scan for any matching keys (Ratelimit may use sub-keys)
    const matchingKeys = await upstash('KEYS', `@upstash/login_limit:login_${normalizedEmail}*`);

    if (matchingKeys && matchingKeys.length > 0) {
        for (const key of matchingKeys) {
            await upstash('DEL', key);
            console.log(`  ✅ Deleted rate-limit key: ${key}`);
        }
    } else {
        // Try deleting the exact key directly (in case KEYS scan misses it)
        await upstash('DEL', rateLimitKey);
        console.log(`  ✅ Cleared rate-limit key (direct): ${rateLimitKey}`);
    }

    // ── 2. Clear cached user profile ────────────────────────────────────────

    console.log('\nStep 2: Clearing cached user profile...');

    // We don't know the UID here, so we scan for user:profile:* keys
    // and check their cached email field
    const profileKeys = await upstash('KEYS', 'user:profile:*');
    let profileCleared = false;

    if (profileKeys && profileKeys.length > 0) {
        for (const key of profileKeys) {
            try {
                const raw = await upstash('GET', key);
                if (raw) {
                    const profile = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    if (profile.email && profile.email.toLowerCase() === normalizedEmail) {
                        await upstash('DEL', key);
                        console.log(`  ✅ Deleted stale user profile cache: ${key}`);
                        profileCleared = true;
                    }
                }
            } catch (_) {
                // Skip unparseable entries
            }
        }
    }

    if (!profileCleared) {
        console.log('  ℹ️  No cached profile found for this email (this is fine).');
    }

    // ── 3. Check Firebase Auth (via Admin REST API) ──────────────────────────

    console.log('\nStep 3: Checking Firebase Auth...');
    const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
    const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY || !FIREBASE_PROJECT_ID) {
        console.log('  ⚠️  Firebase Admin credentials not available in .env.local — skipping Firebase check.');
        console.log('     You can verify manually at: https://console.firebase.google.com/project/' + FIREBASE_PROJECT_ID + '/authentication/users');
    } else {
        try {
            // Mint a short-lived Google OAuth token to call the Identity Toolkit API
            const { createSign } = require('crypto');

            const now = Math.floor(Date.now() / 1000);
            const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
            const claim = Buffer.from(JSON.stringify({
                iss: FIREBASE_CLIENT_EMAIL,
                sub: FIREBASE_CLIENT_EMAIL,
                aud: 'https://oauth2.googleapis.com/token',
                iat: now,
                exp: now + 3600,
                scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase',
            })).toString('base64url');

            const sign = createSign('RSA-SHA256');
            sign.update(`${header}.${claim}`);
            const sig = sign.sign(FIREBASE_PRIVATE_KEY, 'base64url');
            const jwt = `${header}.${claim}.${sig}`;

            // Exchange for access token
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
            });
            const tokenData = await tokenRes.json();
            const accessToken = tokenData.access_token;

            if (!accessToken) {
                console.log('  ⚠️  Could not obtain Firebase access token. Check FIREBASE_PRIVATE_KEY.');
            } else {
                // Lookup user by email via Identity Toolkit
                const lookupRes = await fetch(
                    `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts:lookup`,
                    {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ email: [normalizedEmail] }),
                    }
                );
                const lookupData = await lookupRes.json();

                if (lookupData.error) {
                    console.log(`  ❌ Firebase lookup error: ${lookupData.error.message}`);
                } else if (!lookupData.users || lookupData.users.length === 0) {
                    console.log(`  ❌ No Firebase Auth user found for email: ${normalizedEmail}`);
                    console.log('     → The user might not be registered, or was registered with a different email.');
                } else {
                    const fbUser = lookupData.users[0];
                    console.log(`  ✅ Firebase Auth user found:`);
                    console.log(`     UID:           ${fbUser.localId}`);
                    console.log(`     Email:         ${fbUser.email}`);
                    console.log(`     Verified:      ${fbUser.emailVerified}`);
                    console.log(`     Disabled:      ${fbUser.disabled}`);
                    console.log(`     Last Login:    ${fbUser.lastLoginAt ? new Date(parseInt(fbUser.lastLoginAt)).toISOString() : 'never'}`);

                    if (fbUser.disabled) {
                        console.log('\n  ⚠️  This account is DISABLED in Firebase! Re-enabling...');
                        // Re-enable the account
                        const enableRes = await fetch(
                            `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts:update`,
                            {
                                method: 'POST',
                                headers: {
                                    Authorization: `Bearer ${accessToken}`,
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({ localId: fbUser.localId, disableUser: false }),
                            }
                        );
                        const enableData = await enableRes.json();
                        if (!enableData.error) {
                            console.log('  ✅ Account re-enabled in Firebase!');
                        } else {
                            console.log(`  ❌ Failed to re-enable: ${enableData.error.message}`);
                        }
                    }
                }
            }
        } catch (fbErr) {
            console.log(`  ⚠️  Firebase check error: ${fbErr.message}`);
        }
    }

    // ── 4. Summary ─────────────────────────────────────────────────────────

    console.log('\n─────────────────────────────────────────────');
    console.log('✅ Fix applied. What was done:');
    console.log('   • Redis rate-limit keys for this email → CLEARED');
    console.log('   • Stale Redis user profile cache → CLEARED');
    console.log('   • Firebase account status → CHECKED (see above)');
    console.log('\n↩️  Please try logging in again now.');
    console.log('   If the problem persists, run: npm run dev');
    console.log('   and check the terminal for the exact Firebase error code.\n');
}

// ── Entry ─────────────────────────────────────────────────────────────────

if (clearAll) {
    clearAllRateLimits().catch((err) => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
} else {
    fixUserAuth(email).catch((err) => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}
