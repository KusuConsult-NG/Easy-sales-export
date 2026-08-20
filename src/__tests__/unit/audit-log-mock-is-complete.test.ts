/**
 * @jest-environment node
 */

/**
 * The audit-log mock must cover the module's whole export surface.
 *
 * THREE EXPORTS HAVE NOW GONE MISSING FROM IT, ONE AT A TIME
 * ----------------------------------------------------------
 *   logAdminFinancialAction  — escrow and payment paths
 *   logAuditAction           — eleven files
 *   recordAdminAction        — the cooperative member status action
 *
 * The failure mode is identical every time, and it is the worst kind: the export
 * is `undefined`, calling it throws, and the caller's try/catch turns the throw
 * into its own generic failure message. So the action under test returns
 * "Failed to update member status" — which reads exactly like a defect in the
 * code being tested — and every assertion about what it wrote fails against
 * perfectly correct code.
 *
 * The third one cost an hour to find. This is the gate that stops there being a
 * fourth: it diffs jest.setup.js's mock against the module's actual exports.
 *
 * WHY IT READS THE SETUP FILE AS TEXT
 * -----------------------------------
 * Importing @/lib/audit-log in a test gets the MOCK — that is the point of the
 * mock — so `Object.keys` on it would describe the very thing under inspection.
 * The real surface has to come from the source, and the mock's surface from the
 * file that defines it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();

function source(rel: string): string {
    return stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });
}

/** Runtime values the module exports — types and interfaces excluded. */
function realExports(): string[] {
    const src = source('src/lib/audit-log.ts');
    const names = new Set<string>();

    for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([a-zA-Z][\w]*)/gm)) {
        names.add(m[1]);
    }
    for (const m of src.matchAll(/^export\s+(?:const|let)\s+([a-zA-Z][\w]*)/gm)) {
        names.add(m[1]);
    }
    // `export { logFinancialAction as logAdminFinancialAction };` — the aliased
    // form, which is exactly how one of the three missing ones was spelled.
    for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const part of m[1].split(',')) {
            const alias = part.includes(' as ') ? part.split(' as ')[1] : part;
            const name = alias.trim();
            if (name) names.add(name);
        }
    }
    return [...names].sort();
}

/** Keys the jest.setup.js factory returns for @/lib/audit-log. */
function mockedExports(): string[] {
    const src = source('jest.setup.js');
    const start = src.indexOf("jest.mock('@/lib/audit-log'");
    expect(start).toBeGreaterThan(-1);

    // The factory body, taken by balancing braces from the opening one.
    const open = src.indexOf('{', src.indexOf('=>', start));
    let depth = 0;
    let end = open;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const body = src.slice(open, end);

    return [...body.matchAll(/^\s{4}([a-zA-Z][\w]*)\s*:/gm)].map((m) => m[1]).sort();
}

describe('the audit-log mock', () => {
    it('covers every runtime export of the real module', () => {
        const real = realExports();
        const mocked = mockedExports();

        // Vacuity guards. A regex that stopped matching would report a clean
        // result from two empty lists.
        expect(real.length).toBeGreaterThanOrEqual(8);
        expect(mocked.length).toBeGreaterThanOrEqual(8);
        expect(real).toContain('recordAdminAction');
        expect(mocked).toContain('recordAdminAction');

        const missing = real.filter((name) => !mocked.includes(name));

        if (missing.length > 0) {
            throw new Error(
                `\n\njest.setup.js does not mock ${missing.length} audit-log export(s):\n\n`
                + missing.map((m) => `  ${m}()`).join('\n')
                + `\n\nEach one is undefined at call time, so the first call throws inside the\n`
                + `caller's try/catch and comes back as that action's own generic failure —\n`
                + `"Failed to update member status", say. Every assertion about what the\n`
                + `action wrote then fails against correct code.\n\n`
                + `Three have gone missing this way already: logAdminFinancialAction,\n`
                + `logAuditAction and recordAdminAction.\n`,
            );
        }
        expect(missing).toEqual([]);
    });

    it('and the aliased export form is detected, which is how one of them hid', () => {
        // `export { logFinancialAction as logAdminFinancialAction }` exports a name
        // that appears nowhere as a declaration. A scan for `export function` and
        // `export const` alone misses it entirely.
        const real = realExports();
        expect(real).toContain('logAdminFinancialAction');
        expect(real).toContain('createAdminAuditLog');
    });

    it('and every mocked name really exists, so the mock is not inventing a surface', () => {
        // The other direction. A mock exporting something the module does not
        // would let a caller depend on a function that is undefined in production
        // — the same defect, pointing the other way.
        const real = realExports();
        const mocked = mockedExports();
        const invented = mocked.filter((name) => !real.includes(name));
        expect(invented).toEqual([]);
    });
});
