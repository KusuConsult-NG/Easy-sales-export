const admin = require('firebase-admin');
const collections = {
    USERS: 'users',
    COOPERATIVE_MEMBERS: 'cooperative_members',
    EXPORT_APPLICATIONS: 'export_onboarding_applications',
    WAVE_APPLICATIONS: 'wave_applications'
};

// Initialize app with local credentials
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function runSweep() {
    try {
        console.log("Starting Reconcile Sweep...");
        const usersSnapshot = await db.collection(collections.USERS).get();
        console.log(`Scanning ${usersSnapshot.size} total users...`);
        
        let fragmentedUsers = 0;
        const scanResults = [];

        for (const userDoc of usersSnapshot.docs) {
            const userData = userDoc.data();
            const uid = userDoc.id;
            const registrations = userData.serviceRegistrations || {};

            let hasFragmentation = false;
            const fragments = [];

            // A. Check Cooperative Mismatch
            if (registrations.cooperative) {
                const globalStatus = registrations.cooperative.status;
                const memberRef = await db.collection(collections.COOPERATIVE_MEMBERS).doc(uid).get();
                if (memberRef.exists) {
                    const localStatus = memberRef.data()?.status || 'UNKNOWN';
                    if (globalStatus !== localStatus) {
                        fragments.push(`Cooperative: Global=${globalStatus}, Local=${localStatus}`);
                        hasFragmentation = true;
                    }
                }
            }

            // B. Check Export Mismatch
            if (registrations.export) {
                const globalStatus = registrations.export.status;
                const exportRef = await db.collection(collections.EXPORT_APPLICATIONS).doc(uid).get();
                if (exportRef.exists) {
                    const localStatus = exportRef.data()?.status || 'UNKNOWN';
                    if (globalStatus !== localStatus) {
                        fragments.push(`Export: Global=${globalStatus}, Local=${localStatus}`);
                        hasFragmentation = true;
                    }
                }
            }

            // C. Check WAVE Mismatch
            if (registrations.wave) {
                const globalStatus = registrations.wave.status;
                const waveRef = await db.collection(collections.WAVE_APPLICATIONS).doc(uid).get();
                if (waveRef.exists) {
                    const localStatus = waveRef.data()?.status || waveRef.data()?.applicationStatus || 'UNKNOWN';
                    // Allow acceptable divergence terms based on WAVE terminology
                    if (globalStatus !== localStatus && !(globalStatus === 'ACTIVE' && localStatus === 'APPROVED')) {
                        fragments.push(`WAVE: Global=${globalStatus}, Local=${localStatus}`);
                        hasFragmentation = true;
                    }
                }
            }

            if (hasFragmentation) {
                fragmentedUsers++;
                scanResults.push({
                    uid,
                    email: userData.email,
                    displayName: userData.fullName || 'Unknown',
                    fragments
                });
            }
        }

        console.log("\n====== SWEEP RESULTS ======");
        console.log(JSON.stringify({
            status: 'success',
            meta: {
                scanned_total: usersSnapshot.size,
                fragmented_count: fragmentedUsers,
                note: 'This was a READ-ONLY diagnostic sweep. No records were modified.'
            },
            fragmented_users: scanResults
        }, null, 2));

    } catch (error) {
        console.error('Failed to perform reconcile sweep:', error);
    }
}

runSweep();
