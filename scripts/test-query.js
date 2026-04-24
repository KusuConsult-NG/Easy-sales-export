const { db } = require("../src/lib/firebase-admin");

async function run() {
  try {
    let limit = 25;
    let cursor = undefined;
    let filterState = undefined;
    let filterRole = undefined;
    let filterStatus = undefined;
    let searchQuery = undefined;

    const pageSize = 25;

    let query = db.collection("wave_briefing_registrations");
    query = query.orderBy("createdAt", "desc").limit(pageSize + 1);

    let countQuery = db.collection("wave_briefing_registrations");

    console.log("Executing Promise.all...");
    const [snapshot, countSnap] = await Promise.all([
        query.get(),
        countQuery.count().get()
    ]);
    console.log("Promise.all succeeded");
    
    const hasMore = snapshot.docs.length > pageSize;
    const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
    const totalCount = countSnap.data().count;

    let data = docs.map(doc => {
        const d = doc.data();
        return {
            id: doc.id,
            ...d,
            createdAt: d.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
            updatedAt: d.updatedAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
            status: d.status || "registered",
            attended: d.attended ?? false,
            confirmationSent: d.confirmationSent ?? false,
        };
    });

    if (searchQuery) {
        data = data.filter(r =>
            r.fullName?.toLowerCase().includes(searchQuery) ||
            r.email?.toLowerCase().includes(searchQuery) ||
            r.phoneNumber?.toLowerCase().includes(searchQuery)
        );
    }

    const nextCursor = hasMore && docs.length > 0
        ? docs[docs.length - 1].data().createdAt?.toDate?.()?.toISOString() ?? null
        : null;

    console.log("Success! Returned data length:", data.length);
  } catch (e) {
    console.error("Test error:", e.message, e.stack);
  }
}
run();
