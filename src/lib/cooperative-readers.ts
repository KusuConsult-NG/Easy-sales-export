import "server-only";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { findCooperativeMemberRow } from "@/lib/cooperative-member-lookup";
import { fixedSavingsPlanStatus } from "@/lib/cooperative-savings";
import { normaliseLoanApplication } from "@/lib/loan-application-location";
import { serializeValue } from "@/lib/firestore-serialize";

/**
 * A cooperative member's own records, read once and defined once.
 *
 *   #564 THREE COOPERATIVE SCREENS ASKED THIS APPLICATION FOR THIS OVER HTTP.
 *
 *   /cooperatives/fixed-savings, /cooperatives/my-savings and
 *   /cooperatives/withdrawals were "use client" pages whose first act on mount
 *   was `fetch("/api/cooperative/...")` — the browser opening a second HTTP
 *   request back to the server that had just rendered the page. Same shape as
 *   #562's land and certificate screens.
 *
 * ── WHY A SHARED READER, AGAIN ──────────────────────────────────────────────
 *
 *   Because each handler carries a finding, and a copy of the query in a server
 *   page would be a second place for that finding to be true or false:
 *
 *     #488 A MEMBERSHIP LOOKUP BY DOCUMENT ID MISSES A MEMBER whose row carries
 *     `userId` as a FIELD, and a miss is indistinguishable from not being a
 *     member. findCooperativeMemberRow is the shared answer, and this route was
 *     the one whose verdict other screens most trust.
 *
 *     #419 THE PLAN STATUS IS DERIVED, NOT READ. Nothing ever wrote "matured",
 *     so a plan whose term had ended still showed a countdown and the "Matured
 *     Plans" section could not appear. Deriving it makes every row already in
 *     the database correct at the next read. The spread order matters: the
 *     derived status must come AFTER `...data` or the stored value wins again.
 *
 *   Both routes now call these too. One definition, more callers.
 *
 * ── EVERYTHING HERE CROSSES THE SERVER→CLIENT BOUNDARY ──────────────────────
 *
 *   #657 These are read by Server Components and handed to Client Components,
 *   and Next refuses to pass a class instance across that line. The adapter
 *   returns Timestamps — measured against the local stack, four of them on a
 *   cooperative_loans row and three on a cooperative_members row — so a
 *   document spread into a returned object carries them along.
 *
 *   The server said so on every render of /cooperatives/loans, three times:
 *
 *     ⨯ Error: Only plain objects, and a few built-ins, can be passed to
 *       Client Components from Server Components.
 *
 *   because readMyLoanApplications converted `appliedAt` — the field it sorts
 *   on and the one the screen prints — and spread the other three raw.
 *
 *   Every spread of a document goes through serializeValue now, which is the
 *   helper lib/firestore-serialize exists for and whose own header states this
 *   rule. NOT a list of timestamp fields: a list has to be maintained by hand
 *   against a schema nobody edits with this file open, and the three that
 *   leaked are exactly what that costs. The explicit `.toDate()` conversions
 *   stay where they are — after the spread — because the screens are written
 *   against Dates on those fields.
 *
 * ── AND THEY ARE STILL SESSION-SCOPED ───────────────────────────────────────
 *
 *   Each function takes a user id and reads only that member's rows, exactly as
 *   the handlers did after their own requireSession. Nothing here widens what a
 *   member can see; the caller is responsible for having resolved the session,
 *   and both callers do.
 */

export type CooperativeMembership =
    | { isMember: false; status: "not_member"; data: null }
    | { isMember: true; status: string; data: Record<string, any> };

/** Whether this user is a cooperative member, and what their status is. */
export async function readCooperativeMembership(userId: string): Promise<CooperativeMembership> {
    const memberRow = await findCooperativeMemberRow(
        db.collection(COLLECTIONS.COOPERATIVE_MEMBERS), userId,
    );

    if (!memberRow) {
        return { isMember: false, status: "not_member", data: null };
    }

    const membershipData = memberRow.data;

    return {
        isMember: true,
        status: membershipData?.membershipStatus || "pending",
        //   #657 — the whole member row, and it carries three Timestamps. Two
        //   of the three callers flatten to { isMember, status } and never
        //   expose it; a reader that is safe only because of what its callers
        //   happen to do is one refactor from the defect this fixed.
        data: serializeValue<Record<string, any>>(membershipData ?? {}),
    };
}

/** This member's fixed savings plans, newest first, with a DERIVED status. */
export async function readFixedSavingsPlans(userId: string): Promise<Record<string, any>[]> {
    const snapshot = await db.collection(COLLECTIONS.FIXED_SAVINGS_PLANS)
        .where("memberId", "==", userId)
        .orderBy("createdAt", "desc")
        .get();

    return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            //   #657 — serialized, not raw. `updatedAt` is on every dedicated
            //   table and was not in the list below.
            ...serializeValue<Record<string, any>>(data),
            //   #419 — after the spread, deliberately. See the header.
            status: fixedSavingsPlanStatus(data),
            startDate: data.startDate?.toDate?.() || new Date(),
            maturityDate: data.maturityDate?.toDate?.() || new Date(),
            createdAt: data.createdAt?.toDate?.() || new Date(),
        };
    });
}

/**
 * The loan products a member may actually apply for.
 *
 *   #570 Moved here from /api/cooperative/loan-products so /cooperatives/loans
 *   can read it on the SERVER instead of fetching the route from the browser.
 *
 *   INACTIVE PRODUCTS ARE NOT OFFERED. create-loan-product and
 *   update-loan-product both write `isActive: Boolean(isActive)` and NOTHING
 *   read it — not this route, not the admin list, not the application path — so
 *   an admin deactivating a product removed it from nowhere: it stayed on the
 *   public list at its old rate and could still be applied for. A toggle that
 *   is collected, stored and never consulted, and this one had a price on it.
 *
 *   The field list is a WHITELIST, not a spread: a loan product row is admin
 *   data and only these six fields are the offer.
 */
const PUBLIC_PRODUCT_FIELDS = [
    "name",
    "description",
    "minAmount",
    "maxAmount",
    "interestRate",
    "durationMonths",
] as const;

export async function readActiveLoanProducts(): Promise<Record<string, unknown>[]> {
    const snapshot = await db.collection(COLLECTIONS.LOAN_PRODUCTS)
        .where("isActive", "==", true)
        .orderBy("minAmount", "asc")
        .get();

    return snapshot.docs.map((doc: any) => {
        const data = doc.data() ?? {};
        const product: Record<string, unknown> = { id: doc.id };
        for (const field of PUBLIC_PRODUCT_FIELDS) {
            if (data[field] !== undefined) product[field] = data[field];
        }
        return product;
    });
}

/**
 * This member's loan applications, from BOTH places one can be filed.
 *
 *   #570 Moved here from /api/cooperative/my-loan-applications, with the
 *   finding it carries:
 *
 *   A MEMBER'S OWN APPLICATION DID NOT APPEAR IN THEIR OWN LIST. The page that
 *   calls this submits through applyForLoanAction, which files into
 *   cooperative_loans and keys the borrower `memberId`. The route read
 *   loan_applications by `userId`, so an application filed on that very page
 *   was never in the list rendered underneath the form. The member saw
 *   "submitted" and then nothing, indefinitely.
 *
 *   Both collections, newest first. See lib/loan-application-location.ts.
 */
export async function readMyLoanApplications(userId: string): Promise<Record<string, any>[]> {
    const [generalSnap, coopSnap] = await Promise.all([
        db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .where("userId", "==", userId)
            .orderBy("appliedAt", "desc")
            .get(),
        db.collection(COLLECTIONS.COOPERATIVE_LOANS)
            .where("memberId", "==", userId)
            .get(),
    ]);

    //   #657 — THE spread this finding is about. `appliedAt` was converted and
    //   createdAt, updatedAt and approvedAt went to the browser as Timestamp
    //   instances, which Next refuses and logged three times per render.
    //   serializeValue first, then the explicit Date the screen is written
    //   against, so nothing about `appliedAt` changes.
    return [
        ...generalSnap.docs.map(doc => ({
            id: doc.id,
            ...serializeValue<Record<string, any>>(doc.data()),
            appliedAt: doc.data().appliedAt?.toDate?.() || new Date(),
        })),
        ...coopSnap.docs.map(doc => ({
            ...serializeValue<Record<string, any>>(
                normaliseLoanApplication(doc.data(), COLLECTIONS.COOPERATIVE_LOANS),
            ),
            id: doc.id,
            appliedAt: doc.data().appliedAt?.toDate?.() || doc.data().createdAt?.toDate?.() || new Date(),
        })),
    ].sort((a: any, b: any) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime());
}
