"use client";

import { useEffect } from "react";
import { logger } from '@/lib/logger';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        logger.error("Error:", error);
    }, [error]);

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
