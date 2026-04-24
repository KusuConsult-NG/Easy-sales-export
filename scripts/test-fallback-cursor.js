const { db } = require("../src/lib/firebase-admin");

async function run() {
  try {
    let limit = 25;
    let filterState = "Lagos";
    let pageSize = 25;

    let fallbackQuery = db.collection("wave_briefing_registrations").where("state", "==", filterState);
    const allDocsSnap = await fallbackQuery.get();
    const allDocs = allDocsSnap.docs;
    
    allDocs.sort((a, b) => {
        const timeA = a.data().createdAt?.toMillis?.() ?? 0;
        const timeB = b.data().createdAt?.toMillis?.() ?? 0;
        return timeB - timeA;
    });

    const page1 = allDocs.slice(0, pageSize);
    const cursorTimeISO = page1[page1.length - 1].data().createdAt.toDate().toISOString();
    console.log("Cursor ISO:", cursorTimeISO);

    let cursorTime = new Date(cursorTimeISO).getTime();
    let startIndex = 0;
    while (startIndex < allDocs.length && (allDocs[startIndex].data().createdAt?.toMillis?.() ?? 0) >= cursorTime) {
        startIndex++;
    }

    const page2 = allDocs.slice(startIndex, startIndex + pageSize);
    console.log("Page 2 First item time:", page2[0].data().createdAt.toDate().toISOString());
    console.log("Page 1 Last item time:", cursorTimeISO);

  } catch (e) {
    console.error("Test error:", e.message);
  }
}
run();
