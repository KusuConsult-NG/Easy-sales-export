import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getPlatformMetricsAction } from "./src/app/actions/global-aggregation";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
if(!getFirestore) {
// It's already init inside the action's dependencies
}

async function run() {
    const metrics = await getPlatformMetricsAction();
    console.log(metrics);
}
run().catch(console.error);
