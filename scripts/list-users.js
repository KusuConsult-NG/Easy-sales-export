const admin = require('firebase-admin');
const sa = require('../service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });

(async () => {
    try {
        const res = await admin.auth().listUsers(100);
        console.log('Total auth users:', res.users.length);
        res.users.forEach(u => console.log('  UID:', u.uid, '| Email:', u.email, '| Name:', u.displayName));

        const snap = await admin.firestore().collection('users').get();
        console.log('\nTotal Firestore users:', snap.size);
        snap.docs.forEach(d => {
            const data = d.data();
            console.log('  ID:', d.id, '| Email:', data.email, '| Role:', data.role);
        });
    } catch (e) { console.error('Error:', e.message); }
    process.exit(0);
})();
