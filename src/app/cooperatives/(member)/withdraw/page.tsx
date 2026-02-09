'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Wallet, AlertCircle, TrendingDown, CheckCircle } from 'lucide-react';
import Link from 'next/link';
import { submitWithdrawalRequestAction } from '@/app/actions/withdrawal';

export default function WithdrawPage() {
    const router = useRouter();
    const [amount, setAmount] = useState<string>('');
    const [bankName, setBankName] = useState<string>('');
    const [accountNumber, setAccountNumber] = useState<string>('');
    const [accountName, setAccountName] = useState<string>('');
    const [reason, setReason] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const amountNum = parseFloat(amount) || 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            setLoading(true);
            setError(null);

            // Validate inputs
            if (amountNum < 1000) {
                setError('Minimum withdrawal amount is ₦1,000');
                return;
            }

            if (!bankName || !accountNumber || !accountName) {
                setError('Please fill in all bank details');
                return;
            }

            if (accountNumber.length !== 10) {
                setError('Account number must be 10 digits');
                return;
            }

            // Submit withdrawal request
            const result = await submitWithdrawalRequestAction({
                amount: amountNum,
                bankName,
                accountNumber,
                accountName,
                reason: reason || 'Personal withdrawal',
            });

            if (!result.success) {
                setError(result.error || 'Failed to submit withdrawal request');
                return;
            }

            setSuccess(true);

            // Redirect to cooperative dashboard after 3 seconds
            setTimeout(() => {
                router.push('/cooperatives');
            }, 3000);

        } catch (err: any) {
            setError(err.message || 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    // Success state
    if (success) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-green-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-12 text-center">
                    <div className="flex justify-center mb-6">
                        <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                            <CheckCircle className="w-12 h-12 text-green-600 dark:text-green-400" />
                        </div>
                    </div>
                    <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
                        Request Submitted! 🎉
                    </h2>
                    <p className="text-lg text-slate-600 dark:text-slate-400 mb-6">
                        Your withdrawal request of <span className="font-semibold text-green-600">₦{amountNum.toLocaleString()}</span> has been submitted for admin approval.
                    </p>
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 mb-6">
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            You'll receive an email notification once your request is reviewed. Typically processed within 24-48 hours.
                        </p>
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-500">
                        Redirecting to cooperative dashboard...
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-green-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <Link
                        href="/cooperatives"
                        className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white mb-4"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Cooperative
                    </Link>
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
                        Request Withdrawal
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Withdraw funds from your cooperative balance
                    </p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8">
                    {/* Amount Input */}
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Withdrawal Amount (₦) *
                        </label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-semibold text-slate-400">
                                ₦
                            </span>
                            <input
                                type="number"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="10,000"
                                min="1000"
                                step="100"
                                required
                                className="w-full pl-12 pr-4 py-4 text-2xl font-semibold border-2 border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:bg-slate-900 dark:text-white"
                            />
                        </div>
                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                            Minimum withdrawal: ₦1,000
                        </p>
                    </div>

                    {/* Bank Details */}
                    <div className="mb-6">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                            Bank Details
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                    Bank Name *
                                </label>
                                <input
                                    type="text"
                                    value={bankName}
                                    onChange={(e) => setBankName(e.target.value)}
                                    placeholder="e.g., First Bank of Nigeria"
                                    required
                                    className="w-full px-4 py-3 border-2 border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:bg-slate-900 dark:text-white"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                    Account Number *
                                </label>
                                <input
                                    type="text"
                                    value={accountNumber}
                                    onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                    placeholder="0123456789"
                                    maxLength={10}
                                    required
                                    className="w-full px-4 py-3 border-2 border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:bg-slate-900 dark:text-white font-mono"
                                />
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                    {accountNumber.length}/10 digits
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                    Account Name *
                                </label>
                                <input
                                    type="text"
                                    value={accountName}
                                    onChange={(e) => setAccountName(e.target.value)}
                                    placeholder="Account holder name"
                                    required
                                    className="w-full px-4 py-3 border-2 border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:bg-slate-900 dark:text-white"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Reason (Optional) */}
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Reason for Withdrawal (Optional)
                        </label>
                        <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="e.g., Emergency expense, Business capital, etc."
                            rows={3}
                            className="w-full px-4 py-3 border-2 border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:bg-slate-900 dark:text-white resize-none"
                        />
                    </div>

                    {/* Info Notice */}
                    <div className="mb-6 flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                        <div className="text-sm text-slate-700 dark:text-slate-300">
                            <p className="font-medium mb-1">Important Information:</p>
                            <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400">
                                <li>Withdrawal requests require admin approval</li>
                                <li>Processing typically takes 24-48 hours</li>
                                <li>You'll receive an email notification when processed</li>
                                <li>Ensure bank details are correct to avoid delays</li>
                            </ul>
                        </div>
                    </div>

                    {/* Error Display */}
                    {error && (
                        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                        </div>
                    )}

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={loading || !amountNum || !bankName || !accountNumber || !accountName}
                        className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-linear-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-slate-400 disabled:to-slate-500 text-white font-semibold rounded-lg transition-all shadow-lg disabled:cursor-not-allowed"
                    >
                        {loading ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Submitting Request...
                            </>
                        ) : (
                            <>
                                <TrendingDown className="w-5 h-5" />
                                Submit Withdrawal Request
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}
