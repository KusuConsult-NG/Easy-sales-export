import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync('./service-account.json', 'utf8'));
} catch (e) {
  console.log("No local service account, trying default Application Default Credentials");
}

if (serviceAccount) {
    initializeApp({
        credential: cert(serviceAccount)
    });
} else {
    initializeApp();
}

const db = getFirestore();

async function run() {
    console.log("Looking for user steviekusu@gmail.com...");
    const snapshot = await db.collection("users").where("email", "==", "steviekusu@gmail.com").get();
    
    if (snapshot.empty) {
        console.log("User not found.");
        return;
    }
    
    for (const doc of snapshot.docs) {
        const data = doc.data();
        console.log("UserId (doc ID):", doc.id);
        console.log("Roles:", data.roles);
        console.log("ServiceRegs:", JSON.stringify(data.serviceRegistrations || {}, null, 2));
        
        let didUpdate = false;
        let finalRoles = [...(data.roles || [])];
        
        if (finalRoles.includes('academy_learner')) {
            finalRoles = finalRoles.filter(r => r !== 'academy_learner');
            if (!finalRoles.includes('academy_participant')) {
                finalRoles.push('academy_participant');
            }
            didUpdate = true;
        }
        
        if (didUpdate) {
            console.log("Updating roles to:", finalRoles);
            await doc.ref.update({
                roles: finalRoles
            });
            console.log("Update successful");
        }
    }
}

run().catch(console.error);
