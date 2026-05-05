import { getAdminDb } from "../src/lib/firebase-admin";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function searchUser(email: string) {
    const db = getAdminDb();
    
    console.log(`Deep searching for ${email}...`);
    
    // 1. Check 'users' by email field
    const snap = await db.collection("users").where("email", "==", email).get();
    console.log(`Found ${snap.size} docs in 'users' with email ${email}`);
    snap.docs.forEach(d => console.log(` - Doc ID: ${d.id}`));
    
    // 2. Check 'admin_users' by email field
    const snapAdmin = await db.collection("admin_users").where("email", "==", email).get();
    console.log(`Found ${snapAdmin.size} docs in 'admin_users' with email ${email}`);
    
    // 3. Check for 'Users' (Capital U)
    const snapCap = await db.collection("Users").where("email", "==", email).get();
    console.log(`Found ${snapCap.size} docs in 'Users' (Capital U) with email ${email}`);
    
    // 4. Check for 'user' (singular)
    const snapSing = await db.collection("user").where("email", "==", email).get();
    console.log(`Found ${snapSing.size} docs in 'user' (singular) with email ${email}`);

    // 5. Check if the Document ID exists in ANY other common collection
    if (snap.size > 0) {
        const uid = snap.docs[0].id;
        const collections = ["wave_members", "cooperative_members", "seller_verifications"];
        for (const col of collections) {
            const d = await db.collection(col).doc(uid).get();
            if (d.exists) console.log(`User ID ${uid} also exists in ${col}`);
        }
    }
}

searchUser("farmnationuser@gmail.com");
