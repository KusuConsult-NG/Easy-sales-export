import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { logger } from "@/lib/logger";
import { notifyMemberDecision } from "@/lib/member-decision-notice";

/**
 *   #693 A PAYOUT PAYSTACK ACCEPTED AND THEN FAILED WAS RECORDED AS COMPLETED.
 *
 *   A Paystack transfer is ASYNCHRONOUS. `POST /transfer` returns
 *   `{ status: true, data: { transfer_code, status: "pending" | "otp" } }` —
 *   the outer `status` says the API CALL was accepted; `data.status` says where
 *   the money is, and on acceptance it is `pending`. The money has not moved.
 *
 *   `initiateTransfer` checked `res.ok && data.status` and returned
 *   `success: true`, never reading `data.data.status`. Its own log line is
 *   honest — "Transfer initiated" — and every caller read the boolean as PAID:
 *
 *       status: payoutSuccess ? "completed" : "approved_pending_payout"
 *
 *   and wrote a TRANSACTIONS ledger row with `status: "completed"`.
 *
 *   THE OUTCOME ARRIVES BY WEBHOOK, AND THE WEBHOOK IGNORED IT. The Paystack
 *   route handles `charge.success`, `charge.failed` and `charge.abandoned`.
 *   Every `transfer.success`, `transfer.failed` and `transfer.reversed` fell
 *   through to `{ message: "Event ignored" }` with a 200.
 *
 *   So a transfer that Paystack accepted and a bank then rejected — a closed
 *   account, a name mismatch, an insufficient Paystack balance — left:
 *
 *       the member's balance DEBITED,
 *       the withdrawal marked COMPLETED,
 *       a ledger row saying they were paid,
 *       the money back in the Paystack balance,
 *
 *   and nothing anywhere that could notice. #318 covered the case where
 *   INITIATION was ambiguous, and reconcile-fulfilment reports those. This is
 *   the other one: initiation succeeded, so no flag was ever set.
 *
 * ── IT MARKS AND TELLS; IT DOES NOT MOVE MONEY ──────────────────────────────
 *
 *   A failed transfer means the money is provably still with the platform, so
 *   crediting the member back is arguably safe. It is deliberately not done
 *   here, for the reason cron/reconcile-fulfilment already gives for the four
 *   money-out paths it watches: "retrying a transfer moves money, and this
 *   route alerts rather than auto-heals". A webhook is the wrong place to move
 *   money automatically — it is replayable, it is attacker-reachable if the
 *   signature check ever regresses, and a credit racing an admin's manual
 *   correction pays twice.
 *
 *   What it does instead is everything short of that, and the part that was
 *   missing entirely: the record is flagged `needsReconciliation` — which
 *   reconcile-fulfilment ALREADY scans and reports — the failure is recorded
 *   with Paystack's own message, and THE MEMBER IS TOLD their payout did not
 *   arrive, which nothing did before.
 *
 *   THE STATUS IS NOT ROLLED BACK either. #250's rule: "A caller MUST NOT
 *   return the record to a state it can be paid from again; park it for
 *   reconciliation instead."
 */

/** What a payout reference's prefix says the money was for. */
interface PayoutKind {
    /** Collections to look in, in order — a prefix can span more than one. */
    collections: string[];
    /** How the member refers to it. */
    subject: string;
    /** Where they go to look. */
    link: string;
    /** The field holding the person who should have been paid. */
    payeeFields: string[];
}

/**
 *   The five prefixes payoutReference() produces, from the five money-out paths.
 *
 *   `WITHDRAW` spans three collections because admin/_withdrawals.ts resolves
 *   the withdrawal across them — the same shape as resolveLoanApplication.
 */
const KINDS: Record<string, PayoutKind> = {
    WITHDRAW: {
        collections: [
            COLLECTIONS.WITHDRAWALS,
            COLLECTIONS.COOPERATIVE_WITHDRAWALS,
            COLLECTIONS.WAVE_WITHDRAWALS,
        ],
        subject: "Your withdrawal",
        link: "/dashboard/wallet",
        payeeFields: ["userId", "memberId"],
    },
    WAVE: {
        collections: [COLLECTIONS.WAVE_WITHDRAWALS],
        subject: "Your WAVE withdrawal",
        link: "/wave/earnings",
        payeeFields: ["userId"],
    },
    WALLET: {
        collections: [COLLECTIONS.WALLET_TRANSACTIONS],
        subject: "Your wallet payout",
        link: "/dashboard/wallet",
        payeeFields: ["userId"],
    },
    ESCROW: {
        collections: [COLLECTIONS.MARKETPLACE_ORDERS],
        subject: "Your payout for an order",
        link: "/marketplace/seller/orders",
        payeeFields: ["sellerId", "vendorId"],
    },
    LOAN: {
        collections: [COLLECTIONS.LOAN_APPLICATIONS],
        subject: "Your loan disbursement",
        link: "/loans",
        payeeFields: ["userId"],
    },
};

export interface ParsedPayoutReference {
    prefix: string;
    entityId: string;
}

/**
 *   Split a payout reference back into its prefix and entity id.
 *
 *   payoutReference() joins them with "-" and the entity id may contain "-"
 *   itself, so only the FIRST segment is the prefix. Splitting on every "-"
 *   would truncate any uuid-shaped id, which is most of them.
 */
export function parsePayoutReference(reference: string): ParsedPayoutReference | null {
    if (typeof reference !== "string") return null;
    const at = reference.indexOf("-");
    if (at <= 0) return null;
    const prefix = reference.slice(0, at);
    const entityId = reference.slice(at + 1);
    if (!entityId || !(prefix in KINDS)) return null;
    return { prefix, entityId };
}

export type TransferEvent = "transfer.success" | "transfer.failed" | "transfer.reversed";

/** Everything that happened, so a caller can log one line and a test can read it. */
export interface PayoutOutcome {
    handled: boolean;
    reason?: string;
    collection?: string;
    entityId?: string;
    payee?: string;
}

/**
 *   Record what became of a transfer, and tell the payee when it did not arrive.
 *
 *   NEVER THROWS. It runs inside a webhook that must answer Paystack 200 or be
 *   retried; a failure to write a flag must not turn into a redelivery storm.
 */
export async function recordPayoutOutcome(params: {
    reference: string;
    event: TransferEvent;
    /** Paystack's own words, which are what an admin needs. */
    message?: string;
    amountNaira?: number | null;
}): Promise<PayoutOutcome> {
    const { reference, event, message, amountNaira } = params;

    const parsed = parsePayoutReference(reference);
    if (!parsed) {
        //   Not ours, or a reference from before payoutReference() existed.
        //   Worth a line: an unrecognised payout reference means money left the
        //   Paystack balance that this platform cannot account for.
        logger.warn("[payout-outcome] transfer event for an unrecognised reference", { reference, event });
        return { handled: false, reason: "unrecognised reference" };
    }

    const kind = KINDS[parsed.prefix];

    try {
        /*
         *   ONCE ONLY, and really once: .create() is an INSERT that throws
         *   ALREADY_EXISTS on a duplicate id. Paystack redelivers, and the part
         *   that must not repeat is the notice to the member — the flags below
         *   are idempotent, a second "your payout did not arrive" is not.
         */
        const eventId = `${reference}::${event}`;
        try {
            await db.collection(COLLECTIONS.PAYOUT_EVENTS).doc(eventId).create({
                id: eventId,
                reference,
                event,
                prefix: parsed.prefix,
                entityId: parsed.entityId,
                message: message ?? null,
                amount: typeof amountNaira === "number" ? amountNaira : null,
                receivedAt: FieldValue.serverTimestamp(),
            });
        } catch (error: any) {
            if (error?.code === "ALREADY_EXISTS") {
                return { handled: false, reason: "already recorded", entityId: parsed.entityId };
            }
            throw error;
        }

        //   Find the record the reference names.
        let found: { collection: string; data: Record<string, any> } | null = null;
        for (const collection of kind.collections) {
            const snap = await db.collection(collection).doc(parsed.entityId).get();
            if (snap.exists) { found = { collection, data: snap.data() ?? {} }; break; }
        }

        if (!found) {
            logger.error("[payout-outcome] no record for a transfer event", {
                reference, event, tried: kind.collections,
            });
            return { handled: false, reason: "record not found", entityId: parsed.entityId };
        }

        const payee = kind.payeeFields
            .map((f) => found!.data[f])
            .find((v) => typeof v === "string" && v.trim()) as string | undefined;

        const ref = db.collection(found.collection).doc(parsed.entityId);

        if (event === "transfer.success") {
            /*
             *   POSITIVE EVIDENCE, which nothing recorded before. A withdrawal
             *   marked "completed" carried no proof the money had moved — the
             *   status was written from the API ACCEPTING the transfer. This is
             *   the first field on the record that means it actually arrived.
             */
            await ref.update({
                payoutConfirmedAt: FieldValue.serverTimestamp(),
                payoutOutcome: "success",
                updatedAt: FieldValue.serverTimestamp(),
            });
            return { handled: true, collection: found.collection, entityId: parsed.entityId, payee };
        }

        /*
         *   FAILED OR REVERSED. The status is deliberately NOT rolled back —
         *   #250: a record must not be returned to a state it can be paid from
         *   again. `needsReconciliation` is the flag cron/reconcile-fulfilment
         *   already scans and reports, so this plugs into machinery that exists
         *   rather than inventing a second alerting path.
         */
        await ref.update({
            needsReconciliation: true,
            payoutOutcome: event === "transfer.reversed" ? "reversed" : "failed",
            payoutFailedAt: FieldValue.serverTimestamp(),
            payoutError: message
                ? `Paystack ${event}: ${message}`
                : `Paystack reported ${event} for this payout`,
            updatedAt: FieldValue.serverTimestamp(),
        });

        if (payee) {
            //   THE HALF THAT WAS MISSING ENTIRELY. Their balance is debited
            //   and the record says paid; without this they find out by
            //   checking their bank account and wondering.
            await notifyMemberDecision({
                userId: payee,
                subject: kind.subject,
                outcome: "rejected",
                amount: typeof amountNaira === "number" ? amountNaira : undefined,
                reason: message
                    ? `The bank transfer did not go through: ${message}. Our team is reconciling it.`
                    : "The bank transfer did not go through. Our team is reconciling it.",
                channel: "withdrawal",
                link: kind.link,
                linkText: "View details",
            });
        } else {
            logger.error("[payout-outcome] a failed payout has no payee to tell", {
                reference, event, collection: found.collection,
            });
        }

        return { handled: true, collection: found.collection, entityId: parsed.entityId, payee };
    } catch (error) {
        logger.error("[payout-outcome] could not record a transfer outcome", { reference, event, error });
        return { handled: false, reason: "error" };
    }
}
