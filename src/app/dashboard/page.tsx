"use client";

import { useEffect, useState, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { getPrimaryApp } from "@/lib/role-app-mapping";
import type { UserRole } from "@/lib/types/roles";

/**
 * Smart Dashboard Redirect
 * 
 * This component redirects users to their primary app's dashboard
 * based on their role priority (Export > Marketplace > Farm Nation > etc.)
 * 
 * SAFETY:
 * - Checks for ?error query param to prevent infinite redirect loops
 * - Redirects are blocked if middleware denied access and sent user back here
 */
function DashboardRedirectContent() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const searchParams = useSearchParams();
    const error = searchParams.get("error");
    const [timeoutReached, setTimeoutReached] = useState(false);
    const [targetRoute, setTargetRoute] = useState("/marketplace");

    // Timeout after 5 seconds to show manual fallback
    useEffect(() => {
        const timer = setTimeout(() => {
            if (status === "loading") {
                setTimeoutReached(true);
            }
        }, 5000);

        return () => clearTimeout(timer);
    }, [status]);

    useEffect(() => {
        if (status === "loading") return;

        // STOP: If there's an error (e.g., from middleware redirect loop protection), 
        // DO NOT attempt to redirect again. Show the error.
        if (error) return;

        // Not authenticated - redirect to login
        if (status === "unauthenticated" || !session) {
            router.replace("/auth/login");
            return;
        }

        // Get user roles
        const userRoles = (session?.user?.roles as UserRole[]) || [];

        // Determine primary app and defer state update to satisfy React's effect constraints
        const primaryApp = getPrimaryApp(userRoles);
        setTimeout(() => setTargetRoute(primaryApp), 0);
        router.replace(primaryApp);
    }, [session, status, router, error]);

    // Error State
    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
                <div className="max-w-md w-full bg-white shadow-lg rounded-xl p-6 text-center">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 mb-2">Access Denied</h2>
                    <p className="text-slate-600 mb-6">
                        {error === "unauthorized"
                            ? "You do not have permission to access the requested application."
                            : "We encountered an issue redirecting you to your dashboard."}
                    </p>
                    <button
                        onClick={() => router.push("/")}
                        className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg hover:bg-slate-300 transition-colors"
                    >
                        Return to Home
                    </button>
                    <div className="mt-4 pt-4 border-t border-slate-100">
                        <p className="text-xs text-slate-500">Error Code: {error}</p>
                    </div>
                </div>
            </div>
        );
    }

    // Loading State
    return (
        <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-slate-900 via-blue-900 to-slate-900">
            <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-4 border-white mb-6"></div>
                <h2 className="text-2xl font-bold text-white mb-2">Redirecting to your dashboard...</h2>
                <p className="text-blue-200">Please wait a moment</p>

                {timeoutReached && (
                    <div className="mt-8 p-6 bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl max-w-sm mx-auto">
                        <p className="text-white mb-4">Taking longer than expected?</p>
                        <button
                            onClick={() => router.push(targetRoute)}
                            className="w-full px-6 py-3 bg-white text-blue-900 font-semibold rounded-xl hover:bg-blue-50 transition"
                        >
                            Continue to Dashboard →
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function DashboardRedirect() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            </div>
        }>
            <DashboardRedirectContent />
        </Suspense>
    );
}
