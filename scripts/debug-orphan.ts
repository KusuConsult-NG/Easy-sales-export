
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";

async function debugOrphan() {
    const email = "muhammadsanialiyu1268@gmail.com";

    const uSnap = await db.collection("users").where("email", "==", email).get();
    if (uSnap.empty) {
        console.log("USER NOT FOUND IN USERS COLLECTION");
    } else {
        console.log("USER DATA:", JSON.stringify(uSnap.docs[0].data(), null, 2));
    }

    const wSnap = await db.collection("wave_applications").where("userEmail", "==", email).get();
    console.log("WAVE BY USEREMAIL COUNT:", wSnap.size);
    if (wSnap.size > 0) console.log("WAVE DATA:", JSON.stringify(wSnap.docs[0].data(), null, 2));

    const wSnap2 = await db.collection("wave_applications").where("email", "==", email).get();
    console.log("WAVE BY EMAIL COUNT:", wSnap2.size);
    if (wSnap2.size > 0) console.log("WAVE DATA (EMAIL):", JSON.stringify(wSnap2.docs[0].data(), null, 2));
}

debugOrphan().catch(console.error);
