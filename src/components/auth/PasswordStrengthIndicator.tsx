"use client";

import { Check, X } from "lucide-react";
import { PASSWORD_RULES } from "@/lib/password-policy";

interface PasswordStrengthIndicatorProps {
    password: string;
    /** Tighter spacing and a two-column checklist, for use inside a modal. */
    compact?: boolean;
}

/**
 * Real-time feedback on the password requirements the server actually enforces.
 *
 * THIS COMPONENT WAS CORRECT AND USED BY NOTHING — #330.
 *
 * It listed all five requirements while the three live password screens each
 * stated a different, shorter rule:
 *
 *   /auth/register        a hand-rolled four-item checklist with no lowercase,
 *                         so PASSWORD1! read "Strong" with every tick green and
 *                         was then refused by the server for having no
 *                         lowercase letter.
 *   /auth/reset-password  minLength={8} and "Must be at least 8 characters".
 *   /profile              a `length < 8` check in the change-password modal.
 *
 * All three render this component now, and its list is no longer typed out
 * here: it comes from PASSWORD_RULES, the same array passwordPolicySchema
 * validates against. The checklist and the refusal cannot disagree, because
 * there is only one list.
 */
export default function PasswordStrengthIndicator({
    password,
    compact = false,
}: PasswordStrengthIndicatorProps) {
    if (!password) return null;

    const results = PASSWORD_RULES.map((rule) => ({ ...rule, met: rule.test(password) }));
    const metCount = results.filter((r) => r.met).length;

    // "Strong" means every rule the server enforces is satisfied — not four of
    // five, and not a separate scoring scheme that can reach its top label on a
    // password the server refuses.
    const strength = metCount === PASSWORD_RULES.length ? "strong" : metCount >= 3 ? "medium" : "weak";

    const strengthColor = {
        strong: "bg-emerald-500",
        medium: "bg-amber-500",
        weak: "bg-red-500",
    };

    const strengthTextColor = {
        strong: "text-emerald-600",
        medium: "text-amber-600",
        weak: "text-red-600",
    };

    const strengthLabel = {
        strong: "Strong",
        medium: "Medium",
        weak: "Weak",
    };

    return (
        <div className={compact ? "mt-2 space-y-2" : "mt-3 space-y-3"}>
            {/* Strength Bar */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-900">
                        Password Strength
                    </span>
                    <span className={`text-sm font-semibold ${strengthTextColor[strength]}`}>
                        {strengthLabel[strength]}
                    </span>
                </div>
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-300 ${strengthColor[strength]}`}
                        style={{ width: `${(metCount / PASSWORD_RULES.length) * 100}%` }}
                    />
                </div>
            </div>

            {/* Requirements Checklist */}
            <div className={compact ? "grid grid-cols-1 sm:grid-cols-2 gap-1" : "space-y-2"}>
                {results.map((req) => (
                    <div key={req.id} className="flex items-center gap-2 text-sm">
                        {req.met ? (
                            <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : (
                            <X className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <span className={req.met ? "text-emerald-600" : "text-slate-500"}>
                            {req.label}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
