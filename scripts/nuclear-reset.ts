import { getAdminAuth, getAdminDb } from "../src/lib/firebase-admin";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function nuclearReset(email: string) {
    const auth = getAdminAuth();
    const db = getAdminDb();
    
    try {
        console.log(`Starting NUCLEAR RESET for ${email}...`);
        
        // 1. Find and delete old auth user
        try {
            const oldUser = await auth.getUserByEmail(email);
            await auth.deleteUser(oldUser.uid);
            console.log(`Deleted old Auth user: ${oldUser.uid}`);
            
            // Delete old Firestore doc
            await db.collection("users").doc(oldUser.uid).delete();
            console.log("Deleted old Firestore doc.");
        } catch (e) {
            console.log("No old user found in Auth.");
        }
        
        // 2. Create BRAND NEW user (new UID)
        const newUser = await auth.createUser({
            email: email,
            password: "Farmnation@2026",
            emailVerified: true
        });
        const newUid = newUser.uid;
        console.log(`Created NEW Auth user with UID: ${newUid}`);
        
        // 3. Create fresh Firestore document
        await db.collection("users").doc(newUid).set({
            uid: newUid,
            email: email,
            fullName: "Test farmNation User",
            firstName: "Test",
            lastName: "User",
            roles: ["general_user", "farmer", "investor"],
            isVerified: true,
            verified: true,
            profileComplete: true,
            serviceRegistrations: {
                farmNation: {
                    status: "approved",
                    appliedAt: new Date(),
                    approvedAt: new Date(),
                    role: "both"
                }
            },
            createdAt: new Date(),
            updatedAt: new Date()
        });
        console.log("Created fresh Firestore doc.");
        
        // 4. Clear Redis for BOTH old and new (just in case)
        const { redis } = await import("../src/lib/redis");
        const keys = await redis.keys(`*${email}*`);
        for (const k of keys) await redis.del(k);
        await redis.del(`user:profile:${newUid}`);
        console.log("Redis purged.");

        console.log(`NUCLEAR RESET COMPLETE. User can now login with ${email} / Farmnation@2026`);
    } catch (error) {
        console.error("Nuclear reset failed:", error);
    }
}

nuclearReset("farmnationuser@gmail.com");
