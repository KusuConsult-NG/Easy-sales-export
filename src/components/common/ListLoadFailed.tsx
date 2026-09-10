"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * What a screen shows when it could not READ a list — as opposed to reading one
 * and finding it empty.
 *
 *   #588 THIRTY-SIX SCREENS TOLD PEOPLE THEIR THINGS WERE GONE.
 *
 *   The shape is the same everywhere, and SellerProductsClient is the plainest
 *   example of it:
 *
 *       if (result.success && result.data?.products) {
 *           setProducts(...);
 *       } else if (result.error) {
 *           logger.error("Failed to load products:", { error: result.error });
 *       }
 *       } catch (error) {
 *           logger.error("Failed to load products:", { error });
 *       } finally {
 *           setLoading(false);
 *       }
 *
 *   A refusal or a thrown error writes a line to a log nobody is reading, the
 *   spinner stops, and the list state is still the `[]` it was initialised
 *   with. So the screen renders its EMPTY STATE — and a seller with forty live
 *   listings is told:
 *
 *       "No products found. Add your first product"
 *
 *   That is not a cosmetic failure. A seller who believes it re-creates
 *   listings they already have; a member looking at their savings, or an
 *   investor at their portfolio, is told their money is not there. #579 found
 *   this on the export catalogue — "could not tell" and "nothing" collapsed
 *   into one branch — and it is this codebase's most repeated defect. This is
 *   the same reading applied everywhere it belongs.
 *
 * ── WHY A COMPONENT AND NOT A LINE IN EACH SCREEN ───────────────────────────
 *
 *   Because there are thirty-six of them, and written out per screen it is a
 *   panel, an icon, a retry button and — the part that matters — a sentence
 *   telling somebody their data is not lost. Thirty-six restatements of that
 *   sentence is how this codebase grew most of the drift the audit keeps
 *   finding.
 *
 *   The ratchet in a-failed-read-is-not-an-empty-list counts the screens that
 *   still cannot tell the two apart, and the number may only go down.
 */
export default function ListLoadFailed({
    what,
    onRetry,
    className = "",
}: {
    /** What could not be loaded, as the person calls it: "your orders", "your savings". */
    what: string;
    /** Omitted where the screen has no re-read to offer — then it says so instead. */
    onRetry?: () => void;
    className?: string;
}) {
    return (
        <div
            role="status"
            className={`bg-white border border-amber-200 rounded-2xl p-8 text-center ${className}`}
        >
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-900 mb-2">
                We could not load {what}
            </h3>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
                Nothing is lost — this screen could not reach {what} just now.
                {onRetry ? " Try again in a moment." : " Please refresh the page in a moment."}
            </p>
            {onRetry && (
                <button
                    onClick={onRetry}
                    className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-800 transition"
                >
                    <RefreshCw className="w-4 h-4" />
                    Try again
                </button>
            )}
        </div>
    );
}
