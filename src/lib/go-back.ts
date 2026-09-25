/**
 * Back, with somewhere to land when the browser has nowhere to go.
 *
 *   #927 THE RULE #921 PUT IN components/ui/BackButton, EXTRACTED SO A SCREEN CAN
 *   USE IT WITHOUT ADOPTING THE COMPONENT'S LOOK.
 *
 *   #921's finding: `history.back()` is a NO-OP when the tab has one history entry
 *   — a bookmark, a link from an email, anything opened with target=_blank. Four
 *   of BackButton's fourteen call sites had no fallback, so the button rendered,
 *   looked enabled, and did nothing. BackButton's `fallbackPath` is required now.
 *
 *   Then app/not-found turned out to hand-roll the same broken shape, on the page
 *   where arriving with NO history is not an edge case but the normal case. Swapping
 *   it to <BackButton> would have imported that component's chevron and classes
 *   into a screen with its own styling; a sweep found eight more hand-rolled
 *   `router.back()` calls where the same swap would restyle eight screens.
 *
 *   So the RULE is shared and the presentation is not. BackButton calls this;
 *   not-found calls this; the other eight are a ledger in
 *   a-back-button-that-went-nowhere-and-a-step-you-could-not-see, because each
 *   needs a per-screen decision about where "back" means when there is no history,
 *   and that is not a decision to make eight times in one pass.
 *
 * ── WHAT IT DELIBERATELY DOES NOT TRY TO DO ─────────────────────────────────
 *
 *   `history.length` counts the whole TAB session, not this app's share of it, so
 *   `back()` can still walk somebody off the platform. Nothing can tell the two
 *   apart: `document.referrer` describes the entry we came FROM, not the one we
 *   would return TO, and the History API exposes no per-entry origin. The fallback
 *   is a last resort, not a preference. What both #921 and #927 changed is that
 *   the last resort always exists.
 */

interface BackCapableRouter {
    back: () => void;
    push: (href: string) => void;
}

/**
 * Pop one history entry if there is one, otherwise navigate to `fallbackPath`.
 *
 * Always does one or the other — there is no path through this function that
 * leaves a clicked button doing nothing, which is the whole point.
 */
export function goBackOr(router: BackCapableRouter, fallbackPath: string): void {
    if (typeof window !== 'undefined' && window.history.length > 1) {
        router.back();
        return;
    }

    router.push(fallbackPath);
}
