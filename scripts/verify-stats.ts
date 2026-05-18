import "dotenv/config";
import { db } from "./src/lib/firebase-admin";
import { COLLECTIONS } from "./src/lib/types/firestore";
import { getDashboardStatsAction } from "./src/app/actions/admin-analytics";
import { getGlobalPendingApprovalsAction, getPlatformMetricsAction } from "./src/app/actions/global-aggregation";

// Polyfill requireSession for testing
jest.mock("./src/lib/session-guard", () => ({
    requireSession: async () => ({ session: { user: { roles: ["super_admin"] } } })
}));

async function verify() {
    console.log("Fetching actual Firestore counts...");
    const counts = {
        users: await db.collection(COLLECTIONS.USERS).count().get().then(s => s.data().count),
        payments: await db.collection(COLLECTIONS.PROCESSED_PAYMENTS).where("status", "==", "completed").count().get().then(s => s.data().count),
    };
    console.log("Firestore Counts:", counts);
}
verify();
