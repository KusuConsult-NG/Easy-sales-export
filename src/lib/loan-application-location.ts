import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Where a loan application actually lives.
 *
 * APPLICATIONS ARE WRITTEN TO TWO COLLECTIONS, AND EVERY READER ASSUMED ONE.
 *
 *   loan_applications   submitLoanApplicationAction (the wizard),
 *                       /api/cooperative/apply-loan, loan-actions.ts
 *   cooperative_loans   _applyForLoanAction — and that is the ONLY path the
 *                       member loan page at /cooperatives/loans submits
 *                       through
 *
 * Three separate places opened `db.collection(LOAN_APPLICATIONS).doc(id)`
 * directly — the admin approval queue, the approve/reject/disburse actions, and
 * /api/admin/cooperative/approve-loan, which is the route the admin UI calls.
 * So an application a member filed through the UI was invisible in the queue
 * AND un-actionable: the approve route answered 404 for a row that plainly
 * existed.
 *
 * A member saw "application submitted". No admin ever saw it. Nothing reported
 * a discrepancy, because each half was internally consistent.
 *
 * WHY RESOLVE RATHER THAN REPOINT THE WRITER
 * ------------------------------------------
 * Applications already exist in both collections, filed by different paths over
 * the platform's life. Moving the writer would strand every row filed to date
 * behind the same invisibility. Resolving costs one extra read on the miss and
 * keeps both sets reachable.
 *
 * This lives in lib/ rather than beside one caller because three call sites
 * needed it, and three copies of a lookup rule is precisely how this codebase
 * arrived at the defect it is fixing.
 */

/** The collections an application may live in, most common first. */
export const LOAN_APPLICATION_COLLECTIONS = [
    COLLECTIONS.LOAN_APPLICATIONS,
    COLLECTIONS.COOPERATIVE_LOANS,
] as const;

export interface ResolvedLoanApplication {
    /** Document reference in the collection that actually holds the row. */
    ref: any;
    /** The collection name, to be passed to any status-transition claim. */
    collection: string;
    /** The snapshot, so callers do not re-read what was just fetched. */
    snap: any;
}

/**
 * Find an application by id in whichever collection holds it, or null.
 *
 * Checks loan_applications first: three of the four writers use it, so the
 * common case costs a single read.
 */
export async function resolveLoanApplication(
    applicationId: string,
): Promise<ResolvedLoanApplication | null> {
    if (!applicationId) return null;

    for (const collection of LOAN_APPLICATION_COLLECTIONS) {
        const ref = db.collection(collection).doc(applicationId);
        const snap = await ref.get();
        if (snap.exists) return { ref, collection, snap };
    }

    return null;
}

/**
 * Normalise a cooperative_loans row to the field names every reader expects.
 *
 * cooperative_loans keys the borrower as `memberId`; loan_applications uses
 * `userId`. The admin queue enriches rows by `userId`, so an un-normalised row
 * silently renders as "Unknown" with no bank details.
 */
export function normaliseLoanApplication<T extends Record<string, any>>(row: T, collection: string): T & {
    userId: string;
    _sourceCollection: string;
} {
    return {
        ...row,
        userId: row.userId || row.memberId,
        _sourceCollection: collection,
    };
}
