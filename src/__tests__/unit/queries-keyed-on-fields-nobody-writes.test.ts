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
 * ── WAS RECORDED, NOT REPAIRED — CLOSED BY #273 ─────────────────────────────
 *
 *        health.ts's "Stale JWT Session Risk" check was guarded on the same
 *        absent `lastLoginAt` and had never executed once. #335 left "stamp it
 *        at sign-in, or drop the consumers" open.
 *
 *        DROPPED. Stamping the field would have made the check fire and every
 *        firing would be a false alarm: its condition is "the profile changed
 *        more than 24 HOURS after the last login" and the session is maxAge 8h,
 *        so it selects accounts whose session expired long before the change.
 *        Its premise is false too — the jwt callback re-reads roles, ban state
 *        and the revocation flag from the profile every SYNC_INTERVAL, two
 *        minutes — and the risk it names is already enforced by
 *        sessionsValidFrom (#306/#343). The check is gone, the field is still
 *        unwritten, and nothing in the repository reads it.
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
        //   #273 The chain lost its dead middle term. It was
        //        `updatedAt || lastLoginAt || createdAt`, and lastLoginAt is
        //        written by nothing, so it never contributed — it only made the
        //        line read as though the platform records a last-login time.
        expect(source('src/lib/broadcast-logic.ts'))
            .toMatch(/data\.updatedAt \|\| data\.createdAt/);
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
describe('#273 — the stale-JWT check is DROPPED, not stamped into life', () => {
    /**
     * #335 recorded it and left "stamp lastLoginAt at sign-in, or drop the
     * consumers" open. Dropped, on three measurements each asserted below:
     *
     *   1. The condition is "profile changed >24h after last login" and the
     *      session is maxAge 8h, so it selects accounts whose session expired
     *      long before the change. Stamping the field would make it fire, and
     *      every firing would be a false alarm.
     *   2. Its premise — that a live JWT carries stale roles — is false: the
     *      jwt callback re-reads the profile every SYNC_INTERVAL (2 minutes).
     *   3. What it gestures at IS controlled, by sessionsValidFrom (#306/#343),
     *      as an enforcement rather than a report.
     */
    it('THE CHECK IS GONE, AND SO IS THE FIELD IT COULD NOT READ', () => {
        const health = source(HEALTH);

        expect(health).not.toMatch(/untypedData\.lastLoginAt/);
        expect(health).not.toContain('High Stale JWT Risk');
    });

    it('and NOTHING in the repository reads lastLoginAt any more', () => {
        // The whole point of the decision. Derived rather than listed, so a
        // reader reappearing fails here. codeMentions strips comments first:
        // four files still EXPLAIN the removal, and a raw-text sweep would read
        // those tombstones as readers — the trap this audit has hit repeatedly.
        expect(codeMentions('lastLoginAt')).toEqual([]);
    });

    it('and it is still NOT written, which is the other half of the decision', () => {
        // Dropping the consumers only makes sense if the field stays absent.
        // If a writer ever appears, this fails and the check can be revisited —
        // on its merits, which are the three reasons above.
        expect(codeMentions('lastLoginAt:')).toEqual([]);
    });

    it('the reasoning is recorded where the check used to be', () => {
        // Prose, so raw text — asserting it on stripped source is the tombstone
        // trap pointed the other way.
        const raw = readFileSync(HEALTH, 'utf-8');

        expect(raw).toContain('STALE JWT SESSION RISK — REMOVED');
        expect(raw).toContain('maxAge: 8 * 60 * 60');
        expect(raw).toContain('SYNC_INTERVAL');
        expect(raw).toContain('sessionsValidFrom');
    });

    it('and those three claims are true of the code they describe', () => {
        // Coupled, not quoted. If the session length or the sync interval
        // changes, this fails and the reasoning has to be re-checked.
        const auth = source('src/lib/auth.ts');

        expect(auth).toContain('maxAge: 8 * 60 * 60');
        expect(auth).toContain('const SYNC_INTERVAL = 2 * 60 * 1000;');
        expect(auth).toContain('token.roles = cachedProfile.roles');
        expect(auth).toContain('cachedProfile.sessionsValidFrom');
    });

    it('and the report it belonged to still raises the checks that DO work', () => {
        // Vacuity guard: the finding removed one dead branch, not a report.
        const health = source(HEALTH);
        expect(health).toContain('Data Corruption (Export State Drift)');
        expect(health).toContain('issues.push');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#273 — "recently active" is one expression now, not six', () => {
    /**
     * The rule was written out at six sites — five in broadcast-logic.ts, one in
     * sms-broadcast.ts — and ONE of them carried the extra `lastLoginAt` term
     * while the other five did not. Nothing writes that field, so the odd copy
     * behaved identically and the drift was invisible. That is the state a
     * duplicate sits in right up until somebody changes one of them.
     */
    it('the shared rule imports nothing, so any layer can ask it', () => {
        // #381's discipline: a rule that pulls in the database adapter cannot be
        // called from a screen.
        const imports = source('src/lib/recent-activity.ts').match(/^import .*$/gm) ?? [];
        expect(imports).toEqual([]);
    });

    it('BOTH DECISION SITES ASK IT', () => {
        // The two that FILTER. The four that build a `lastActive` field for a
        // resolved recipient are display, and default to now on an absent
        // value — folding those in would change what they emit, so they are
        // deliberately left alone.
        expect(source('src/lib/broadcast-logic.ts')).toContain('if (!isRecentlyActive(data)) return;');
        expect(source('src/app/actions/sms-broadcast.ts')).toContain('if (!isRecentlyActive(u)) continue;');
    });

    it('and neither one open-codes the comparison beside it any more', () => {
        for (const rel of ['src/lib/broadcast-logic.ts', 'src/app/actions/sms-broadcast.ts']) {
            expect({ rel, drifted: /lastActiveRaw\s*<\s*thirtyDaysAgo/.test(source(rel)) })
                .toEqual({ rel, drifted: false });
        }
    });
});

describe('#273 — what the shared rule answers', () => {
    const iso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

    it('updatedAt decides, because every write touches it', async () => {
        const { isRecentlyActive } = await import('@/lib/recent-activity');
        expect(isRecentlyActive({ updatedAt: iso(3) })).toBe(true);
        expect(isRecentlyActive({ updatedAt: iso(90) })).toBe(false);
    });

    it('createdAt is the fallback for a row written once and never since', async () => {
        const { isRecentlyActive } = await import('@/lib/recent-activity');
        expect(isRecentlyActive({ createdAt: iso(5) })).toBe(true);
    });

    it('and updatedAt WINS over createdAt when both are present', async () => {
        // Vacuity guard on the fallback: an old account written yesterday is
        // active; a fresh account is not made stale by its creation date.
        const { isRecentlyActive } = await import('@/lib/recent-activity');
        expect(isRecentlyActive({ updatedAt: iso(1), createdAt: iso(900) })).toBe(true);
        expect(isRecentlyActive({ updatedAt: iso(900), createdAt: iso(1) })).toBe(false);
    });

    it('A ROW WITH NO EVIDENCE IS NOT ACTIVE, rather than defaulting to now', async () => {
        // The fail-open this codebase keeps finding. Defaulting an unusable
        // timestamp to "now" sweeps the row into every recent-activity
        // audience, which is a broadcast to people it was not meant for.
        const { isRecentlyActive, lastActiveAt } = await import('@/lib/recent-activity');
        expect(isRecentlyActive({})).toBe(false);
        expect(isRecentlyActive(null)).toBe(false);
        expect(isRecentlyActive({ updatedAt: 'not-a-date' })).toBe(false);
        expect(lastActiveAt({ updatedAt: 'not-a-date' })).toBeNull();
    });

    it('and a Firestore-shaped timestamp reads the same as an ISO string', async () => {
        const { lastActiveAt } = await import('@/lib/recent-activity');
        const when = new Date(Date.now() - 4 * 86_400_000);
        expect(lastActiveAt({ updatedAt: { toDate: () => when } })?.getTime())
            .toBe(lastActiveAt({ updatedAt: when.toISOString() })?.getTime());
    });
});
