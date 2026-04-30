import { getAdminDb } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function main() {
    const db = getAdminDb();
    
    // Fetch all users (this is a one-off script, so a full scan is fine for now)
    const snapshot = await db.collection(COLLECTIONS.USERS).get();
    
    const admins: { email: string, roles: string[] }[] = [];
    
    snapshot.forEach(doc => {
        const data = doc.data();
        const roles = data.roles || [];
        
        // Check if user has any admin role
        const isAdmin = roles.some((r: string) => 
            r === "super_admin" || 
            r === "admin" || 
            r === "moderator" || 
            r === "support" || 
            r.endsWith("_admin")
        );
        
        if (isAdmin && data.email) {
            admins.push({
                email: data.email,
                roles: roles
            });
        }
    });
    
    console.log("=== Admin Accounts ===");
    admins.forEach((admin, index) => {
        console.log(`${index + 1}. ${admin.email}`);
        console.log(`   Roles: ${admin.roles.join(', ')}`);
        console.log('---');
    });
    console.log(`Total Admin Accounts: ${admins.length}`);
    
    process.exit(0);
}

main().catch(console.error);
