/**
 * @jest-environment jsdom
 */

/**
 *   #742 TWENTY OF TWENTY-NINE ADMIN LISTS SAID "NOTHING HERE" WHEN THE READ
 *        HAD FAILED, AND THE HOOK THEY ALL SHARE KNEW.
 *
 *   `useAdminData` is the one loader every admin list goes through. On a failed
 *   read it sets `error` and LEAVES `data` alone — which is `[]` on a first
 *   load, and it clears `error` at the start of each fetch, so the pair is
 *   exact: empty list, no error, means empty; empty list WITH an error means
 *   the screen never saw the data.
 *
 *   Twenty screens rendered only the first half of that pair:
 *
 *       {items.length === 0 ? <Nothing here /> : items.map(…)}
 *
 *   EIGHT OF THE TWENTY DESTRUCTURED THE ERROR AND DROPPED IT. `error:
 *   fetchError` in the destructure and not one other mention in the file —
 *   marketplace/escrow, marketplace/sellers, marketplace/buyers, disputes,
 *   audit-logs, cooperatives/members, farm-nation/land-verification and
 *   academy/page. The screen asked the hook whether the read failed, was told,
 *   and drew "No escrow transactions found" anyway.
 *
 * ── THE RULE ALREADY EXISTED, AND ITS SWEEP EXCLUDED THESE SCREENS BY NAME ──
 *
 *   #545 established "a failed read is not an empty list" and its scan carries
 *
 *       if (entry !== 'admin') walk(full);   // "a handful of staff, not every
 *                                            //  member"
 *
 *   #600 later reversed exactly that reasoning for three OTHER ratchets, and
 *   its words fit here better than they fit there:
 *
 *       "these are the screens where a withdrawal is approved and an escrow
 *        released: a blank admin page is a seller who does not get paid."
 *
 *   marketplace/escrow, marketplace/withdrawals and disputes are three of the
 *   twenty. #600 did not reach this sweep because its own RATCHETS list is
 *   three hand-written paths — a hand-written list where the filesystem holds
 *   the fact, which is this audit's second-most-common defect, and #741 filed
 *   it against the same three files for a different reason.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. The table
 *   was written BEFORE the sweep ran, which is the wrong order and is recorded
 *   rather than tidied away. ONE MUTANT SURVIVES AND IS LEFT SURVIVING, with
 *   its reason in the table: it deletes a check rather than breaking the code,
 *   and at zero offenders "the check was deleted" and "the codebase is clean"
 *   are the same observation. That is this audit's own vacuity problem, and the
 *   defences available against it — the predicate exercised directly on a
 *   screen that fails it, and the population asserted non-empty — are both
 *   present below.
 */

import React from 'react';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

/** What the hook reports, swapped per test. */
let hookState: any = {};

jest.mock('@/hooks/useAdminData', () => ({
    useAdminData: () => ({
        data: [],
        loading: false,
        error: null,
        search: '',
        setSearch: jest.fn(),
        filters: {},
        updateFilter: jest.fn(),
        clearFilter: jest.fn(),
        hasMore: false,
        onNextPage: jest.fn(),
        onPrevPage: jest.fn(),
        pageIndex: 0,
        setData: jest.fn(),
        refresh: jest.fn(),
        meta: {},
        ...hookState,
    }),
}));
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
//   The screen's server actions, stubbed at the module boundary: importing them
//   for real pulls in the Redis client, which is ESM and not this suite's
//   subject. Nothing below calls them — the hook is what supplies the data.
jest.mock('@/app/actions/marketplace', () => ({
    getAllEscrowTransactionsAdmin: jest.fn(),
    releaseEscrowFunds: jest.fn(),
    refundEscrowToBuyer: jest.fn(),
}));
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }), signOut: jest.fn() }));

const EscrowPage = require('@/app/admin/marketplace/escrow/page').default;

beforeEach(() => { hookState = {}; });

// ─────────────────────────────────────────────────────────────────────────────
describe('#742 — the escrow queue, on a read that failed', () => {
    it('DOES NOT SAY THERE ARE NO ESCROW TRANSACTIONS', () => {
        /*
         *   THE test. An empty list and a failed read are the same `[]`, and
         *   this screen is where money is released: "no escrow transactions" to
         *   an administrator is a seller who does not get paid, in a queue the
         *   platform could not open.
         */
        hookState = { error: 'permission denied for table escrow_transactions' };
        render(<EscrowPage />);

        expect(screen.queryByText('No escrow transactions found')).toBeNull();
    });

    it('AND SAYS SO, WITH THE REASON AN ADMIN CAN ACT ON', () => {
        hookState = { error: 'permission denied for table escrow_transactions' };
        render(<EscrowPage />);

        expect(screen.getByRole('alert')).toBeTruthy();
        //   The reason is shown: "permission denied" and "the database is down"
        //   need different people, and an admin is who can tell them apart.
        expect(screen.getByText(/permission denied/)).toBeTruthy();
    });

    it('AND ON A GENUINELY EMPTY QUEUE IT STILL SAYS SO', () => {
        /*
         *   Vacuity guard, and the more important half: a screen that had
         *   simply lost its empty state would pass the first test. Empty with
         *   NO error is still empty, and must read that way.
         */
        hookState = { error: null };
        render(<EscrowPage />);

        expect(screen.getByText('No escrow transactions found')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#742 — and the banner itself distinguishes the two states', () => {
    const AdminReadFailed = require('@/components/admin/AdminReadFailed').default;

    it('RENDERS NOTHING WHEN THERE IS NO ERROR', () => {
        const { container } = render(<AdminReadFailed error={null} subject="disputes" />);
        expect(container.textContent).toBe('');
    });

    it('AND AN EMPTY STRING IS NOT AN ERROR', () => {
        //   The hook clears to null, but '' is what a caller that forgot would
        //   pass, and a banner that fired on it would cry wolf on every screen.
        const { container } = render(<AdminReadFailed error="" subject="disputes" />);
        expect(container.textContent).toBe('');
    });

    it('AND NAMES WHAT COULD NOT BE READ', () => {
        render(<AdminReadFailed error="connection reset" subject="escrow transactions" />);
        expect(screen.getByText(/Escrow transactions could not be loaded/)).toBeTruthy();
        expect(screen.getByText('connection reset')).toBeTruthy();
    });

    it('AND SAYS PLAINLY THAT THIS IS NOT AN EMPTY LIST', () => {
        //   The sentence is the finding. Without it a red box above a list still
        //   leaves "so is there nothing here, or not?" unanswered.
        render(<AdminReadFailed error="timeout" subject="disputes" />);
        expect(screen.getByText(/not an empty list/)).toBeTruthy();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#742 — and every admin list that uses the hook surfaces it', () => {
    function hookConsumers(): string[] {
        const found: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) { walk(full); continue; }
                if (!entry.endsWith('.tsx')) continue;
                const src = code(full.slice(ROOT.length + 1));
                if (/=\s*useAdminData\s*[<(]/.test(src)) found.push(full.slice(ROOT.length + 1));
            }
        };
        walk(join(ROOT, 'src/app/admin'));
        return found.sort();
    }

    /**
     * Does this screen put the read failure on the page, under whatever name it
     * bound it to?
     *
     *   THE PROPERTY, NOT THE COMPONENT. The first version of this asserted
     *   `<AdminReadFailed`, and it flagged the NINE screens that were already
     *   right — they render the failure with their own inline banner, which is
     *   what the component was extracted FROM. Pinning the component would
     *   have rewritten nine working screens to satisfy a test, and it is the
     *   same mistake #741 filed against #600 and #351 one finding ago: a
     *   ratchet that pins the spelling of an implementation reports on the
     *   implementation, not on the rule.
     *
     *   The rule is: the screen can tell an administrator the list could not be
     *   read. Nine do it inline, twenty do it through the shared banner.
     */
    function surfacesTheFailure(src: string): boolean {
        const call = src.search(/=\s*useAdminData\s*[<(]/);
        const destr = src.slice(src.lastIndexOf('{', call), call);
        const m = destr.match(/(^|[{,\s])error\s*:\s*([A-Za-z_$][\w$]*)/)
            ?? destr.match(/(^|[{,\s])(error)\s*[,}]/);
        if (!m) return false;
        const n = m[2];
        return new RegExp(
            `\\{\\s*!?${n}\\s*(&&|\\?|\\})`   // {error && …}  {error ? …}  {error}
            + `|[A-Za-z]+=\\{${n}\\}`         // error={error}
            + `|&&\\s*!?${n}\\b`,             // … && !error
        ).test(src);
    }

    it('NOT ONE OF THEM LOADS A LIST WITHOUT A WAY TO SAY THE READ FAILED', () => {
        /*
         *   Swept, not listed — the thirtieth admin list is the next instance of
         *   this finding, and #600's hand-written list of three is precisely
         *   what let this one sit unnoticed.
         */
        const silent = hookConsumers().filter((f) => !surfacesTheFailure(code(f)));
        expect(silent).toEqual([]);
    });

    it('AND THE PREDICATE CAN STILL SEE A SCREEN THAT CANNOT', () => {
        //   At zero the sweep has to be able to fire, or [] says nothing.
        const blind = `
            const { data: rows, loading } = useAdminData<X>({ fetchAction: f });
            return <div>{rows.length === 0 ? <p>Nothing here</p> : null}</div>;`;
        const bound = `
            const { data: rows, loading, error: fetchError } = useAdminData<X>({ fetchAction: f });
            return <div>{rows.length === 0 ? <p>Nothing here</p> : null}</div>;`;
        const surfaced = `
            const { data: rows, loading, error: fetchError } = useAdminData<X>({ fetchAction: f });
            return <div>{fetchError ? <p>failed</p> : rows.length === 0 ? <p>Nothing here</p> : null}</div>;`;

        expect(surfacesTheFailure(blind)).toBe(false);
        //   The eight-of-twenty shape: taken, and still not on the page.
        expect(surfacesTheFailure(bound)).toBe(false);
        expect(surfacesTheFailure(surfaced)).toBe(true);
    });

    it('AND THE SWEEP FOUND THE SCREENS, SO [] MEANS CLEAN', () => {
        //   At zero, a walk pointed at the wrong directory is indistinguishable
        //   from a fixed codebase — #741's lesson, one finding old.
        const consumers = hookConsumers();

        expect(consumers.length).toBeGreaterThanOrEqual(25);
        expect(consumers).toContain('src/app/admin/marketplace/escrow/page.tsx');
        expect(consumers).toContain('src/app/admin/disputes/page.tsx');
    });

    it('AND NONE OF THEM STILL BINDS THE ERROR ONLY TO DISCARD IT', () => {
        /*
         *   The eight-of-twenty shape, stated as its own assertion: a
         *   destructured `error` that appears exactly once in the file is bound
         *   and dropped. Counting occurrences catches it where "does the file
         *   mention error" cannot.
         */
        const dropped: string[] = [];
        for (const f of hookConsumers()) {
            const src = code(f);
            const call = src.search(/=\s*useAdminData\s*[<(]/);
            const destr = src.slice(src.lastIndexOf('{', call), call);
            const m = destr.match(/(^|[{,\s])error\s*:\s*([A-Za-z_$][\w$]*)/);
            if (!m) continue;
            const uses = src.match(new RegExp(`\\b${m[2]}\\b`, 'g')) ?? [];
            if (uses.length < 2) dropped.push(f);
        }
        expect(dropped).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#742 — and the hook still reports the pair the screens rely on', () => {
    it('THE FAILURE PATH SETS error AND LEAVES data ALONE', () => {
        /*
         *   The whole repair rests on this. If a failed read also cleared
         *   `data`, or if `error` survived into the next successful fetch, every
         *   banner above would be wrong in one direction or the other.
         */
        const hook = code('src/hooks/useAdminData.ts');

        expect(hook).toContain('const [data, setData] = useState<T[]>([]);');
        expect(hook).toContain('setError(msg);');
        //   Cleared at the START of a fetch, so a recovered read drops it.
        expect(hook).toContain('setError(null);');
        //   And the failure branches do not touch the data.
        const failure = hook.slice(hook.indexOf("const msg = result.error"));
        expect(failure).not.toContain('setData(');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy,
 *   each mutant proving its edit landed by a unique string on disk. Run AFTER
 *   this table was written — see the header.
 *
 *   AND THE HARNESS ITSELF HAD A FAULT WORTH RECORDING. Its snapshot map was
 *   keyed by BASENAME, and `admin/marketplace/escrow/page.tsx` and
 *   `admin/disputes/page.tsx` are both `page.tsx` — so the restore wrote the
 *   disputes screen over the escrow screen. It was caught by reading `git
 *   status` rather than by a test, the file was restored from git and the edit
 *   re-applied, and the map is keyed by full path now. A restore step that can
 *   corrupt the tree is worse than no restore step.
 *
 *     MUTANT                                                        RESULT
 *     the escrow empty state stops consulting the error              KILLED
 *     the escrow banner is removed entirely                          KILLED
 *     the banner renders even with no error                          KILLED
 *     the banner drops the "not an empty list" sentence              KILLED
 *     the banner stops showing the reason                            KILLED
 *     one screen goes back to binding the error and dropping it      KILLED
 *     the hook clears data on a failed read                          KILLED
 *
 *     SURVIVED, AND LEFT SURVIVING
 *     the sweep's offender list is replaced with []               SURVIVED ✗
 *         Not a defect in the code — it deletes the check. No assertion can
 *         catch its own deletion from inside itself, and at zero offenders a
 *         deleted sweep and a clean tree produce the same []. Recorded rather
 *         than answered with a mutant chosen to be killable.
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
