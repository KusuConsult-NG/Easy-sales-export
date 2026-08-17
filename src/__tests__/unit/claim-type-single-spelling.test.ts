/**
 * @jest-environment node
 */

/**
 * One business event, one claim type — but repairs must still read the old name.
 *
 * THE DEFECT
 * ----------
 * A cooperative contribution has two confirmation paths, and each passed its own
 * literal to claimPaymentOnce:
 *
 *   src/infrastructure/payments/service.ts   webhook          "contribution"
 *   src/app/actions/cooperative/_payment.ts  browser redirect "cooperative_contribution"
 *
 * So which name a payment was filed under depended on which path won a race
 * against Paystack. Every other claim type in the codebase has exactly one
 * spelling; this was the only one that did not.
 *
 * HOW IT WAS FOUND, AND WHY IT HID
 * --------------------------------
 * By querying production while checking whether the savings repair had anything
 * to do. processed_payments holds rows of type='contribution' and NOT ONE of
 * 'cooperative_contribution' — the browser path has never won a claim race in
 * production. Nothing had yet been filed under the name the rest of the system
 * does not use, so nothing was visibly broken.
 *
 * That is what made it worth fixing rather than shrugging at: the first time the
 * browser redirect wins, that payment is recorded under a type no consumer
 * matches, and the failure would appear months later as a contribution missing
 * from a report.
 *
 * WHY "contribution" WON
 * ----------------------
 * It is the name already in the database, the name BOTH paths use for the
 * cooperative LEDGER row, and the name every consumer matches on. Standardising
 * the other way would have orphaned the existing production rows.
 *
 * THE ASYMMETRY THIS FILE ENFORCES
 * --------------------------------
 * Exactly one spelling may be WRITTEN. Both must remain READABLE, because
 * repairs work on historical rows — a repair that recognised only the current
 * name would report "nothing to do" for precisely the rows it exists to fix, and
 * for a money repair that is the worst available failure mode.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import {
    CLAIM_TYPE,
    LEGACY_COOPERATIVE_CONTRIBUTION_CLAIM_TYPE,
} from '@/lib/wallet-ledger';

const SRC = join(process.cwd(), 'src');
const OWNER = join('lib', 'wallet-ledger.ts');

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__') continue;
            walk(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

function codeOf(file: string): string {
    return readFileSync(file, 'utf-8')
        .split('\n')
        .filter(line => {
            const t = line.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

describe('the contribution claim type has one spelling', () => {
    const files = walk(SRC).map(f => ({ file: f, code: codeOf(f) }));

    it('found the source tree (sanity)', () => {
        expect(files.length).toBeGreaterThan(100);
        expect(files.some(f => f.file.endsWith(OWNER))).toBe(true);
    });

    it('the constant is the name already in production', () => {
        // Not an arbitrary choice: production's processed_payments rows carry
        // this value, and switching to the other spelling would orphan them.
        expect(CLAIM_TYPE.COOPERATIVE_CONTRIBUTION).toBe('contribution');
        expect(LEGACY_COOPERATIVE_CONTRIBUTION_CLAIM_TYPE).toBe('cooperative_contribution');
    });

    it('nothing writes the legacy spelling as a claim TYPE', () => {
        // Scoped to `type:` assignments, not to any appearance of the string.
        //
        // A looser check on the substring flagged three false positives, and each
        // is a genuinely different concept — the sort of noise that gets a check
        // deleted rather than fixed:
        //
        //   src/app/actions/payments.ts              purpose: "cooperative_contribution"
        //   src/app/api/cooperative/contribute/…     purpose: 'cooperative_contribution'
        //       — the Paystack METADATA PURPOSE, a separate field that routes the
        //         webhook. Renaming it would break payments already in flight.
        //   src/lib/types/firestore.ts               COOPERATIVE_CONTRIBUTIONS:
        //                                            "cooperative_contributions"
        //       — a COLLECTION name, plural, matched only as a substring.
        //
        // wallet-ledger.ts is exempt: it defines the legacy name so repairs can
        // read it.
        const offenders = files
            .filter(f => !f.file.endsWith(OWNER))
            .filter(f => new RegExp(`type:\\s*["']${LEGACY_COOPERATIVE_CONTRIBUTION_CLAIM_TYPE}["']`).test(f.code))
            .map(f => f.file.replace(process.cwd() + '/', ''));

        expect(
            offenders.length === 0
                ? 'ok'
                : `These write "${LEGACY_COOPERATIVE_CONTRIBUTION_CLAIM_TYPE}" as a claim type. One ` +
                  `business event must not have two names — use ` +
                  `CLAIM_TYPE.COOPERATIVE_CONTRIBUTION from @/lib/wallet-ledger: ` +
                  offenders.join(', ')
        ).toBe('ok');
    });

    it('both contribution writers claim with the constant, not a literal', () => {
        // The two paths that diverged. Asserted by name because they are the
        // specific pair this defect came from.
        for (const rel of [
            join('infrastructure', 'payments', 'service.ts'),
            join('app', 'actions', 'cooperative', '_payment.ts'),
        ]) {
            const code = codeOf(join(SRC, rel));
            expect(
                /CLAIM_TYPE\.COOPERATIVE_CONTRIBUTION/.test(code)
                    ? 'ok'
                    : `${rel} does not use CLAIM_TYPE.COOPERATIVE_CONTRIBUTION`
            ).toBe('ok');
        }
    });

    it('no claimPaymentOnce call anywhere passes a bare contribution literal', () => {
        // Vacuity guard: importing the constant while still passing a literal
        // would satisfy the check above and change nothing.
        //
        // Scoped to claimPaymentOnce CALL SITES, because `type: "contribution"`
        // is correct elsewhere — service.ts writes exactly that on the unified
        // ledger row and the cooperative ledger row, where both paths already
        // agree. Forbidding it file-wide would demand a change that is not a fix.
        const offenders: string[] = [];

        for (const { file, code } of files) {
            for (const call of code.match(/claimPaymentOnce\(\{[\s\S]*?\}\)/g) ?? []) {
                if (/type:\s*["'](contribution|cooperative_contribution)["']/.test(call)) {
                    offenders.push(file.replace(process.cwd() + '/', ''));
                }
            }
        }

        expect(
            offenders.length === 0
                ? 'ok'
                : `These claim a contribution with a literal instead of ` +
                  `CLAIM_TYPE.COOPERATIVE_CONTRIBUTION: ${offenders.join(', ')}`
        ).toBe('ok');
    });
});

describe('the repair still reads BOTH spellings', () => {
    // The asymmetry. Rows written before the unification carry the legacy name;
    // rows written after carry the new one. A repair recognising only one would
    // report "nothing to do" for exactly the rows it exists to fix.
    const repair = readFileSync(join(process.cwd(), 'scripts', 'repair-savings-balance.ts'), 'utf-8');

    it('queries for the current spelling', () => {
        expect(repair).toMatch(/CLAIM_TYPE\.COOPERATIVE_CONTRIBUTION/);
    });

    it('queries for the legacy spelling too', () => {
        expect(repair).toMatch(/LEGACY_COOPERATIVE_CONTRIBUTION_CLAIM_TYPE/);
    });

    it('uses an `in` filter rather than a single equality', () => {
        // `.eq('raw_data->>type', ...)` can only ever match one of the two.
        expect(repair).toMatch(/\.in\(\s*['"]raw_data->>type['"]/);
        expect(repair).not.toMatch(/\.eq\(\s*['"]raw_data->>type['"]/);
    });

    it("still narrows on source='client_verify', which is the real discriminator", () => {
        // Only that path credited totalContributions without savingsBalance.
        // Widening the type filter must not have widened the repair itself.
        expect(repair).toMatch(/\.eq\(\s*['"]raw_data->>source['"],\s*['"]client_verify['"]\s*\)/);
    });
});
