const admin = require('firebase-admin');
const https = require('https');

admin.initializeApp({
  credential: admin.credential.cert(require('../temp-sa.json'))
});
const db = admin.firestore();

function fetchPaystack(page) {
    return new Promise((resolve, reject) => {
        https.get('https://api.paystack.co/transaction?perPage=100&status=success&page=' + page, {
            headers: { 'Authorization': `Bearer sk_live_619313d0b5ed441d66597883863da06a7e77e366` }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

async function run() {
    let all = [];
    for(let i=1; i<=3; i++) {
        let json = await fetchPaystack(i);
        if(!json.data || json.data.length === 0) break;
        all.push(...json.data);
    }
    
    // Legacy mapping uses type or purpose
    const coop = all.filter(t => {
        const m = t.metadata || {};
        const type = m.type || m.purpose || "payment";
        return type === 'cooperative_membership_registration' || type === 'cooperative' || type.includes('cooperative');
    });
    
    console.log(`Found ${coop.length} cooperative payments on Paystack.`);

    for (const tx of coop) {
        const reference = tx.reference;
        const metadata = tx.metadata || {};
        const userId = metadata.userId;
        const tier = metadata.membershipTier || metadata.plan || "basic";
        const expectedType = "cooperative_membership_registration";
        
        if (!userId) continue;

        // Force write to ensure it registers correctly in the DB regardless of previous skips
        let memberRef;
        if (metadata.membershipId) {
            memberRef = db.collection('cooperative_members').doc(metadata.membershipId);
        } else {
            const querySnap = await db.collection('cooperative_members').where("userId", "==", userId).limit(1).get();
            if (!querySnap.empty) memberRef = querySnap.docs[0].ref;
            else memberRef = db.collection('cooperative_members').doc(userId); // Create missing
        }

        await db.runTransaction(async (t) => {
            const processedRef = db.collection('processedPayments').doc(reference);
            const userRef = db.collection('users').doc(userId);

            t.set(memberRef, {
                userId,
                paymentStatus: "completed",
                paymentReference: reference,
                membershipTier: tier,
                membershipStatus: "pending",
                paymentVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            t.set(userRef, {
                serviceRegistrations: { cooperatives: {
                    paymentStatus: "completed",
                    paymentReference: reference,
                    paymentAmount: tx.amount / 100,
                    membershipTier: tier,
                    status: "legacy_pending_onboarding",
                }},
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            t.set(processedRef, {
                reference,
                type: expectedType, // Force the correct exact string!
                userId,
                amount: tx.amount / 100,
                tier,
                processedAt: tx.paid_at ? new Date(tx.paid_at) : admin.firestore.FieldValue.serverTimestamp(),
                status: "completed",
                source: "force_sync"
            }, { merge: true });
        });
        process.stdout.write('.');
    }
    console.log('\nDone migrating missing legacy records.');
}
run().catch(console.error).then(() => process.exit(0));
