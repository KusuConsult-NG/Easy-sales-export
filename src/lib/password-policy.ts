/**
 * What this platform requires of a password — the one statement of it.
 *
 *   #330 THERE WERE SIX, THE THREE LIVE SCREENS ALL UNDERSTATED THE RULE, AND
 *        THE ONLY CORRECT COPY WAS USED BY NOTHING.
 *
 *        registerAction, changePasswordAction and the password-reset action all
 *        validate with `passwordPolicySchema`, which demands five things:
 *        8 characters, an uppercase letter, a LOWERCASE letter, a digit and a
 *        symbol. What the screens told the user:
 *
 *        components/auth/PasswordStrengthIndicator.tsx
 *            All five, correctly labelled. Imported by NOTHING — zero
 *            consumers in the entire repository.
 *
 *        components/auth/RegisterForm.tsx            /auth/register, LIVE
 *            A hand-rolled checklist of FOUR: "8+ characters",
 *            "Uppercase letter", "Number", "Special character". Lowercase is
 *            absent from the checklist AND from the strength calculation, so
 *            `PASSWORD1!` scores 4 of 4, fills the bar to 100%, prints
 *            "Strong" in green with four green ticks — and the server refuses
 *            it: "Password must contain at least one lowercase letter."
 *
 *        app/auth/reset-password/page.tsx            LIVE
 *            `minLength={8}` and the line "Must be at least 8 characters".
 *            One requirement of five, and the browser's own validation accepts
 *            `password`, which fails three server rules.
 *
 *        app/profile/page.tsx  (change password)     LIVE
 *            `if (passwordData.new.length < 8) setPasswordError(...)`. Again
 *            one of five, again passing `password` through to a refusal.
 *
 *        components/auth/ModuleRegisterPage.tsx      dead component
 *            Builds a four-item list including "Uppercase & lowercase letters"
 *            and never renders it. Nothing imports this component either.
 *
 *        lib/security.ts validatePassword            dead function
 *            A sixth copy, whose uppercase/lowercase/number/special checks are
 *            each gated on an env var compared `=== 'true'`. Unset means false,
 *            and they are unset — so it would enforce length alone. Nothing
 *            imports it; only `hashData` is taken from that module.
 *
 *        This is the codebase's most repeated defect — one rule in N copies,
 *        with the wired copy drifted — landing on the screen every account
 *        starts at.
 *
 * HOW THIS FILE PREVENTS THE NEXT DRIFT
 * -------------------------------------
 * The rules are DATA. `passwordPolicySchema` is built from this array rather
 * than restating it, and the strength indicator renders the same array. Adding
 * a rule changes what the server enforces and what every screen shows, in one
 * edit, because there is nothing else to edit.
 *
 * Deliberately dependency-free: no zod, no react. Both sides import it.
 */

export interface PasswordRule {
    /** Stable key, for tests and for keying list items. */
    id: "length" | "uppercase" | "lowercase" | "number" | "special";
    /** What the user is shown in the checklist. */
    label: string;
    /** What the server says when it refuses. */
    message: string;
    test: (password: string) => boolean;
}

/**
 * Order matters only for display. The messages are the ones
 * passwordPolicySchema has always produced — kept verbatim so existing
 * refusals read the same.
 */
export const PASSWORD_RULES: readonly PasswordRule[] = [
    {
        id: "length",
        label: "At least 8 characters",
        message: "Password must be at least 8 characters",
        test: (p) => p.length >= 8,
    },
    {
        id: "uppercase",
        label: "One uppercase letter (A-Z)",
        message: "Password must contain at least one uppercase letter",
        test: (p) => /[A-Z]/.test(p),
    },
    {
        id: "lowercase",
        label: "One lowercase letter (a-z)",
        message: "Password must contain at least one lowercase letter",
        test: (p) => /[a-z]/.test(p),
    },
    {
        id: "number",
        label: "One number (0-9)",
        message: "Password must contain at least one number",
        test: (p) => /[0-9]/.test(p),
    },
    {
        id: "special",
        label: "One special character (!@#$%^&*)",
        message: "Password must contain at least one special character",
        // Anything that is not a letter or a digit, which is what
        // passwordPolicySchema has always accepted. Deliberately broader than
        // the explicit punctuation class in lib/security.ts: a password the
        // server accepts must not be one a screen calls invalid.
        test: (p) => /[^A-Za-z0-9]/.test(p),
    },
];

/** The rules this password does not satisfy, in display order. */
export function unmetPasswordRules(password: string): PasswordRule[] {
    return PASSWORD_RULES.filter((rule) => !rule.test(password));
}

/** True when the password satisfies every rule the server enforces. */
export function passwordMeetsPolicy(password: string): boolean {
    return unmetPasswordRules(password).length === 0;
}

/**
 * The first refusal message, for a caller that shows one line rather than a
 * checklist. Null when the password is acceptable.
 */
export function firstPasswordProblem(password: string): string | null {
    return unmetPasswordRules(password)[0]?.message ?? null;
}
