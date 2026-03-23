/**
 * fix-processedpayments-type.js
 *
 * Repairs 34 backfilled processedPayments docs where type="unknown".
 * Maps paystackMetadata.purpose → correct type string.
 * Also creates academy_applications records for academy payments.
 *
 * Safe to re-run — checks existing before writing.
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
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const projectId = envVars.FIREBASE_PROJECT_ID;
const clientEmail = envVars.FIREBASE_CLIENT_EMAIL;
const privateKey = envVars.FIREBASE_PRIVATE_KEY;

if (!projectId || !clientEmail || !privateKey) {
    console.error("❌ Missing Firebase credentials");
    process.exit(1);
}
if (!getApps().length) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}
const db = getFirestore();

// Map from paystackMetadata.purpose → canonical type used by webhook
const PURPOSE_TO_TYPE = {
    "academy_registration": "academy_registration",
    "cooperative_membership_registration": "cooperative_membership_registration",
    "wave_registration": "wave_registration",
    "wave_application": "wave_application",
    "farm_nation_registration": "farm_nation_registration",
    "farm_nation_subscription": "farm_nation_subscription",
    "marketplace_order": "marketplace_order",
    "export_investment": "export_investment",
};

async function main() {
    console.log("🔧 Fixing processedPayments type field...\n");

    // Fetch all docs with type="unknown"
    const snap = await db.collection("processedPayments")
        .where("type", "==", "unknown")
        .get();

    console.log(`📊 Found ${snap.size} docs with type="unknown"\n`);

    let fixed = 0;
    let academyFixed = 0;
    let noMapping = 0;

    for (const doc of snap.docs) {
        const data = doc.data();
        const meta = data.paystackMetadata || {};
        const purpose = meta.purpose || null;
        const correctType = PURPOSE_TO_TYPE[purpose] || null;

        if (!correctType) {
            console.log(`  ⚠️  No mapping for purpose="${purpose}" on doc ${doc.id}`);
            noMapping++;
            continue;
        }

        // Fix the type field
        await doc.ref.update({ type: correctType });
        console.log(`  ✅ ${doc.id}: type "unknown" → "${correctType}" (userId: ${data.userId})`);
        fixed++;

        // For academy payments, create academy_applications if missing
        if (correctType === "academy_registration" && data.userId) {
            const userId = data.userId;
            const reference = data.reference || doc.id;
            const amount = data.amount || 0;
            const plan = meta.plan || (amount >= 100000 ? "elite" : amount >= 50000 ? "advanced" : "foundation");

            // Check if application already exists for this reference
            const existingApp = await db.collection("academy_applications")
                .where("paymentReference", "==", reference)
                .limit(1)
                .get();

            if (!existingApp.empty) {
                console.log(`     ℹ️  academy_applications already exists for ref ${reference}`);
                continue;
            }

            // Get user data
            let userData = {};
            try {
                const userSnap = await db.collection("users").doc(userId).get();
                userData = userSnap.data() || {};
            } catch (e) {
                console.warn(`     ⚠️  Could not fetch user ${userId}`);
            }

            const applicationId = `BACKFILL-ACADEMY-${reference}`;
            await db.collection("academy_applications").doc(applicationId).set({
                userId,
                applicationId,
                personalInfo: {
                    fullName: userData.fullName || userData.name || "Unknown",
                    email: userData.email || "Unknown",
                    phone: userData.phone || userData.phoneNumber || "",
                },
                education: {
                    educationLevel: "Not provided (backfilled from Paystack)",
                    fieldOfStudy: "Not provided",
                },
                status: "pending",
                paymentStatus: "completed",
                paymentReference: reference,
                paymentAmount: amount,
                plan,
                submittedAt: data.processedAt || FieldValue.serverTimestamp(),
                source: "paystack_backfill",
            });

            // Also update user's serviceRegistrations
            try {
                await db.collection("users").doc(userId).set({
                    serviceRegistrations: {
                        academy: {
                            paymentStatus: "completed",
                            paymentReference: reference,
                            paymentAmount: amount,
                            plan,
                            status: "pending",
                            applicationId,
                        }
                    },
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
            } catch (e) {
                console.warn(`     ⚠️  Could not update user serviceRegistrations for ${userId}`);
            }

            console.log(`     📋 academy_applications created for userId=${userId}, plan=${plan}, amount=₦${amount}`);
            academyFixed++;
        }
    }

    console.log("\n" + "═".repeat(60));
    console.log("✨ Fix Complete:");
    console.log(`   ✅ type field repaired    : ${fixed}`);
    console.log(`   📋 academy_applications   : ${academyFixed} created`);
    console.log(`   ⚠️  No mapping found       : ${noMapping}`);
    console.log("═".repeat(60));
}

main().catch((err) => {
    console.error("❌ Fatal error:", err);
    process.exit(1);
});
