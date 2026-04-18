const { db } = require("./src/lib/firebase-admin");

async function simulate() {
  try {
    console.log("Testing base query...");
    let query = db.collection("exportWindows").orderBy("createdAt", "desc").limit(1);
    const snap = await query.get();
    console.log("Base query succeeded, got", snap.docs.length, "docs");

    console.log("Testing startAfter on undefined field...");
    if (snap.docs.length > 0) {
      const docId = snap.docs[0].id;
      const cursorDoc = await db.collection("exportWindows").doc(docId).get();
      
      let brokenQuery = db.collection("exportWindows").where("status", "==", "pending").limit(50);
      brokenQuery = brokenQuery.startAfter(cursorDoc); // <--- FAILS if query doesn't match cursor fields!
      
      await brokenQuery.get();
      console.log("startAfter on broken query succeeded");
    } else {
       console.log("No docs to test cursor pagination");
    }
    
  } catch (e) {
    console.error("FIREBASE ERROR!!!");
    console.error(e.message);
  }
}

simulate();
