/**
 * Tests for the session-scoped status actions in src/app/actions/my-data.ts.
 *
 * These two actions replaced the last three browser components that queried
 * Supabase with the public anon key. What matters here is that neither one can
 * be steered into reading something the caller did not ask for: the browser
 * passes a *kind*, never a query, and the row is always scoped to the session
 * user. Enabling row-level security depends on this staying true.
 */

import { getMyApplicationStatus, getMyMembershipStatus } from "@/app/actions/my-data";
import { COLLECTIONS } from "@/lib/types/firestore";

beforeAll(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(() => {
    (console.error as jest.Mock).mockRestore();
    (console.warn as jest.Mock).mockRestore();
});

/** An empty query result, in the shape the adapter returns. */
const emptySnap = { empty: true, docs: [], exists: false };

/** A single-document query result. */
function snapWith(data: Record<string, any>) {
    return {
        empty: false,
        exists: true,
        docs: [{ id: "doc-1", data: () => data }],
        data: () => data,
    };
}

describe("getMyApplicationStatus", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.mockFirestoreGet.mockResolvedValue(emptySnap);
    });

    it("refuses a collection that is not on the allowlist, without querying", async () => {
        const result = await getMyApplicationStatus("users", "roles");

        // #415 — "unknown", not "pending". See the note below.
        expect(result.status).toBe("unknown");
        expect(global.mockFirestoreCollection).not.toHaveBeenCalled();
    });

    it("refuses an allowlisted collection paired with an unlisted status field", async () => {
        const result = await getMyApplicationStatus(COLLECTIONS.WAVE_APPLICATIONS, "roles");

        expect(result.status).toBe("unknown");
        expect(global.mockFirestoreCollection).not.toHaveBeenCalled();
    });

    it("reads nothing when there is no session", async () => {
        global.mockRequireSession.mockResolvedValueOnce({ session: null, error: "Unauthorized" });

        const result = await getMyApplicationStatus(COLLECTIONS.WAVE_APPLICATIONS, "status");

        // #415 — the same word its neighbour getMyMembershipStatus has always
        // used for this, asserted twenty lines further down.
        expect(result.status).toBe("unauthenticated");
        expect(global.mockFirestoreCollection).not.toHaveBeenCalled();
    });

    it("returns the status of an allowlisted application", async () => {
        global.mockFirestoreGet.mockResolvedValue(
            snapWith({ status: "rejected", rejectionReason: "Incomplete documents" })
        );

        const result = await getMyApplicationStatus(COLLECTIONS.WAVE_APPLICATIONS, "status");

        expect(result.status).toBe("rejected");
        expect(result.rejectionReason).toBe("Incomplete documents");
        expect(global.mockFirestoreCollection).toHaveBeenCalledWith(COLLECTIONS.WAVE_APPLICATIONS);
    });

    it("reads farm-nation status off the user record, not an applications table", async () => {
        global.mockFirestoreGet.mockResolvedValue(
            snapWith({ serviceRegistrations: { farmNation: { status: "approved" } } })
        );

        const result = await getMyApplicationStatus(COLLECTIONS.USERS, "farmNation");

        expect(result.status).toBe("approved");
        expect(global.mockFirestoreCollection).toHaveBeenCalledWith(COLLECTIONS.USERS);
    });

    it("reports UNKNOWN rather than pending when the query fails", async () => {
        /**
         *   #415. This test used to assert "pending", and that was the defect:
         *   all five waiting screens leave the page on
         *   `applicationStatus === "approved"`, so answering a failed read with
         *   a definite "you are still waiting" held an approved applicant on a
         *   page telling them to wait. The neighbouring describe block has
         *   always asserted "unknown" and "unauthenticated" for exactly these
         *   two cases in getMyMembershipStatus; the two agree now.
         */
        global.mockFirestoreGet.mockRejectedValue(new Error("connection reset"));

        const result = await getMyApplicationStatus(COLLECTIONS.WAVE_APPLICATIONS, "status");

        expect(result.status).toBe("unknown");
    });
});

describe("getMyMembershipStatus", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.mockFirestoreGet.mockResolvedValue(emptySnap);
    });

    it("refuses an unknown module, without querying", async () => {
        const result = await getMyMembershipStatus("not-a-module");

        expect(result.status).toBe("unknown");
        expect(global.mockFirestoreCollection).not.toHaveBeenCalled();
    });

    it("reads nothing when there is no session", async () => {
        global.mockRequireSession.mockResolvedValueOnce({ session: null, error: "Unauthorized" });

        const result = await getMyMembershipStatus("wave");

        expect(result.status).toBe("unauthenticated");
        expect(global.mockFirestoreCollection).not.toHaveBeenCalled();
    });

    it("accepts a settled registration on the user record and stops there", async () => {
        global.mockFirestoreGet.mockResolvedValue(
            snapWith({ serviceRegistrations: { wave: { status: "approved" } } })
        );

        const result = await getMyMembershipStatus("wave");

        expect(result.status).toBe("approved");
        // Only the user record is read; the fallback collection is not touched.
        expect(global.mockFirestoreCollection).toHaveBeenCalledTimes(1);
        expect(global.mockFirestoreCollection).toHaveBeenCalledWith(COLLECTIONS.USERS);
    });

    it("falls back to the collection the writers actually use for farm-nation", async () => {
        // A pending registration is not settled, so the fallback runs.
        global.mockFirestoreGet.mockResolvedValue(
            snapWith({ serviceRegistrations: { farmNation: { status: "pending" } } })
        );

        await getMyMembershipStatus("farm-nation");

        // The browser version looked for "farmnation_applications", which no
        // writer produces, so this fallback never matched a row.
        expect(global.mockFirestoreCollection).toHaveBeenCalledWith(
            COLLECTIONS.FARM_NATION_APPLICATIONS
        );
    });

    it("treats cooperative and cooperatives as the same module", async () => {
        await getMyMembershipStatus("cooperative");
        expect(global.mockFirestoreCollection).toHaveBeenCalledWith(COLLECTIONS.COOPERATIVE_MEMBERS);

        jest.clearAllMocks();
        global.mockFirestoreGet.mockResolvedValue(emptySnap);

        await getMyMembershipStatus("cooperatives");
        expect(global.mockFirestoreCollection).toHaveBeenCalledWith(COLLECTIONS.COOPERATIVE_MEMBERS);
    });

    it("reports unknown when nothing is found, leaving the session value to stand", async () => {
        const result = await getMyMembershipStatus("wave");

        expect(result.status).toBe("unknown");
        expect(result.data).toBeNull();
    });
});
