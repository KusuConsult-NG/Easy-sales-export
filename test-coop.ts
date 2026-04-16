import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getCooperativeStatsAction } from "./src/app/actions/cooperative-admin";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, cert } from "firebase-admin/app";

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
if(!getFirestore) {
// It's already init inside the action's dependencies, maybe we need to mock session?
}
