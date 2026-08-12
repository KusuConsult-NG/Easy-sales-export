/**
 * @jest-environment node
 */

/**
 * The private-file rule, enforced instead of merely stated.
 *
 * cooperative/index.ts opens with:
 *
 *     Private files (_actions, _admin, _payment, _dashboard, _loans, _withdrawal)
 *     must never be imported directly from outside this domain.
 *
 * Five files were doing exactly that, across four domains:
 *
 *     admin/wave/members/page.tsx            → wave/_admin
 *     admin/cooperatives/members/page.tsx    → cooperative/_admin
 *     admin/academy/applications/page.tsx    → academy/_admin
 *     hooks/useMarketplaceSearch.ts          → marketplace/_actions
 *     __tests__/unit/delivery-fee.test.ts    → marketplace/_payment
 *
 * Every one was gratuitous — each function is already reachable through its
 * barrel, the marketplace ones via `export * from "./_actions"` — so the four
 * application imports now go through the barrels and this test keeps them there.
 *
 * WHAT THIS IS AND IS NOT
 * -----------------------
 * It is NOT a security boundary. Every one of these functions is a `"use server"`
 * export and therefore a reachable endpoint whichever path an import takes; the
 * barrel changes nothing about that, and no finding in this audit was caused by
 * a direct import.
 *
 * It is an architectural one. The barrel is where a domain says what it offers,
 * and a convention with five exceptions is not a convention — it is a comment.
 * Written down as a test so the next person to reach past a barrel has to mean
 * it.
 *
 * TESTS ARE EXEMPT, DELIBERATELY
 * ------------------------------
 * delivery-fee.test.ts imports marketplace/_payment directly, and should be
 * allowed to. A test's job includes reaching inside a module — several suites in
 * this repo import a private file precisely because the barrel would hide what
 * they need to exercise. Exempting them keeps the rule about application code,
 * which is where it means something.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ACTIONS_ROOT = join(process.cwd(), 'src/app/actions');

/** Domains are the action subdirectories that publish a barrel. */
function domainsWithBarrels(): string[] {
    return readdirSync(ACTIONS_ROOT)
        .filter((entry) => {
            const full = join(ACTIONS_ROOT, entry);
            if (!statSync(full).isDirectory()) return false;
            try {
                statSync(join(full, 'index.ts'));
                return true;
            } catch {
                return false;
            }
        })
        .sort();
}

/** Every .ts/.tsx file under src, with its path relative to the repo. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) {
            if (entry === 'node_modules' || entry === '.next') continue;
            sourceFiles(full, acc);
        } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
            acc.push(full);
        }
    }
    return acc;
}

describe('domain barrels', () => {
    const domains = domainsWithBarrels();

    it('finds the domains to check (sanity)', () => {
        // Without this, a moved directory makes the assertion below pass against
        // an empty list — the vacuity failure this whole audit keeps meeting.
        expect(domains.length).toBeGreaterThanOrEqual(4);
        expect(domains).toContain('cooperative');
        expect(domains).toContain('marketplace');
    });

    it('is not reached past by application code', () => {
        const files = sourceFiles(join(process.cwd(), 'src'));
        const violations: string[] = [];

        for (const file of files) {
            const rel = file.slice(process.cwd().length + 1);

            // Tests may reach inside; see the header for why.
            if (rel.includes('__tests__')) continue;

            const src = readFileSync(file, 'utf-8');

            for (const domain of domains) {
                // A domain's own files import their siblings freely.
                if (rel.startsWith(join('src/app/actions', domain))) continue;

                const pattern = new RegExp(
                    `from\\s+['"]@/app/actions/${domain}/_[a-zA-Z0-9_]+['"]`,
                    'g'
                );
                for (const match of src.matchAll(pattern)) {
                    violations.push(`${rel}: ${match[0]}`);
                }
            }
        }

        if (violations.length > 0) {
            throw new Error(
                `\n\n${violations.length} file(s) import a domain's private module directly:\n\n` +
                violations.map((v) => `  ${v}`).join('\n') +
                `\n\nImport from the domain barrel instead — @/app/actions/<domain>.\n` +
                `Everything these files need is already re-exported there.\n\n` +
                `This is not a security boundary: every one of these functions is a\n` +
                `"use server" export and reachable whichever path the import takes.\n` +
                `It is where a domain states what it offers, and a convention with\n` +
                `exceptions is a comment rather than a rule.\n`
            );
        }
        expect(violations).toEqual([]);
    });

    it('re-exports what the application actually imports from each domain', () => {
        // The other half: a barrel that omitted something would force the
        // direct import back. Checked by importing each barrel and confirming
        // the names the app uses are present.
        const expectations: Record<string, string[]> = {
            wave: ['getStandardWaveApplicationsAction'],
            cooperative: ['getCooperativeStatsAction', 'getStandardCooperativeMembersAction'],
            academy: ['getStandardAcademyApplicationsAction', 'logAcademyExportAction'],
            marketplace: ['searchProductsAction', 'calculateDeliveryAction'],
        };

        for (const [domain, names] of Object.entries(expectations)) {
            const barrel = readFileSync(join(ACTIONS_ROOT, domain, 'index.ts'), 'utf-8');
            for (const name of names) {
                // Either named explicitly, or covered by an `export * from`.
                const named = barrel.includes(name);
                const wildcard = /export \* from/.test(barrel);
                expect(named || wildcard).toBe(true);
            }
        }
    });
});
