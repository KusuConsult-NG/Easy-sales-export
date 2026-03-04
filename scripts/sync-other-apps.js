require('dotenv').config({ path: '.env.production.local' });
const admin = require('firebase-admin');

async function run() {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) privateKey = privateKey.slice(1, -1);
    if (privateKey.includes('\\n')) privateKey = privateKey.replace(/\\n/g, '\n');

    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
        })
    });

    const db = admin.firestore();
    const modules = [
        { collection: 'export_applications', key: 'export' },
        { collection: 'marketplace_applications', key: 'marketplace' },
        { collection: 'cooperative_members', key: 'cooperatives' },
        { collection: 'farm_applications', key: 'farmNation'},
        { collection: 'academy_users', key: 'academy' }
    ];

    for (const mod of modules) {
        console.log(`Checking ${mod.collection}...`);
        try {
            const snap = await db.collection(mod.collection).get();
            let count = 0;
            for (const doc of snap.docs) {
                const data = doc.data();
                const uid = data.userId || doc.id; // cooperatives uses doc.id sometimes
                if (uid) {
                    const userRef = db.collection('users').doc(uid);
                    const userDoc = await userRef.get();
                    if (userDoc.exists) {
                        const userData = userDoc.data();
                        const existingStatus = userData.serviceRegistrations?.[mod.key]?.status;
                        if (!existingStatus) {
                            const updateObj = {};
                            updateObj[`serviceRegistrations.${mod.key}.status`] = data.status || "pending";
                            updateObj[`serviceRegistrations.${mod.key}.applicationId`] = doc.id;
                            updateObj[`serviceRegistrations.${mod.key}.submittedAt`] = data.createdAt || admin.firestore.FieldValue.serverTimestamp();
                            await userRef.update(updateObj);
                            count++;
                        }
                    }
                }
            }
            console.log(`Synced ${count} records for ${mod.key}.`);
        } catch(e) { console.log(`Error checking ${mod.collection}`); }
    }
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
