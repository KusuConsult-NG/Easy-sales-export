'use client';

import React, { Component, ReactNode } from 'react';
import { RotateCw, AlertTriangle, Home, RefreshCcw } from 'lucide-react';
import Link from 'next/link';

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
        // Log to monitoring service if available
        if (!error.message.startsWith('NEXT_REDIRECT')) {
            console.error(`[GlobalResilienceBoundary:${this.props.moduleName || 'Generic'}] Caught error:`, error, errorInfo);
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
