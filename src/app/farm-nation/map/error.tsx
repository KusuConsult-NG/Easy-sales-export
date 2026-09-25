"use client";

import { useStaleDeploymentRecovery } from "@/components/shared/useStaleDeploymentRecovery";
import { useBoundaryReport } from "@/components/shared/useBoundaryReport";

export default function Error({
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
    useBoundaryReport(error, updating, "farm-nation/map");

    if (updating) {
        return (
            <div className="flex h-[600px] w-full flex-col items-center justify-center rounded-2xl bg-slate-50 border border-slate-200">
                <p className="text-slate-600 font-medium">Updating to latest version…</p>
            </div>
        );
    }

    return (
        <div className="flex h-[600px] w-full flex-col items-center justify-center rounded-2xl bg-slate-50 border border-slate-200">
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Something went wrong!</h2>
            <p className="text-slate-500 mb-4 px-4 text-center">
                We couldn't load the map. This might be due to a network error.
            </p>
            <button
                onClick={() => reset()}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
                Try again
            </button>
        </div>
    );
}
