'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log error for debugging
        console.error('Global error caught:', error);
    }, [error]);

    return (
        <html>
            <body>
                <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
                    <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-xl text-center">
                        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                            <AlertTriangle className="w-10 h-10 text-red-600 dark:text-red-400" />
                        </div>

                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                            Something Went Wrong
                        </h1>

                        <p className="text-slate-600 dark:text-slate-400 mb-6">
                            {error.message || "An unexpected error occurred. Please try again."}
                        </p>

                        <div className="flex gap-3">
                            <button
                                onClick={reset}
                                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
                            >
                                <RefreshCw className="w-4 h-4" />
                                Try Again
                            </button>
                            <Link
                                href="/"
                                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                            >
                                <Home className="w-4 h-4" />
                                Go Home
                            </Link>
                        </div>

                        {error.digest && (
                            <p className="mt-4 text-xs text-slate-500 dark:text-slate-500">
                                Error ID: {error.digest}
                            </p>
                        )}
                    </div>
                </div>
            </body>
        </html>
    );
}
