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
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function checkToggle() {
            try {
                const isEnabled = await getFeatureToggle(featureName);
                setEnabled(isEnabled);
            } catch (error) {
                console.error(`Failed to fetch toggle for ${featureName}:`, error);
                // Keep default value on error
            } finally {
                setLoading(false);
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

    useEffect(() => {
        async function checkToggles() {
            const results: Record<string, boolean> = {};

            await Promise.all(
                featureNames.map(async (name) => {
                    try {
                        results[name] = await getFeatureToggle(name);
                    } catch (error) {
                        results[name] = DEFAULT_TOGGLES[name] ?? false;
                    }
                })
            );

            setToggles(results);
        }

        checkToggles();
    }, [featureNames.join(',')]);

    return toggles;
}
