'use client';
import { useStaleDeploymentRecovery } from "@/components/shared/useStaleDeploymentRecovery";
import { useBoundaryReport } from "@/components/shared/useBoundaryReport";
import { AlertTriangle } from 'lucide-react';

export default function DashboardError({
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
    useBoundaryReport(error, updating, "dashboard");

    if (updating) {
        return (
            <div className="min-h-[50vh] flex items-center justify-center p-8">
                <p className="text-slate-600 font-medium">Updating to latest version…</p>
            </div>
        );
    }

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
