export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { debitJsonbBalance } from "@/lib/wallet-ledger";

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

        // Validation
        if (!amount || amount < 50000) {
            return NextResponse.json(
                { success: false, message: "Minimum amount is ₦50,000" },
                { status: 400 }
            );
        }

        if (!durationMonths || durationMonths < 1 || durationMonths > 12) {
            return NextResponse.json(
                { success: false, message: "Duration must be between 1 and 12 months" },
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
        if (memberData.membershipStatus !== "approved" && memberData.membershipStatus !== "active") {
            return NextResponse.json(
                { success: false, message: "Your membership must be approved first" },
                { status: 403 }
            );
        }

        // Calculate interest and maturity
        const interestRate = 14; // 14% annual interest for fixed savings
        const projectedProfit = (amount * interestRate * (durationMonths / 12)) / 100;

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
        const planRef = db.collection(COLLECTIONS.FIXED_SAVINGS_PLANS).doc();
        await planRef.set({
            memberId: userId,
            amount,
            startDate: FieldValue.serverTimestamp(),
            maturityDate: new Date(Date.now() + durationMonths * 30 * 24 * 60 * 60 * 1000),
            durationMonths,
            interestRate,
            projectedProfit,
            status: "active",
            createdAt: FieldValue.serverTimestamp(),
        });

        // Create transaction record
        const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc();
        await txRef.set({
            userId,
            type: "fixed_savings_funding",
            amount,
            description: `Funded ${durationMonths}-month fixed savings plan`,
            status: "completed",
            date: FieldValue.serverTimestamp(),
        });

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
