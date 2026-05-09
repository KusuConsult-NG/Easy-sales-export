
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";

async function peekUsers() {
    const snap = await db.collection("users").limit(5).get();
    snap.docs.forEach(d => {
        console.log(`ID: ${d.id}`);
        console.log(JSON.stringify(d.data(), null, 2));
        console.log("-------------------");
    });
}

peekUsers().catch(console.error);
