export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { resolveBankAccount } from "@/lib/bank-account-resolve";
import { bankVerifyLimiter, BANK_VERIFY_RATE_LIMITED } from "@/lib/bank-verify-rate-limit";

/**
 * Bank Account Name Enquiry
 * Uses Paystack's resolve endpoint: GET https://api.paystack.co/bank/resolve
 *
 * Body: { accountNumber: string, bankCode: string }
 * Returns: { success, accountName, accountNumber, bankId }
 */
async function verifyBankAccountHandler(req: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        /**
         *   #642 THE SAME METER ITS SIBLING HAS.
         *
         *   This resolves any ten-digit NUBAN to the holder's real name through
         *   the platform's Paystack key — #243's "name-lookup oracle for whoever
         *   is signed in" — and the control written for the same lookup,
         *   `bankVerification` at ten an hour, was applied to
         *   actions/paystack.ts and not here. This door carried only the generic
         *   `withRateLimit`, which defaults to two hundred A MINUTE: twelve
         *   thousand an hour against a control sized at ten.
         *
         *   The generic wrapper is gone rather than kept alongside. Ten an hour
         *   is strictly tighter, so it adds nothing but a second key space — and
         *   pooling every route into one counter is a defect of its own, which
         *   lib/rate-limit.ts still has.
         */
        const rl = await bankVerifyLimiter.check(session.user.id);
        if (!rl.success) {
            return NextResponse.json({ success: false, error: BANK_VERIFY_RATE_LIMITED }, { status: 429 });
        }

        const body = await req.json();
        const { accountNumber, bankCode } = body;

        // #346 The resolution itself now lives in lib/bank-account-resolve.ts,
        // so the onboarding ACTIONS can run the same check at the point they
        // write the record — this route was a browser-only control.
        const result = await resolveBankAccount(accountNumber, bankCode);

        if (!result.ok) {
            return NextResponse.json(
                { success: false, error: result.reason },
                { status: result.status ?? 422 },
            );
        }

        return NextResponse.json({
            success: true,
            accountName: result.accountName,
            accountNumber: result.accountNumber,
            bankId: result.bankId ?? null,
        });
    } catch (error) {
        logger.error('Error in verify-bank-account route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const POST = verifyBankAccountHandler;
