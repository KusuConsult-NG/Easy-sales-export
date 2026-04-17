const admin = require('firebase-admin');
const dotenv = require('dotenv');
const fs = require('fs');

const env = dotenv.parse(fs.readFileSync('.env.local'));
const serviceAccount = {
  project_id: env.FIREBASE_PROJECT_ID,
  client_email: env.FIREBASE_CLIENT_EMAIL,
  private_key: env.FIREBASE_PRIVATE_KEY.replace(/\\\\n/g, '\\n').replace(/^\"|\"$/g, '')
};

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    const txSnap = await db.collection('processedPayments').orderBy("processedAt", "desc").limit(15).get();
    const allDocs = txSnap.docs.map(d => ({id: d.id, ...d.data()}));
    
    const recentTransactions = [];
    let collected = 0;
    for (const d of allDocs) {
        if (collected >= 8) break;
        const ts = d.processedAt ?? d.createdAt ?? d.date ?? null;
        if (Number(d.amount) > 0 || d.amount === undefined || d.registrationFee !== undefined) {
            recentTransactions.push({
                id: d.id || Math.random().toString(),
                type: d.type ?? d.action ?? "Transaction",
                amount: Number(d.amount ?? d.registrationFee) || 0,
                date: ts?.toDate ? ts.toDate().toISOString() : (ts ? new Date(ts).toISOString() : new Date(0).toISOString())
            });
            collected++;
        }
    }
    
    console.log("Recent TXs length:", recentTransactions.length);
    if(recentTransactions.length > 0) {
        console.log("First TX:", recentTransactions[0]);
    } else {
        console.log("Empty. Here is the first raw document from DB:", allDocs[0]);
    }
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
