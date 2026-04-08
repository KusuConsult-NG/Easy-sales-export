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
    console.log("Looking for all users with academy_learner role...");
    const snapshot = await db.collection("users").where("roles", "array-contains", "academy_learner").get();
    
    if (snapshot.empty) {
        console.log("No users found with 'academy_learner'. Everyone is updated!");
        return;
    }
    
    console.log(`Found ${snapshot.size} users with legacy academy_learner role. Updating...`);
    
    let count = 0;
    const batch = db.batch();

    for (const doc of snapshot.docs) {
        const data = doc.data();
        let finalRoles = [...(data.roles || [])];
        
        finalRoles = finalRoles.filter(r => r !== 'academy_learner');
        if (!finalRoles.includes('academy_participant')) {
            finalRoles.push('academy_participant');
        }
        
        batch.update(doc.ref, { roles: finalRoles });
        count++;
        
        // Firestore batches support up to 500 operations
        if (count % 400 === 0) {
            await batch.commit();
            console.log(`Committed ${count} updates...`);
        }
    }
    
    if (count % 400 !== 0) {
        await batch.commit();
        console.log(`Committed remaining updates. Total updated: ${count}`);
    }
    
    console.log("Migration complete.");
}

run().catch(console.error);
