/**
 * @jest-environment node
 */

/**
 * The tools an owner runs to find out whether the platform is all right were
 * themselves wrong.
 *
 * THE INTEGRITY CHECKER, WRONG IN FOUR WAYS AT ONCE
 * ------------------------------------------------
 * /api/admin/verify-integrity is the "is my data OK?" button. It:
 *
 *   1. declared `const memberIds = new Set<string>()`, never added anything to
 *      it, and then asked `!memberIds.has(...)` for every loan and every
 *      savings plan. The Set was permanently empty, so EVERY loan and EVERY
 *      plan on the platform was reported ORPHANED. A report that flags 100% of
 *      records is one nobody reads twice.
 *
 *   2. read COOPERATIVE_FIXED_SAVINGS, which has no writer anywhere in the
 *      codebase. Fixed savings moved to FIXED_SAVINGS_PLANS — _coop_money.ts
 *      records the move in a comment and create-fixed-savings writes there — so
 *      totalFixedSavings was always 0 and no plan was ever checked.
 *
 *   3. swept three whole collections with a bare .get(), which the adapter caps
 *      at DEFAULT_QUERY_LIMIT (5,000) while returning a snapshot that looks
 *      identical to a complete one. A full-collection audit is precisely what
 *      .all() exists for.
 *
 *   4. compared `data.memberId` against `doc.id` alone. cooperative_members is
 *      keyed by USER id at every creation site, and one path keys by a separate
 *      membershipId with the userId in a field — so the index has to hold both,
 *      or every record belonging to a membership created that way orphans.
 *
 * THE MONEY TOTALS, CAPPED AT 5,000
 * ---------------------------------
 * finance.service.ts opens with "Balances must be derived from ledger totals
 * only" and then derived them from the first 5,000 rows.
 * getVerifiedRevenueMetrics is the worst of the three: it is the platform's
 * TOTAL revenue and total transaction count, and both stopped at 5,000
 * completed payments. Every payment past the cap was money the platform had
 * taken and did not report — and the Paystack reconciliation diffs against
 * exactly those two numbers.
 *
 * The reconciliation had the same defect on its own side: it built the set of
 * local references from a capped read, so every Paystack transaction whose
 * local record sat past row 5,000 was reported "missing in local" — the report
 * manufactured the discrepancies it existed to find.
 *
 * THE EXPORTS THAT WERE NOT EXPORTS
 * ---------------------------------
 * Three CSV endpoints swept unbounded. export/users even carries a comment
 * saying it fetches everything "to avoid the 500 pagination cap" and cites
 * 34,000 records — the intent was right and the mechanism silently defeated it,
 * handing an admin the first 5,000 rows in a file that looks complete.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const INTEGRITY = 'src/app/api/admin/verify-integrity/route.ts';
const FINANCE = 'src/services/finance.service.ts';
const RECONCILE = 'src/app/api/admin/finance/reconcile/route.ts';
const COOP_MONEY = 'src/app/actions/cooperative/_coop_money.ts';
const CREATE_SAVINGS = 'src/app/api/cooperative/create-fixed-savings/route.ts';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry) && !full.includes('__tests__')) out.push(full);
    }
    return out;
}

describe('the integrity checker builds the index it then consults', () => {
    const src = code(INTEGRITY);

    it('adds every member to the set the foreign-key checks read', () => {
        // THE test. Without this line every loan and every plan is "orphaned".
        expect(src).toContain('memberIds.add(doc.id);');
        expect(src).toContain('if (data.userId) memberIds.add(String(data.userId));');
    });

    it('and the checks that consume it are still there, so the line is not decorative', () => {
        // Vacuity guard: adding to a Set nothing reads would pass the assertion
        // above and fix nothing.
        expect(src).toContain('!memberIds.has(String(owner))');
        expect(src).toContain('report.orphanedRecords.push(`Loan ${doc.id}: orphaned');
        expect(src).toContain('report.orphanedRecords.push(`FixedSavings ${doc.id}: orphaned');
    });

    it('accepting either name the borrower is stored under', () => {
        // cooperative_loans keys the borrower as `memberId`; the merged reader
        // normalises it to `userId`. Rejecting one of them reports a live row
        // as schema-broken.
        expect(src).toContain('const owner = data.memberId ?? data.userId;');
    });
});

describe('it reads the collection that is actually written', () => {
    it('fixed savings plans, not the collection with no writer', () => {
        // THE second test.
        expect(code(INTEGRITY)).toContain('COLLECTIONS.FIXED_SAVINGS_PLANS');
        expect(code(INTEGRITY)).not.toContain('COLLECTIONS.COOPERATIVE_FIXED_SAVINGS');
    });

    it('which is where the writer puts them', () => {
        // Vacuity guard on both ends of the claim.
        expect(code(CREATE_SAVINGS)).toContain('COLLECTIONS.FIXED_SAVINGS_PLANS');
        expect(code(CREATE_SAVINGS)).toContain('memberId: userId,');
    });

    it('and the abandoned collection really has no writer left', () => {
        const writers: string[] = [];
        for (const file of walk(join(process.cwd(), 'src'))) {
            const body = code(relative(process.cwd(), file));
            if (body.includes('COLLECTIONS.COOPERATIVE_FIXED_SAVINGS')) {
                writers.push(relative(process.cwd(), file));
            }
        }

        expect(writers).toEqual([]);
        // The move is recorded in the codebase, so this is the platform's own
        // answer rather than a guess.
        expect(source(COOP_MONEY)).toContain('COLLECTIONS.FIXED_SAVINGS_PLANS');
    });
});

describe('a whole-collection audit reads the whole collection', () => {
    const src = code(INTEGRITY);

    it('all three sweeps use .all()', () => {
        // THE third test.
        const sweeps = src.match(/\.all\(\)\s*\.get\(\)/g) ?? [];
        expect(sweeps.length).toBe(3);

        expect(src).toContain('COLLECTIONS.COOPERATIVE_MEMBERS).all().get()');
        expect(src).toContain('COLLECTIONS.COOPERATIVE_LOANS).all().get()');
        expect(src).toContain('COLLECTIONS.FIXED_SAVINGS_PLANS).all().get()');
    });

    it('and a truncated audit says so rather than reporting all-clear', () => {
        expect(src).toContain('truncated: [] as string[]');
        expect(src).toContain('if (membersSnapshot.truncated) report.truncated.push("cooperative_members");');
        expect(src).toContain('if (loansSnapshot.truncated) report.truncated.push("cooperative_loans");');
        expect(src).toContain('if (fixedSavingsSnapshot.truncated) report.truncated.push("fixed_savings_plans");');
    });
});

describe('the money totals', () => {
    const finance = code(FINANCE);

    it('are derived from every row, not the first five thousand', () => {
        // THE test. Three derivations, all of them unbounded aggregations by
        // their own description.
        const sweeps = finance.match(/\.all\(\)\s*\n?\s*\.get\(\)/g) ?? [];
        expect(sweeps.length).toBeGreaterThanOrEqual(2);

        expect(finance).toContain('await query.all().get()');
        expect(finance).not.toMatch(/const snap = await query\.get\(\);/);
        expect(finance).not.toMatch(/\.where\("status", "==", "completed"\)\s*\n\s*\.get\(\);/);
    });

    it('and each says so when the ceiling is hit', () => {
        const shouts = finance.match(/if \((?:ledgerSnap|snap)\.truncated\)/g) ?? [];
        expect(shouts.length).toBe(3);
    });

    it('the class still claiming to derive balances from totals only', () => {
        // Vacuity guard: this is why a capped sum is a defect here rather than
        // a performance choice.
        expect(source(FINANCE)).toContain('Balances must be derived from ledger totals only');
    });

    it('and the reconciliation reads every local payment it diffs against', () => {
        expect(code(RECONCILE)).toContain('COLLECTIONS.PROCESSED_PAYMENTS).all().get()');
        expect(code(RECONCILE)).toContain('if (localPaymentsSnap.truncated)');
    });

    it('which is the set "missing in local" is computed from', () => {
        // Vacuity guard: the cap only mattered because this set drives the
        // report's headline finding.
        expect(code(RECONCILE)).toContain('if (!localReferences.has(tx.reference))');
        expect(code(RECONCILE)).toContain('missingInLocal.push(');
    });
});

describe('an export exports everything', () => {
    const EXPORTS = [
        'src/app/api/admin/export/users/route.ts',
        'src/app/api/admin/export/cooperative-members/route.ts',
        'src/app/api/admin/wave/reports/export/route.ts',
    ];

    it('all three CSV endpoints sweep unbounded', () => {
        // THE test.
        for (const rel of EXPORTS) {
            expect(code(rel)).toContain('.all().get()');
        }
    });

    it('and each reports a truncated file rather than passing it off as complete', () => {
        for (const rel of EXPORTS) {
            expect(code(rel)).toMatch(/\.truncated\)/);
        }
    });

    it('with the user export saying so in a header the caller can read', () => {
        // The CSV itself gives no way to tell, so it goes out of band.
        expect(code('src/app/api/admin/export/users/route.ts'))
            .toContain('"X-Export-Truncated": String(snapshot.truncated)');
    });

    it('and the comment that always intended this is still there', () => {
        // Vacuity guard on the diagnosis: the author believed .get() fetched
        // everything, which is exactly why a silent cap was the defect.
        expect(source('src/app/api/admin/export/users/route.ts'))
            .toContain('avoids 500 pagination cap');
    });
});
