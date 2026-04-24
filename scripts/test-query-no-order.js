const { db } = require("../src/lib/firebase-admin");

async function run() {
  try {
    let limit = 25;
    let filterState = "Lagos";

    let query = db.collection("wave_briefing_registrations");
    if (filterState) {
        query = query.where("state", "==", filterState);
    }
    // No orderBy here!
    query = query.limit(25);

    let countQuery = db.collection("wave_briefing_registrations");
    if (filterState) countQuery = countQuery.where("state", "==", filterState);

    console.log("Executing Promise.all with filter but NO orderBy...");
    const [snapshot, countSnap] = await Promise.all([
        query.get(),
        countQuery.count().get()
    ]);
    console.log("Promise.all succeeded. Docs:", snapshot.docs.length, "Count:", countSnap.data().count);
  } catch (e) {
    console.error("Test error:", e.message);
  }
}
run();
