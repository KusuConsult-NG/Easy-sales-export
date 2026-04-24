const { db } = require("../src/lib/firebase-admin");

async function run() {
  try {
    let limit = 25;
    let filterState = "Lagos";

    let query = db.collection("wave_briefing_registrations");
    if (filterState) {
        query = query.where("state", "==", filterState);
    }
    
    // Explicitly add orderBy("__name__") and see if it requires a composite index
    const p1 = await query.orderBy("__name__", "desc").limit(1).get();
    const docId = p1.docs[0].id;
    console.log("P1 Doc ID:", docId);

  } catch (e) {
    console.error("Test error:", e.message);
  }
}
run();
