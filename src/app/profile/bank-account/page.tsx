"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, ChevronLeft, Loader2, ShieldAlert } from "lucide-react";
import BankAccountVerification from "@/components/shared/BankAccountVerification";
import {
    getBankAccountStatusAction,
    reverifyBankAccountAction,
    type BankAccountStatus,
} from "@/app/actions/bank-account";
import { useToast } from "@/contexts/ToastContext";

/**
 * Confirming your payout account — #208.
 *
 * THE REFUSAL NEEDED SOMEWHERE TO POINT. paystackPayout holds a payout to an
 * account this codebase never resolved and tells the admin to ask the member to
 * re-verify. Every bank-verification control in the app lived inside the two
 * onboarding wizards, which somebody already onboarded cannot re-enter — so
 * before this screen the instruction named a step that did not exist, which is
 * #362's shape and turns every held payout into a support ticket.
 *
 * The banner is shown from the SERVER'S answer, and a failed check is shown as
 * a failure rather than as "not confirmed" (#313): those are different states
 * and a member should not be told to redo something over a database blip.
 */
export default function BankAccountPage() {
    const { showToast } = useToast();

    const [status, setStatus] = useState<BankAccountStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        const result = await getBankAccountStatusAction();
        if (result.success && result.data) {
            setStatus(result.data);
            setError(null);
        } else {
            setStatus(null);
            setError(result.error || "Could not read your bank account");
        }
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    async function handleVerified(account: {
        bankName: string; accountNumber: string; accountName: string;
        verified: boolean; bankCode?: string;
    }) {
        // The component has already resolved the account to show the holder
        // name. The server resolves it AGAIN before storing — the browser's
        // answer is not evidence, which is the whole of #284.
        if (!account.verified || !account.bankCode) return;

        setSaving(true);
        try {
            const result = await reverifyBankAccountAction(
                account.accountNumber,
                account.bankCode,
                account.bankName,
            );
            if (result.success && result.data) {
                showToast(`Confirmed — ${result.data.accountName}`, "success");
                await load();
            } else {
                showToast(result.error || "Could not save your bank account", "error");
            }
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-green-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-3xl mx-auto px-8 py-6">
                    <Link
                        href="/profile"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition mb-2"
                    >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        Back to Profile
                    </Link>
                    <h1 className="text-3xl font-bold text-slate-900">Payout Bank Account</h1>
                    <p className="text-slate-600 mt-1">
                        The account your earnings and withdrawals are paid into.
                    </p>
                </div>
            </div>

            <div className="max-w-3xl mx-auto px-8 py-8 space-y-6">
                {error && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 flex items-start gap-2">
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold">We could not check your account</p>
                            <p className="text-sm">{error}</p>
                        </div>
                    </div>
                )}

                {status && !status.resolved && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 flex items-start gap-2">
                        <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold">
                                This account has not been confirmed with your bank
                            </p>
                            <p className="text-sm mt-1">
                                Payouts are on hold until it is. Confirm the account below — it
                                takes one step, and any held payment can be released straight
                                afterwards.
                            </p>
                        </div>
                    </div>
                )}

                {status?.resolved && (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-green-900 flex items-start gap-2">
                        <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold">Confirmed with your bank</p>
                            <p className="text-sm mt-1">
                                {status.accountName}
                                {status.accountNumberTail && ` · ••••${status.accountNumberTail}`}
                                {status.bankName && ` · ${status.bankName}`}
                            </p>
                        </div>
                    </div>
                )}

                <div className="bg-white rounded-2xl border border-slate-200 p-6">
                    <h2 className="font-bold text-slate-900 mb-1">
                        {status?.resolved ? "Change your payout account" : "Confirm your payout account"}
                    </h2>
                    <p className="text-sm text-slate-600 mb-5">
                        We check the number with your bank and store the name the bank gives us.
                        You cannot type the account name yourself.
                    </p>

                    <BankAccountVerification onVerified={handleVerified} />

                    {saving && (
                        <p className="mt-4 text-sm text-slate-500 flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Saving…
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
