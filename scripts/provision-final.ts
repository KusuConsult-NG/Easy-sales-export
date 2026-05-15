// @ts-nocheck
import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";

async function provisionUser(email: string) {
    console.log(`Starting final provisioning and cache invalidation for ${email}...`);
    
    try {
        const usersRef = db.collection(COLLECTIONS.USERS);
        const snapshot = await usersRef.where("email", "==", email).get();
        
        if (snapshot.empty) {
            console.error(`Error: User with email ${email} not found.`);
            process.exit(1);
        }
        
        const userDoc = snapshot.docs[0];
        const userId = userDoc.id;
        
        console.log(`Found user ${userId}. Force-updating status to approved and ensuring roles...`);
        
        await usersRef.doc(userId).update({
            // Ensure all roles are present
            roles: FieldValue.arrayUnion("investor", "farmer", "marketplace_buyer", "seller"),
            
            // Explicitly set approved status and both roles
            "serviceRegistrations.farmNation.status": "approved",
            "serviceRegistrations.farmNation.role": "both",
            "serviceRegistrations.farmNation.accountType": "both",
            "serviceRegistrations.farmNation.approvedAt": FieldValue.serverTimestamp(),
            
            "serviceRegistrations.marketplace.status": "approved",
            "serviceRegistrations.marketplace.role": "both",
            "serviceRegistrations.marketplace.accountType": "both",
            "serviceRegistrations.marketplace.approvedAt": FieldValue.serverTimestamp(),
            
            // Legacy flags
            "farmNation.role": "both",
            "marketplace.role": "both",
            "sellerVerificationStatus": "approved",
            "isSeller": true,
            
            // Hub flag
            "profileComplete": true,
            
            updatedAt: FieldValue.serverTimestamp()
        });
        
        console.log(`Success! Firestore updated. Now attempting cache invalidation via Redis...`);
        
        // Try to invalidate Redis cache if possible
        try {
            // Note: Since this script runs outside the Next.js environment, 
            // we need to initialize Redis manually if we wanted to call invalidateUserCache.
            // For now, the updatedAt change + the checkModuleAccess Layer 2 should handle it.
            // But let's try to clear the userProfile key.
            const { createClient } = await import("redis");
            const redisUrl = process.env.REDIS_URL;
            if (redisUrl) {
                const client = createClient({ url: redisUrl });
                await client.connect();
                await client.del(`user:profile:${userId}`);
                await client.del(`seller:status:${userId}`);
                console.log(`Redis cache cleared for user ${userId}`);
                await client.disconnect();
            }
        } catch (redisError) {
            console.warn("Could not clear Redis cache (might be running in env without direct Redis access):", redisError);
        }
        
        console.log(`Done! ${email} should now have full access. Please ask the user to log out and log in one last time.`);
        process.exit(0);
    } catch (error) {
        console.error("Provisioning failed:", error);
        process.exit(1);
    }
}

const email = process.argv[2] || "farmnationuser@gmail.com";
provisionUser(email);
