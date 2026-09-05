"use client";

import { useState, useEffect } from "react";
import { getFeatureToggle } from "@/app/actions/feature-toggles";
import { DEFAULT_TOGGLES, resolveToggle } from "@/lib/feature-toggles";

/**
 *   #410 #245's REPAIR REACHED THE SERVER ACTION AND NOT THIS HOOK.
 *
 *   #245 found that getFeatureToggle returned DEFAULT_TOGGLES on a database
 *   error, and that seven of those default to TRUE — farm_nation_purchases,
 *   escrow_messaging, cooperative_loans, land_verification, academy_courses,
 *   wave_program, digital_id_system. So a transient read failure silently
 *   re-enabled a feature an admin had killed. Its own words: "A kill switch
 *   exists for the moment something is going wrong. A database error is that
 *   moment." The server now fails CLOSED through resolveToggle.
 *
 *   THE BROWSER HALF WAS LEFT AS IT WAS. This hook caught the error and did
 *   nothing — "Keep default value on error" — and the plural hook below wrote
 *   `DEFAULT_TOGGLES[name] ?? false` in its catch, which is the exact line #245
 *   condemned, one layer up.
 *
 *   AND IT IS LIVE. Six callers, all of them navigation: AdminSidebar,
 *   HubNavigation, WebsiteNav, Sidebar, DashboardNav, plus the WAVE earnings
 *   screen. An admin kills a module, the server correctly answers false, the
 *   call fails once on a flaky connection, and the killed module is still in
 *   the menu — for as long as the page is open. #297's class, and the same
 *   defect number's other half.
 *
 *   THE LOADING STATE IS DELIBERATELY NOT THE SAME CASE. The initial value
 *   stays the configured default, because "not read yet" is not "read and
 *   failed": treating it as off would blank every navigation on first paint and
 *   fill it in a moment later. That window is brief and self-correcting; the
 *   error is neither, which is why only the error path changes here.
 */
export function useFeatureToggle(featureName: string): boolean {
    const [enabled, setEnabled] = useState(DEFAULT_TOGGLES[featureName] ?? false);

    useEffect(() => {
        async function checkToggle() {
            try {
                const isEnabled = await getFeatureToggle(featureName);
                setEnabled(isEnabled);
            } catch {
                // #410. Fail closed, through the SAME helper the server uses —
                // one statement of the rule, not two that can drift (#390).
                setEnabled(resolveToggle(featureName, { readFailed: true }));
            }
        }

        checkToggle();
    }, [featureName]);

    return enabled;
}

/**
 * Hook to check multiple feature toggles at once
 */
export function useFeatureToggles(featureNames: string[]): Record<string, boolean> {
    const [toggles, setToggles] = useState<Record<string, boolean>>(() => {
        const initial: Record<string, boolean> = {};
        featureNames.forEach(name => {
            initial[name] = DEFAULT_TOGGLES[name] ?? false;
        });
        return initial;
    });

    const dependencyKey = featureNames.join(',');

    useEffect(() => {
        async function checkToggles() {
            const results: Record<string, boolean> = {};

            // Use Promise.all to fetch all toggles in parallel
            await Promise.all(
                featureNames.map(async (name) => {
                    try {
                        const isEnabled = await getFeatureToggle(name);
                        results[name] = isEnabled;
                    } catch {
                        // #410. This was `DEFAULT_TOGGLES[name] ?? false` — the
                        // line #245 removed from the server for turning a killed
                        // feature back on. Every caller of THIS hook is a
                        // navigation menu, so that is a killed module still
                        // offered to the user.
                        results[name] = resolveToggle(name, { readFailed: true });
                    }
                })
            );

            setToggles(results);
        }

        checkToggles();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dependencyKey]);

    return toggles;
}
