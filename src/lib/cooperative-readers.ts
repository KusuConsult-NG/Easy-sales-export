import "server-only";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { findCooperativeMemberRow } from "@/lib/cooperative-member-lookup";
import { fixedSavingsPlanStatus } from "@/lib/cooperative-savings";
import { normaliseLoanApplication } from "@/lib/loan-application-location";

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
        data: membershipData ?? {},
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
            ...data,
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

    return [
        ...generalSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            appliedAt: doc.data().appliedAt?.toDate?.() || new Date(),
        })),
        ...coopSnap.docs.map(doc => ({
            ...normaliseLoanApplication(doc.data(), COLLECTIONS.COOPERATIVE_LOANS),
            id: doc.id,
            appliedAt: doc.data().appliedAt?.toDate?.() || doc.data().createdAt?.toDate?.() || new Date(),
        })),
    ].sort((a: any, b: any) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime());
}
