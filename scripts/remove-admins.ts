import { getAdminAuth, getAdminDb } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function main() {
    const db = getAdminDb();
    
    const targetEmails = [
        "martynseric@gmail.com",
        "easysalesexport4@gmail.com",
        "easysalesexport2@gmail.com",
        "oladeledavid@gmail.com",
        "easysalesexport3@gmail.com"
    ];
    
    for (const email of targetEmails) {
        // Query user by email
        const snapshot = await db.collection(COLLECTIONS.USERS).where('email', '==', email).get();
        
        if (snapshot.empty) {
            console.log(`User not found: ${email}`);
            continue;
        }
        
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const currentRoles = data.roles || [];
            
            // Filter out any admin-related roles
            const newRoles = currentRoles.filter((role: string) => 
                role !== "admin" && role !== "super_admin"
            );
            
            // Ensure they at least have general_user
            if (newRoles.length === 0) {
                newRoles.push("general_user");
            }
            
            await doc.ref.update({
                roles: newRoles,
                updatedAt: new Date()
            });
            
            console.log(`Demoted ${email}. New roles: ${newRoles.join(', ')}`);
        }
    }
    
    console.log("Finished updating admin accounts.");
    process.exit(0);
}

main().catch(console.error);
