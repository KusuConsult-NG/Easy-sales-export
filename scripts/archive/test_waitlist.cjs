const { db } = require("./src/lib/firebase-admin");
async function countWaitlist() {
  const collections = await db.listCollections();
  // console.log("Collections:", collections.map(c => c.id).join(", "));
  
  const snapshot = await db.collection("waitlist").get();
  console.log("WAITLIST_TOTAL=" + snapshot.docs.length);
  
  // also check another name if possible
  const snapshot2 = await db.collection("waitlists").get();
  if (snapshot2.docs.length > 0) {
     console.log("WAITLISTS_TOTAL=" + snapshot2.docs.length);
  }
}
countWaitlist();
