import { db } from "./src/lib/firebase-admin";

async function run() {
    const memSnap = await db.collection("cooperative_members").get();
    let unknownCount = 0;
    
    for (const doc of memSnap.docs) {
        const d = doc.data();
        let name = d.firstName ? `${d.firstName} ${d.lastName || ''}` : d.fullName;
        
        if (!name && d.userId) {
            const uSnap = await db.collection("users").doc(d.userId).get();
            const uData = uSnap.data() || {};
            name = uData.firstName ? `${uData.firstName} ${uData.lastName || ''}` : (uData.name || uData.fullName || uData.displayName);
        }
        
        if (!name) unknownCount++;
    }
    console.log(`Unknown names: ${unknownCount} out of ${memSnap.docs.length}`);
}
run();
