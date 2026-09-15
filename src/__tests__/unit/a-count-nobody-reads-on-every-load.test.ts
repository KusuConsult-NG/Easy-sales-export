/**
 * @jest-environment node
 */

/**
 *   #766 THE HEAVIEST QUERY ON THE HEAVIEST ADMIN SCREEN PRODUCED A NUMBER
 *        NOTHING RENDERS, AND RAN BEFORE THE ROWS.
 *
 *   Reported by the owner twice — "I also noticed that the Users app is also
 *   loading slowly. I thought you had fixed that as well?", then "Users app
 *   loading slowly — Not investigated." The second report is fair: #758 removed
 *   a duplicated read of the CALLER's row from this action and that was all.
 *
 * ── MEASURED, AGAINST REAL POSTGRES ─────────────────────────────────────────
 *
 *   42,000 rows, widened to the shape this platform actually stores — module
 *   registrations with profiles, a kyc block, bank details, next of kin,
 *   metadata — about 3.5 KB of raw_data each:
 *
 *       SELECT id, raw_data FROM users ORDER BY created_at DESC LIMIT 120
 *         Index Scan using idx_users_created_at            0.14 ms
 *
 *       SELECT count(*) FROM users
 *         Seq Scan on users, 42,000 rows                  12.19 ms
 *
 *   Eighty-seven times the cost of the data being displayed, and it is the half
 *   that GROWS: the index scan stops after 120 rows however large the table
 *   gets, and an exact count cannot stop at all. Those numbers are a warm local
 *   socket — production is a hosted Postgres over the network with
 *   `Prefer: count=exact`.
 *
 * ── AND THE COST WAS WASTED TWICE OVER ──────────────────────────────────────
 *
 *   (1) ON EVERY NARROWED REQUEST THE ANSWER WAS DISCARDED. #498's own rule is
 *       `narrowedInMemory ? filteredUsers.length : absoluteDbCount`, so a
 *       search, or a filter on role, module, gender, status or a date range,
 *       ran the scan and then used the other branch. On a SEARCH it ran the
 *       expensive form — `where(documentId, "in", matchingUserIds)` — and threw
 *       that away.
 *
 *   (2) NOTHING RENDERS IT EVEN WHEN IT IS KEPT. #498 recorded this at the time
 *       — "NOTHING RENDERS THIS TODAY — admin/users/page.tsx does not
 *       destructure `meta`" — and it is still true.
 *
 *   THE COUNT IS NOT DELETED. #498 kept it correct deliberately: "a returned
 *   field that is quietly wrong is what the next person builds a header on".
 *   It is now only RUN when its answer will be used, and when it runs it goes
 *   out concurrently with the page fetch rather than in front of it.
 *
 * ── AND #765, WHICH ARRIVED IN THE SAME BREATH ──────────────────────────────
 *
 *       "the forensic button should be removed from the UI temporarily for now.
 *        the client doesnt need it."
 *
 *   Hidden behind one constant, not deleted — the word in the instruction is
 *   "temporarily", and #266 exists because this screen was once reachable only
 *   by typing the URL. Pinned below so a fourth entry point cannot appear
 *   without respecting the decision.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { FORENSIC_SCAN_IN_NAV } from '@/lib/forensic-scan-visibility';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const USERS_ACTION = 'src/app/actions/admin/_users.ts';
const USERS_PAGE = 'src/app/admin/users/page.tsx';

/** The body of _getUsersAction, so an assertion cannot match another function. */
function getUsersBody(): string {
    const src = code(USERS_ACTION);
    const start = src.indexOf('async function _getUsersAction');
    const end = src.indexOf('export const getUsersAction');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#766 — the count runs only when its answer is used', () => {
    it('IT IS GUARDED, NOT UNCONDITIONAL', () => {
        /*
         *   THE test. `await runQueryWithRetry(() => countQuery.count().get())`
         *   sat at the top level of the function and ran on every request.
         */
        const body = getUsersBody();

        expect(body).toContain('const needsDbCount = !narrowedInMemory;');
        expect(body).toContain('if (needsDbCount) {');
    });

    it('AND narrowedInMemory IS DECIDED BEFORE THE COUNT, NOT AFTER IT', () => {
        /*
         *   The whole fix depends on the order. It used to be declared two
         *   hundred lines below the query it would have let us skip.
         *
         *   Compared as INDEXES rather than asserted as present: both strings
         *   exist either way, and it is which comes first that matters.
         */
        const body = getUsersBody();
        const declared = body.indexOf('const narrowedInMemory =');
        const counted = body.indexOf('countQuery.count().get()');

        expect(declared).toBeGreaterThan(-1);
        expect(counted).toBeGreaterThan(-1);
        expect(declared).toBeLessThan(counted);
    });

    it('AND IT IS DECLARED EXACTLY ONCE', () => {
        //   Hoisting a declaration and leaving the old one behind is how two
        //   definitions of one rule start. Counted, not matched.
        const declarations = [...getUsersBody().matchAll(/const narrowedInMemory =/g)];

        expect(declarations).toHaveLength(1);
    });

    it('AND IT STILL NAMES EVERY IN-MEMORY FILTER', () => {
        /*
         *   #498's property, which the move must not lose: the reported total
         *   has to come from the narrowed set whenever anything narrows it. A
         *   filter missing from this list makes the count answer a different
         *   question from the list beside it — the defect #498 fixed.
         */
        const body = getUsersBody();
        const decl = body.slice(body.indexOf('const narrowedInMemory ='));
        const clause = decl.slice(0, decl.indexOf(';'));

        for (const opt of ['state', 'lga', 'role', 'modules', 'gender', 'status', 'search', 'fromDate', 'toDate']) {
            expect({ opt, named: clause.includes(`options.${opt}`) }).toEqual({ opt, named: true });
        }
    });

    it('AND THE COUNT GOES OUT CONCURRENTLY WITH THE PAGE FETCH', () => {
        /*
         *   The two share nothing, and awaiting them in sequence made the
         *   request cost both. Asserted by ORDER again: the promise is created
         *   before the rows are awaited, and resolved after.
         */
        const body = getUsersBody();
        const started = body.indexOf('countPromise = runQueryWithRetry');
        const rowsAwaited = body.indexOf('const snapshot = await runQueryWithRetry');
        const countAwaited = body.indexOf('countPromise ? await countPromise');

        expect(started).toBeGreaterThan(-1);
        expect(started).toBeLessThan(rowsAwaited);
        expect(rowsAwaited).toBeLessThan(countAwaited);
    });

    it('and the reported total is unchanged in both directions', () => {
        //   The point of the finding is cost, not behaviour. #498's expression
        //   is the contract and it survives verbatim.
        expect(getUsersBody())
            .toContain('totalCount: narrowedInMemory ? filteredUsers.length : absoluteDbCount');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#766 — the premise: nothing renders the figure', () => {
    it('THE USERS SCREEN DOES NOT READ meta', () => {
        /*
         *   #498 recorded this and it is still true, so it is asserted rather
         *   than quoted. If somebody wires the total to a header, this fails
         *   and the guard above should be revisited — the count would then be
         *   worth its cost on the unfiltered path.
         */
        const page = code(USERS_PAGE);
        const destructure = page.slice(page.indexOf('} = useAdminData<User>') - 600,
                                      page.indexOf('} = useAdminData<User>'));

        expect(destructure).not.toContain('meta');
        expect(page).not.toContain('totalCount');
    });

    it('and the hook does return it, so this is a reader gap and not a writer one', () => {
        //   Stating which half is missing. useAdminData stores meta; the page
        //   simply never asks for it.
        expect(code('src/hooks/useAdminData.ts')).toContain('setMeta(result.meta)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#765 — the forensic scan button is off the UI, temporarily', () => {
    it('THE FLAG IS OFF', () => {
        expect(FORENSIC_SCAN_IN_NAV).toBe(false);
    });

    it('AND EVERY ENTRY POINT RESPECTS IT', () => {
        /*
         *   Three of them, and a fourth added later must too. Each is asserted
         *   by name so a new link that forgets the flag is a failure here
         *   rather than a button reappearing on the owner's screen.
         */
        for (const f of [
            'src/components/admin/AdminSidebar.tsx',
            'src/app/admin/system-health/page.tsx',
            'src/app/admin/system-health/diagnostics/page.tsx',
        ]) {
            expect({ f, guarded: code(f).includes('FORENSIC_SCAN_IN_NAV') })
                .toEqual({ f, guarded: true });
        }
    });

    it('AND NO OTHER FILE LINKS TO IT UNGUARDED', () => {
        /*
         *   The sweep, rather than a list somebody remembers to extend. Any
         *   component that names the route has to name the flag too.
         *
         *   The three sibling screens under the same prefix — Duplicate
         *   Profiles, Farm Nation Approvals, Coop Memberships — are separate
         *   tools and are NOT hidden, so the match is anchored to the exact
         *   route and not to the prefix.
         */
        const { readdirSync } = require('fs') as typeof import('fs');
        const offenders: string[] = [];

        (function walk(dir: string) {
            for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
                const rel = `${dir}/${e.name}`;
                if (e.isDirectory()) {
                    if (e.name === '__tests__') continue;
                    walk(rel);
                    continue;
                }
                if (!/\.tsx$/.test(e.name) || e.name.includes('.test.')) continue;

                const src = code(rel);
                //   The route exactly, not /admin/forensics/duplicates and the
                //   other two.
                const linksToScan = /["'`]\/admin\/forensics["'`]/.test(src);
                if (linksToScan && !src.includes('FORENSIC_SCAN_IN_NAV')) offenders.push(rel);
            }
        })('src');

        expect(offenders).toEqual([]);
    });

    it('AND THE SWEEP IS NOT VACUOUS — it finds the guarded ones', () => {
        //   An empty-vs-empty comparison above would pass while proving
        //   nothing, which is the shape a route rename would produce.
        expect(code('src/components/admin/AdminSidebar.tsx')).toContain('"/admin/forensics"');
    });

    it('AND NOTHING WAS DELETED — the page, the action and the checks all remain', () => {
        /*
         *   "Temporarily" is the word in the instruction. #266 exists because
         *   this screen was once reachable only by typing the URL, with four
         *   repairs inside it no operator could read; losing the way in again
         *   is a state this audit already had to fix once.
         */
        const { existsSync } = require('fs') as typeof import('fs');

        expect(existsSync(join(ROOT, 'src/app/admin/forensics/page.tsx'))).toBe(true);
        expect(code('src/app/actions/forensics.ts')).toContain('runForensicScanAction');
    });

    it('AND THE THREE SIBLING QUEUES ARE STILL OFFERED', () => {
        //   The instruction was about the scan button. Duplicate Profiles
        //   (#724), Farm Nation Approvals (#725) and Coop Memberships (#726)
        //   are queues an admin works and share only a URL prefix with it.
        const sidebar = code('src/components/admin/AdminSidebar.tsx');

        for (const label of ['Duplicate Profiles', 'Farm Nation Approvals', 'Coop Memberships']) {
            expect({ label, offered: sidebar.includes(`"${label}"`) })
                .toEqual({ label, offered: true });
        }
    });

    it('and one constant brings it back', () => {
        //   The reversal is a single edit, and that is the whole design. Stated
        //   as a test so it stays true.
        const flag = code('src/lib/forensic-scan-visibility.ts');
        const declarations = [...flag.matchAll(/export const FORENSIC_SCAN_IN_NAV/g)];

        expect(declarations).toHaveLength(1);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by FULL PATH, each mutant proving its edit landed.
 *
 *     MUTANT                                                        RESULT
 *     the count runs unconditionally again                           KILLED
 *     narrowedInMemory moves back below the count                    KILLED
 *     the count is awaited before the page fetch                     KILLED
 *     a filter is dropped from narrowedInMemory                      KILLED
 *     the reported total always uses the database count              KILLED
 *     FORENSIC_SCAN_IN_NAV flipped to true                           KILLED
 *     the sidebar stops reading the flag                             KILLED
 *     a new unguarded link to /admin/forensics is added              KILLED
 *     the forensic page file is deleted                              KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED
 *
 *   The count-unconditional and count-awaited-first mutants are the two that
 *   matter: they are the exact states the code was in this morning, and either
 *   one restores the cost this finding measured.
 */
