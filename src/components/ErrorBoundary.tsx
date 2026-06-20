'use client';

import React, { Component, ReactNode } from 'react';
import Link from 'next/link';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
}

/**
 * Global Error Boundary
 * Catches errors in any child component tree.
 * Auto-reloads on chunk-load / stale-deployment errors.
 */

function isStaleDeploymentError(error?: Error): boolean {
    if (!error) return false;
    const msg = error.message ?? "";
    const name = error.name ?? "";
    return (
        name === "ChunkLoadError" ||
        name === "UnrecognizedActionError" ||
        msg.includes("ChunkLoadError") ||
        msg.includes("Loading chunk") ||
        msg.includes("was not found on the server") ||
        msg.includes("UnrecognizedAction") ||
        msg.includes("Failed to fetch dynamically imported module") ||
        msg.includes("Importing a module script failed") ||
        msg.includes("Failed to find Server Action") ||
        msg.includes("older or newer deployment")
    );
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        // Do not log internal Next.js redirect errors
        if (error.message.startsWith('NEXT_REDIRECT')) return;

        // Auto-reload on stale-deployment errors (new Vercel build invalidated old chunks)
        if (isStaleDeploymentError(error)) {
            console.warn('[ErrorBoundary] Stale deployment — auto-reloading.');
            window.location.reload();
            return;
        }

        console.error('Error Boundary caught:', error, errorInfo);
    }

    render() {
        if (this.state.hasError && this.state.error) {
            // Re-throw Next.js redirect errors so the router can handle them
            if (this.state.error.message.startsWith('NEXT_REDIRECT') || (this.state.error as any).digest?.startsWith('NEXT_REDIRECT')) {
                throw this.state.error;
            }

            return (
                <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
                    <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
                        <div className="mb-4">
                            <svg
                                className="mx-auto h-16 w-16 text-red-500"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                />
                            </svg>
                        </div>
                        <h1 className="text-2xl font-bold text-gray-900 mb-2">
                            Oops! Something went wrong
                        </h1>
                        <p className="text-gray-600 mb-6">
                            We encountered an unexpected error. Our team has been notified and is working on a fix.
                        </p>
                        {process.env.NODE_ENV === 'development' && this.state.error && (
                            <div className="mb-6 p-4 bg-red-50 rounded border border-red-200 text-left overflow-auto max-h-48">
                                <p className="text-sm text-red-800 font-mono">
                                    {this.state.error.message}
                                </p>
                            </div>
                        )}
                        <div className="space-y-3">
                            <button
                                onClick={() => window.location.reload()}
                                className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                            >
                                Reload Page
                            </button>
                            <Link
                                href="/"
                                className="block w-full px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                            >
                                Go to Homepage
                            </Link>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
