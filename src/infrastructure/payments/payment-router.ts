/**
 * Which processor fulfils which Paystack payment type — stated once.
 *
 *   #531 NINE PROCESSORS, THREE ROUTERS, AND NOT ONE OF THEM DISPATCHED ALL
 *        NINE.
 *
 *   infrastructure/payments/service.ts exports nine fulfilment processors.
 *   Three places route a Paystack payment to them, and each was written by
 *   hand:
 *
 *                                          webhook   cron    admin sync
 *     marketplace_order                       Y        Y         Y
 *     export_investment                       Y        Y         Y
 *     cooperative_membership_registration     Y        Y         Y
 *     academy_registration                    Y        Y         Y
 *     wallet_funding                          Y        Y         Y
 *     contribution                            Y        Y         .
 *     farm_nation_registration                .        .         Y
 *     farm_nation_subscription                .        .         Y
 *     wave_registration                       .        .         Y
 *     wave_application                        .        .         Y
 *
 *   Measured from the three dispatch chains, not assumed. The audit's most
 *   repeated finding — a rule that reached some of its doors — on the paths
 *   that decide whether somebody who paid gets what they paid for.
 *
 * ── AND THE THREE DISAGREED ABOUT WHAT TO DO WITH A TYPE THEY DID NOT KNOW ──
 *
 *   THE WEBHOOK GOT THIS RIGHT and its comment says why: "A type this route
 *   does not handle still needs a record, or an unknown payment vanishes
 *   silently. It is claimed explicitly, with a status that is NOT 'completed'
 *   so it is not summed as revenue, and logged loudly enough to be found."
 *
 *   THE CRON COUNTED IT AS HEALED. Its dispatch chain has no else, and the
 *   three lines after it run unconditionally:
 *
 *       // Successfully processed — increment local counter and add to set to
 *       // bypass discrepancy marking
 *       results.firebaseTotal++;
 *       firebaseRefs.add(tx.reference);
 *       continue;
 *
 *   The `continue` skips the `missingInFirebase.push` below. So a payment it
 *   could not route was counted as repaired AND removed from the discrepancy
 *   list — by the one job whose entire purpose is to surface payments the
 *   platform missed. The comment says "Successfully processed" about a case
 *   where nothing was processed.
 *
 *   THE ADMIN SYNC WROTE IT AS COMPLETED. Its else branch does
 *   `docRef.set({ status: "completed", ... })` on a payment nothing fulfilled.
 *   Four readers sum PROCESSED_PAYMENTS where status is "completed" as revenue
 *   (analytics.service twice, finance.service, the academy course report), so
 *   the money entered the platform's revenue figure with nobody credited — and
 *   because the sync skips a reference already marked completed, every later
 *   run skipped it too. Unfulfillable, counted, and permanently invisible.
 *
 *   THIS IS THE SHAPE OF THE TWELVE GHOST PAYMENTS. The twelve ₦10,000
 *   payments of 14–17 May 2026 carry bare Paystack references and no
 *   application metadata, so `metadata.type || metadata.purpose` is null and
 *   they fall through every branch — into exactly these two treatments.
 *
 * ── AND ONE OF THE THREE RESOLVED A LEGACY USER ID AND THE OTHER DID NOT ────
 *
 *   #449 established that a migrated member's uid has to be walked to the end
 *   of the chain, because "on a twice-migrated member the session said one
 *   account and this credited another". The webhook and the cron both call
 *   resolveActiveUserId. The admin sync read `metadata.userId ?? null` raw, so
 *   the manual repair tool — the one an admin reaches for when a payment did
 *   not land — could fulfil against a stale identity.
 *
 * ── WHY A TABLE AND NOT THREE CORRECTED CHAINS ──────────────────────────────
 *
 *   Because three corrected chains is what the last person wrote. The table is
 *   the single statement of which type goes where; the three callers ask it,
 *   and a test asserts that none of them dispatches by hand any more. A tenth
 *   processor added here reaches every door at once, which is the only version
 *   of this fix that does not come back.
 */

import { logger } from "@/lib/logger";
import {
    processMarketplaceOrder,
    processWalletFunding,
    processExportInvestment,
    processCooperativeRegistration,
    processAcademyRegistration,
    processCooperativeContribution,
    processFarmNationRegistration,
    processWaveRegistration,
    exportWindowIdFromMetadata,
} from "@/infrastructure/payments/service";

/** Everything a processor might need, gathered once by the caller. */
export interface PaystackPaymentContext {
    reference: string;
    /** Naira, not kobo. */
    amount: number;
    /** Already resolved through resolveActiveUserId by the caller — see #449. */
    userId: string;
    metadata: Record<string, any>;
    paidAt?: Date;
}

/**
 * The status a payment gets when nothing here can fulfil it.
 *
 * The webhook's own value, reused rather than respelled. Deliberately NOT
 * "completed": four readers sum completed payments as revenue.
 */
export const UNHANDLED_PAYMENT_STATUS = "unhandled_type";

type PaymentRoute = {
    types: readonly string[];
    run: (ctx: PaystackPaymentContext) => Promise<void>;
};

/**
 * The table. Each row is one processor and every spelling that reaches it.
 *
 * The multi-spelling rows are not tidiness: `farm_nation_registration` and
 * `farm_nation_subscription` both existed in the admin sync's chain, and
 * `metadata.purpose` from the old cooperative portal is why `type` has a
 * fallback at all.
 */
export const PAYMENT_ROUTES: readonly PaymentRoute[] = [
    {
        types: ["marketplace_order"],
        run: (c) => processMarketplaceOrder(c.reference, c.amount, c.userId, c.paidAt),
    },
    {
        types: ["export_investment"],
        // Either name — see exportWindowIdFromMetadata. Reading `exportId`
        // alone meant a live investment was never fulfilled (#449's neighbour).
        run: (c) => processExportInvestment(
            c.reference, c.amount, c.userId,
            exportWindowIdFromMetadata(c.metadata) as string, c.paidAt,
        ),
    },
    {
        types: ["cooperative_membership_registration"],
        run: (c) => processCooperativeRegistration(
            c.reference, c.amount, c.userId,
            c.metadata.membershipTier || c.metadata.plan || "Member",
            // Legacy payments from the old portal may not carry membershipId.
            c.metadata.membershipId || c.userId,
            c.paidAt,
        ),
    },
    {
        types: ["academy_registration"],
        run: (c) => processAcademyRegistration(c.reference, c.amount, c.userId, c.metadata.plan, c.paidAt),
    },
    {
        types: ["contribution"],
        run: (c) => processCooperativeContribution(c.reference, c.amount, c.userId, c.paidAt),
    },
    {
        types: ["farm_nation_registration", "farm_nation_subscription"],
        run: (c) => processFarmNationRegistration(c.reference, c.amount, c.userId, c.paidAt),
    },
    {
        types: ["wave_registration", "wave_application"],
        run: (c) => processWaveRegistration(c.reference, c.amount, c.userId, c.paidAt),
    },
    {
        types: ["wallet_funding"],
        // processWalletFunding throws on refusal, so a wallet credit that did
        // not happen is never counted as fulfilled — #298's rule, and the
        // reason every row here can be treated the same way by the callers.
        run: (c) => processWalletFunding(c.reference, c.paidAt),
    },
];

/** Every type any door dispatches. Derived, so it cannot drift from the table. */
export const HANDLED_PAYMENT_TYPES: ReadonlySet<string> = new Set(
    PAYMENT_ROUTES.flatMap((r) => r.types),
);

/**
 * Fulfil one payment.
 *
 * Returns true when a processor ran, false when no row claims the type. It does
 * NOT swallow a processor's failure: every processor throws on refusal and the
 * caller has to decide what that means for its own bookkeeping — the webhook
 * answers 500 so Paystack retries, the cron records a discrepancy, the sync
 * counts an error. A dispatcher that returned false for both "unknown type" and
 * "processor refused" would erase the difference between a payment nobody can
 * route and one that failed to credit, which is the distinction this whole
 * finding turns on.
 */
export async function dispatchPaystackPayment(
    type: string | null | undefined,
    ctx: PaystackPaymentContext,
): Promise<boolean> {
    if (!type) return false;

    const route = PAYMENT_ROUTES.find((r) => r.types.includes(type));
    if (!route) {
        logger.error(`[Payments] No processor for payment type on ${ctx.reference}`, { type });
        return false;
    }

    await route.run(ctx);
    return true;
}
