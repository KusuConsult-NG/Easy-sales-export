const admin = require('firebase-admin');
const sa = require('../service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });

const TARGET_UID = 'HTRB2dWhFsfjDnJWyiI5SsBhmo73';
const TARGET_EMAIL = 'steviekusu@gmail.com';

(async () => {
    try {
        const db = admin.firestore();

        await db.collection('users').doc(TARGET_UID).set({
            email: TARGET_EMAIL,
            name: 'Stephen Kusu',
            role: 'super_admin',
            status: 'active',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        console.log(`✅ ${TARGET_EMAIL} promoted to super_admin`);

        // Verify
        const doc = await db.collection('users').doc(TARGET_UID).get();
        console.log('Verified role:', doc.data().role);
    } catch (e) {
        console.error('Error:', e.message);
    }
    process.exit(0);
})();
