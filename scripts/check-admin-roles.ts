// @ts-nocheck
const { getAdminDb } = require('../src/lib/firebase-admin');

async function checkAdmins() {
    const db = getAdminDb();

    // Get all users with roles
    const snapshot = await db.collection('users').get();

    let adminFound = false;
    let mismatchedFound = false;

    console.log("Checking Admin Roles...");

    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.roles && Array.isArray(data.roles)) {
            const hasExactAdmin = data.roles.includes('admin') || data.roles.includes('super_admin');
            const hasCaseMismatch = data.roles.some(r => typeof r === 'string' && r.toLowerCase() === 'admin' && r !== 'admin');

            if (hasCaseMismatch) {
                console.log(`[MISMATCH] User ${data.email} has role: ${JSON.stringify(data.roles)}`);
                mismatchedFound = true;
            } else if (hasExactAdmin) {
                console.log(`[OK] User ${data.email} is an admin. Roles:`, data.roles);
                adminFound = true;
            }
        }
    });

    if (!adminFound && !mismatchedFound) {
        console.log("NO ADMINS FOUND IN DATABASE?!");
    }
}

checkAdmins().catch(console.error).finally(() => process.exit(0));
