'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle, XCircle, Loader2, TrendingUp, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { verifyContributionPaymentAction } from '@/app/actions/cooperative-payment';

// Force dynamic rendering - page uses useSearchParams()
export const dynamic = 'force-dynamic';

function VerifyPaymentContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const reference = searchParams.get('reference');
    const cooperativeId = searchParams.get('cooperativeId');

    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [message, setMessage] = useState<string>('');

    useEffect(() => {
        if (!reference) {
            setStatus('error');
            setMessage('Missing payment reference');
            return;
        }

        const verifyPayment = async () => {
            try {
                setStatus('loading');
                const result = await verifyContributionPaymentAction(reference!);

                if (result.success) {
                    setStatus('success');
                    setMessage(result.message || 'Payment verified successfully!');

                    // Redirect after 3 seconds if cooperativeId is provided
                    if (cooperativeId) {
                        setTimeout(() => {
                            router.push(`/cooperatives/${cooperativeId}`);
                        }, 3000);
                    }
                } else {
                    setStatus('error');
                    setMessage(result.error || 'Payment verification failed');
                }
            } catch (error: any) {
                setStatus('error');
                setMessage(error.message || 'An error occurred');
            }
        };

        verifyPayment();
    }, [reference, cooperativeId, router]);

    if (status === 'loading') {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-12 text-center">
                    <Loader2 className="w-20 h-20 text-blue-600 animate-spin mx-auto mb-6" />
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                        Verifying Payment
                    </h2>
                    <p className="text-slate-600 dark:text-slate-400">
                        Please wait while we confirm your payment...
                    </p>
                </div>
            </div>
        );
    }

    if (status === 'error') {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-red-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-12 text-center">
                    <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                        <XCircle className="w-10 h-10 text-red-500" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                        Verification Failed
                    </h2>
                    <p className="text-slate-600 dark:text-slate-400 mb-8">
                        {message}
                    </p>
                    <Link
                        href="/cooperatives"
                        className="inline-flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                    >
                        Back to Cooperatives
                        <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>
            </div>
        );
    }

    // Success state
    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-green-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-12 text-center">
                <div className="w-20 h-20 bg-linear-to-r from-green-400 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                    <CheckCircle className="w-12 h-12 text-white" />
                </div>

                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">
                    Payment Successful!
                </h1>

                <p className="text-lg text-slate-600 dark:text-slate-400 mb-8">
                    {message}
                </p>

                <div className="bg-linear-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-6 mb-8 border border-green-200 dark:border-green-800">
                    <div className="flex items-center justify-center gap-2 text-green-600 dark:text-green-400">
                        <TrendingUp className="w-5 h-5" />
                        <span className="text-sm font-medium">Your contribution has been recorded</span>
                    </div>
                </div>

                <Link
                    href={cooperativeId ? `/cooperatives/${cooperativeId}` : '/cooperatives'}
                    className="inline-flex items-center gap-2 bg-linear-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-8 py-3 rounded-lg font-semibold transition-all shadow-lg hover:shadow-xl"
                >
                    View Cooperative
                    <ArrowRight className="w-4 h-4" />
                </Link>
            </div>
        </div>
    );
}

function VerifyPaymentPageContent() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                    <p className="mt-4 text-slate-600 dark:text-slate-400">Loading...</p>
                </div>
            </div>
        }>
            <VerifyPaymentContent />
        </Suspense>
    );
}

export default function VerifyPaymentPagePage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
            </div>
        }>
            <VerifyPaymentPageContent />
        </Suspense>
    );
}
