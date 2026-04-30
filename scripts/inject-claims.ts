import { getAdminAuth } from "../src/lib/firebase-admin";

async function main() {
    const email = "admin.easysalesexport@gmail.com";
    const auth = getAdminAuth();
    
    try {
        const user = await auth.getUserByEmail(email);
        
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
            "academy_admin",
            "admin_dashboard_access"
        ];

        await auth.setCustomUserClaims(user.uid, { admin: true, roles: allAdminRoles });
        console.log("Custom claims updated successfully.");
    } catch(e) {
        console.error("Failed to update claims", e);
    }
    process.exit(0);
}
main();
