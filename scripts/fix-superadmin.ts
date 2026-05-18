import "dotenv/config";
import { adminAuth, db } from "../src/lib/firebase-admin";

async function fix() {
    const email = "admin.easysalesexport@gmail.com";
    try {
        const userRecord = await adminAuth.getUserByEmail(email);
        console.log("Found user:", userRecord.uid, "Email:", userRecord.email);
        console.log("Current custom claims:", userRecord.customClaims);
        
        // Ensure they have super_admin claim
        const updatedClaims = {
            ...userRecord.customClaims,
            super_admin: true,
            role: "super_admin",
            admin: true
        };
        await adminAuth.setCustomUserClaims(userRecord.uid, updatedClaims);
        console.log("Updated custom claims:", updatedClaims);

        // Update Firestore
        const userRef = db.collection("users").doc(userRecord.uid);
        const userDoc = await userRef.get();
        
        let roles = userDoc.data()?.roles || [];
        if (!roles.includes("super_admin")) roles.push("super_admin");
        if (!roles.includes("admin")) roles.push("admin");
        
        await userRef.set({
            roles: roles,
            isVerified: true
        }, { merge: true });
        
        console.log("Updated Firestore roles:", roles);
        
    } catch (e) {
        console.error("Error:", e);
    }
}

fix().catch(console.error).finally(() => process.exit(0));
