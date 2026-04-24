import { getBriefingRegistrationsAction } from "../src/app/actions/briefing-admin";
import { db } from "../src/lib/firebase-admin";

async function run() {
    // Mock the session guard
    jest.mock("../src/lib/session-guard", () => ({
        requireSession: async () => ({
            session: { user: { roles: ["admin"] } }
        })
    }));

    try {
        const result = await getBriefingRegistrationsAction({}, 25);
        console.log("Result success:", result.success);
        console.log("Result error:", result.error);
        if (!result.success) {
            console.log("Full result:", JSON.stringify(result, null, 2));
        }
    } catch (e) {
        console.error("Caught error:", e);
    }
}
run();
