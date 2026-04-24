const { db } = require("../src/lib/firebase-admin");

async function run() {
  try {
    let limit = 25;
    let filterState = "Lagos";
    let cursor = null;
    let pageSize = 25;

    let query = db.collection("wave_briefing_registrations");
    if (filterState) query = query.where("state", "==", filterState);
    if (filterState) query = query.where("status", "==", "registered");
    query = query.orderBy("createdAt", "desc").limit(pageSize + 1);

    let countQuery = db.collection("wave_briefing_registrations");
    if (filterState) countQuery = countQuery.where("state", "==", filterState);
    if (filterState) countQuery = countQuery.where("status", "==", "registered");

    let snapshot;
    let countSnap;

    try {
        const results = await Promise.all([
            query.get(),
            countQuery.count().get()
        ]);
        snapshot = results[0];
        countSnap = results[1];
    } catch (e) {
        if (e.message && e.message.includes("index")) {
            console.log("Fallback triggered!");
            let fallbackQuery = db.collection("wave_briefing_registrations");
            if (filterState) fallbackQuery = fallbackQuery.where("state", "==", filterState);
            if (filterState) fallbackQuery = fallbackQuery.where("status", "==", "registered");
            
            const allDocsSnap = await fallbackQuery.get();
            const allDocs = allDocsSnap.docs;
            
            allDocs.sort((a, b) => {
                const timeA = a.data().createdAt?.toMillis?.() ?? 0;
                const timeB = b.data().createdAt?.toMillis?.() ?? 0;
                return timeB - timeA;
            });
            
            let startIndex = 0;
            if (cursor) {
                const cursorTime = new Date(cursor).getTime();
                if (!isNaN(cursorTime)) {
                    while (startIndex < allDocs.length && (allDocs[startIndex].data().createdAt?.toMillis?.() ?? 0) >= cursorTime) {
                        startIndex++;
                    }
                }
            }
            
            const slicedDocs = allDocs.slice(startIndex, startIndex + pageSize + 1);
            snapshot = { docs: slicedDocs };
            countSnap = { data: () => ({ count: allDocs.length }) };
        } else {
            throw e;
        }
    }

    const hasMore = snapshot.docs.length > pageSize;
    const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
    
    console.log("Returned Docs:", docs.length, "HasMore:", hasMore, "Total Count:", countSnap.data().count);
    if (docs.length > 0) {
        console.log("First doc date:", docs[0].data().createdAt.toDate().toISOString());
        console.log("Last doc date:", docs[docs.length - 1].data().createdAt.toDate().toISOString());
    }

  } catch (e) {
    console.error("Test error:", e.message);
  }
}
run();
