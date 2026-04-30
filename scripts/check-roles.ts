import { getAdminAuth, getAdminDb } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function main() {
    const db = getAdminDb();
    const emails = ["admin.easysalesexport@gmail.com", "easysaleswave@gmail.com"];
    for (const email of emails) {
        const snap = await db.collection(COLLECTIONS.USERS).where("email", "==", email).get();
        if (snap.empty) {
            console.log(email + ": Not found");
        } else {
            console.log(email + ": " + snap.docs[0].data().roles);
        }
    }
    process.exit(0);
}
main();
