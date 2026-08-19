/**
 * Which of the two loan products an application is for.
 *
 * LOAN_APPLICATIONS holds both, and no row said which. Three writers put rows
 * in it:
 *
 *   api/cooperative/apply-loan            cooperative — productId, a MANDATORY
 *                                         guarantor, a membership check and a
 *                                         savings-multiple cap
 *   cooperative/_loans_applications.ts    cooperative — the action behind the
 *                                         member loan form
 *   actions/loan-actions.ts               business — collateral and
 *                                         businessDetails, validated against
 *                                         lib/validations/loan.ts, which has no
 *                                         guarantor field at all
 *
 * Every admin queue then filtered on `status` and nothing else, so
 * /loans/approve listed cooperative applications and the cooperative admin
 * queue listed business ones. The concrete bypass — an unverified guarantor
 * being approvable on the door that did not check — was closed separately by
 * putting guarantorBlocksApproval on all three doors. What remained is that
 * the two products' underwriting is completely different and invisible to
 * whoever is looking at the list.
 *
 * WHY INFERENCE AND NOT A MIGRATION
 * ---------------------------------
 * Rows already in production carry no discriminator and cannot grow one
 * without a backfill. `loanProductOf` therefore reads the stamped field when it
 * is there and falls back to the fields that have ALWAYS distinguished the two
 * — a cooperative application records a productId and a guarantor, a business
 * application records collateral and businessDetails. So existing rows classify
 * correctly on the next read with no data change at all, and the stamp makes
 * new rows unambiguous.
 *
 * That also means the queues filter in memory rather than with a `where`: a
 * `where("loanProduct", "==", ...)` would silently drop every row written
 * before this existed, which is every row in production today.
 */

export type LoanProduct = "cooperative" | "business";

export const LOAN_PRODUCT_FIELD = "loanProduct";

function has(data: Record<string, unknown>, key: string): boolean {
    const v = data[key];
    if (v === undefined || v === null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (typeof v === "object") return Object.keys(v as object).length > 0;
    return true;
}

/**
 * The product this application is for.
 *
 * Returns "business" for a row that matches neither shape, because that is the
 * product with no membership, no guarantor and no savings cap — the weaker
 * claim. Reading an unknown row as "cooperative" would assert a membership and
 * a guarantor that may not exist.
 */
export function loanProductOf(data: Record<string, unknown> | null | undefined): LoanProduct {
    if (!data) return "business";

    const stamped = data[LOAN_PRODUCT_FIELD];
    if (stamped === "cooperative" || stamped === "business") return stamped;

    // A guarantor is mandatory on the cooperative door and absent from the
    // business schema, so it is the single most reliable signal.
    if (has(data, "guarantorName") || has(data, "productId")) return "cooperative";
    if (has(data, "collateral") || has(data, "businessDetails")) return "business";

    return "business";
}

export function isCooperativeLoan(data: Record<string, unknown> | null | undefined): boolean {
    return loanProductOf(data) === "cooperative";
}

export function isBusinessLoan(data: Record<string, unknown> | null | undefined): boolean {
    return loanProductOf(data) === "business";
}

/** Keep only the applications belonging to one product. */
export function filterByLoanProduct<T extends { data?: unknown }>(
    docs: T[],
    product: LoanProduct,
): T[] {
    return docs.filter((d) => {
        const raw = typeof (d as { data?: unknown }).data === "function"
            ? (d as unknown as { data: () => Record<string, unknown> }).data()
            : (d as unknown as Record<string, unknown>);
        return loanProductOf(raw) === product;
    });
}
