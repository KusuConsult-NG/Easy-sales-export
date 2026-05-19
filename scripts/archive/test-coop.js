const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json'); // assuming it exists or use default
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    const members = await db.collection('cooperative_members').get();
    let count = 0;
    members.forEach(doc => {
        const data = doc.data();
        if (data.paymentStatus === 'completed') count++;
    });
    console.log(`Total paymentStatus=completed: ${count}`);
    
    // Check processed_payments
    const pp = await db.collection('processed_payments').where('type', '==', 'cooperative_membership_registration').where('status', '==', 'completed').get();
    console.log(`Total processed payments: ${pp.size}`);
    
    const uids = new Set();
    pp.forEach(doc => uids.add(doc.data().userId || doc.data().customerEmail));
    console.log(`Total unique paid users in processed_payments: ${uids.size}`);
}
run();
