/**
 * @jest-environment node
 */

/**
 *   #919 TWO FUNCTIONS CALLED isValidNigerianPhone, AND THEY DISAGREED.
 *
 *   Found auditing components/ui/PhoneInput.tsx and app/auth/forgot-password/page.tsx
 *   — two of the files no test had named.
 *
 *       components/ui/PhoneInput   /^0[789][01]\d{8}$/  and two siblings
 *       lib/security               /^(\+?234|0)[789]\d{9}$/
 *
 *   The middle digit is the whole difference and it is not cosmetic. Nigerian
 *   mobile prefixes are 070, 071, 080, 081, 090 and 091, so `[789][01]` is the
 *   real set and `[789]\d` wrongly admits 072…079, 082…089 and 092…099.
 *   MEASURED — they disagreed on 08212345678, 07512345678, 09512345678 and
 *   +2348512345678, among others.
 *
 * ── WHICH WAS LIVE, MEASURED BEFORE ASSUMING ────────────────────────────────
 *
 *   PhoneInput's. The only importer of the name is marketplace/checkout, and it
 *   imports it FROM PhoneInput. lib/security's copy had no callers at all.
 *
 *   So this was never a live defect, and saying otherwise would be the failure
 *   this audit keeps guarding against. It was a dead and WRONG copy of a live
 *   rule, sitting in the module whose name is the first place somebody would look
 *   for it — which is the trap validations/shared's nubanAccountNumber header
 *   already describes about account numbers: "a fourth hand-written /^\d{10}$/ is
 *   how a fourth disagreement starts." Here it had already started.
 *
 * ── THE FIX, AND WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────
 *
 *   `isNigerianMobile` lives in lib/phone, beside normalisePhone, because that is
 *   where the platform's phone reasoning already is. Both spellings delegate.
 *   NOTHING IS DELETED: lib/security keeps its export and its name, so any future
 *   caller reaching for it by name gets the right answer rather than a missing
 *   import.
 *
 *   The accepted set is PhoneInput's three shapes, because that is what the
 *   checkout takes today — narrowing it would refuse numbers the platform
 *   currently accepts, which is a behaviour change nobody asked for. What changes
 *   is that lib/security's answer becomes the strict one, on a function nothing
 *   calls.
 *
 * ── AND forgot-password, WHICH IS CORRECT AND IS PINNED FOR IT ───────────────
 *
 *   The reset screen never confirms whether an address is registered: "If an
 *   account exists for {email}, we've sent password reset instructions." The
 *   action behind it returns success for an unknown address AND for a
 *   rate-limited one, reasoning in its own comment that the limit must not
 *   "become an oracle for which addresses are registered".
 *
 *   password-reset.test.ts already covers the action, including "still says
 *   nothing about whether an address is registered". The SCREEN was unreached,
 *   and its half of that guarantee is one sentence of copy that a well-meaning
 *   edit to "We've sent a reset link to {email}" would quietly undo. Pinned, not
 *   changed.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { isNigerianMobile } from '@/lib/phone';
import { isValidNigerianPhone as fromPhoneInput } from '@/components/ui/PhoneInput';
import { isValidNigerianPhone as fromSecurity } from '@/lib/security';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.15 });

/** The four the two old regexes answered differently, and why each is not a mobile. */
const NOT_MOBILE_PREFIXES = [
    '08212345678',
    '07512345678',
    '09512345678',
    '+2348512345678',
] as const;

/** Real Nigerian mobile prefixes, one number each. */
const REAL_MOBILES = [
    '07012345678',
    '07112345678',
    '08012345678',
    '08112345678',
    '09012345678',
    '09112345678',
] as const;

describe('#919 — the one rule', () => {
    it('THE CONTROL: it accepts every real mobile prefix', () => {
        //   First. A rule that refused everything would satisfy each rejection
        //   assertion below, and this is a validator on the field people type
        //   their number into — over-strict is a member who cannot check out.
        for (const number of REAL_MOBILES) {
            expect({ number, valid: isNigerianMobile(number) }).toEqual({ number, valid: true });
        }
    });

    it('and the three shapes the checkout takes', () => {
        //   Eleven digits local, thirteen with 234, ten bare — plus separators,
        //   because that is how people write a number.
        expect(isNigerianMobile('08012345678')).toBe(true);
        expect(isNigerianMobile('2348012345678')).toBe(true);
        expect(isNigerianMobile('+2348012345678')).toBe(true);
        expect(isNigerianMobile('8012345678')).toBe(true);
        expect(isNigerianMobile('+234 801 234 5678')).toBe(true);
        expect(isNigerianMobile('0801-234-5678')).toBe(true);
    });

    it('IT REFUSES THE PREFIXES THAT ARE NOT MOBILES', () => {
        //   The four the old pair disagreed about. `[789]\\d` admitted all of
        //   them; none is a Nigerian mobile prefix.
        for (const number of NOT_MOBILE_PREFIXES) {
            expect({ number, valid: isNigerianMobile(number) }).toEqual({ number, valid: false });
        }
    });

    it('and the ordinary refusals', () => {
        for (const bad of ['', '   ', 'not a number', '0801234567', '080123456789', '12345678901']) {
            expect({ bad, valid: isNigerianMobile(bad) }).toEqual({ bad, valid: false });
        }
        expect(isNigerianMobile(null)).toBe(false);
        expect(isNigerianMobile(undefined)).toBe(false);
    });
});

describe('#919 — both spellings now answer from it', () => {
    it('THEY AGREE ON EVERY NUMBER THEY USED TO DISAGREE ABOUT', () => {
        //   The defect, directly: this loop failed on four of these before the
        //   fix. Asserted as a three-way agreement rather than "both are true",
        //   which would pass if both had been broken the same way.
        const probes = [...REAL_MOBILES, ...NOT_MOBILE_PREFIXES, '8012345678', '+234 801 234 5678', 'nonsense', ''];

        for (const number of probes) {
            const canonical = isNigerianMobile(number);
            expect({ number, fromPhoneInput: fromPhoneInput(number), fromSecurity: fromSecurity(number) })
                .toEqual({ number, fromPhoneInput: canonical, fromSecurity: canonical });
        }
    });

    it('and neither keeps a regex of its own', () => {
        //   The thing that made them drift. Comments stripped: both headers quote
        //   the old expressions to explain the finding, and an unstripped read
        //   finds those quotations and reports the regexes as still present. This
        //   is the trap this audit has now hit six times, so it is stated rather
        //   than discovered again.
        for (const rel of ['src/components/ui/PhoneInput.tsx', 'src/lib/security.ts']) {
            const src = code(rel);

            expect({ rel, delegates: src.includes('isNigerianMobile(phone)') })
                .toEqual({ rel, delegates: true });
            expect({ rel, ownRegex: /\[789\]/.test(src) }).toEqual({ rel, ownRegex: false });
        }
    });

    it('AND lib/security KEEPS ITS EXPORT, so a caller reaching by name still finds it', () => {
        //   Deliberately not deleted. The name is the first place somebody would
        //   look, and a missing import is how the wrong rule gets written a third
        //   time.
        expect(typeof fromSecurity).toBe('function');
        expect(code('src/lib/security.ts')).toContain('export function isValidNigerianPhone');
    });

    it('POSITIVE CONTROL: the regex sweep can find one', () => {
        //   Two `not`-shaped assertions above. Without this, a stripper that
        //   gutted the file would satisfy them.
        expect(/\[789\]/.test('const r = /^0[789][01]\\d{8}$/;')).toBe(true);
        expect(code('src/lib/phone.ts')).toMatch(/\[789\]\[01\]/);
        expect(code('src/components/ui/PhoneInput.tsx')).toContain('isValidNigerianPhone');
    });

    it('and the live caller still imports the name it always did', () => {
        //   marketplace/checkout imports it from PhoneInput. That is unchanged, so
        //   this is a fix with no call-site churn.
        const checkout = code('src/app/marketplace/checkout/page.tsx');

        expect(checkout).toContain('isValidNigerianPhone');
        expect(checkout).toContain('from "@/components/ui/PhoneInput"');
    });
});

describe('#919 — how many phone rules are left, and where', () => {
    /**
     * Three, and they answer different questions.
     *
     *   lib/phone                     normalisePhone, normalisePhoneLoose,
     *                                 phoneLookupVariants, isNigerianMobile
     *   lib/types/phone-number-field  normalisePhoneInput — a FIELD helper, for
     *                                 what to keep as somebody types
     *   components/ui/PhoneInput      normalizePhoneNumber, formatPhoneNumber —
     *                                 storage and display shapes
     *
     *   NOT folded together. normalisePhone answers "what do I query for",
     *   normalisePhoneInput answers "what do I allow in the box", and
     *   formatPhoneNumber answers "how do I show it" — three questions that happen
     *   to touch the same digits. Collapsing them would be a bigger change than
     *   this finding, on paths that include registration.
     *
     *   What is pinned is the COUNT, so a fourth normaliser has to justify itself
     *   the way this one's validator could not.
     */
    it('THE LEDGER — modules defining a phone normaliser', () => {
        const DEFINERS = [
            'src/lib/phone.ts',
            'src/lib/types/phone-number-field.ts',
            'src/components/ui/PhoneInput.tsx',
        ];

        const defining = DEFINERS.filter((rel) =>
            /export function normali[sz]ePhone[A-Za-z]*\s*\(/.test(code(rel)));

        expect(defining).toEqual(DEFINERS);
    });

    it('AND EXACTLY ONE MODULE DEFINES THE VALIDATOR', () => {
        //   The half this finding actually fixed. Both old sites delegate, so
        //   `isNigerianMobile` is defined once.
        const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');

        function walk(dir: string, out: string[] = []): string[] {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) {
                    if (entry !== 'node_modules') walk(full, out);
                } else if (/\.tsx?$/.test(full)) {
                    out.push(full);
                }
            }
            return out;
        }

        const definers: string[] = [];
        for (const file of walk(join(ROOT, 'src'))) {
            const rel = file.slice(ROOT.length + 1);
            if (/__tests__|\.test\./.test(rel)) continue;

            if (/export function isNigerianMobile\s*\(/.test(stripComments(readFileSync(file, 'utf8'), { label: rel }))) {
                definers.push(rel);
            }
        }

        expect(definers).toEqual(['src/lib/phone.ts']);
    });
});

describe('#919 — forgot-password does not say whether the address is registered', () => {
    const SCREEN = 'src/app/auth/forgot-password/page.tsx';

    it('THE CONTROL: the screen is still the reset screen', () => {
        const src = code(SCREEN).replace(/\s+/g, ' ');

        expect(src).toContain('Reset Password');
        expect(src).toContain('sendResetEmailAction');
    });

    it('ITS SUCCESS MESSAGE IS CONDITIONAL, not a confirmation', () => {
        //   The screen's half of a guarantee the action already keeps. "We've sent
        //   a reset link to {email}" would be the natural copy edit and would
        //   confirm the address exists — turning a careful non-enumerable flow
        //   into an account-existence oracle, on a page no login is required for.
        const src = code(SCREEN).replace(/\s+/g, ' ');

        expect(src).toContain('If an account exists for');
        expect(src).toMatch(/we&apos;ve sent|we've sent/);
    });

    it('and it never claims the address was found', () => {
        const src = code(SCREEN).replace(/\s+/g, ' ').toLowerCase();

        for (const leak of [
            'no account',
            'not registered',
            'email not found',
            'account found',
            'no user with',
        ]) {
            expect({ leak, present: src.includes(leak) }).toEqual({ leak, present: false });
        }
    });

    it('POSITIVE CONTROL: the copy really is being read', () => {
        //   Five `not`-shaped assertions above, all of which pass on an empty
        //   string.
        const src = code(SCREEN);

        expect(src).toContain('Check Your Email');
        expect(src.length).toBeGreaterThan(2_000);
    });
});
