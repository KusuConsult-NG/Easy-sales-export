'use client';

import React, { Component, ReactNode } from 'react';
import { reportBoundaryError } from "@/components/shared/useBoundaryReport";
import { RotateCw, AlertTriangle, Home, RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import { isStaleDeploymentError, consumeReloadBudget } from '@/lib/stale-deployment-recovery';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    moduleName?: string;
    dashboardUrl?: string;
}

interface State {
    hasError: boolean;
    error?: Error;
}

/**
 * Global Resilience Error Boundary
 * Handles STALE_DATA / Concurrency errors with a user-friendly "Refresh & Retry" prompt.
 * Standardizes the recovery UX across the entire platform.
 */
export class GlobalResilienceBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        /*
         *   #852 THE SAME BOUNDED RECOVERY THE ROUTE BOUNDARIES USE.
         *
         *   Next's own docs say a Server Action id is part of the build
         *   artifacts and that Next rotates them "at most every 14 days, even
         *   when the source is unchanged", so a long-open tab meets
         *   "Failed to find Server Action" whatever else is configured. Their
         *   prescription is to "surface the error as a retry path in the UI
         *   rather than a hard failure, so a refresh recovers the user".
         *
         *   A class component cannot use the hook, so it calls the same budget
         *   directly — the arrangement ErrorBoundary already uses. The RULE is
         *   shared; only the plumbing differs. BOUNDED, per #717: an unguarded
         *   reload that does not fetch a newer page hits the same boundary and
         *   reloads forever.
         */
        if (isStaleDeploymentError(error)) {
            if (consumeReloadBudget()) {
                console.warn('[GlobalResilienceBoundary] Stale deployment — reloading once.');
                window.location.reload();
                return;
            }
            console.error(
                '[GlobalResilienceBoundary] Stale deployment error after this page already used its '
                + 'automatic reloads. Showing the error instead of reloading again.',
                error,
            );
            return;
        }

        // Log to monitoring service if available
        /*
         *   #907 AND SOMEBODY IS TOLD. This ended in console.error, and a class
         *   boundary is NEARER than every route boundary #904 wired — see
         *   reportBoundaryError for which layouts this one wraps.
         *
         *   AFTER the stale-deployment branch above, deliberately: a
         *   ChunkLoadError after a deploy is a browser holding an old bundle,
         *   not a defect, and reporting it would fill the feed with every
         *   deploy. And NEXT_REDIRECT is not an error at all — Next throws it to
         *   move the router, and render() re-throws it on purpose.
         */
        if (!error.message.startsWith('NEXT_REDIRECT')) {
            reportBoundaryError(error, `component/GlobalResilienceBoundary:${this.props.moduleName || 'Generic'}`, errorInfo);
        }
    }

    handleReset = () => {
        this.setState({ hasError: false, error: undefined });
        window.location.reload();
    };

    render() {
        if (this.state.hasError && this.state.error) {
            // Handle Next.js redirects (don't catch these)
            if (this.state.error.message.startsWith('NEXT_REDIRECT') || (this.state.error as any).digest?.startsWith('NEXT_REDIRECT')) {
                throw this.state.error;
            }

            const isStaleData = this.state.error.message.includes('STALE_DATA') || 
                               this.state.error.message.includes('optimistic lock') ||
                               this.state.error.message.includes('version mismatch');

            const moduleLabel = this.props.moduleName || 'System';
            const dashboardUrl = this.props.dashboardUrl || '/dashboard';

            if (isStaleData) {
                return (
                    <div className="min-h-[400px] flex items-center justify-center p-6 bg-amber-50/30 rounded-2xl border border-amber-100 backdrop-blur-sm">
                        <div className="max-w-md w-full text-center">
                            <div className="mb-6 inline-flex p-4 bg-amber-100 rounded-full text-amber-600 animate-pulse">
                                <RotateCw size={32} />
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900 mb-3">
                                {moduleLabel} Data Out of Sync
                            </h2>
                            <p className="text-gray-600 mb-8">
                                Someone else updated this information while you were viewing it. To prevent overwriting their changes, please refresh the page and try again.
                            </p>
                            
                            <div className="flex flex-col gap-3">
                                <button
                                    onClick={this.handleReset}
                                    className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-amber-600 text-white rounded-xl hover:bg-amber-700 transition-all font-semibold shadow-lg shadow-amber-200"
                                >
                                    <RefreshCcw size={18} />
                                    Refresh & Retry
                                </button>
                            </div>
                        </div>
                    </div>
                );
            }

            return (
                <div className="min-h-[400px] flex items-center justify-center p-6 bg-red-50/30 rounded-2xl border border-red-100 backdrop-blur-sm">
                    <div className="max-w-md w-full text-center">
                        <div className="mb-6 inline-flex p-4 bg-red-100 rounded-full text-red-600">
                            <AlertTriangle size={32} />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900 mb-3">
                            Unexpected Snag
                        </h2>
                        <p className="text-gray-600 mb-8">
                            We hit an issue in the {moduleLabel} module. Don't worry, your data is safe.
                        </p>

                        <div className="flex flex-col gap-3">
                            <button
                                onClick={this.handleReset}
                                className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-all font-semibold shadow-lg shadow-gray-200"
                            >
                                <RefreshCcw size={18} />
                                Try Again
                            </button>
                            <Link
                                href={dashboardUrl}
                                className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-white text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 transition-all font-medium"
                            >
                                <Home size={18} />
                                Back to Dashboard
                            </Link>
                        </div>

                        {process.env.NODE_ENV === 'development' && (
                            <div className="mt-8 p-4 bg-white/50 rounded-lg text-left overflow-auto max-h-32 border border-red-100">
                                <p className="text-xs font-mono text-red-800 italic">
                                    {this.state.error.message}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default GlobalResilienceBoundary;
