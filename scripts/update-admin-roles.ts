import { getAdminAuth, getAdminDb } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function main() {
    const email = "admin.easysalesexport@gmail.com";
    const auth = getAdminAuth();
    const db = getAdminDb();
    
    let uid;
    try {
        const user = await auth.getUserByEmail(email);
        uid = user.uid;
    } catch(e) {
        console.error("User not found");
        process.exit(1);
    }
    
    const allAdminRoles = [
        "super_admin", 
        "admin", 
        "moderator",
        "support",
        "wave_admin", 
        "cooperative_admin", 
        "marketplace_admin", 
        "export_admin", 
        "farmnation_admin", 
        "academy_admin"
    ];

    await db.collection(COLLECTIONS.USERS).doc(uid).set({
        roles: allAdminRoles,
        updatedAt: new Date()
    }, { merge: true });
    
    console.log("Updated admin account with ALL admin roles.");
    process.exit(0);
}

main().catch(console.error);
