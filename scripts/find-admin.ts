import { db, adminAuth } from "../src/lib/firebase-admin";

async function findAdmins() {
    console.log("Searching for admins in Firestore users...");
    try {
        const snapshot = await db.collection("users").get();
        let count = 0;
        
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const roles = data.roles || [];
            const email = data.email || "";
            
            // Look for any admin role or admin-like email
            if (roles.includes("admin") || roles.includes("super_admin") || email.includes("admin") || email.includes("easysales")) {
                count++;
                console.log(`\n[Admin Found] UID: ${doc.id}`);
                console.log(`  Email: ${email}`);
                console.log(`  FullName: ${data.fullName || data.displayName || "(no name)"}`);
                console.log(`  Roles: ${JSON.stringify(roles)}`);
                console.log(`  Status: ${data.status || "(none)"}`);
                
                // Check if user exists in Firebase Auth
                try {
                    const authUser = await adminAuth.getUser(doc.id);
                    console.log(`  Firebase Auth status: EXISTS (Email: ${authUser.email}, Disabled: ${authUser.disabled})`);
                } catch (authErr: any) {
                    console.log(`  Firebase Auth status: MISSING/ERROR: ${authErr.message}`);
                }
            }
        }
        
        console.log(`\nFinished. Total Admin/Special accounts found: ${count}`);
    } catch (e: any) {
        console.error("Error searching Firestore:", e.message);
    }
}

findAdmins();
