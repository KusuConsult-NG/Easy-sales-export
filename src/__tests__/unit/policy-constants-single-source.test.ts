/**
 * @jest-environment node
 */

/**
 * No business rule may be written as a number outside the module that owns it.
 *
 * WHY THIS TEST AND NOT ANOTHER ASSERTION ON THE CONSTANTS
 * -------------------------------------------------------
 * cooperative-tiers.test.ts already asserts maxLoanMultiplier === 0.5, and it
 * passed the entire time the live loan path was enforcing 3x. The constant was
 * never wrong. The caller that ignored it was, and no assertion on a constant
 * can see a caller that does not read it.
 *
 * That is the actual failure mode here, repeatedly:
 *
 *   - maxLoanMultiplier corrected 3 → 0.5; _applyForLoanAction kept
 *     `savingsBalance * 3` inline, so the correction never reached the code
 *     that decides whether to lend.
 *   - /api/cooperative/apply-loan held a third copy of the same rule as
 *     `amount * 2`, applied against the wrong balance field.
 *   - lib/cooperative-limits.ts was created to end the duplicate minimum
 *     balance, and platform.ts still carried `const MIN_BALANCE = 5000`.
 *   - /api/cooperatives/register charged `const registrationFee = 10000` while
 *     the sibling registration path read it from COOPERATIVE_CONFIG.
 *
 * Each was fixed individually. Individually fixing them leaves the generator
 * untouched — nothing stops the next copy, and the next copy is silent until a
 * member is charged the wrong amount or lent six times what they should be.
 *
 * This is the check that fails on the copy instead. It is deliberately the
 * narrowest rule that catches all four: a NUMERIC LITERAL assigned to a
 * variable whose NAME claims to be the policy. A value computed from the
 * constant passes, an imported constant passes, and an unrelated 5000 passes.
 *
 * WHEN THIS FAILS, THE FIX IS TO IMPORT THE CONSTANT. There is no ignore list
 * on purpose: an escape hatch here recreates exactly the situation the check
 * exists to prevent.
 */

import { describe, it, expect } from '@jest/globals';
import { scanForPolicyConstantCopies, POLICY_CONCEPTS } from '@/lib/testing/policy-constant-scan';

describe('policy constants have a single source', () => {
    it('finds no business rule written as a literal outside its module', () => {
        const copies = scanForPolicyConstantCopies();

        const report = copies
            .map(c =>
                `\n  ${c.file}:${c.line}\n` +
                `      const ${c.variable} = ${c.value}\n` +
                `      This is the ${c.concept}. Import ${c.canonical} instead.`
            )
            .join('');

        expect(copies.length === 0 ? '' : report).toBe('');
    });

    it('is actually looking at something — the scan runs and the registry is populated', () => {
        // A scan that silently found no files would report zero copies and pass
        // forever. That is the vacuity trap this codebase has hit before (the
        // smoke suite passing against a broken backend, the guard detector
        // whose regex stopped matching), so the scan's reach is asserted rather
        // than assumed.
        expect(POLICY_CONCEPTS.length).toBeGreaterThanOrEqual(5);
        for (const concept of POLICY_CONCEPTS) {
            expect(concept.allowedFiles.length).toBeGreaterThan(0);
            expect(concept.canonical).toMatch(/@\/lib\//);
        }
    });

    it('recognises each concept by the name a copy would actually use', () => {
        // The names below are the ones the four real copies were written with.
        // If a pattern is loosened or renamed so it no longer matches these,
        // the scan goes quiet without failing — this is what says so.
        const matches = (name: string) =>
            POLICY_CONCEPTS.some(c => c.namePattern.test(name));

        expect(matches('MIN_BALANCE')).toBe(true);         // platform.ts
        expect(matches('MINIMUM_BALANCE')).toBe(true);     // withdraw route
        expect(matches('registrationFee')).toBe(true);     // register route
        expect(matches('maxLoanAmount')).toBe(true);       // _coop_money.ts
        expect(matches('interestRate')).toBe(true);        // several
        expect(matches('maxTermMonths')).toBe(true);       // loan-terms

        // And does not fire on names that merely contain a policy word, which
        // is what would make the check too noisy to keep.
        expect(matches('currentBalance')).toBe(false);
        expect(matches('EXPORT_ROW_CAP')).toBe(false);
        expect(matches('MIN_WITHDRAWAL')).toBe(false);
        expect(matches('totalAmount')).toBe(false);
    });
});
