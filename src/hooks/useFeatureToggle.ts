"use client";

import { useState, useEffect } from "react";
import { getFeatureToggle } from "@/app/actions/feature-toggles";
import { DEFAULT_TOGGLES } from "@/lib/feature-toggles";

/**
 * Hook to check if a feature is enabled
 * Falls back to default value if database is unavailable
 */
export function useFeatureToggle(featureName: string): boolean {
    const [enabled, setEnabled] = useState(DEFAULT_TOGGLES[featureName] ?? false);

    useEffect(() => {
        async function checkToggle() {
            try {
                const isEnabled = await getFeatureToggle(featureName);
                setEnabled(isEnabled);
            } catch {
                // Keep default value on error
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
                        results[name] = DEFAULT_TOGGLES[name] ?? false;
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
