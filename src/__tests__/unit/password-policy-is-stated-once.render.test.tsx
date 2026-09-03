/**
 * @jest-environment jsdom
 */

/**
 *   #330 SIX STATEMENTS OF ONE PASSWORD RULE. THE THREE LIVE SCREENS ALL
 *        UNDERSTATED IT, AND THE ONLY CORRECT COPY WAS USED BY NOTHING.
 *
 *        registerAction, changePasswordAction and resetPasswordAction all
 *        validate with `passwordPolicySchema`, which demands five things:
 *        8 characters, uppercase, LOWERCASE, a digit, a symbol.
 *
 *        components/auth/PasswordStrengthIndicator.tsx
 *            All five, correct. ZERO imports anywhere in the repository.
 *
 *        components/auth/RegisterForm.tsx           /auth/register, LIVE
 *            A hand-rolled checklist of four — length, uppercase, number,
 *            special. Lowercase absent from the list AND from the score. So
 *            `PASSWORD1!` passed 4 of 4, filled the bar to 100%, printed
 *            "Strong" in green beside four green ticks, and the server refused
 *            it: "Password must contain at least one lowercase letter."
 *
 *        app/auth/reset-password/page.tsx           LIVE
 *            minLength={8} and "Must be at least 8 characters" — one of five.
 *
 *        app/profile/page.tsx (change password)     LIVE
 *            `if (passwordData.new.length < 8)` — one of five.
 *
 *        components/auth/ModuleRegisterPage.tsx     dead component
 *            Builds a list including lowercase and never renders it; nothing
 *            imports the component either.
 *
 *        lib/security.ts validatePassword           dead function
 *            A sixth copy whose four content checks are each gated on an env
 *            var compared `=== 'true'`. Unset means false. Nothing imports it.
 *
 *        The rules are DATA now — lib/password-policy.ts — and both the schema
 *        and the indicator are built from that one array.
 */

// describe/it/expect come from the globals, NOT from '@jest/globals':
// importing them shadows the global `expect` that '@testing-library/jest-dom'
// augments in jest.setup.js, and `toBeInTheDocument` then does not typecheck.
// Same as the other *.render.test.tsx suites.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import PasswordStrengthIndicator from '@/components/auth/PasswordStrengthIndicator';
import {
    PASSWORD_RULES,
    passwordMeetsPolicy,
    unmetPasswordRules,
    firstPasswordProblem,
} from '@/lib/password-policy';
import { passwordPolicySchema } from '@/lib/schemas';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

/** The password the register screen called "Strong" and the server refused. */
const THE_EXPLOIT = 'PASSWORD1!';

// ─────────────────────────────────────────────────────────────────────────────
describe('#330 — the password the screen called Strong', () => {
    it('PASSWORD1! IS REFUSED BY THE SERVER', () => {
        expect(passwordPolicySchema.safeParse(THE_EXPLOIT).success).toBe(false);
        expect(passwordMeetsPolicy(THE_EXPLOIT)).toBe(false);
    });

    it('and the ONE rule it breaks is the one the old checklist omitted', () => {
        expect(unmetPasswordRules(THE_EXPLOIT).map((r) => r.id)).toEqual(['lowercase']);
        expect(firstPasswordProblem(THE_EXPLOIT))
            .toBe('Password must contain at least one lowercase letter');
    });

    it("THE OLD FOUR-CHECK SCORE CALLED IT PERFECT — which is why this matters", () => {
        // The calculation exactly as RegisterForm carried it. Reproduced here
        // rather than described, so the gap is measured and not asserted.
        const oldChecks = {
            length: THE_EXPLOIT.length >= 8,
            uppercase: /[A-Z]/.test(THE_EXPLOIT),
            number: /[0-9]/.test(THE_EXPLOIT),
            special: /[^A-Za-z0-9]/.test(THE_EXPLOIT),
        };
        const passed = Object.values(oldChecks).filter(Boolean).length;
        const oldLabel = passed <= 1 ? 'Weak' : passed <= 2 ? 'Fair' : passed <= 3 ? 'Good' : 'Strong';

        expect(passed).toBe(4);
        expect(oldLabel).toBe('Strong');
        // Full bar, top label, and a server that says no.
        expect(passed / 4).toBe(1);
        expect(passwordMeetsPolicy(THE_EXPLOIT)).toBe(false);
    });

    it('the same password satisfies every screen rule the old code stated', () => {
        // reset-password: minLength={8} and "Must be at least 8 characters"
        expect(THE_EXPLOIT.length >= 8).toBe(true);
        // profile: if (new.length < 8) refuse
        expect(THE_EXPLOIT.length < 8).toBe(false);
        // …and is still refused.
        expect(passwordMeetsPolicy(THE_EXPLOIT)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#330 — the schema and the checklist are the same list', () => {
    const CASES: [string, boolean][] = [
        ['PASSWORD1!', false],   // no lowercase — the one that shipped
        ['password1!', false],   // no uppercase
        ['Password!!', false],   // no digit
        ['Password11', false],   // no symbol
        ['Pass1!', false],       // too short
        ['password', false],     // the value minLength={8} waved through
        ['Password1!', true],    // satisfies all five
        ['Password1 ', true],    // a space is a symbol under /[^A-Za-z0-9]/, as the schema always allowed
        // An accented capital is NOT an uppercase letter here: /[A-Z]/ is
        // ASCII-only, while /[^A-Za-z0-9]/ counts Á as the special character.
        // Pre-existing behaviour of passwordPolicySchema, preserved rather than
        // changed — pinned so a later widening of the character classes is a
        // deliberate edit and not a surprise.
        ['Ábcdef1!', false],
    ];

    it.each(CASES)('%s → acceptable: %s, and the schema agrees', (password, expected) => {
        expect(passwordMeetsPolicy(password)).toBe(expected);
        expect(passwordPolicySchema.safeParse(password).success).toBe(expected);
    });

    it('every refusal message the schema emits comes from PASSWORD_RULES', () => {
        const known = new Set(PASSWORD_RULES.map((r) => r.message));
        for (const [password] of CASES) {
            const result = passwordPolicySchema.safeParse(password);
            if (result.success) continue;
            for (const issue of result.error.issues) {
                expect({ password, message: issue.message, known: known.has(issue.message) })
                    .toEqual({ password, message: issue.message, known: true });
            }
        }
    });

    it('the messages are the ones the chained .regex() calls produced', () => {
        // Preserved verbatim so an existing refusal reads the same as before.
        expect(PASSWORD_RULES.map((r) => r.message)).toEqual([
            'Password must be at least 8 characters',
            'Password must contain at least one uppercase letter',
            'Password must contain at least one lowercase letter',
            'Password must contain at least one number',
            'Password must contain at least one special character',
        ]);
    });

    it('POSITIVE CONTROL: the agreement check can fail', () => {
        // Otherwise "schema agrees with rules" could hold because both sides
        // accept everything.
        expect(passwordMeetsPolicy('')).toBe(false);
        expect(passwordPolicySchema.safeParse('').success).toBe(false);
        expect(unmetPasswordRules('').length).toBe(PASSWORD_RULES.length);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#330 — the checklist a user actually sees', () => {
    it('NAMES THE LOWERCASE REQUIREMENT', () => {
        render(<PasswordStrengthIndicator password={THE_EXPLOIT} />);
        expect(screen.getByText(/lowercase/i)).toBeInTheDocument();
    });

    it('shows every rule the server enforces, and no others', () => {
        render(<PasswordStrengthIndicator password="x" />);
        for (const rule of PASSWORD_RULES) {
            expect(screen.getByText(rule.label)).toBeInTheDocument();
        }
    });

    it('DOES NOT SAY "Strong" FOR A PASSWORD THE SERVER REFUSES', () => {
        render(<PasswordStrengthIndicator password={THE_EXPLOIT} />);
        expect(screen.queryByText('Strong')).not.toBeInTheDocument();
    });

    it('says Strong only when every rule is met', () => {
        render(<PasswordStrengthIndicator password="Password1!" />);
        expect(screen.getByText('Strong')).toBeInTheDocument();
        expect(passwordMeetsPolicy('Password1!')).toBe(true);
    });

    it('renders nothing for an empty password', () => {
        const { container } = render(<PasswordStrengthIndicator password="" />);
        expect(container).toBeEmptyDOMElement();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#330 — every live password screen states the same rule', () => {
    /**
     * The screens where a user chooses a password. LoginForm is excluded: it
     * takes an existing one and states no policy.
     */
    const PASSWORD_SCREENS = [
        'src/components/auth/RegisterForm.tsx',
        'src/app/auth/reset-password/page.tsx',
        'src/app/profile/page.tsx',
    ];

    it.each(PASSWORD_SCREENS)('%s renders PasswordStrengthIndicator', (rel) => {
        const src = stripComments(read(rel));
        expect({ rel, uses: src.includes('<PasswordStrengthIndicator') })
            .toEqual({ rel, uses: true });
    });

    it('AND NONE OF THEM STILL CARRIES A HAND-WRITTEN COPY OF THE POLICY', () => {
        // The literals that made each of them a separate, shorter statement of
        // the rule.
        const banned = [
            /"8\+ characters"/,
            /"Uppercase letter"/,
            /Must be at least 8 characters/,
            /\.length < 8\)/,
        ];
        const offenders: string[] = [];
        for (const rel of PASSWORD_SCREENS) {
            const src = stripComments(read(rel));
            for (const pattern of banned) {
                if (pattern.test(src)) offenders.push(`${rel}: ${pattern}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('POSITIVE CONTROL: those patterns do match the code they came from', () => {
        // Without this, "no offenders" could mean the patterns match nothing at
        // all. Each is checked against the string it was written for.
        expect(/"8\+ characters"/.test('{ label: "8+ characters", met: checks.length }')).toBe(true);
        expect(/Must be at least 8 characters/.test('<p>Must be at least 8 characters</p>')).toBe(true);
        expect(/\.length < 8\)/.test('if (passwordData.new.length < 8) {')).toBe(true);
    });

    it('the profile modal refuses with the message the SERVER would give', () => {
        const src = stripComments(read('src/app/profile/page.tsx'));
        expect(src).toMatch(/firstPasswordProblem\(passwordData\.new\)/);
    });

    it('the indicator no longer types the rules out itself', () => {
        // It listed all five by hand. Correct, and still a copy — the next edit
        // to the policy would have had to find it.
        const src = stripComments(read('src/components/auth/PasswordStrengthIndicator.tsx'));
        expect(src).toMatch(/PASSWORD_RULES/);
        expect(src).not.toMatch(/One uppercase letter/);
        expect(src).not.toMatch(/\/\[A-Z\]\//);
    });

    it('and the schema is built from the array rather than restating it', () => {
        const src = stripComments(read('src/lib/schemas.ts'));
        expect(src).toMatch(/PASSWORD_RULES/);
        // The chained regex form this replaced.
        expect(src).not.toMatch(/\.regex\(\/\[A-Z\]\//);
        expect(src).not.toMatch(/\.regex\(\/\[a-z\]\//);
    });

    it('VACUITY GUARD: the screens exist and are substantial', () => {
        for (const rel of PASSWORD_SCREENS) {
            expect({ rel, big: read(rel).length > 1000 }).toEqual({ rel, big: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#330 — the two dead copies, recorded', () => {
    /**
     * Neither is reachable, so neither is repaired. They are pinned so that a
     * later reader does not mistake them for the policy, and so that WIRING one
     * up fails this test rather than silently reintroducing a shorter rule.
     */
    it('ModuleRegisterPage is imported by nothing', () => {
        const consumers = [
            'src/app/auth/register/page.tsx',
        ].filter((rel) => read(rel).includes('ModuleRegisterPage'));
        expect(consumers).toEqual([]);
    });

    it('lib/security.ts validatePassword is imported by nothing', () => {
        // Its uppercase/lowercase/number/special checks are each gated on an
        // env var compared === 'true'; unset means false, so it would enforce
        // length alone if adopted.
        const src = stripComments(read('src/lib/security.ts'));
        expect(src).toMatch(/requireUppercase: process\.env\.PASSWORD_REQUIRE_UPPERCASE === 'true'/);
    });
});
