/**
 * @jest-environment node
 */

/**
 *   #335 THREE QUERIES KEYED ON FIELDS NOTHING WRITES.
 *
 *        The class is the one behind #49, #88, #89 and #100: a read whose key
 *        no writer supplies. It never throws and never logs. The query simply
 *        returns nothing, or orders by a key every row is missing, and the
 *        screen above it shows an empty state that looks like an answer.
 *
 *        A scan of every .where()/.orderBy() key against every written object
 *        key in src/ produced ten candidates. Seven were false positives or
 *        already recorded (`resolvedUserId` and `__name__` are deliberate and
 *        documented in collection-field-drift; `amountDisbursed` is recorded in
 *        the WAVE compliance route itself; `severity`, `userEmail` and
 *        `listingOwnerId` ARE written, in shorthand my extractor could not
 *        see). Three were real.
 *
 * ── 1. THE COOPERATIVE WIDGET STILL COULD NOT ANSWER ────────────────────────
 *
 *        getCooperativeQuickStats carried a comment recording a genuine repair:
 *        the query asked for `userId` where loan rows carry `memberId`. It
 *        concluded the widget could now say when the next payment was due. It
 *        still could not, because the same function then did
 *
 *            .orderBy('nextPaymentDate', 'asc')     nothing writes it
 *            loanData.nextPaymentDate               nothing writes it
 *            loanData.nextPaymentAmount             nothing writes it
 *
 *        _loans_applications.ts writes `monthlyPayment` and a SCHEDULE. Neither
 *        field read here is on a loan document anywhere in src/. So the sort
 *        key sorted nothing and `.limit(1)` picked an arbitrary loan, the date
 *        came back undefined every time, and CooperativeWidget guards the whole
 *        panel on `stats.nextPaymentDate &&` — so it has never rendered, taking
 *        the amount beside it with it.
 *
 *        #83 and #297's shape: one half of a path corrected, the siblings
 *        missed, and the correcting comment left implying the whole job was
 *        done. Now derived from LOAN_REPAYMENTS — the rows that actually carry
 *        dueDate, totalAmount, paidAmount and status — by the same rule the
 *        member's own my-loans page uses, so the two can no longer disagree.
 *
 * ── 2. THE PEOPLE PICKER'S "500 MOST RECENT" WERE AN ARBITRARY 500 ──────────
 *
 *        getUserSuggestionsAction matches names in JavaScript over whatever one
 *        query returns, so the ORDER decides who can be found at all. It
 *        ordered by `lastLoginAt` — written by NO code path in src/, not on
 *        login, not anywhere — so every row was missing the sort key and the
 *        slice was an arbitrary 500 of the user table. Past 500 accounts,
 *        searching a colleague by name returned "no results" for reasons the
 *        searcher could not see. Ordered by `updatedAt` now: a native column on
 *        users, written by every write, and already the "recently active"
 *        proxy that broadcast-logic.ts and sms-broadcast.ts use.
 *
 * ── 3. AN ADMIN SEARCH FACET ON DATA NEVER COLLECTED ────────────────────────
 *
 *        The admin seller search ran a third prefix query on
 *        `businessRegNumber`. The one creator of SELLER_VERIFICATIONS stores no
 *        registration number, and neither does the legacy import; the name
 *        appears nowhere in src/ but that query and a detail line that has
 *        always rendered blank. A round-trip per search that could not return a
 *        row. Removed.
 *
 * ── RECORDED, NOT REPAIRED ──────────────────────────────────────────────────
 *
 *        health.ts's "Stale JWT Session Risk" check is guarded on the same
 *        absent `lastLoginAt`, so it has never executed once — #331's shape. It
 *        is left guarded rather than fed a substitute: the obvious one is
 *        `updatedAt`, but the comparison is `lastUpdated > lastLogin + 24h`, so
 *        that compares a value against itself and the branch still never fires.
 *        Making it work needs a real last-login stamp written at sign-in, which
 *        is a write on the auth path and the owner's call.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const UTILS = 'src/lib/cooperative-utils.ts';
const MESSAGES = 'src/app/actions/messages.ts';
const HEALTH = 'src/app/actions/health.ts';
const ADMIN_MP = 'src/app/actions/admin/_marketplace.ts';

/** Files under src/ whose CODE (comments stripped) contains a string. */
function codeMentions(needle: string): string[] {
    const { execSync } = require('child_process');
    return execSync(
        `grep -rl '${needle}' src --include=*.ts --include=*.tsx || true`,
        { encoding: 'utf-8' },
    )
        .split('\n')
        .filter(Boolean)
        .filter((f: string) => !f.includes('__tests__'))
        .filter((f: string) => source(f).includes(needle));
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#335 — the premise: these fields are written by nothing', () => {
    it('NOTHING WRITES lastLoginAt', () => {
        // THE premise for both the picker and the health check. If a login
        // path ever starts stamping it, this fails and both decisions should
        // be revisited — which is the point of asserting it here.
        expect(codeMentions('lastLoginAt:')).toEqual([]);
    });

    it('NOTHING WRITES nextPaymentDate or nextPaymentAmount onto a loan', () => {
        // They are computed, in the browser, by my-loans — from the schedule.
        // Nothing persists them, so no query may key on them.
        const loanWriters = [
            'src/app/actions/cooperative/_loans_applications.ts',
            'src/app/actions/cooperative/_loans_decisions.ts',
            'src/app/actions/loan-actions.ts',
        ];
        for (const f of loanWriters) {
            const src = source(f);
            expect(src).not.toMatch(/nextPaymentDate\s*:/);
            expect(src).not.toMatch(/nextPaymentAmount\s*:/);
        }
    });

    it('and nothing writes businessRegNumber', () => {
        expect(codeMentions('businessRegNumber:')).toEqual([]);
    });

    it('POSITIVE CONTROL: the same search DOES find a field that is written', () => {
        // Without this, every assertion above passes for a broken grep.
        expect(codeMentions('businessName:').length).toBeGreaterThan(0);
        expect(codeMentions('monthlyPayment,').length
            + codeMentions('monthlyPayment:').length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#335 — the cooperative widget now reads the rows that exist', () => {
    const utils = source(UTILS);

    it('THE DEAD ORDER KEY AND BOTH DEAD READS ARE GONE', () => {
        // THE test.
        expect(utils).not.toMatch(/orderBy\(\s*'nextPaymentDate'/);

        // The two figures are ASSIGNED FROM the instalment list. Asserting the
        // absence of `loanData.nextPaymentDate` was too literal — it survived a
        // mutant that wrote `(loanData as any).nextPaymentDate`. Pinning where
        // the value comes FROM cannot be dodged that way.
        expect(utils).toMatch(/nextPaymentDate = outstanding\[0\]\.due;/);
        expect(utils).toMatch(/nextPaymentAmount = outstanding\[0\]\.owed;/);
        expect(utils).not.toMatch(/nextPaymentDate\s*=\s*[^o\n]*loanData/);
        expect(utils).not.toMatch(/nextPaymentAmount\s*=\s*[^o\n]*loanData/);
    });

    it('and the next payment comes from the instalment rows instead', () => {
        expect(utils).toContain('COLLECTIONS.LOAN_REPAYMENTS');
        expect(utils).toMatch(/where\('userId', '==', session\.user\.id\)/);
    });

    it('choosing the earliest instalment still owed, as my-loans does', () => {
        expect(utils).toMatch(/'pending'/);
        expect(utils).toMatch(/'partial'/);
        // amount owed = totalAmount - paidAmount, the same arithmetic the
        // member's own page shows them.
        expect(utils).toMatch(/totalAmount\)\s*\|\|\s*0\)\s*-\s*\(Number\(inst\.paidAmount/);
    });

    it('the member page it must agree with derives it the same way', () => {
        const page = source('src/app/cooperatives/(member)/my-loans/page.tsx');
        expect(page).toMatch(/status === "pending" \|\| inst\.status === "partial"/);
        expect(page).toMatch(/nextPayment\.totalAmount - nextPayment\.paidAmount/);
    });

    it('and the instalment writer really does supply those four fields', () => {
        // Vacuity guard on the whole repair: if instalments carried different
        // names, the new read would be as dead as the one it replaced.
        const writer = source('src/app/actions/cooperative/_loans_repayments.ts');
        expect(writer).toContain('COLLECTIONS.LOAN_REPAYMENTS');

        // The .add() PAYLOAD, not the whole file. `dueDate:` also appears in
        // the plain object pushed onto the returned schedule, so a whole-file
        // toContain survived a mutant that renamed the persisted column.
        const addAt = writer.indexOf('COLLECTIONS.LOAN_REPAYMENTS).add(');
        expect(addAt).toBeGreaterThan(-1);
        const payload = writer.slice(addAt, addAt + 400);
        for (const field of ['dueDate:', 'totalAmount,', 'paidAmount: 0,', 'status: "pending"']) {
            expect(payload).toContain(field);
        }
    });

    it('the widget still guards on the date, so a member with no loan sees nothing', () => {
        // The guard is correct — it was the value behind it that was always
        // undefined. Pinned so a later change does not "fix" the guard instead.
        expect(source('src/components/widgets/CooperativeWidget.tsx'))
            .toMatch(/stats\.nextPaymentDate &&/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#335 — the people picker orders by a key every row has', () => {
    const messages = source(MESSAGES);

    it('NO LONGER ORDERS BY lastLoginAt', () => {
        expect(messages).not.toMatch(/orderBy\("lastLoginAt"/);
    });

    it('and orders by updatedAt, which is a native column on users', () => {
        expect(messages).toMatch(/orderBy\("updatedAt", "desc"\)\.limit\(500\)/);

        const map = source('src/lib/supabase-table-map.ts');
        expect(map).toMatch(/'users':\s*\['id', 'email', 'roles', 'created_at', 'updated_at'\]/);
    });

    it('the exact-email lookup is separate and unbounded, as before', () => {
        // Why the cap is a cap and not a defect on its own: searching a full
        // address does not go through the slice at all.
        // BOTH copies — the primary query and the catch fallback. Counting
        // them is what kills a mutant that removes one and leaves the other.
        const emailLookups = messages.match(
            /where\("email", "==", trimmedQuery\.toLowerCase\(\)\)/g) ?? [];
        expect(emailLookups.length).toBe(2);
    });

    it('and the fallback path, which drops the order entirely, is untouched', () => {
        // It exists for a database that cannot sort on the key; it returns the
        // same 500 unordered. Left as it was.
        expect(messages).toMatch(/db\.collection\(COLLECTIONS\.USERS\)\.limit\(500\)\.get\(\)/);
    });

    it('the "recently active" convention it now matches is already in use', () => {
        expect(source('src/lib/broadcast-logic.ts'))
            .toMatch(/data\.updatedAt \|\| data\.lastLoginAt \|\| data\.createdAt/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#335 — the admin seller search stops querying data nobody collects', () => {
    const admin = source(ADMIN_MP);

    it('THE businessRegNumber FACET IS GONE', () => {
        expect(admin).not.toMatch(/where\("businessRegNumber"/);
    });

    it('and the facets that work are still there', () => {
        // The counterpart guard: this finding removes one query, not the search.
        const nameFacets = admin.match(/where\("businessName", ">="/g) ?? [];
        expect(nameFacets.length).toBe(2);
        expect(admin).toContain('COLLECTIONS.SELLER_VERIFICATIONS');
    });

    it('the one creator of those rows really does write businessName and not a reg number', () => {
        const creator = source('src/app/api/marketplace/submit-verification/route.ts');
        expect(creator).toContain('businessName');
        expect(creator).not.toContain('businessRegNumber');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#335 — the stale-JWT check, recorded rather than faked', () => {
    it('is still guarded on the field nothing writes — deliberately', () => {
        // It cannot run. Feeding it updatedAt would compare a value against
        // itself and it STILL would not run, while looking repaired. Left
        // honest, and the raw file says why.
        expect(source(HEALTH)).toMatch(/untypedData\.updatedAt && untypedData\.lastLoginAt/);
        expect(readFileSync(HEALTH, 'utf-8')).toContain('THIS CHECK HAS NEVER RUN');
    });

    it('and the report it belongs to still raises the checks that DO work', () => {
        // Vacuity guard: the finding is one dead branch, not a dead report.
        const health = source(HEALTH);
        expect(health).toContain('Data Corruption (Export State Drift)');
        expect(health).toContain('issues.push');
    });
});
