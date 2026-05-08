/**
 * Comprehensive Platform-Wide Firestore Sanitization Script
 * Modules: Cooperative, Academy, Farm Nation, Export
 */
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const isCommit = process.argv.includes('--commit');

const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

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

async function processCollection(collectionName, sanitizer) {
    console.log(`\n--- ${isCommit ? 'EXECUTING' : 'DRY RUN'} Sanitization for ${collectionName} ---`);
    let lastDoc = null;
    let totalUpdated = 0;
    let totalProcessed = 0;
    const pageSize = 500;

    while (true) {
        let query = db.collection(collectionName).limit(pageSize);
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }

        const snapshot = await query.get();
        if (snapshot.empty) break;

        const docs = snapshot.docs;
        const batch = db.batch();
        let batchCount = 0;

        for (const doc of docs) {
            const data = doc.data();
            const updates = sanitizer(data, doc.id);

            if (Object.keys(updates).length > 0) {
                if (isCommit) {
                    batch.update(doc.ref, {
                        ...updates,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                } else if (totalUpdated < 3) {
                    console.log(`[DRY RUN] Would update doc ${doc.id} in ${collectionName}:`, JSON.stringify(updates));
                }
                totalUpdated++;
                batchCount++;
            }
        }

        if (isCommit && batchCount > 0) {
            try {
                await batch.commit();
            } catch (error) {
                console.error(`Error committing batch for ${collectionName}:`, error.message);
                await new Promise(resolve => setTimeout(resolve, 5000));
                await batch.commit();
            }
        }

        totalProcessed += docs.length;
        lastDoc = docs[docs.length - 1];
        console.log(`Progress in ${collectionName}: Processed ${totalProcessed}, ${isCommit ? 'Updated' : 'Matches'} ${totalUpdated}`);
    }
    console.log(`Finished ${collectionName}. Total ${isCommit ? 'Updated' : 'Identified'}: ${totalUpdated}`);
}

// GENERIC SANITIZER: versioning + timestamps
const genericSanitizer = (data) => {
    const updates = {};
    if (data._version === undefined) updates._version = 1;
    if (!data.createdAt && (data.submittedAt || data.timestamp || data.date)) updates.createdAt = data.submittedAt || data.timestamp || data.date;
    return updates;
};

// MEMBER SANITIZER: Specific for cooperative members
const memberSanitizer = (data) => {
    const updates = genericSanitizer(data);
    if (!data.status && data.membershipStatus) updates.status = data.membershipStatus;
    if (!data.status && !data.membershipStatus) updates.status = 'active'; // Default for member records
    return updates;
};

// APPLICATION SANITIZER: status + versioning
const applicationSanitizer = (data) => {
    const updates = genericSanitizer(data);
    if (!data.status && data.state && (data.state === 'pending' || data.state === 'approved' || data.state === 'rejected')) {
        updates.status = data.state;
    }
    if (!data.status) updates.status = 'pending';
    return updates;
};

// TRANSACTION SANITIZER: status + versioning
const transactionSanitizer = (data) => {
    const updates = genericSanitizer(data);
    if (!data.status) updates.status = 'completed';
    return updates;
};

// USER SANITIZER: paymentStatus for free modules
const userSanitizer = (data) => {
    const updates = {};
    const registrations = data.serviceRegistrations || {};
    let changed = false;

    // Free modules should always have paymentStatus: 'completed' if they are present
    const freeModules = ['farmNation', 'wave', 'marketplace', 'export'];

    for (const mod of freeModules) {
        if (registrations[mod] && registrations[mod].paymentStatus !== 'completed') {
            updates[`serviceRegistrations.${mod}.paymentStatus`] = 'completed';
            changed = true;
        }
    }

    return changed ? updates : {};
};

async function main() {
    try {
        const collections = [
            // Cooperative
            { name: 'cooperative_members', sanitizer: memberSanitizer },
            { name: 'cooperative_transactions', sanitizer: transactionSanitizer },
            { name: 'cooperative_onboarding_applications', sanitizer: applicationSanitizer },
            { name: 'loans', sanitizer: applicationSanitizer },
            { name: 'cooperative_withdrawals', sanitizer: transactionSanitizer },
            { name: 'cooperative_contributions', sanitizer: transactionSanitizer },
            
            // Academy
            { name: 'academy_applications', sanitizer: applicationSanitizer },
            { name: 'academy_enrollments', sanitizer: genericSanitizer },
            { name: 'course_progress', sanitizer: genericSanitizer },
            
            // Farm Nation
            { name: 'farm_nation_applications', sanitizer: applicationSanitizer },
            { name: 'farmNationProperties', sanitizer: genericSanitizer },
            
            // Export
            { name: 'export_onboarding_applications', sanitizer: applicationSanitizer },
            { name: 'exportInvestments', sanitizer: transactionSanitizer },

            // Users
            { name: 'users', sanitizer: userSanitizer }
        ];

        if (!isCommit) {
            console.log('NOTE: Running in DRY RUN mode. No data will be modified.');
            console.log('To commit changes, run with: node scripts/sanitize-platform-data.js --commit\n');
        }

        for (const col of collections) {
            await processCollection(col.name, col.sanitizer);
        }
        
        console.log('\n--- Full Platform Sanitization Complete ---');
    } catch (error) {
        console.error('Sanitization failed:', error);
    } finally {
        process.exit(0);
    }
}

main();
