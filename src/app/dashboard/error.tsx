'use client';
import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

export default function DashboardError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log to monitoring (non-PII info only)
        console.error('[Dashboard Error]', error.message);
    }, [error]);

    return (
        <div className="min-h-[50vh] flex items-center justify-center p-8">
            <div className="text-center max-w-md">
                <div className="flex justify-center mb-4">
                    <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
                        <AlertTriangle className="w-8 h-8 text-red-500" />
                    </div>
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-2">Something went wrong</h2>
                <p className="text-slate-500 text-sm mb-6">
                    An error occurred in this section. Your data is safe.
                </p>
                <button
                    onClick={reset}
                    className="px-6 py-2.5 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition-colors"
                >
                    Try again
                </button>
            </div>
        </div>
    );
}
