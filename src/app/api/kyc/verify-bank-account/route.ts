export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { withRateLimit } from '@/lib/rate-limit';

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

        if (!accountNumber || !bankCode) {
            return NextResponse.json(
                { error: 'accountNumber and bankCode are required' },
                { status: 400 }
            );
        }

        if (!/^\d{10}$/.test(accountNumber)) {
            return NextResponse.json(
                { error: 'Account number must be exactly 10 digits' },
                { status: 400 }
            );
        }

        const paystackKey = process.env.PAYSTACK_SECRET_KEY;

        // --- STRICT PRODUCTION CHECK: Fail if Paystack key not configured ---
        if (!paystackKey) {
            logger.error('CRITICAL: PAYSTACK_SECRET_KEY not found. Failing bank account verification securely.');
            return NextResponse.json({ error: 'Verification service currently unavailable.' }, { status: 503 });
        }
        // --- END STRICT CHECK ---

        const url = `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`;

        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${paystackKey}`,
            },
        });

        const data = await response.json();

        if (!response.ok) {
            const errMsg = data?.message || 'Bank account verification failed';
            logger.error('Paystack bank resolve error', { status: response.status, message: errMsg });
            return NextResponse.json({ success: false, error: errMsg }, { status: response.status });
        }

        if (!data.status || !data.data) {
            return NextResponse.json({ success: false, error: 'Could not resolve account details' }, { status: 422 });
        }

        return NextResponse.json({
            success: true,
            accountName: data.data.account_name,
            accountNumber: data.data.account_number,
            bankId: data.data.bank_id ?? null,
        });
    } catch (error) {
        logger.error('Error in verify-bank-account route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const POST = withRateLimit(verifyBankAccountHandler);
