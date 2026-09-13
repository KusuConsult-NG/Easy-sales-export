"use client";

import { useEffect, useRef, useState } from "react";
import {
    isStaleDeploymentError,
    canAutoReload,
    consumeReloadBudget,
} from "@/lib/stale-deployment-recovery";

/**
 * The stale-deployment half of an error boundary, in one place — #717.
 *
 * Returns `true` while an automatic reload is on its way, and the boundary
 * should render its "updating" notice. Returns `false` for everything else,
 * INCLUDING a stale-deployment error whose page has already used its reloads —
 * which is the case that used to spin forever and must now fall through to the
 * ordinary error UI, where there is a "Try again" button and a way out.
 *
 * WHY THE DECISION IS TAKEN IN useState AND NOT IN THE EFFECT. A boundary that
 * waited for the effect would render its full red error screen for one frame
 * before the reload, on a condition that is not the user's problem and is about
 * to fix itself. `canAutoReload` only reads; the effect is what spends.
 */
export function useStaleDeploymentRecovery(error: unknown): boolean {
    const [reloading] = useState(() => isStaleDeploymentError(error) && canAutoReload());

    //   React runs effects twice in development's StrictMode. Without this the
    //   budget would be spent twice per mount and the second reload would be
    //   refused for a reason that only exists in dev.
    const spent = useRef(false);

    useEffect(() => {
        if (!reloading || spent.current) return;
        spent.current = true;

        if (consumeReloadBudget()) {
            window.location.reload();
            return;
        }

        //   Lost the budget between the render and this effect — another
        //   boundary on the same page got there first. Nothing to do: the
        //   reload it started is already in flight.
    }, [reloading]);

    return reloading;
}
