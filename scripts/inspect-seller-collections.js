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
    // Check a sample seller verification doc
    const snap = await db.collection("seller_verifications").limit(3).get();
    snap.docs.forEach(d => {
        const data = d.data();
        console.log("seller_verification doc:");
        console.log("  id:", d.id);
        console.log("  status:", data.status);
        console.log("  keys:", Object.keys(data).join(", "));
        console.log("  createdAt:", data.createdAt);
    });

    // Check all root-level collections to find what data we DO have
    const rootCols = await db.listCollections();
    console.log("\n=== ALL ROOT COLLECTIONS ===");
    for (const col of rootCols) {
        const count = await col.count().get();
        if (count.data().count > 0) {
            console.log(`  ${String(count.data().count).padStart(6)}  ${col.id}`);
        }
    }
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
