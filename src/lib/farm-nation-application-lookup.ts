/**
 * Finding one user's Farm Nation application — READ-ONLY.
 *
 *   #671 THE FORENSIC SCAN REPORTED 45 OF 50 FARMERS AS APPROVED WITH NO
 *   APPLICATION BEHIND THEM. THE APPLICATIONS WERE THERE.
 *
 *        The owner ran the production scan and Farm Nation Approval Drift came
 *        back Fail:
 *
 *            Scanned 50 accounts holding the farmer role; compared 1 against
 *            their authoritative application record. Found 45 whose user
 *            registration and application disagree.
 *
 *        and all forty-five read `user: approved, no application record`.
 *
 *        NINETY PER CENT OF A SAMPLE FAILING THE SAME WAY IS A STATEMENT ABOUT
 *        THE INSTRUMENT. The scan asked
 *
 *            farm_nation_applications where userId == <id>
 *
 *        and nothing else. Every real reader of this collection asks a WIDER
 *        question, because the collection has never been keyed one way:
 *
 *          _fn_onboarding.ts    userId field → applicationId on the user record
 *                               → userEmail (unclaimed only)
 *          module-access-check  userId field → userEmail → profile.email
 *          _applications.ts     the matched doc id → `legacy_<uid>`
 *          _legacy.ts           WRITES the doc id as `legacy_<uid>`
 *
 *        So an approved farmer whose application is reachable by applicationId
 *        or by address — but whose row has no `userId` field yet — is
 *        indistinguishable, to the scan, from an approval with nothing behind
 *        it. The readers BACKFILL `userId` when they find such a row, which is
 *        why the population that still lacks it is exactly the population that
 *        has not been through a reader lately.
 *
 *        THIS IS #488, IN A SECOND MODULE. There, the cooperative
 *        reconciliation reported "2 members with no membership record" and the
 *        rows were under auto-generated ids carrying `userId` as a field;
 *        `findCooperativeMemberRow` is that fix, and this is the same fix for
 *        the same mistake one module over. A forensic scan that asks a
 *        NARROWER question than the application manufactures findings, and an
 *        operator who learns to scroll past forty-five of them will scroll past
 *        the real one.
 *
 * ── WHY THIS PERFORMS NO WRITE ──────────────────────────────────────────────
 *
 *   Both real readers heal as they go: they `update({ userId })` on the row
 *   they matched. That is right for them and wrong here. The forensics screen
 *   tells the operator it only reads, and a scan that repairs what it measures
 *   cannot be run twice for the same answer — the second run reports a
 *   healthier platform because the first run edited it. The backfill belongs in
 *   an action somebody presses on purpose, not in the measurement.
 *
 * ── AND WHY AN EMAIL MATCH IS NARROWED ──────────────────────────────────────
 *
 *   Matching an application on an address is, in the onboarding path, a CLAIM —
 *   #36, and the reason `_fn_onboarding` only adopts a row with no `userId`.
 *   Reading is not claiming, but a row that already belongs to ANOTHER account
 *   is not evidence about this one, so the same restriction applies: a row
 *   matched by address counts only if it is unclaimed or already this user's.
 */

/** Which row answered, under which key — the key is reported, not just the fact. */
export interface FarmNationApplicationMatch {
    id: string;
    data: Record<string, any>;
    /** Which lookup found it. Named so a report can say how it was reached. */
    via: "userId" | "applicationId" | "legacyDocId" | "userEmail" | "profileEmail";
}

/** The identifying facts about the user, as the user document already holds them. */
export interface FarmNationApplicantKeys {
    userId: string;
    /** `serviceRegistrations.farmNation.applicationId`, when the user record carries one. */
    applicationId?: string | null;
    email?: string | null;
}

const rowsOf = (snap: any): any[] => (snap && !snap.empty ? snap.docs ?? [] : []);

/** A row matched by address counts only if nobody else owns it. */
const claimableBy = (docs: any[], userId: string): any | null =>
    docs.find((d) => {
        const owner = (d.data() ?? {}).userId;
        return !owner || owner === userId;
    }) ?? null;

/**
 * Locate every application belonging to this user, by every key the product
 * itself uses. Cheapest and most authoritative first; the first key that
 * answers wins.
 *
 * Returns `[]` only when NO key finds anything — which is the only state that
 * honestly means "no application record".
 *
 * @param applications the farm_nation_applications collection handle
 * @param keys         what the user document knows about this person
 */
export async function findFarmNationApplications(
    applications: any,
    keys: FarmNationApplicantKeys,
): Promise<FarmNationApplicationMatch[]> {
    const { userId } = keys;
    if (!userId) return [];

    //   1. The field every current writer sets, and the only key the scan used
    //      to ask about. All of a user's rows, not one — the caller decides
    //      which is current, and a member may hold an older rejected
    //      application beside a newer approved one.
    const byField = rowsOf(await applications.where("userId", "==", userId).get());
    if (byField.length > 0) {
        return byField.map((d) => ({ id: d.id, data: d.data() ?? {}, via: "userId" as const }));
    }

    //   2. The id the user's own record points at. This is the user document
    //      naming its application — as direct a statement of ownership as
    //      exists, and it needs no claim gate.
    if (keys.applicationId) {
        const direct = await applications.doc(keys.applicationId).get();
        if (direct.exists) {
            return [{ id: direct.id ?? keys.applicationId, data: direct.data() ?? {}, via: "applicationId" }];
        }
    }

    //   3. The document id the legacy importer writes. `_applications.ts` falls
    //      back to exactly this id, so rows under it are reachable by the
    //      product and must be reachable here.
    const legacy = await applications.doc(`legacy_${userId}`).get();
    if (legacy.exists) {
        return [{ id: legacy.id ?? `legacy_${userId}`, data: legacy.data() ?? {}, via: "legacyDocId" }];
    }

    const email = typeof keys.email === "string" ? keys.email.trim().toLowerCase() : "";
    if (!email) return [];

    //   4. The address the account signed up with, which is what submission
    //      writes to `userEmail`. Unclaimed-or-own only — see the header.
    const byUserEmail = claimableBy(rowsOf(await applications.where("userEmail", "==", email).limit(5).get()), userId);
    if (byUserEmail) {
        return [{ id: byUserEmail.id, data: byUserEmail.data() ?? {}, via: "userEmail" }];
    }

    //   5. The address on the application's own profile block. Weaker — nothing
    //      authenticated it, and `_fn_onboarding` deliberately stopped claiming
    //      on it (#36). It is here because `module-access-check` GRANTS ACCESS
    //      on it: a user this platform already lets into Farm Nation on the
    //      strength of such a row is not a user with "no application record",
    //      whatever one thinks of the key. Same unclaimed-or-own restriction.
    const byProfileEmail = claimableBy(rowsOf(await applications.where("profile.email", "==", email).limit(5).get()), userId);
    if (byProfileEmail) {
        return [{ id: byProfileEmail.id, data: byProfileEmail.data() ?? {}, via: "profileEmail" }];
    }

    return [];
}
