// @ts-nocheck
import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";

async function deprovisionMarketplace(email: string) {
    console.log(`Deprovisioning Marketplace access for ${email}...`);
    
    try {
        const usersRef = db.collection(COLLECTIONS.USERS);
        const snapshot = await usersRef.where("email", "==", email).get();
        
        if (snapshot.empty) {
            console.error(`Error: User with email ${email} not found.`);
            process.exit(1);
        }
        
        const userDoc = snapshot.docs[0];
        const userId = userDoc.id;
        const currentRoles = userDoc.data().roles || [];
        
        // Remove marketplace roles
        const filteredRoles = currentRoles.filter((r: string) => r !== "marketplace_buyer" && r !== "seller");
        
        await usersRef.doc(userId).update({
            roles: filteredRoles,
            
            // Remove marketplace registration
            "serviceRegistrations.marketplace": FieldValue.delete(),
            
            // Remove legacy flags
            "isSeller": FieldValue.delete(),
            "sellerVerificationStatus": FieldValue.delete(),
            "marketplace.role": FieldValue.delete(),
            
            updatedAt: FieldValue.serverTimestamp()
        });
        
        // Clear Redis cache
        try {
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
        } catch (e) {}
        
        console.log(`Success! Marketplace access removed for ${email}.`);
        process.exit(0);
    } catch (error) {
        console.error("Deprovisioning failed:", error);
        process.exit(1);
    }
}

deprovisionMarketplace("farmnationuser@gmail.com");
