'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle, XCircle, Loader2, TrendingUp, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { verifyContributionPaymentAction } from '@/app/actions/cooperative-payment';

export default function VerifyPaymentPage() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const reference = searchParams.get('reference');

    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [message, setMessage] = useState<string>('');
    const [details, setDetails] = useState<any>(null);

    useEffect(() => {
        if (!reference) {
            setStatus('error');
            setMessage('Missing payment reference');
            return;
        }

        verifyPayment();
    }, [reference]);

    const verifyPayment = async () => {
        try {
            setStatus('loading');

            const result = await verifyContributionPaymentAction(reference!);

            if (result.success) {
                setStatus('success');
                setMessage(result.message || 'Payment verified successfully!');
            } else {
                setStatus('error');
                setMessage(result.error || 'Payment verification failed');
            }
        } catch (error: any) {
            setStatus('error');
            setMessage(error.message || 'An error occurred');
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
            <div className="max-w-md w-full">
                {/* Loading State */}
                {status === 'loading' && (
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-12 text-center">
                        <div className="flex justify-center mb-6">
                            <div className="relative">
                                <Loader2 className="w-20 h-20 text-blue-600 animate-spin" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-full" />
                                </div>
                            </div>
                        </div>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                            Verifying Payment
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400">
                            Please wait while we confirm your payment...
                        </p>
                        <p className="text-sm text-slate-500 dark:text-slate-500 mt-4">
                            Reference: {reference}
                        </p>
                    </div>
                )}

                {/* Success State */}
                {status === 'success' && (
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-12 text-center">
                        <div className="flex justify-center mb-6">
                            <div className="relative">
                                <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                                    <CheckCircle className="w-12 h-12 text-green-600 dark:text-green-400" />
                                </div>
                                <div className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full animate-ping opacity-75" />
                            </div>
                        </div>

                        <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
                            Payment Successful! 🎉
                        </h2>
                        <p className="text-lg text-slate-600 dark:text-slate-400 mb-8">
                            {message}
                        </p>

                        {/* Success Details */}
                        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-6 mb-8">
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-sm text-slate-600 dark:text-slate-400">
                                    Payment Reference
                                </span>
                                <span className="text-sm font-mono text-slate-900 dark:text-white">
                                    {reference}
                                </span>
                            </div>
                            <div className="pt-4 border-t border-green- 200 dark:border-green-800">
                                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                                    <TrendingUp className="w-5 h-5" />
                                    <span className="text-sm font-medium">
                                        Your tier and loan eligibility have been updated
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="space-y-3">
                            <Link
                                href="/cooperatives"
                                className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-semibold rounded-lg transition-all shadow-lg"
                            >
                                View My Cooperative Dashboard
                                <ArrowRight className="w-5 h-5" />
                            </Link>
                            <Link
                                href="/dashboard"
                                className="w-full block text-center px-6 py-3 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium transition-colors"
                            >
                                Go to Dashboard
                            </Link>
                        </div>
                    </div>
                )}

                {/* Error State */}
                {status === 'error' && (
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-12 text-center">
                        <div className="flex justify-center mb-6">
                            <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                                <XCircle className="w-12 h-12 text-red-600 dark:text-red-400" />
                            </div>
                        </div>

                        <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
                            Payment Failed
                        </h2>
                        <p className="text-lg text-slate-600 dark:text-slate-400 mb-8">
                            {message}
                        </p>

                        {reference && (
                            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 mb-8">
                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                                    Payment Reference
                                </p>
                                <p className="text-sm font-mono text-slate-900 dark:text-white">
                                    {reference}
                                </p>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="space-y-3">
                            <Link
                                href="/cooperatives/contribute"
                                className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-semibold rounded-lg transition-all shadow-lg"
                            >
                                Try Again
                                <ArrowRight className="w-5 h-5" />
                            </Link>
                            <Link
                                href="/cooperatives"
                                className="w-full block text-center px-6 py-3 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium transition-colors"
                            >
                                Back to Cooperative
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
