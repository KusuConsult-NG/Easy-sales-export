/**
 * investigate-data-gaps.js
 * Deep analysis of data gaps across all admin modules
 */

const path = require("path");
const fs = require("fs");

function readDotEnvLocal() {
    const envPath = path.join(__dirname, "..", ".env.local");
    const content = fs.readFileSync(envPath, "utf8");
    const vars = {};
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        let value = trimmed.substring(eqIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        value = value.replace(/\\n/g, "\n");
        vars[key] = value;
    }
    return vars;
}

const envVars = readDotEnvLocal();
const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

if (!getApps().length) {
    initializeApp({ credential: cert({ projectId: envVars.FIREBASE_PROJECT_ID, clientEmail: envVars.FIREBASE_CLIENT_EMAIL, privateKey: envVars.FIREBASE_PRIVATE_KEY }) });
}
const db = getFirestore();

async function main() {
    console.log("🔍 Deep Data Gap Investigation\n");

    // 1. Academy payments breakdown
    console.log("=== ACADEMY ===");
    const academyPayments = await db.collection("processedPayments")
        .where("type", "==", "academy_registration").count().get();
    console.log(`processedPayments with type=academy_registration: ${academyPayments.data().count}`);
    
    // Sample an academy_applications doc
    const appSample = await db.collection("academy_applications").limit(2).get();
    appSample.docs.forEach(d => console.log(`  academy_application sample: ${JSON.stringify(Object.keys(d.data()))}`));
    
    // Sample academy processedPayments
    const paymentSample = await db.collection("processedPayments")
        .where("type", "==", "academy_registration").limit(2).get();
    paymentSample.docs.forEach(d => {
        const data = d.data();
        console.log(`  processedPayment(academy) keys: ${JSON.stringify(Object.keys(data))}`);
        console.log(`  userId: ${data.userId}, amount: ${data.amount}, reference: ${d.id}`);
    });

    // 2. Cooperative members gap analysis
    console.log("\n=== COOPERATIVE MEMBERS GAP ===");
    const totalMembers = await db.collection("cooperative_members").count().get();
    const completedMembers = await db.collection("cooperative_members")
        .where("paymentStatus", "==", "completed").count().get();
    const pendingPaymentMembers = await db.collection("cooperative_members")
        .where("paymentStatus", "==", "pending").count().get();
    console.log(`Total cooperative_members: ${totalMembers.data().count}`);
    console.log(`  paymentStatus=completed: ${completedMembers.data().count}`);
    console.log(`  paymentStatus=pending: ${pendingPaymentMembers.data().count}`);
    
    // Sample a pending member to understand the structure
    const pendingMemberSample = await db.collection("cooperative_members")
        .where("paymentStatus", "==", "pending").limit(3).get();
    pendingMemberSample.docs.forEach(d => {
        const data = d.data();
        console.log(`  pending member id=${d.id}, keys: userId=${data.userId}, membershipStatus=${data.membershipStatus}, hasRef=${!!data.paymentReference}`);
    });

    // 3. Seller verifications breakdown  
    console.log("\n=== SELLER VERIFICATIONS ===");
    const sellerStatuses = {};
    const sellerSnap = await db.collection("seller_verifications").limit(500).get();
    sellerSnap.docs.forEach(d => {
        const s = d.data().status || 'undefined';
        sellerStatuses[s] = (sellerStatuses[s] || 0) + 1;
    });
    console.log("seller_verifications by status:", JSON.stringify(sellerStatuses));

    // 4. Check land listings alternative collections
    console.log("\n=== LAND / FARM NATION ===");
    const landCols = ["land_listings", "farm_listings", "farmNation_listings", "properties"];
    for (const col of landCols) {
        try {
            const snap = await db.collection(col).count().get();
            console.log(`  ${col}: ${snap.data().count}`);
        } catch(e) {
            console.log(`  ${col}: ERR`);
        }
    }

    // 5. Check export alternative collections
    console.log("\n=== EXPORT ===");
    const exportCols = ["export_applications", "export_requests", "exportRequests", "exports"];
    for (const col of exportCols) {
        try {
            const snap = await db.collection(col).count().get();
            console.log(`  ${col}: ${snap.data().count}`);
        } catch(e) {
            console.log(`  ${col}: ERR`);
        }
    }
    
    // Check processedPayments by type breakdown
    console.log("\n=== processedPayments BY TYPE ===");
    const allPayments = await db.collection("processedPayments").get();
    const typeMap = {};
    allPayments.docs.forEach(d => {
        const t = d.data().type || 'undefined';
        typeMap[t] = (typeMap[t] || 0) + 1;
    });
    Object.entries(typeMap).sort((a,b)=>b[1]-a[1]).forEach(([t, c]) => console.log(`  ${String(c).padStart(4)}  ${t}`));

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
