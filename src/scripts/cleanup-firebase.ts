/**
 * DANGER: Firebase Data Cleanup Script
 * 
 * WARNING: This will DELETE ALL data from Firebase Auth and Firestore!
 * Use ONLY for testing/development environments, NEVER in production!
 * 
 * Usage:
 * 1. Ensure you're using the correct Firebase project (check .env.local)
 * 2. Run: npx tsx src/scripts/cleanup-firebase.ts
 * 3. Confirm the prompts
 * 4. All data will be permanently deleted
 */

import { adminAuth } from "@/lib/firebase-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import * as readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function question(query: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(query, resolve);
    });
}

async function deleteAllAuthUsers(): Promise<number> {
    console.log('\n🔥 Deleting all Firebase Auth users...');
    let count = 0;

    try {
        const listUsersResult = await adminAuth.listUsers(1000);

        for (const user of listUsersResult.users) {
            await adminAuth.deleteUser(user.uid);
            count++;
            console.log(`   ✓ Deleted user: ${user.email || user.uid}`);
        }

        console.log(`✅ Deleted ${count} Auth users\n`);
        return count;
    } catch (error) {
        console.error('❌ Error deleting Auth users:', error);
        throw error;
    }
}

async function deleteAllFirestoreData(): Promise<number> {
    console.log('🔥 Deleting all Firestore collections...');
    let totalDeleted = 0;

    // List of all collections to delete
    const collections = [
        'users',
        'marketplace_sellers',
        'marketplace_products',
        'marketplace_orders',
        'export_participants',
        'export_orders',
        'export_windows',
        'wave_members',
        'wave_applications',
        'cooperative_members',
        'cooperative_savings',
        'cooperative_loans',
        'cooperative_withdrawals',
        'land_listings',
        'property_inquiries',
        'academy_courses',
        'academy_enrollments',
        'certificates',
        'messages',
        'notifications',
        'testimonials',
        'admin_logs',
    ];

    for (const collectionName of collections) {
        const count = await deleteCollection(collectionName);
        totalDeleted += count;
    }

    console.log(`\n✅ Deleted ${totalDeleted} total Firestore documents\n`);
    return totalDeleted;
}

async function deleteCollection(collectionName: string, batchSize = 100): Promise<number> {
    const collectionRef = db.collection(collectionName);
    const query = collectionRef.limit(batchSize);

    return new Promise((resolve, reject) => {
        deleteQueryBatch(query, collectionName, resolve, reject, 0);
    });
}

async function deleteQueryBatch(
    query: import("@/lib/supabase-db").SupabaseQuery,
    collectionName: string,
    resolve: (value: number) => void,
    reject: (error: any) => void,
    deletedCount: number
) {
    try {
        const snapshot = await query.get();

        if (snapshot.size === 0) {
            console.log(`   ✓ ${collectionName}: ${deletedCount} documents deleted`);
            resolve(deletedCount);
            return;
        }

        const batch = db.batch();
        snapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });

        await batch.commit();

        const newDeletedCount = deletedCount + snapshot.size;

        // Recurse to delete more
        setImmediate(() => {
            deleteQueryBatch(query, collectionName, resolve, reject, newDeletedCount);
        });
    } catch (error) {
        console.error(`   ❌ Error deleting from ${collectionName}:`, error);
        reject(error);
    }
}

async function main() {
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║                                                       ║');
    console.log('║     🚨 FIREBASE DATA CLEANUP SCRIPT 🚨                ║');
    console.log('║                                                       ║');
    console.log('║     WARNING: This will DELETE ALL data!              ║');
    console.log('║                                                       ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    /**
     *   #304 THE ONLY GUARD ON THE MOST DESTRUCTIVE FILE IN THE REPOSITORY
     *        CHECKED A SYSTEM THIS SCRIPT DOES NOT TOUCH.
     *
     *        It read NEXT_PUBLIC_FIREBASE_PROJECT_ID and blocked if the name
     *        contained "prod":
     *
     *            if (projectId?.includes('prod') || projectId?.includes('production'))
     *
     *        while every delete below goes through `supabaseDb` — the SUPABASE
     *        database. Firebase is not this platform's datastore; the script's
     *        own import says so on line 15. So the guard inspected the name of a
     *        project that is no longer used and let the deletes run against the
     *        live one.
     *
     *        Three ways it failed:
     *
     *          WRONG SYSTEM.  A Supabase URL was never consulted at all.
     *          UNSET IS FALSY. With the Firebase variable absent — which it is,
     *                          Firebase having been left behind — `undefined?.
     *                          includes('prod')` is undefined, so the block did
     *                          not fire. The check passed by being unanswerable.
     *          NAME MATCHING.  Even pointed at the right system, "does the name
     *                          contain the letters p-r-o-d" is not a test of
     *                          whether a database holds real members' money.
     *
     *        Replaced with the guard scripts/seed-local.ts already uses, on the
     *        connection this script actually deletes through: the target must be
     *        localhost, or the operator must set an explicit variable whose
     *        value states what they are doing. Same shape, same wording, so
     *        there is one convention for "this touches a real database" rather
     *        than two.
     */
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    if (!supabaseUrl) {
        console.error('❌ BLOCKED: NEXT_PUBLIC_SUPABASE_URL is not set.');
        console.error('❌ This script deletes through Supabase; refusing to run without knowing the target.');
        process.exit(1);
    }

    const targetHost = new URL(supabaseUrl).hostname;
    const targetIsLocal =
        targetHost === 'localhost' || targetHost === '127.0.0.1' || targetHost === '0.0.0.0';

    if (!targetIsLocal && process.env.CLEANUP_ALLOW_REMOTE !== 'yes-destroy-a-remote-database') {
        console.error(`❌ BLOCKED: ${targetHost} is not a local database.`);
        console.error('❌ This deletes EVERY user and EVERY collection, and it cannot be undone.');
        console.error('❌ If you truly mean to wipe a remote TEST database, set');
        console.error('❌   CLEANUP_ALLOW_REMOTE=yes-destroy-a-remote-database');
        process.exit(1);
    }

    console.log(`Supabase target: ${targetHost}${targetIsLocal ? ' (local)' : ' (REMOTE — override in effect)'}\n`);

    // Confirmation prompts
    const confirm1 = await question('Are you ABSOLUTELY SURE you want to delete all data? (type "yes"): ');
    if (confirm1.toLowerCase() !== 'yes') {
        console.log('❌ Cancelled.');
        rl.close();
        process.exit(0);
    }

    // #304 This asked for the FIREBASE project id and compared against a
    // variable that is normally unset, so the operator was asked to confirm a
    // target the script was not going to touch. It names the Supabase host now
    // — the thing the deletes below actually run against.
    const confirm2 = await question(`Type the target host (${targetHost}) to confirm: `);
    if (confirm2 !== targetHost) {
        console.log('❌ Host mismatch. Cancelled.');
        rl.close();
        process.exit(0);
    }

    console.log('\n🔥 Starting deletion in 3 seconds...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    try {
        // Delete all data
        const authCount = await deleteAllAuthUsers();
        const firestoreCount = await deleteAllFirestoreData();

        console.log('╔═══════════════════════════════════════════════════════╗');
        console.log('║                                                       ║');
        console.log('║     ✅ CLEANUP COMPLETED                              ║');
        console.log('║                                                       ║');
        console.log(`║     Auth Users Deleted: ${authCount.toString().padEnd(28)} ║`);
        console.log(`║     Firestore Docs Deleted: ${firestoreCount.toString().padEnd(24)} ║`);
        console.log('║                                                       ║');
        console.log('║     Your Firebase is now clean! 🎉                    ║');
        console.log('║                                                       ║');
        console.log('╚═══════════════════════════════════════════════════════╝\n');

    } catch (error) {
        console.error('\n❌ Cleanup failed:', error);
        process.exit(1);
    }

    rl.close();
}

main();
