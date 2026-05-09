
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";

async function debugUser() {
    const emailArg = process.argv[2];
    if (!emailArg) {
        console.error("Please provide an email address.");
        process.exit(1);
    }

    const uSnap = await db.collection("users").where("email", "==", emailArg).get();
    
    if (uSnap.empty) {
        console.log("No user found with email:", emailArg);
        return;
    }

    const data = uSnap.docs[0].data();
    const userId = uSnap.docs[0].id;
    console.log("USER DATA:", JSON.stringify(data, null, 2));

    const wSnapByUid = await db.collection("wave_applications").where("userId", "==", userId).get();
    console.log("WAVE BY UID COUNT:", wSnapByUid.size);
    if (wSnapByUid.size > 0) console.log("WAVE DATA:", JSON.stringify(wSnapByUid.docs[0].data(), null, 2));

    const fSnapByUid = await db.collection("farm_nation_applications").where("userId", "==", userId).get();
    console.log("FARM NATION BY UID COUNT:", fSnapByUid.size);
    if (fSnapByUid.size > 0) console.log("FARM NATION DATA:", JSON.stringify(fSnapByUid.docs[0].data(), null, 2));
}

debugUser().catch(console.error);
