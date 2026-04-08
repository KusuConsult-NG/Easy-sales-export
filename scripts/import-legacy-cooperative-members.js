/**
 * import-legacy-cooperative-members.js
 *
 * Onboards cooperative members who paid before the platform existed.
 * Their payment has been verified by admin via physical PDF/JPEG receipts.
 *
 * WHAT THIS SCRIPT DOES (per member row):
 *  1. Looks up / creates a Firebase Auth account
 *  2. Creates/merges the `users/{uid}` Firestore document
 *  3. Creates/merges the `cooperative_members/{uid}` document
 *     — paymentStatus: "completed", membershipStatus: "approved", onboardingCompleted: false
 *  4. Sets serviceRegistrations.cooperative.status = "legacy_pending_onboarding"
 *     so the OnboardingClient shows the form with the payment step skipped
 *  5. Creates a cooperative_transactions entry for the registration fee
 *  6. Queues a password-reset token so the member can set their own password
 *
 * USAGE:
 *   node scripts/import-legacy-cooperative-members.js               # live run
 *   node scripts/import-legacy-cooperative-members.js --dry-run     # preview only
 *
 * DATA FILE:
 *   scripts/data/legacy-cooperative-members.json
 *   (See the template below for the expected shape)
 *
 * TEMPLATE (scripts/data/legacy-cooperative-members.json):
 * [
 *   {
 *     "email": "john@example.com",
 *     "firstName": "John",
 *     "lastName": "Doe",
 *     "phone": "08012345678",
 *     "membershipTier": "basic",        // "basic" (₦10,000) | "premium" (₦20,000)
 *     "registrationFee": 10000,         // optional — defaults to tier amount
 *     "gender": "male",                 // optional
 *     "stateOfOrigin": "Enugu",        // optional
 *     "lga": "Igbo-Eze North",         // optional
 *     "occupation": "Farmer",          // optional
 *     "dateOfBirth": "1985-06-12",     // optional
 *     "residentialAddress": "12 Main Street, Enugu", // optional
 *     "nextOfKinName": "Jane Doe",     // optional
 *     "nextOfKinPhone": "08098765432", // optional
 *     "savingsBalance": 0              // optional — defaults to 0
 *   }
 * ]
 */

require('dotenv').config({ path: '.env.production.local' });
const admin = require('firebase-admin');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// ─── Config ────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const DATA_FILE = path.join(__dirname, 'data', 'legacy-cooperative-members.json');
const IMPORT_SOURCE = 'legacy_csv_import';
const PASSWORD_RESET_EXPIRY_DAYS = 7;

// ─── Firebase Init ─────────────────────────────────────────────────────────────

let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
if (privateKey.startsWith('"') && privateKey.endsWith('"')) privateKey = privateKey.slice(1, -1);
if (privateKey.includes('\\n')) privateKey = privateKey.replace(/\\n/g, '\n');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey,
        }),
    });
}

const db = admin.firestore();
const authAdmin = admin.auth();
const FieldValue = admin.firestore.FieldValue;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function log(emoji, msg) {
    console.log(`${emoji}  ${msg}`);
}

function registrationFeeForTier(tier) {
    return tier === 'premium' ? 20000 : 10000;
}

/** Generate a cryptographically secure temporary password */
function generateTempPassword() {
    return `Coop@${crypto.randomBytes(8).toString('hex')}`;
}

/** Generate a secure password-reset token */
function generateResetToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ─── Core Import Logic ─────────────────────────────────────────────────────────

async function importMember(member, index) {
    const label = `[${index + 1}] ${member.email}`;
    const fee = member.registrationFee ?? registrationFeeForTier(member.membershipTier ?? 'basic');
    const tier = (member.membershipTier === 'premium' ? 'premium' : 'basic');
    const cooperativeTier = tier === 'premium' ? 'tier2' : 'tier1';

    // ── Step 1: Find or create Firebase Auth account ──────────────────────────
    let uid;
    let authCreated = false;

    try {
        const existing = await authAdmin.getUserByEmail(member.email);
        uid = existing.uid;
        log('⏭️', `${label} — Auth account already exists (uid: ${uid})`);
    } catch (err) {
        if (err.code === 'auth/user-not-found') {
            if (DRY_RUN) {
                log('🆕', `${label} — [DRY RUN] Would create Auth account`);
                return { status: 'dry_run', email: member.email };
            }
            const tempPassword = generateTempPassword();
            const created = await authAdmin.createUser({
                email: member.email,
                password: tempPassword,
                displayName: `${member.firstName || ''} ${member.lastName || ''}`.trim() || undefined,
                emailVerified: false,
            });
            uid = created.uid;
            authCreated = true;
            log('🔐', `${label} — Auth account created (uid: ${uid})`);
        } else {
            throw err;
        }
    }

    if (DRY_RUN) {
        log('🔍', `${label} — [DRY RUN] Would write Firestore docs for uid: ${uid}`);
        return { status: 'dry_run', email: member.email, uid };
    }

    // ── Step 2: Check if cooperative_members doc already fully onboarded ──────
    const memberRef = db.collection('cooperative_members').doc(uid);
    const memberDoc = await memberRef.get();

    if (memberDoc.exists && memberDoc.data()?.onboardingCompleted === true) {
        log('⏭️', `${label} — Onboarding already complete, skipping.`);
        return { status: 'skipped', email: member.email, uid, reason: 'onboarding_completed' };
    }

    const now = FieldValue.serverTimestamp();
    const batch = db.batch();

    // ── Step 3: Create / merge users/{uid} ────────────────────────────────────

    const fullName = [member.firstName, member.lastName].filter(Boolean).join(' ').trim();
    const userRef = db.collection('users').doc(uid);

    batch.set(userRef, {
        uid,
        fullName: fullName || member.email,
        firstName: member.firstName || '',
        lastName: member.lastName || '',
        email: member.email,
        phone: member.phone || '',
        gender: member.gender || '',
        stateOfOrigin: member.stateOfOrigin || '',
        lga: member.lga || '',
        residentialAddress: member.residentialAddress || '',
        occupation: member.occupation || '',
        // Roles: add cooperative_member without overwriting other roles
        // Note: arrayUnion is not available in batch — we handle this below
        roles: ['general_user', 'cooperative_member'],
        verified: true,
        isVerified: true,
        cooperativeTier,
        cooperativeRegistrationFee: fee,
        'serviceRegistrations.cooperative': {
            status: 'legacy_pending_onboarding',
            tier: cooperativeTier,
            applicationId: `${uid}_legacy`,
            paymentReference: 'LEGACY_IMPORT_RECEIPT',
            submittedAt: now,
        },
        _importedAt: now,
        _importSource: IMPORT_SOURCE,
        createdAt: now,
        updatedAt: now,
    }, { merge: true });

    // ── Step 4: Create / merge cooperative_members/{uid} ─────────────────────

    batch.set(memberRef, {
        userId: uid,
        fullName,
        firstName: member.firstName || '',
        lastName: member.lastName || '',
        email: member.email,
        phone: member.phone || '',
        gender: member.gender || '',
        dateOfBirth: member.dateOfBirth || '',
        stateOfOrigin: member.stateOfOrigin || '',
        lga: member.lga || '',
        residentialAddress: member.residentialAddress || '',
        occupation: member.occupation || '',
        nextOfKinName: member.nextOfKinName || '',
        nextOfKinPhone: member.nextOfKinPhone || '',
        nextOfKinAddress: member.nextOfKinAddress || '',
        membershipTier: tier,
        registrationFee: fee,
        membershipStatus: 'approved',
        paymentStatus: 'completed',
        savingsBalance: member.savingsBalance ?? 0,
        loanBalance: 0,
        onboardingCompleted: false, // <-- triggers onboarding form prompt on login
        _importedAt: now,
        _importSource: IMPORT_SOURCE,
        createdAt: now,
        updatedAt: now,
    }, { merge: true });

    // ── Step 5: cooperative_transactions entry ───────────────────────────────

    const txId = `${uid}_legacy_reg`;
    const txRef = db.collection('cooperative_transactions').doc(txId);
    const txDoc = await txRef.get();

    if (!txDoc.exists) {
        batch.set(txRef, {
            userId: uid,
            type: 'membership_registration',
            amount: fee,
            status: 'completed',
            description: 'Legacy Registration Fee (Pre-Platform — verified by admin)',
            membershipTier: tier,
            source: 'legacy_import',
            date: now,
            createdAt: now,
        });
    }

    // ── Step 6: Queue password-reset token ───────────────────────────────────

    if (authCreated) {
        const token = generateResetToken();
        const expiry = Date.now() + PASSWORD_RESET_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

        const resetRef = db.collection('password_resets').doc(token);
        batch.set(resetRef, {
            email: member.email,
            token,
            expiry,
            used: false,
            createdAt: now,
        });
    }

    await batch.commit();

    // Separately update roles using arrayUnion (not supported in batch)
    await userRef.update({
        roles: FieldValue.arrayUnion('general_user', 'cooperative_member'),
    });

    log('✅', `${label} — Import complete (uid: ${uid}, fee: ₦${fee.toLocaleString()}, tier: ${tier})`);
    return { status: 'created', email: member.email, uid, authCreated };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log('\n══════════════════════════════════════════════════════');
    console.log('  Legacy Cooperative Member Import Script');
    console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN (no writes)' : '🚀 LIVE'}`);
    console.log('══════════════════════════════════════════════════════\n');

    if (!fs.existsSync(DATA_FILE)) {
        console.error(`❌  Data file not found: ${DATA_FILE}`);
        console.error('    Create the file and populate it with member records.');
        console.error('    See the template comment at the top of this script.');
        process.exit(1);
    }

    const members = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

    if (!Array.isArray(members) || members.length === 0) {
        console.error('❌  No members found in data file.');
        process.exit(1);
    }

    log('📋', `Found ${members.length} member(s) to process.\n`);

    const results = { created: 0, skipped: 0, dry_run: 0, failed: 0, errors: [] };

    for (let i = 0; i < members.length; i++) {
        const member = members[i];
        if (!member.email) {
            log('⚠️', `Row ${i + 1} — No email provided, skipping.`);
            results.failed++;
            continue;
        }

        try {
            const result = await importMember(member, i);
            if (result.status === 'created') results.created++;
            else if (result.status === 'skipped') results.skipped++;
            else if (result.status === 'dry_run') results.dry_run++;
        } catch (err) {
            log('❌', `[${i + 1}] ${member.email} — FAILED: ${err.message}`);
            results.failed++;
            results.errors.push({ email: member.email, error: err.message });
        }
    }

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  IMPORT SUMMARY');
    console.log('══════════════════════════════════════════════════════');
    if (DRY_RUN) {
        console.log(`  Would process: ${results.dry_run} member(s)`);
    } else {
        console.log(`  ✅  Created:   ${results.created}`);
        console.log(`  ⏭️   Skipped:   ${results.skipped}`);
        console.log(`  ❌  Failed:    ${results.failed}`);
        if (results.errors.length > 0) {
            console.log('\n  Failed records:');
            results.errors.forEach(e => console.log(`    - ${e.email}: ${e.error}`));
        }
    }
    console.log('══════════════════════════════════════════════════════\n');

    if (!DRY_RUN) {
        console.log('  Next Steps:');
        console.log('  1. Verify in Firebase Console → Firestore → cooperative_members');
        console.log('  2. Ask members to check their email for the password-reset link');
        console.log('  3. After they log in, they\'ll be prompted to complete the onboarding form');
        console.log('  4. Once form is submitted → Admin reviews → membershipStatus → active\n');
    }
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
