const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey) {
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.slice(1, -1);
    }
    if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
    }
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
        }),
    });
}

const db = admin.firestore();

async function main() {
    console.log("Analyzing Firestore database for test seed patterns...");

    const collections = [
        "products",
        "land_listings",
        "land_verifications",
        "marketplaceOrders",
        "escrow_transactions",
        "escrow_messages",
        "disputes",
        "processedPayments",
        "failedPayments",
        "wallet_transactions"
    ];

    for (const col of collections) {
        const snap = await db.collection(col).get();
        console.log(`Collection: ${col.padEnd(25)} | Document Count: ${snap.size}`);
    }

    console.log("\n--- Searching for Test/E2E Users in Firestore ---");
    const usersSnap = await db.collection("users").get();
    let testUserCount = 0;
    
    usersSnap.forEach(doc => {
        const data = doc.data();
        const email = (data.email || "").toLowerCase();
        const name = (data.fullName || data.name || "").toLowerCase();
        
        const isTestEmail = email.includes("e2e") || 
                            email.includes("testuser") || 
                            email.includes("marketplaceuser") || 
                            email.includes("exportwindowuser") || 
                            email.includes("farmnationuser") || 
                            email.includes("academyuser") || 
                            email.includes("waveuser");
                            
        const isTestName = name.includes("test buyer") || 
                           name.includes("test seller") || 
                           name.includes("test user") ||
                           name.includes("e2e");

        if (isTestEmail || isTestName) {
            console.log(`Matched Test User: UID=${doc.id.padEnd(30)} | Email=${email.padEnd(40)} | Name=${data.fullName || data.name}`);
            testUserCount++;
        }
    });

    console.log(`\nTotal matched test/E2E users: ${testUserCount} (out of ${usersSnap.size} total users)`);
}

main().then(() => process.exit(0)).catch(err => {
    console.error("Inspection failed:", err);
    process.exit(1);
});
