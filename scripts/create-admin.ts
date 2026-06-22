import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { getAdminAuth, getAdminDb } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function main() {
    const email = "admin.easysalesexport@gmail.com";
    const password = "Admin@2026";
    const auth = getAdminAuth();
    const db = getAdminDb();
    
    let uid;
    try {
        const user = await auth.getUserByEmail(email);
        uid = user.uid;
        await auth.updateUser(uid, { password });
        console.log("User exists, updated password.");
    } catch(e) {
        const user = await auth.createUser({
            email,
            password,
            displayName: "System Admin",
            emailVerified: true
        });
        uid = user.uid;
        console.log("Created new auth user.");
    }
    
    await db.collection(COLLECTIONS.USERS).doc(uid).set({
        email,
        fullName: "System Admin",
        firstName: "System",
        lastName: "Admin",
        roles: ["super_admin", "admin", "export_admin"], // Included export_admin just in case they need module-specific access
        isVerified: true,
        updatedAt: new Date()
    }, { merge: true });
    
    console.log("Admin account setup complete.");
    process.exit(0);
}

main().catch(console.error);
