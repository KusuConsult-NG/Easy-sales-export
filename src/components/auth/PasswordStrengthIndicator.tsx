"use client";

import { Check, X } from "lucide-react";

interface PasswordStrengthIndicatorProps {
    password: string;
}

/**
 * Password Strength Indicator Component
 * 
 * Displays real-time feedback on password requirements:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
export default function PasswordStrengthIndicator({ password }: PasswordStrengthIndicatorProps) {
    const requirements = [
        {
            label: "At least 8 characters",
            met: password.length >= 8,
        },
        {
            label: "One uppercase letter (A-Z)",
            met: /[A-Z]/.test(password),
        },
        {
            label: "One lowercase letter (a-z)",
            met: /[a-z]/.test(password),
        },
        {
            label: "One number (0-9)",
            met: /[0-9]/.test(password),
        },
        {
            label: "One special character (!@#$%^&*)",
            met: /[^A-Za-z0-9]/.test(password),
        },
    ];

    const metCount = requirements.filter((r) => r.met).length;
    const strength =
        metCount === 5 ? "strong" : metCount >= 3 ? "medium" : "weak";

    const strengthColor = {
        strong: "bg-emerald-500",
        medium: "bg-amber-500",
        weak: "bg-red-500",
    };

    const strengthLabel = {
        strong: "Strong",
        medium: "Medium",
        weak: "Weak",
    };

    if (!password) return null;

    return (
        <div className="mt-3 space-y-3">
            {/* Strength Bar */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Password Strength
                    </span>
                    <span
                        className={`text-sm font-semibold ${strength === "strong"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : strength === "medium"
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-red-600 dark:text-red-400"
                            }`}
                    >
                        {strengthLabel[strength]}
                    </span>
                </div>
                <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-300 ${strengthColor[strength]}`}
                        style={{
                            width: `${(metCount / requirements.length) * 100}%`,
                        }}
                    />
                </div>
            </div>

            {/* Requirements Checklist */}
            <div className="space-y-2">
                {requirements.map((req, index) => (
                    <div
                        key={index}
                        className="flex items-center gap-2 text-sm"
                    >
                        {req.met ? (
                            <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : (
                            <X className="w-4 h-4 text-slate-400 dark:text-slate-600 shrink-0" />
                        )}
                        <span
                            className={
                                req.met
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-slate-500 dark:text-slate-400"
                            }
                        >
                            {req.label}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
