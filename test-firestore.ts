import { db } from "./src/lib/firebase-admin";

async function testStartAfter() {
    console.log("Starting test...");
    // 1. Get a document that is approved
    const q1 = db.collection("seller_verifications").where("status", "==", "approved").limit(1);
    const snap1 = await q1.get();
    if (snap1.empty) {
        console.log("No approved doc found");
        return;
    }
    const doc = snap1.docs[0];
    console.log("Got doc:", doc.id, doc.data().status);

    // 2. Try to use it as startAfter in a pending query
    const q2 = db.collection("seller_verifications")
        .where("status", "==", "pending")
        .orderBy("createdAt", "desc")
        .startAfter(doc)
        .limit(5);

    try {
        const snap2 = await q2.get();
        console.log("Query 2 returned", snap2.docs.length, "docs");
    } catch (e) {
        console.error("Query 2 failed:", e);
    }
}

testStartAfter().then(() => process.exit(0));
