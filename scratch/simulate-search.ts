
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getAdminDb } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function simulateSearch(query: string) {
    const db = getAdminDb();
    const ADMIN_ROLES = ["admin", "super_admin", "wave_admin", "cooperative_admin", "marketplace_admin", "export_admin", "farmnation_admin", "academy_admin"];
    
    console.log(`Searching for "${query}"...`);

    // Simulate searchUsersAction logic
    const [adminsSnapshot, generalSnapshot] = await Promise.all([
        db.collection(COLLECTIONS.USERS).where("roles", "array-contains-any", ADMIN_ROLES).get(),
        db.collection(COLLECTIONS.USERS).orderBy("lastLoginAt", "desc").limit(500).get()
    ]);

    const users: any[] = [];
    const seenIds = new Set<string>();

    const processDoc = (doc: any) => {
        if (seenIds.has(doc.id)) return;
        const userData = doc.data();
        const fullName = (userData.fullName || "").toLowerCase();
        const email = (userData.email || "").toLowerCase();
        
        const matches = fullName.includes(query.toLowerCase()) || email.includes(query.toLowerCase());
        if (matches) {
            users.push({
                uid: doc.id,
                fullName: userData.fullName,
                email: userData.email,
                roles: userData.roles
            });
            seenIds.add(doc.id);
        }
    };

    adminsSnapshot.docs.forEach(processDoc);
    generalSnapshot.docs.forEach(processDoc);

    console.log(`Found ${users.length} matches:`);
    users.forEach(u => console.log(` - ${u.email} (${u.fullName})`));
}

simulateSearch("cooperativeuser02")
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
