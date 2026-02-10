'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';

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
        // Log error to console (in production, send to error tracking service)
        console.error('Cooperative Module Error:', error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
        // Reload the page to reset the component tree
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            // Custom fallback UI or default error display
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
                    <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-8 border border-slate-200 dark:border-slate-800">
                        <div className="flex flex-col items-center text-center">
                            {/* Error Icon */}
                            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                                <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
                            </div>

                            {/* Error Title */}
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                                Something Went Wrong
                            </h2>

                            {/* Error Message */}
                            <p className="text-slate-600 dark:text-slate-400 mb-6">
                                We encountered an unexpected error while loading the cooperative module.
                                Please try refreshing the page or contact support if the problem persists.
                            </p>

                            {/* Error Details (only in development) */}
                            {process.env.NODE_ENV === 'development' && this.state.error && (
                                <div className="w-full mb-6 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                                    <p className="text-xs font-mono text-red-800 dark:text-red-200 text-left break-all">
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
                                    href="/cooperatives"
                                    className="flex-1 px-6 py-3 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-900 dark:text-white rounded-xl font-semibold transition-colors text-center"
                                >
                                    Go Home
                                </a>
                            </div>

                            {/* Support Contact */}
                            <p className="text-xs text-slate-500 mt-6">
                                Need help?{' '}
                                <a
                                    href="mailto:info@easysalescooperative.com"
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
