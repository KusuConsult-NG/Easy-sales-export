export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import {
    FIXED_SAVINGS_ANNUAL_RATE,
    projectedFixedSavingsProfit,
    validateFixedSavingsPlan,
    fixedSavingsMaturityDate,
} from "@/lib/cooperative-savings";
import { FieldValue } from "@/lib/firestore-compat";
import { debitJsonbBalance } from "@/lib/wallet-ledger";
import { canTransactAsMember, NOT_A_TRANSACTING_MEMBER_MESSAGE } from "@/lib/cooperative-membership-status";
import { compensateJsonbDebit } from "@/lib/wallet-ledger";

/**
 * API Route: Create Fixed Savings Plan
 * Uses a Firestore transaction for atomic balance deduction & plan creation
 */
export async function POST(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const userId = session.user.id;
        const { amount, durationMonths } = await request.json();

        // Validation, from lib/cooperative-savings.ts rather than inline.
        //
        // The minimum and the term bounds were written out here as literals,
        // and again in the member page's own checks, and again in
        // fixedSavingsSchema, which the sibling server action uses. Three
        // statements of what a valid plan is, free to disagree.
        const validation = validateFixedSavingsPlan(Number(amount), Number(durationMonths));
        if (!validation.valid) {
            return NextResponse.json(
                { success: false, message: validation.reason },
                { status: 400 }
            );
        }

        // Check if user is an approved cooperative member
        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
        const memberDoc = await memberRef.get();

        if (!memberDoc.exists) {
            return NextResponse.json(
                { success: false, message: "You must be a cooperative member to create fixed savings" },
                { status: 403 }
            );
        }

        const memberData = memberDoc.data()!;
        // This door already accepted either spelling; it is the shared rule now
        // so the two that accepted only "active" cannot drift back.
        if (!canTransactAsMember(memberData)) {
            return NextResponse.json(
                { success: false, message: NOT_A_TRANSACTING_MEMBER_MESSAGE },
                { status: 403 }
            );
        }

        // Calculate interest and maturity.
        //
        // The rate was `const interestRate = 14` here, one of FOUR literal
        // copies — two deciding what a member is paid, two deciding what a
        // member is told, with nothing keeping them equal. The loan limit
        // already showed what that costs: the figure shown and the figure
        // enforced differed by six times and nothing noticed.
        //
        // It is a rate PER YEAR, unlike every other rate in this codebase,
        // which is why the constant says so in its name. See the module header.
        const interestRate = FIXED_SAVINGS_ANNUAL_RATE;
        const projectedProfit = projectedFixedSavingsProfit(amount, durationMonths);

        // Lock the savings under a row lock before creating the plan.
        //
        // This was a read-check-write inside runTransaction, which takes no
        // lock, and the write was ABSOLUTE rather than an increment:
        //
        //     const currentBalance = userData.savingsBalance || 0;
        //     if (currentBalance < amount) throw ...
        //     transaction.update(memberRef, { savingsBalance: currentBalance - amount });
        //
        // Two defects, and the second is the worse one. Two plans created at
        // once both passed against the same balance and both deducted, so a
        // member could lock away more than they had. And because the write is
        // absolute, migration 010 cannot help it — 010 only makes the
        // FieldValue.increment sentinel atomic, and no sentinel is used here.
        // An absolute write computed from a stale read does not merely
        // double-deduct: it ERASES any other write to savingsBalance in
        // between, including a contribution's credit landing at the same
        // moment. The member's contribution disappeared and nothing errored.
        // Same shape as the restock in marketplace/_buyer.ts.
        //
        // _createFixedSavingsAction in cooperative/_actions.ts was converted to
        // debitJsonbBalance already; this route is the door the UI actually
        // calls, so the fix had gone to the copy nobody uses. See
        // docs/audit/integrity-sweep-2026-08-10.md.
        const debit = await debitJsonbBalance({
            table: "cooperative_members",
            id: userId,
            field: "savingsBalance",
            amount,
        });

        if (!debit.ok) {
            return NextResponse.json(
                {
                    success: false,
                    message: debit.reason === "insufficient_funds"
                        ? `Insufficient savings balance. You have ₦${Number(debit.balance).toLocaleString()} but need ₦${amount.toLocaleString()}. Please contribute more funds first.`
                        : "Member not found",
                },
                { status: 400 }
            );
        }

        // The funds are reserved by the debit above, which is the only step here
        // that took a lock. The two writes below are plain sequential writes —
        // the runTransaction wrapper around them bought nothing, since the
        // adapter flushes queued writes one at a time after the callback anyway.
        // From here the balance is ALREADY DOWN. A failure below used to leave
        // the member's savings reduced with no plan recorded — the money gone
        // and nothing to show for it.
        const planRef = db.collection(COLLECTIONS.FIXED_SAVINGS_PLANS).doc();
        try {
        await planRef.set({
            memberId: userId,
            amount,
            startDate: FieldValue.serverTimestamp(),
            maturityDate: fixedSavingsMaturityDate(durationMonths),
            durationMonths,
            interestRate,
            projectedProfit,
            status: "active",
            createdAt: FieldValue.serverTimestamp(),
        });

        // Ledger entries — TWO of them, and the second one was missing entirely.
        //
        // THE UNIFIED LEDGER ROW omitted id, module, currency and reference.
        // Every other writer of TRANSACTIONS in this codebase supplies all four
        // and uses a deterministic document id. Without `reference` the row
        // cannot be tied back to the operation that produced it, which is what
        // reconciliation and every support lookup start from. Without `id` the
        // GDPR data export — which does `docs.map(doc => doc.data())` in
        // bulk-user-operations.ts — hands the member rows with no identifier,
        // for these rows only.
        //
        // THE COOPERATIVE LEDGER ROW did not exist. This is the one that
        // matters. The debit above reduces savingsBalance and nothing else:
        // unlike a withdrawal it does not move the money into lockedBalance, so
        // it leaves the member's held total lower with no entry anywhere saying
        // where the money went.
        //
        // forensics.ts reconciles cooperative_members.savingsBalance +
        // lockedBalance against completed cooperative_transactions rows. With
        // no debit row, every member holding a fixed savings plan reported as a
        // balance mismatch — permanently, and correctly, because the ledger
        // genuinely did not account for the money. A reconciliation check that
        // always fails for a whole class of member is a check nobody reads.
        const reference = `fixsav_${planRef.id}`;

        const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(reference);
        await txRef.set({
            id: reference,
            userId,
            type: "fixed_savings_funding",
            module: "cooperative",
            amount,
            currency: "NGN",
            reference,
            description: `Funded ${durationMonths}-month fixed savings plan`,
            status: "completed",
            date: FieldValue.serverTimestamp(),
        });

        // The cooperative ledger, which forensics.ts reconciles against.
        // fixed_savings_lock is in its DEBIT_TYPES.
        const coopTxRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc(reference);
        await coopTxRef.set({
            id: reference,
            userId,
            cooperativeId: memberData.cooperativeId || "default",
            type: "fixed_savings_lock",
            amount,
            currency: "NGN",
            reference,
            description: `Locked into a ${durationMonths}-month fixed savings plan`,
            status: "completed",
            date: FieldValue.serverTimestamp(),
        });

        } catch (workError) {
            await compensateJsonbDebit({
                table: "cooperative_members",
                id: userId,
                field: "savingsBalance",
                amount,
                reason: "fixed savings plan could not be recorded after the debit",
            });
            throw workError;
        }

        const result = planRef.id;

        return NextResponse.json({
            success: true,
            message: "Fixed savings plan created successfully",
            planId: result,
        });
    } catch (error: any) {
        logger.error("Failed to create fixed savings plan:", error);

        // Handle custom errors from transaction
        if (error instanceof Error) {
            return NextResponse.json(
                { success: false, message: error.message },
                { status: 400 }
            );
        }

        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
