'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CreditCard, TrendingUp, Shield, Zap } from 'lucide-react';
import Link from 'next/link';
import { initializeContributionPaymentAction } from '@/app/actions/cooperative-payment';
import { COOPERATIVE_TIERS } from '@/lib/cooperative-tiers';

export default function ContributePage() {
    const router = useRouter();
    const [amount, setAmount] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const amountNum = parseFloat(amount) || 0;

    // Calculate which tier this contribution would reach
    const getTierPreview = (contributionAmount: number) => {
        if (contributionAmount >= COOPERATIVE_TIERS.Premium.minContribution) {
            return {
                tier: 'Premium',
                color: 'from-purple-500 to-pink-500',
                benefits: COOPERATIVE_TIERS.Premium.benefits,
                maxLoan: contributionAmount * COOPERATIVE_TIERS.Premium.maxLoanMultiplier,
            };
        } else if (contributionAmount >= COOPERATIVE_TIERS.Basic.minContribution) {
            return {
                tier: 'Basic',
                color: 'from-blue-500 to-cyan-500',
                benefits: COOPERATIVE_TIERS.Basic.benefits,
                maxLoan: contributionAmount * COOPERATIVE_TIERS.Basic.maxLoanMultiplier,
            };
        }
        return null;
    };

    const tierPreview = getTierPreview(amountNum);

    const handlePayment = async () => {
        try {
            setLoading(true);
            setError(null);

            // Validate amount
            if (amountNum < 1000) {
                setError('Minimum contribution is ₦1,000');
                return;
            }

            if (amountNum > 1000000) {
                setError('Maximum contribution is ₦1,000,000');
                return;
            }

            // Initialize payment
            const result = await initializeContributionPaymentAction(amountNum);

            if (!result.success || !result.data) {
                setError(result.error || 'Failed to initialize payment');
                return;
            }

            // Redirect to Paystack
            window.location.href = result.data.authorizationUrl;
        } catch (err: any) {
            setError(err.message || 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
            <div className="max-w-4xl mx-auto">
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
                        Make a Contribution
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Contribute to your cooperative and unlock higher loan limits
                    </p>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                    {/* Left: Payment Form */}
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8">
                        <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-6">
                            Contribution Amount
                        </h2>

                        {/* Amount Input */}
                        <div className="mb-6">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                Amount (₦)
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
                                    max="1000000"
                                    step="1000"
                                    className="w-full pl-12 pr-4 py-4 text-2xl font-semibold border-2 border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-900 dark:text-white"
                                />
                            </div>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                Min: ₦1,000 • Max: ₦1,000,000
                            </p>
                        </div>

                        {/* Quick Amounts */}
                        <div className="mb-6">
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                                Quick Select
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                                {[5000, 10000, 20000, 50000, 100000, 200000].map((quickAmount) => (
                                    <button
                                        key={quickAmount}
                                        onClick={() => setAmount(quickAmount.toString())}
                                        className="px-4 py-2 text-sm font-medium bg-slate-100 dark:bg-slate-700 hover:bg-blue-100 dark:hover:bg-blue-900 rounded-lg transition-colors"
                                    >
                                        ₦{(quickAmount / 1000).toFixed(0)}k
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Error Display */}
                        {error && (
                            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                            </div>
                        )}

                        {/* Pay Button */}
                        <button
                            onClick={handlePayment}
                            disabled={loading || !amountNum || amountNum < 1000}
                            className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-linear-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 disabled:from-slate-400 disabled:to-slate-500 text-white font-semibold rounded-lg transition-all shadow-lg disabled:cursor-not-allowed"
                        >
                            {loading ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <CreditCard className="w-5 h-5" />
                                    Pay with Paystack
                                </>
                            )}
                        </button>

                        {/* Security Notice */}
                        <div className="mt-4 flex items-start gap-2 text-sm text-slate-500 dark:text-slate-400">
                            <Shield className="w-4 h-4 mt-0.5 shrink-0" />
                            <p>Secure payment powered by Paystack. Your payment information is encrypted.</p>
                        </div>
                    </div>

                    {/* Right: Tier Preview */}
                    <div className="space-y-6">
                        {tierPreview ? (
                            <div className={`bg-linear-to-br ${tierPreview.color} rounded-xl shadow-lg p-8 text-white`}>
                                <div className="flex items-center gap-2 mb-4">
                                    <TrendingUp className="w-6 h-6" />
                                    <h3 className="text-2xl font-bold">{tierPreview.tier} Tier</h3>
                                </div>

                                <div className="mb-6">
                                    <p className="text-white/90 mb-2">Maximum Loan Eligibility</p>
                                    <p className="text-4xl font-bold">
                                        ₦{tierPreview.maxLoan.toLocaleString()}
                                    </p>
                                    <p className="text-sm text-white/80 mt-1">
                                        {COOPERATIVE_TIERS[tierPreview.tier as 'Basic' | 'Premium'].maxLoanMultiplier}x your contribution
                                    </p>
                                </div>

                                <div>
                                    <p className="text-white/90 mb-3 font-medium">Benefits</p>
                                    <ul className="space-y-2">
                                        {tierPreview.benefits.map((benefit, index) => (
                                            <li key={index} className="flex items-start gap-2">
                                                <Zap className="w-4 h-4 mt-0.5 shrink-0" />
                                                <span className="text-sm text-white/90">{benefit}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8 border-2 border-dashed border-slate-300 dark:border-slate-700">
                                <p className="text-center text-slate-500 dark:text-slate-400">
                                    Enter an amount to see your tier preview
                                </p>
                            </div>
                        )}

                        {/* Tier Comparison */}
                        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                                Tier Comparison
                            </h3>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700">
                                    <div>
                                        <p className="font-medium text-slate-900 dark:text-white">Basic Tier</p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            ₦10,000+ contribution
                                        </p>
                                    </div>
                                    <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">
                                        2x Loan
                                    </p>
                                </div>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-medium text-slate-900 dark:text-white">Premium Tier</p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            ₦20,000+ contribution
                                        </p>
                                    </div>
                                    <p className="text-lg font-semibold text-purple-600 dark:text-purple-400">
                                        3x Loan
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
