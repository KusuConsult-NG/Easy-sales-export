"use client";

import { useEffect, useRef } from "react";

/**
 * Run a task on an interval, but ONLY while the tab is actually being looked at.
 *
 *   #538 EVERY BADGE IN THE APP POLLED FOREVER, INCLUDING IN TABS NOBODY WAS
 *        LOOKING AT.
 *
 *   Eleven components and hooks hand-rolled the same block:
 *
 *       useEffect(() => {
 *           load();
 *           const interval = setInterval(load, 8000);
 *           return () => clearInterval(interval);
 *       }, [deps]);
 *
 *   Not one of them asked whether the tab was visible. A signed-in user with
 *   the app open in a background tab — the ordinary case, because this is a
 *   dashboard people leave open — kept issuing server actions at full rate for
 *   as long as the browser stayed open, each one re-checking the session, which
 *   is a read of the user row whenever Redis is unset.
 *
 *   Measured per screen, idle, doing nothing:
 *
 *     /dashboard   DashboardNav's three pollers (8s, 8s, 10s) plus the page's
 *                  own getMyDashboard (8s, and eight queries inside it)
 *                  ≈ 28 server actions and ~75 database queries a minute
 *     /messages    the two nav pollers plus conversations (8s) and messages
 *                  (3s) ≈ 42 server actions a minute
 *     module pages ModuleSidebar (8s), the NotificationCenter inside it (10s)
 *                  and useMembershipStatus (8s) ≈ 21 a minute
 *
 *   Multiply by open tabs and by users, and that is the "the app is slow"
 *   complaint: the server spends its capacity answering the same questions for
 *   people who are not looking, and the answers a user IS waiting for queue
 *   behind them.
 *
 * ── WHY PAUSING IS SAFE HERE, AND WHY IT CATCHES UP ─────────────────────────
 *
 *   Everything polled this way is a DISPLAY value — an unread count, a badge, a
 *   membership status, a list of registrations. Nothing is a write, and nothing
 *   downstream depends on the poll having happened while the tab was hidden.
 *
 *   So a hidden tab stops entirely, and on becoming visible again the task runs
 *   IMMEDIATELY rather than waiting out the remaining interval. The user's first
 *   sight of the tab is therefore fresher than it was before this change, not
 *   staler: previously they saw whatever the last tick had left, up to a full
 *   interval old.
 *
 * ── WHY THE TASK LIVES IN A REF ─────────────────────────────────────────────
 *
 *   The callers pass an inline async closure, which is a new function on every
 *   render. Putting it in the dependency array would tear down and rebuild the
 *   interval on every render — which, for a component that re-renders when the
 *   poll sets state, means the interval restarts each time and the true period
 *   drifts. The ref keeps the interval stable and always calls the latest
 *   closure.
 *
 * ── SSR ─────────────────────────────────────────────────────────────────────
 *
 *   `document` is read inside the effect, never during render, so this is safe
 *   in a component that server-renders before hydrating. Where `document` does
 *   not exist at all the poll simply runs on its interval, as it did before.
 */
export function usePolling(
    task: () => void | Promise<void>,
    intervalMs: number,
    options: { enabled?: boolean; immediate?: boolean; restartKey?: string } = {},
): void {
    //   `immediate: false` for a caller whose own effect already does the first
    //   load. Two hooks keep that effect — useMembershipStatus and
    //   usePendingApplicationStatus — because it carries a `cancelled` flag and
    //   branch logic the repeat does not need. Without this they fired the
    //   status check TWICE on every mount, which #415's suite caught.
    const { enabled = true, immediate = true, restartKey = "" } = options;

    const taskRef = useRef(task);
    //   Refreshed in an effect rather than during render: writing a ref while
    //   rendering is what the react-hooks/refs rule forbids, and it caught this
    //   on the first version. No dependency array — it must run after EVERY
    //   render so the interval always calls the latest closure.
    useEffect(() => { taskRef.current = task; });

    useEffect(() => {
        if (!enabled || intervalMs <= 0) return;
        return startVisibilityAwareInterval(() => taskRef.current(), intervalMs, { immediate });
        //   `restartKey` is in the dependency list so a change of IDENTITY —
        //   the signed-in user, the module being asked about — tears the poll
        //   down and starts a fresh one, which refetches at once.
        //
        //   Without it the interval survived a user change and the badge kept
        //   showing the PREVIOUS user's count until the next tick. #416's suite
        //   caught that; it is a string rather than an array so the dependency
        //   list stays statically checkable.
    }, [enabled, intervalMs, immediate, restartKey]);
}

/**
 * The primitive `usePolling` is built on, exported for the one caller that
 * cannot use the hook.
 *
 * /dashboard defines its `load` INSIDE a useEffect, closing over a `cancelled`
 * flag, so the repeat cannot be lifted into a hook without restructuring the
 * effect that #453 carefully arranged. It calls this directly instead.
 *
 * Sharing the primitive rather than letting that one site hand-roll its own
 * visibility check is deliberate: "two hand-maintained copies of one contract"
 * is the defect class this audit keeps finding, and a pause-when-hidden rule
 * implemented twice is exactly that.
 *
 * Runs `task` immediately if the tab is visible, then every `intervalMs` while
 * it stays visible; stops entirely when hidden and runs once immediately on
 * becoming visible again. Returns a cleanup function.
 */
export function startVisibilityAwareInterval(
    task: () => void | Promise<void>,
    intervalMs: number,
    options: { immediate?: boolean } = {},
): () => void {
    //   `immediate: false` is for a caller that has ALREADY kicked off its own
    //   first load and only wants the repeat — /dashboard does, and running the
    //   task here as well would double every mount. Coming back to a hidden tab
    //   still catches up: that is the repeat, not the first load.
    const { immediate = true } = options;
    let timer: ReturnType<typeof setInterval> | null = null;

    const run = () => { void task(); };

    const isVisible = () =>
        typeof document === "undefined" || document.visibilityState !== "hidden";

    const start = () => {
        if (timer !== null) return;
        timer = setInterval(() => {
            //   Belt as well as braces: a tab can be hidden without the event
            //   firing (a browser that throttles rather than dispatches), so
            //   the tick itself checks too.
            if (isVisible()) run();
        }, intervalMs);
    };

    const stop = () => {
        if (timer === null) return;
        clearInterval(timer);
        timer = null;
    };

    const onVisibilityChange = () => {
        if (isVisible()) {
            //   Catch up first, THEN resume — see the header. Without the
            //   immediate run, coming back to a tab showed a stale badge for up
            //   to one full interval.
            run();
            start();
        } else {
            stop();
        }
    };

    if (isVisible()) {
        if (immediate) run();
        start();
    }

    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
        stop();
        if (typeof document !== "undefined") {
            document.removeEventListener("visibilitychange", onVisibilityChange);
        }
    };
}
