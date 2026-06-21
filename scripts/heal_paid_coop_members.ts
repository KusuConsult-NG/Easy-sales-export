import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { invalidateUserCache } from "../src/lib/cache-invalidation";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
    console.log("=========================================");
    console.log("HEALING PAID COOPERATIVE MEMBERS (ROBUST)");
    console.log(DRY_RUN ? "🔍 DRY RUN MODE" : "🔧 LIVE MODE - WRITING TO DB");
    console.log("=========================================");

    // 1. Fetch completed cooperative payments
    const paymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .get();

    // Map of reference -> payment details
    const paymentByRef = new Map<string, any>();
    // Map of userId -> payment details
    const paymentByUserId = new Map<string, any>();
    // Map of email -> payment details
    const paymentByEmail = new Map<string, any>();

    paymentsSnap.docs.forEach(doc => {
        const data = doc.data();
        const type = data.type || data.metadata?.type || data.metadata?.purpose || data.paystackMetadata?.purpose || "unknown";
        
        const isCoop = type === "cooperative_membership_registration" || 
                       type === "cooperative" || 
                       String(data.purpose).includes("cooperative") ||
                       String(data.metadata?.purpose).includes("cooperative");
        
        if (isCoop || type === "unknown") {
            const ref = data.reference || doc.id;
            const userId = data.userId || data.metadata?.userId || data.paystackMetadata?.userId;
            const email = data.customerEmail || data.email || data.metadata?.email || data.paystackMetadata?.email;

            const paymentInfo = {
                reference: ref,
                userId,
                email,
                amount: data.amount,
                type,
                docId: doc.id
            };

            paymentByRef.set(ref, paymentInfo);
            if (userId) {
                paymentByUserId.set(userId, paymentInfo);
            }
            if (email) {
                paymentByEmail.set(email.toLowerCase().trim(), paymentInfo);
            }
        }
    });

    console.log(`Loaded ${paymentByRef.size} completed payments.`);

    // 2. Fetch all cooperative members
    const coopSnap = await db.collection("cooperative_members").get();
    console.log(`Total cooperative members in DB: ${coopSnap.size}`);

    const toHeal: any[] = [];

    coopSnap.docs.forEach(doc => {
        const member = doc.data();
        const userId = member.userId || doc.id;
        const email = (member.email || "").toLowerCase().trim();
        const status = member.status || member.membershipStatus || "pending";
        const isCurrentlyActive = status === "active" || status === "approved";

        // Check if there is a payment matching ref, userId, or email
        const payInfoByRef = member.paymentReference ? paymentByRef.get(member.paymentReference) : null;
        const payInfoByUserId = userId ? paymentByUserId.get(userId) : null;
        const payInfoByEmail = email ? paymentByEmail.get(email) : null;
        const matchedPayment = payInfoByRef || payInfoByUserId || payInfoByEmail;

        if (matchedPayment && !isCurrentlyActive) {
            toHeal.push({
                docId: doc.id,
                userId,
                email: member.email,
                paymentReference: matchedPayment.reference,
                paymentAmount: matchedPayment.amount,
                currentStatus: status,
                docRef: doc.ref
            });
        }
    });

    console.log(`Identified ${toHeal.length} paid members who are currently pending and need healing.`);

    if (toHeal.length === 0) {
        console.log("No members need healing.");
        return;
    }

    if (DRY_RUN) {
        console.log("\nSample of members to heal:");
        console.log(JSON.stringify(toHeal.slice(0, 10), null, 2));
        return;
    }

    // 3. Batch check user documents existence
    console.log("Checking user profiles existence in batches...");
    const existingUserIds = new Set<string>();
    const chunkSize = 500;
    
    for (let i = 0; i < toHeal.length; i += chunkSize) {
        const chunk = toHeal.slice(i, i + chunkSize);
        const refs = chunk.map(m => db.collection("users").doc(m.userId));
        
        const docs = await db.getAll(...refs);
        docs.forEach(doc => {
            if (doc.exists) {
                existingUserIds.add(doc.id);
            }
        });
        console.log(`  Fetched chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(toHeal.length / chunkSize)}. Total users found: ${existingUserIds.size}`);
    }

    // 4. Process healing in batches
    let batch = db.batch();
    let updatesInBatch = 0;
    let totalUpdated = 0;

    for (const member of toHeal) {
        // 1. Update cooperative membership status
        batch.update(member.docRef, {
            status: "approved",
            membershipStatus: "approved",
            paymentStatus: "completed",
            paymentReference: member.paymentReference,
            updatedAt: FieldValue.serverTimestamp(),
            healedByScript: "heal_paid_coop_members"
        });
        updatesInBatch++;

        // 2. Update user document only if it exists
        if (existingUserIds.has(member.userId)) {
            const userRef = db.collection("users").doc(member.userId);
            batch.update(userRef, {
                roles: FieldValue.arrayUnion("cooperative_member"),
                "serviceRegistrations.cooperatives.status": "approved",
                "serviceRegistrations.cooperatives.paymentStatus": "completed"
            });
            updatesInBatch++;
        } else {
            console.log(`⚠️ User profile ${member.userId} does not exist. Skipping role updates for this user.`);
        }

        if (updatesInBatch >= 400) {
            await batch.commit();
            totalUpdated += Math.ceil(updatesInBatch / 2); // Approximate since some users are skipped
            console.log(`Committed batch of operations (Approx members: ${totalUpdated})`);
            batch = db.batch();
            updatesInBatch = 0;
        }
    }

    if (updatesInBatch > 0) {
        await batch.commit();
        console.log(`Committed final batch of operations.`);
    }

    // Invalidate Redis cache
    console.log("Invalidating caches for healed users...");
    for (const member of toHeal) {
        if (existingUserIds.has(member.userId)) {
            try {
                await invalidateUserCache(member.userId);
            } catch (e) {
                console.warn(`Could not invalidate cache for user ${member.userId}:`, e);
            }
        }
    }

    console.log("Healing complete! All paid cooperative members are now approved/active.");
}

main().catch(err => {
    console.error("Failed:", err);
    process.exit(1);
});
