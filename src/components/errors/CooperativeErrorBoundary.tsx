'use client';

import React from 'react';
import { reportBoundaryError } from "@/components/shared/useBoundaryReport";
import { AlertTriangle } from 'lucide-react';
import { isStaleDeploymentError, consumeReloadBudget } from '@/lib/stale-deployment-recovery';

interface ErrorBoundaryProps {
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

/**
 * Error Boundary Component for Cooperative Module
 * Catches rendering errors and displays user-friendly fallback UI
 */
export class CooperativeErrorBoundary extends React.Component<
    ErrorBoundaryProps,
    ErrorBoundaryState
> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
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
                console.warn('[CooperativeErrorBoundary] Stale deployment — reloading once.');
                window.location.reload();
                return;
            }
            console.error(
                '[CooperativeErrorBoundary] Stale deployment error after this page already used its '
                + 'automatic reloads. Showing the error instead of reloading again.',
                error,
            );
            return;
        }

        // Log error to console (in production, send to error tracking service)
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
        /*
         *   #907 AND THIS ONE HAD NO NEXT_REDIRECT GUARD AT ALL.
         *
         *   Found by the suite beside this, not by eye: the other three class
         *   boundaries both decline to log NEXT_REDIRECT here AND re-throw it
         *   from render() so the router can act. This one did neither, so the
         *   first thing #907's reporting did was send a routine navigation to
         *   Sentry.
         *
         *   STATED AS LATENT, NOT LIVE. Its one subtree —
         *   cooperatives/onboarding/OnboardingClient — is a client component
         *   that navigates with `router.replace`, which does not throw. A
         *   server-side `redirect()` does, and the day one appears in this tree
         *   the boundary would have rendered "Something went wrong" instead of
         *   navigating. The guard is the other three's, copied deliberately
         *   rather than left as the only boundary without it.
         */
        if (error.message.startsWith('NEXT_REDIRECT')) return;

        reportBoundaryError(error, "component/CooperativeErrorBoundary", errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
        // Reload the page to reset the component tree
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            //   #907 Re-thrown so the router can act on it — see componentDidCatch.
            if (this.state.error
                && (this.state.error.message.startsWith('NEXT_REDIRECT')
                    || (this.state.error as any).digest?.startsWith('NEXT_REDIRECT'))) {
                throw this.state.error;
            }

            // Custom fallback UI or default error display
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                    <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
                        <div className="flex flex-col items-center text-center">
                            {/* Error Icon */}
                            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                                <AlertTriangle className="w-8 h-8 text-red-600" />
                            </div>

                            {/* Error Title */}
                            <h2 className="text-2xl font-bold text-slate-900 mb-2">
                                Something Went Wrong
                            </h2>

                            {/* Error Message */}
                            <p className="text-slate-600 mb-6">
                                We encountered an unexpected error while loading the cooperative module.
                                Please try refreshing the page or contact support if the problem persists.
                            </p>

                            {/* Error Details (only in development) */}
                            {process.env.NODE_ENV === 'development' && this.state.error && (
                                <div className="w-full mb-6 p-4 bg-red-50 rounded-lg border border-red-200">
                                    <p className="text-xs font-mono text-red-800 text-left break-all">
                                        {this.state.error.toString()}
                                    </p>
                                </div>
                            )}

                            {/* Action Buttons */}
                            <div className="flex gap-3 w-full">
                                <button
                                    onClick={this.handleReset}
                                    className="flex-1 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-semibold transition-colors"
                                >
                                    Refresh Page
                                </button>
                                <a
                                    href="/dashboard"
                                    className="flex-1 px-6 py-3 bg-slate-200 hover:bg-slate-300 text-slate-900 rounded-xl font-semibold transition-colors text-center"
                                >
                                    Return to Dashboard
                                </a>
                            </div>

                            {/* Support Contact */}
                            <p className="text-xs text-slate-500 mt-6">
                                Need help?{' '}
                                <a
                                    href="mailto:info@easysalesexport.com"
                                    className="text-purple-600 hover:underline"
                                >
                                    Contact Support
                                </a>
                            </p>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
