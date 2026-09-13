'use client';

import { useEffect } from 'react';
import { useStaleDeploymentRecovery } from "@/components/shared/useStaleDeploymentRecovery";
import { logger } from '@/lib/logger';
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

    useEffect(() => {
        //   #717 — any reload is the hook's, and it is bounded. This was
        //   an unguarded window.location.reload(): when a reload did not
        //   fetch a newer page, the same error hit the same boundary and
        //   reloaded again, with nothing counting.
        if (updating) return;
        logger.error('Admin Error Boundary caught:', error);
    }, [error, updating]);

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

            <p className="text-slate-600 max-w-md mb-8">
                {error.message || "An critical error occurred in the admin dashboard. This event has been logged."}
            </p>

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
