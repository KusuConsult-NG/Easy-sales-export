import { getAdminAuth, getAdminDb } from "../src/lib/firebase-admin";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function resetUser(email: string) {
    const auth = getAdminAuth();
    const db = getAdminDb();
    
    try {
        const user = await auth.getUserByEmail(email);
        const uid = user.uid;
        
        console.log(`Found user ${email} with UID ${uid}. Resetting...`);
        
        // 1. Get current data from Firestore
        const userDoc = await db.collection("users").doc(uid).get();
        const userData = userDoc.data();
        
        if (!userData) {
            console.error("Firestore data not found!");
            return;
        }
        
        // 2. Delete from Auth
        await auth.deleteUser(uid);
        console.log("Deleted from Auth.");
        
        // 3. Re-create in Auth with SAME UID
        await auth.createUser({
            uid: uid,
            email: email,
            password: "Password123!", // Setting a known temporary password
            emailVerified: true
        });
        console.log("Re-created in Auth.");
        
        // 4. Update Firestore to be 100% sure
        await db.collection("users").doc(uid).set({
            ...userData,
            email: email,
            uid: uid,
            updatedAt: new Date()
        });
        console.log("Firestore updated.");
        
        console.log(`User ${email} has been reset. Password is: Password123!`);
    } catch (error) {
        console.error("Reset failed:", error);
    }
}

resetUser("farmnationuser@gmail.com");
