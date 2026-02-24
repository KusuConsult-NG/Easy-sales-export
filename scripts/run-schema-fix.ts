/**
 * run-schema-fix.ts
 *
 * Comprehensive Firestore schema standardization script.
 * Reviews all platform collections and backfills missing/default fields
 * introduced by recent feature work (WAVE full form, Cooperative onboarding,
 * Marketplace scoped-cart, serviceRegistrations, KYC verifications, etc.)
 *
 * Usage:
 *   # Dry-run (safe — read-only, shows what would change):
 *   npx ts-node -P tsconfig.node.json scripts/run-schema-fix.ts
 *
 *   # Apply changes (wet-run):
 *   npx ts-node -P tsconfig.node.json scripts/run-schema-fix.ts --wet-run
 */

import * as admin from 'firebase-admin';
require('dotenv').config({ path: '.env.local' });

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        })
    });
}

const db = admin.firestore();
const TS = admin.firestore.FieldValue.serverTimestamp;

interface Report {
    collection: string;
    scanned: number;
    updated: number;
    details: string[];
}

function report(col: string): Report {
    return { collection: col, scanned: 0, updated: 0, details: [] };
}

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--wet-run');

console.log(`\n[SCHEMA FIX] Mode: ${DRY_RUN ? 'DRY RUN (read-only)' : '⚠️  WET RUN (writing to Firestore)'}\n`);

async function fix(
    r: Report,
    col: string,
    buildUpdates: (data: admin.firestore.DocumentData, id: string) => { updates: Record<string, any>; missing: string[] }
) {
    const snap = await db.collection(col).get();
    r.scanned = snap.size;
    const writes: Promise<any>[] = [];
    for (const doc of snap.docs) {
        const { updates, missing } = buildUpdates(doc.data(), doc.id);
        if (Object.keys(updates).length > 0) {
            r.details.push(`  [${doc.id}] missing: ${missing.join(', ')}`);
            r.updated++;
            if (!DRY_RUN) writes.push(doc.ref.update(updates));
        }
    }
    await Promise.all(writes);
}

async function run() {
    const reports: Report[] = [];

    // =========================================================================
    // 1. USERS
    // =========================================================================
    const rUsers = report('users');
    await fix(rUsers, 'users', (d, id) => {
        const updates: Record<string, any> = {};
        const missing: string[] = [];

        if (!d.roles || !Array.isArray(d.roles)) {
            // Migrate legacy `role` string to `roles` array
            updates.roles = d.role ? [d.role] : ['general_user'];
            missing.push('roles');
        }
        if (typeof d.isVerified === 'undefined') {
            updates.isVerified = d.verified ?? false;
            missing.push('isVerified');
        }
        if (typeof d.verified === 'undefined') {
            updates.verified = false;
            missing.push('verified');
        }
        if (!d.serviceRegistrations) {
            updates.serviceRegistrations = {};
            missing.push('serviceRegistrations');
        }
        if (!d.notifications) {
            updates.notifications = { email: true, push: false, sms: true };
            missing.push('notifications');
        }
        if (typeof d.onboardingCompleted === 'undefined') {
            updates.onboardingCompleted = false;
            missing.push('onboardingCompleted');
        }
        if (!d.createdAt) {
            updates.createdAt = TS();
            missing.push('createdAt');
        }
        if (!d.updatedAt) {
            updates.updatedAt = TS();
            missing.push('updatedAt');
        }

        return { updates, missing };
    });
    reports.push(rUsers);

    // =========================================================================
    // 2. WAVE APPLICATIONS (full 7-section form)
    // =========================================================================
    const rWave = report('wave_applications');
    await fix(rWave, 'wave_applications', (d) => {
        const updates: Record<string, any> = {};
        const missing: string[] = [];

        if (!d.status) { updates.status = 'pending'; missing.push('status'); }
        if (!d.applicationDate && !d.submittedAt) {
            updates.applicationDate = TS();
            missing.push('applicationDate');
        }
        if (typeof d.reviewedBy === 'undefined') { updates.reviewedBy = null; missing.push('reviewedBy'); }
        if (typeof d.rejectionReason === 'undefined') { updates.rejectionReason = null; missing.push('rejectionReason'); }
        if (!d.createdAt) { updates.createdAt = TS(); missing.push('createdAt'); }
        if (!d.updatedAt) { updates.updatedAt = TS(); missing.push('updatedAt'); }

        return { updates, missing };
    });
    reports.push(rWave);

    // =========================================================================
    // 3. WAVE MEMBERS
    // =========================================================================
    const rWaveMem = report('wave_members');
    await fix(rWaveMem, 'wave_members', (d) => {
        const updates: Record<string, any> = {};
        const missing: string[] = [];

        if (typeof d.active === 'undefined') { updates.active = true; missing.push('active'); }
        if (!d.enrolledAt) { updates.enrolledAt = TS(); missing.push('enrolledAt'); }
        if (!d.createdAt) { updates.createdAt = TS(); missing.push('createdAt'); }
        if (!d.updatedAt) { updates.updatedAt = TS(); missing.push('updatedAt'); }

        return { updates, missing };
    });
    reports.push(rWaveMem);

    // =========================================================================
    // 4. WAVE CERTIFICATES
    // =========================================================================
    const rWaveCert = report('wave_certificates');
    await fix(rWaveCert, 'wave_certificates', (d) => {
        const updates: Record<string, any> = {};
        const missing: string[] = [];

        if (!d.createdAt) { updates.createdAt = TS(); missing.push('createdAt'); }
        if (!d.certificateType) { updates.certificateType = 'completion'; missing.push('certificateType'); }

        return { updates, missing };
    });
    reports.push(rWaveCert);

    // =========================================================================
    // 5. WAVE SHIPMENTS
    // =========================================================================
    const rWaveShip = report('wave_shipments');
    await fix(rWaveShip, 'wave_shipments', (d) => {
        const updates: Record<string, any> = {};
        const missing: string[] = [];

        if (!d.status) { updates.status = 'pending'; missing.push('status'); }
        if (!d.updates || !Array.isArray(d.updates)) { updates.updates = []; missing.push('updates'); }
        if (!d.createdAt) { updates.createdAt = TS(); missing.push('createdAt'); }

        return { updates, missing };
    });
    reports.push(rWaveShip);

    // =========================================================================
    // 6. COOPERATIVE MEMBERS
    // =========================================================================
    const rCoopMem = report('cooperative_members');
    await fix(rCoopMem, 'cooperative_members', (d) => {
        const updates: Record<string, any> = {};
        const missing: string[] = [];

        if (typeof d.savingsBalance === 'undefined') { updates.savingsBalance = 0; missing.push('savingsBalance'); }
        if (typeof d.loanBalance === 'undefined') { updates.loanBalance = 0; missing.push('loanBalance'); }
        if (typeof d.isActive === 'undefined') { updates.isActive = true; missing.push('isActive'); }
        if (!d.joinedAt) { updates.joinedAt = TS(); missing.push('joinedAt'); }
        if (!d.updatedAt) { updates.updatedAt = TS(); missing.push('updatedAt'); }

        return { updates, missing };
    });
    reports.push(rCoopMem);

    // =========================================================================
    // 7. COOPERATIVE ONBOARDING APPLICATIONS (new collection)
    // =========================================================================
    const rCoopOnboard = report('cooperative_onboarding_applications');
    await fix(rCoopOnboard, 'cooperative_onboarding_applications', (d) => {
        const updates: Record<string, any> = {};
        const missing: string[] = [];

        if (!d.status) { updates.status = 'pending'; missing.push('status'); }
        if (!d.createdAt) { updates.createdAt = TS(); missing.push('createdAt'); }
        if (!d.updatedAt) { updates.updatedAt = TS(); missing.push('updatedAt'); }

        return { updates, missing };
    });
    reports.push(rCoopOnboard);

    // =========================================================================
    // 8. PRODUCTS
    // =========================================================================
    const rProducts = report('products');
    await fix(rProducts, 'products', (d) => {
        const updates: Record<string, any> = {};
        const missing: string[] = [];

        if (!d.status) { updates.status = 'draft'; missing.push('status'); }
        if (typeof d.price === 'undefined') { updates.price = 0; missing.push('price'); }
        if (typeof d.availableQuantity === 'undefined') { updates.availableQuantity = 0; missing.push('availableQuantity'); }
        if (!d.createdAt) { updates.createdAt = TS(); missing.push('createdAt'); }
        if (!d.updatedAt) { updates.updatedAt = TS(); missing.push('updatedAt'); }

        return { updates, missing };
    });
    reports.push(rProducts);

    // =========================================================================
    // 9. MARKETPLACE ORDERS
    // =========================================================================
    const rOrders = report('marketplace_orders');
    await fix(rOrders, 'marketplace_orders', (d) => {
        const updates: Record<string, any> = {};
        const missing: string[] = [];

        if (!d.paymentStatus) { updates.paymentStatus = 'pending'; missing.push('paymentStatus'); }
        if (!d.orderStatus) { updates.orderStatus = 'pending'; missing.push('orderStatus'); }
        if (!d.items || !Array.isArray(d.items)) { updates.items = []; missing.push('items'); }
        if (!d.createdAt) { updates.createdAt = TS(); missing.push('createdAt'); }
        if (!d.updatedAt) { updates.updatedAt = TS(); missing.push('updatedAt'); }

        return { updates, missing };
    });
    reports.push(rOrders);

    // =========================================================================
    // 10. EXPORT WINDOWS
    // =========================================================================
    const rExport = report('export_windows');
    await fix(rExport, 'export_windows', (d) => {
        const updates: Record<string, any> = {};
        const missing: string[] = [];

        if (!d.status) { updates.status = 'pending'; missing.push('status'); }
        if (typeof d.totalInvested === 'undefined') { updates.totalInvested = 0; missing.push('totalInvested'); }
        if (typeof d.spotsFilled === 'undefined') { updates.spotsFilled = 0; missing.push('spotsFilled'); }
        if (!d.createdAt) { updates.createdAt = TS(); missing.push('createdAt'); }
        if (!d.updatedAt) { updates.updatedAt = TS(); missing.push('updatedAt'); }

        return { updates, missing };
    });
    reports.push(rExport);

    // =========================================================================
    // 11. EXPORT INVESTMENTS
    // =========================================================================
    const rExportInv = report('export_investments');
    await fix(rExportInv, 'export_investments', (d) => {
        const updates: Record<string, any> = {};
        const missing: string[] = [];

        if (!d.status) { updates.status = 'pending'; missing.push('status'); }
        if (!d.createdAt) { updates.createdAt = TS(); missing.push('createdAt'); }
        if (!d.updatedAt) { updates.updatedAt = TS(); missing.push('updatedAt'); }

        return { updates, missing };
    });
    reports.push(rExportInv);

    // =========================================================================
    // 12. LOAN APPLICATIONS
    // =========================================================================
    const rLoans = report('loan_applications');
    await fix(rLoans, 'loan_applications', (d) => {
        const updates: Record<string, any> = {};
        const missing: string[] = [];

        if (!d.status) { updates.status = 'pending'; missing.push('status'); }
        if (!d.createdAt) { updates.createdAt = TS(); missing.push('createdAt'); }
        if (!d.updatedAt) { updates.updatedAt = TS(); missing.push('updatedAt'); }

        return { updates, missing };
    });
    reports.push(rLoans);

    // =========================================================================
    // 13. AUDIT LOGS
    // =========================================================================
    const rAudit = report('audit_logs');
    await fix(rAudit, 'audit_logs', (d) => {
        const updates: Record<string, any> = {};
        const missing: string[] = [];

        if (!d.timestamp && !d.createdAt) {
            updates.timestamp = TS();
            missing.push('timestamp');
        }

        return { updates, missing };
    });
    reports.push(rAudit);

    // =========================================================================
    // 14. BRIEFING SUBMISSIONS (offline wave/cooperative field captures)
    // =========================================================================
    const rBriefings = report('briefing_submissions');
    await fix(rBriefings, 'briefing_submissions', (d) => {
        const updates: Record<string, any> = {};
        const missing: string[] = [];

        if (!d.status) { updates.status = 'pending_sync'; missing.push('status'); }
        if (!d.source) { updates.source = 'online'; missing.push('source'); }
        if (!d.submittedAt) { updates.submittedAt = TS(); missing.push('submittedAt'); }

        return { updates, missing };
    });
    reports.push(rBriefings);

    // =========================================================================
    // 15. NOTIFICATIONS
    // =========================================================================
    const rNotif = report('notifications');
    await fix(rNotif, 'notifications', (d) => {
        const updates: Record<string, any> = {};
        const missing: string[] = [];

        if (typeof d.read === 'undefined') { updates.read = false; missing.push('read'); }
        if (!d.createdAt) { updates.createdAt = TS(); missing.push('createdAt'); }

        return { updates, missing };
    });
    reports.push(rNotif);

    // =========================================================================
    // PRINT REPORT
    // =========================================================================
    const totalUpdated = reports.reduce((s, r) => s + r.updated, 0);
    const totalScanned = reports.reduce((s, r) => s + r.scanned, 0);

    console.log('\n\n================ SCHEMA STANDARDIZATION REPORT ================');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'WET RUN (applied)'}`);
    console.log(`Total documents scanned: ${totalScanned}`);
    console.log(`Total documents requiring updates: ${totalUpdated}\n`);

    for (const r of reports) {
        const icon = r.updated > 0 ? '⚠️ ' : '✅';
        console.log(`${icon} ${r.collection.padEnd(42)} scanned=${r.scanned}  needs_update=${r.updated}`);
        if (r.details.length > 0 && r.updated < 20) {
            r.details.forEach(d => console.log(`     ${d}`));
        } else if (r.details.length >= 20) {
            console.log(`     ... and ${r.details.length} more`);
        }
    }

    if (DRY_RUN && totalUpdated > 0) {
        console.log('\n⚠️  DRY RUN complete. Re-run with --wet-run to apply changes.\n');
    } else if (!DRY_RUN) {
        console.log('\n✅ Changes applied to Firestore.\n');
    } else {
        console.log('\n✅ Schema is clean, no updates needed.\n');
    }
}

run()
    .then(() => process.exit(0))
    .catch(e => {
        console.error('Migration failed:', e);
        process.exit(1);
    });
