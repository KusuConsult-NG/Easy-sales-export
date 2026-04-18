import { db } from './src/lib/firebase-admin';
import { COLLECTIONS } from './src/lib/types/firestore';

async function testQuery() {
    try {
        console.log("Testing getAllExportRequestsAction query fallback to implicit Document ID...");
        
        let query: any = db.collection(COLLECTIONS.EXPORT_WINDOWS);
        // The exact code in the server action for when a filter is applied
        const statusFilter = "pending";
        console.log(`Setting filter: where("status", "==", "${statusFilter}")`);
        query = query.where("status", "==", statusFilter).limit(2);

        // Fetch first page
        const firstPageSnap = await query.get();
        console.log(`First page returned ${firstPageSnap.docs.length} docs.`);

        if (firstPageSnap.docs.length > 0) {
            const lastDoc = firstPageSnap.docs[firstPageSnap.docs.length - 1];
            console.log(`Last doc ID string fetched from first page: ${lastDoc.id}`);

            // This is what the UI does: gets the ID, sends it to the server action
            const lastDocIdString = lastDoc.id;

            // Inside server action again:
            const cursorDocReq = await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(lastDocIdString).get();
            if (cursorDocReq.exists) {
                console.log(`Successfully refetched cursorDoc! Exists: true. Passing to startAfter...`);
                // Create a fresh query exactly like the server action
                let query2: any = db.collection(COLLECTIONS.EXPORT_WINDOWS);
                query2 = query2.where("status", "==", statusFilter).limit(2);
                
                // CRITICAL TEST: startAfter with no explicit orderBy
                query2 = query2.startAfter(cursorDocReq);

                try {
                    const secondPageSnap = await query2.get();
                    console.log(`Second page returned ${secondPageSnap.docs.length} docs.`);
                    secondPageSnap.docs.forEach((d: any) => console.log(d.id));
                } catch (err: any) {
                    console.error("FATAL ERROR ON PAGE 2 EXECUTION:", err.message);
                }
            } else {
                console.log("Cursor doc not found?");
            }
        } else {
            console.log("No docs available for the first page to test startAfter. Creating dummies...");
            // Create some dummies
            await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc("docA").set({ status: "pending", createdAt: new Date() });
            await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc("docB").set({ status: "pending", createdAt: new Date() });
            await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc("docC").set({ status: "pending", createdAt: new Date() });
            console.log("Dummies created, re-run test.");
        }
    } catch(err) {
        console.error("Setup error:", err);
    }
}

testQuery().then(() => console.log("Done")).catch(console.error);
