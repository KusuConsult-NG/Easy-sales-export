import { db } from "./src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

async function fixUser() {
    const userId = "rJP9wCmDQTYCXb7A1n7HJrcclpK2";
    console.log(`Creating cooperative_members doc for userId: ${userId}`);
    try {
        const userRef = db.collection("users").doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            console.log("User not found!");
            return;
        }
        
        const userData = userDoc.data()!;
        
        const memberRef = db.collection("cooperative_members").doc(userId);
        await db.runTransaction(async (t) => {
            t.set(memberRef, {
                userId: userId,
                paymentStatus: "completed",
                paymentReference: "rmug5qdb3w",
                membershipTier: "member",
                membershipStatus: "active", // Give them active status so they appear fully onboarded
                paymentVerifiedAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            t.update(userRef, {
                "serviceRegistrations.cooperatives.status": "active",
                updatedAt: FieldValue.serverTimestamp()
            });
        });
        
        console.log("Successfully created cooperative_members document and updated user status to active.");
    } catch (e) {
        console.error("Failed to fix user:", e);
    }
}

fixUser().then(() => process.exit(0));
