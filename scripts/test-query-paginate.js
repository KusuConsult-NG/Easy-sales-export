const { db } = require("../src/lib/firebase-admin");

async function run() {
  try {
    let limit = 25;
    let filterState = "Lagos";

    let query = db.collection("wave_briefing_registrations");
    if (filterState) {
        query = query.where("state", "==", filterState);
    }
    
    // Get first page
    const p1 = await query.limit(1).get();
    const docId = p1.docs[0].id;
    console.log("P1 Doc ID:", docId);

    // Get second page using startAfter(docId)?
    const p2 = await query.orderBy("__name__").startAfter(docId).limit(1).get();
    console.log("P2 Doc ID:", p2.docs[0].id);

  } catch (e) {
    console.error("Test error:", e.message);
  }
}
run();
