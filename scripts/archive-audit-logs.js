/**
 * Audit Log Archival Script
 *
 * Run this manually or schedule it monthly via a cron job / Firebase Scheduled Function.
 * Archives audit_logs older than 90 days to a 'audit_logs_archive' collection,
 * then deletes them from the live collection to keep costs and query times low.
 *
 * Usage:
 *   node scripts/archive-audit-logs.js
 *   (requires GOOGLE_APPLICATION_CREDENTIALS set to your service account key)
 *
 * Note: Firestore Admin SDK allows deletes even though client rules say 
 * `allow delete: if false` — this script runs server-side with Admin privileges.
 */

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// Initialise Admin SDK  
if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
    });
}
const db = getFirestore();

const RETENTION_DAYS = 90;
const BATCH_SIZE = 400; // Firestore max batch is 500 — keep headroom

async function archiveAuditLogs() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    console.log(`\n[Audit Archival] Archiving logs older than ${cutoffDate.toISOString()}`);

    let totalArchived = 0;
    let totalDeleted = 0;
    let hasMore = true;

    while (hasMore) {
        // Read a batch of old logs
        const snapshot = await db.collection('audit_logs')
            .where('timestamp', '<', cutoffDate)
            .orderBy('timestamp', 'asc')
            .limit(BATCH_SIZE)
            .get();

        if (snapshot.empty) {
            hasMore = false;
            break;
        }

        // Write to archive collection + delete from live — two batches
        const archiveBatch = db.batch();
        const deleteBatch = db.batch();

        snapshot.docs.forEach((doc) => {
            // Archive: copy to audit_logs_archive with same document ID
            const archiveRef = db.collection('audit_logs_archive').doc(doc.id);
            archiveBatch.set(archiveRef, {
                ...doc.data(),
                archivedAt: FieldValue.serverTimestamp(),
            });

            // Delete from live collection
            deleteBatch.delete(doc.ref);
        });

        await archiveBatch.commit();
        await deleteBatch.commit();

        totalArchived += snapshot.size;
        totalDeleted += snapshot.size;
        console.log(`[Audit Archival] Processed batch of ${snapshot.size}. Total archived: ${totalArchived}`);

        if (snapshot.size < BATCH_SIZE) {
            hasMore = false;
        }
    }

    console.log(`\n[Audit Archival] Complete. Archived: ${totalArchived}, Deleted: ${totalDeleted}`);
    console.log(`[Audit Archival] Archive stored in 'audit_logs_archive' collection.`);
    console.log(`[Audit Archival] To set a TTL on archive, enable Firestore TTL policy on 'archivedAt' field.\n`);
}

archiveAuditLogs().catch((err) => {
    console.error('[Audit Archival] FAILED:', err);
    process.exit(1);
});
