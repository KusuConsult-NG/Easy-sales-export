export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { withRateLimit } from '@/lib/rate-limit';
import { resolveBankAccount } from "@/lib/bank-account-resolve";

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

export const POST = withRateLimit(verifyBankAccountHandler);
