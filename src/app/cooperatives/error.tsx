"use client";

import { useStaleDeploymentRecovery } from "@/components/shared/useStaleDeploymentRecovery";
import { useBoundaryReport } from "@/components/shared/useBoundaryReport";
import { AlertTriangle } from "lucide-react";

export default function ErrorBoundary({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    /*
     *   #852 — the shared, bounded recovery. #717 built it as "one shared,
     *   bounded recovery instead of nine copies" and wired eight of the fifteen
     *   route boundaries; this was one of the seven it did not reach. The
     *   NEAREST boundary wins, so /wave fell through to a dead end while
     *   /wave/application recovered, and /cooperatives while
     *   /cooperatives/onboarding recovered.
     */
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
    useBoundaryReport(error, updating, "cooperatives");

    if (updating) {
        return (
            <div className="min-h-[400px] flex items-center justify-center p-6 bg-slate-50">
                <p className="text-slate-600 font-medium">Updating to latest version…</p>
            </div>
        );
    }

    return (
        <div className="min-h-[400px] flex items-center justify-center p-6 bg-slate-50">
            <div className="max-w-md w-full bg-white border border-red-100 rounded-2xl p-8 shadow-sm text-center">
                <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
                    <AlertTriangle className="w-8 h-8 text-red-500" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-3">Something went wrong!</h2>
                <p className="text-slate-500 mb-8 text-sm leading-relaxed">
                    We encountered an unexpected error while loading this section. Our technical team has been notified.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                        onClick={() => reset()}
                        className="px-6 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors"
                    >
                        Try again
                    </button>
                    <button
                        onClick={() => window.location.href = '/dashboard'}
                        className="px-6 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition-colors"
                    >
                        Return to Dashboard
                    </button>
                </div>
            </div>
        </div>
    );
}
