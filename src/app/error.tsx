'use client';

import { useStaleDeploymentRecovery } from "@/components/shared/useStaleDeploymentRecovery";
import { useBoundaryReport } from "@/components/shared/useBoundaryReport";
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AlertTriangle, Home, RefreshCw, LayoutDashboard } from 'lucide-react';
import { HardLogoutButton } from '@/components/auth/HardLogoutButton';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const { data: session } = useSession();
    const isLoggedIn = !!session?.user;

    //   #717 — one shared, bounded recovery instead of nine copies
    //   of the same unguarded reload.
    const updating = useStaleDeploymentRecovery(error);

    /*
     *   #904 AND SOMEBODY IS TOLD. This boundary logged to the browser console
     *   and reported nowhere; only app/global-error.tsx reported, and Next
     *   stops at the NEAREST boundary, so global-error handles almost nothing.
     *   See components/shared/useBoundaryReport for the measurement — #901's two
     *   screens threw on every row they were given, in production, silently.
     *
     *   The hook keeps this boundary's own `if (updating) return`: a
     *   ChunkLoadError after a deploy is a stale bundle, not a defect, and
     *   reporting it would bury the real crashes.
     */
    useBoundaryReport(error, updating, "root");

    // While a stale-deployment reload is in flight, show nothing or simple loading
    if (updating) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <p className="text-slate-600 font-medium">Updating to latest version…</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-2xl p-8 shadow-xl text-center">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle className="w-10 h-10 text-red-600" />
                </div>

                <h1 className="text-2xl font-bold text-slate-900 mb-2">
                    Something Went Wrong
                </h1>

                {/*
                  *   #904 THE MESSAGE IS NOT THE USER'S TO READ.
                  *
                  *   This rendered `error.message` straight onto the page. Next
                  *   replaces the message for errors thrown during a SERVER
                  *   render, so the exposure is the client-side throws — and
                  *   those carry whatever the code said, which on this platform
                  *   includes database column names, adapter internals and
                  *   third-party API text. It is also useless to the person
                  *   reading it: "Cannot read properties of null (reading
                  *   'toFixed')" tells a member nothing they can act on.
                  *
                  *   app/global-error.tsx already had the right shape and
                  *   showed the message only under NODE_ENV === 'development';
                  *   this is that, plus the digest below, which is the thing
                  *   support can actually match to a report.
                  */}
                <p className="text-slate-600 mb-6">
                    An unexpected error occurred. Please try again.
                </p>

                {process.env.NODE_ENV === 'development' && error.message && (
                    <p className="mb-6 text-left text-xs font-mono text-red-600 wrap-break-word bg-slate-100 p-3 rounded-lg">
                        {error.message}
                    </p>
                )}

                <div className="flex flex-col gap-3">
                    <div className="flex gap-3">
                        <button
                            onClick={reset}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors cursor-pointer"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Try Again
                        </button>
                        <Link
                            href={isLoggedIn ? "/dashboard" : "/"}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 border border-slate-200 text-slate-900 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
                        >
                            {isLoggedIn ? <LayoutDashboard className="w-4 h-4" /> : <Home className="w-4 h-4" />}
                            {isLoggedIn ? "Return to Dashboard" : "Go Home"}
                        </Link>
                    </div>

                    <HardLogoutButton className="mt-2" />
                </div>

                {error.digest && (
                    <p className="mt-4 text-xs text-slate-500">
                        Error ID: {error.digest}
                    </p>
                )}
            </div>
        </div>
    );
}
