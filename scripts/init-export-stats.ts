import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
};

if (!getApps().length) {
    initializeApp({
        credential: cert(serviceAccount),
    });
}

const db = getFirestore();

async function initExportStats() {
    console.log("Initializing export_stats metadata...");

    try {
        const [
            pendingReviewCountSnap,
            pendingCountSnap,
            approvedCountSnap,
            rejectedCountSnap
        ] = await Promise.all([
            db.collection("export_onboarding_applications").where("status", "==", "pending_review").count().get(),
            db.collection("export_onboarding_applications").where("status", "==", "pending").count().get(),
            db.collection("export_onboarding_applications").where("status", "==", "approved").count().get(),
            db.collection("export_onboarding_applications").where("status", "==", "rejected").count().get()
        ]);

        const resubmittedSnap = await db.collection("export_onboarding_applications")
            .where("resubmittedAt", "!=", null)
            .count()
            .get()
            .catch(() => ({ data: () => ({ count: 0 }) })); 

        const pending = (pendingReviewCountSnap.data().count || 0) + (pendingCountSnap.data().count || 0);
        const approved = approvedCountSnap.data().count || 0;
        const rejected = rejectedCountSnap.data().count || 0;
        const resubmitted = resubmittedSnap.data().count || 0;

        console.log(`Stats to write: Pending: ${pending}, Approved: ${approved}, Rejected: ${rejected}, Resubmitted: ${resubmitted}`);

        await db.collection("system_metadata").doc("export_stats").set({
            pending,
            approved,
            rejected,
            resubmitted
        }, { merge: true });

        console.log("Successfully initialized export_stats metadata!");
    } catch (e) {
        console.error("Error initializing export_stats metadata", e);
    }
}

initExportStats();
