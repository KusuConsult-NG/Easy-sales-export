'use client';

import { useStaleDeploymentRecovery } from "@/components/shared/useStaleDeploymentRecovery";
import { useBoundaryReport } from "@/components/shared/useBoundaryReport";
import { AlertOctagon, RotateCcw, Home } from 'lucide-react';
import Link from 'next/link';
import { HardLogoutButton } from '@/components/auth/HardLogoutButton';

export default function AdminError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
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
    useBoundaryReport(error, updating, "admin");

    if (updating) {
        return (
            <div className="min-h-[400px] flex items-center justify-center p-6 bg-slate-50">
                <p className="text-slate-600 font-medium">Updating to latest version…</p>
            </div>
        );
    }

    return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
                <AlertOctagon className="w-8 h-8 text-red-600" />
            </div>

            <h2 className="text-2xl font-bold text-slate-900 mb-2">
                Admin Console Error
            </h2>

            {/*   #904 The message is not rendered in production — see
              *   app/error.tsx. An administrator is still a browser, and this
              *   screen is reachable with a session that is not trusted with
              *   adapter internals. Dev keeps it. */}
            <p className="text-slate-600 max-w-md mb-8">
                A critical error occurred in the admin dashboard. This event has been logged.
            </p>

            {process.env.NODE_ENV === 'development' && error.message && (
                <p className="max-w-md mb-8 text-left text-xs font-mono text-red-600 wrap-break-word bg-slate-100 p-3 rounded-lg">
                    {error.message}
                </p>
            )}

            <div className="flex flex-col gap-4 items-center">
                <div className="flex gap-4">
                    <button
                        onClick={reset}
                        className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-lg hover:opacity-90 transition-opacity font-medium"
                    >
                        <RotateCcw className="w-4 h-4" />
                        Retry System
                    </button>

                    <Link
                        href="/admin/settings"
                        className="flex items-center gap-2 px-5 py-2.5 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                    >
                        <Home className="w-4 h-4" />
                        Return to Dashboard
                    </Link>
                </div>
                
                <HardLogoutButton variant="secondary" />
            </div>

            {error.digest && (
                <div className="mt-8 p-3 bg-slate-50 rounded-md border border-slate-200">
                    <p className="text-xs font-mono text-slate-500">
                        Digest: {error.digest}
                    </p>
                </div>
            )}
        </div>
    );
}
