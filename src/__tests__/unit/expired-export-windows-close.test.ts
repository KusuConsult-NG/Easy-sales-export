/**
 * @jest-environment node
 */

/**
 *   #196 NOTHING EVER CLOSED AN EXPIRED EXPORT WINDOW, AND EVERY LIST OFFERED
 *        THE ONES THAT HAD ENDED.
 *
 *        #275 measured the premise and this suite re-measures it: a scan for a
 *        writer of "closed" onto export_windows finds none. The string appears
 *        in type unions and status lists and in no assignment anywhere. So a
 *        window whose period ended months ago was still `status: "open"`.
 *
 *        #275 fixed the MONEY half — all three investment doors refuse an
 *        expired window — and recorded the rest as an owner decision. What that
 *        left was a platform that OFFERED what it would then refuse:
 *
 *          getActiveExportWindowsAction   status == "open", nothing else.
 *                                         Feeds /export and
 *                                         /export/opportunities.
 *          getExportOpportunities         status in [open, active].
 *                                         Feeds /export/windows.
 *          getExportOpportunityById       status only. A bookmarked link to a
 *                                         window that closed months ago still
 *                                         rendered a live opportunity page.
 *
 *        Each card prints its own closeDate. So a member saw a date in the past
 *        beside an Invest button, clicked it, and was refused. The refusal was
 *        already correct; the offer should never have been made.
 *
 *   THE DECISION, TAKEN: CLOSE THEM, AND STOP OFFERING THEM. BOTH.
 *
 *        Filtering alone would leave every stored row saying "open" for ever,
 *        so every future reader would have to remember the deadline rule for
 *        itself — which is precisely how the three investment doors came to
 *        disagree.
 *
 *        Closing alone would leave a window that ended between cron runs still
 *        listed and clickable.
 *
 *        So one shared predicate — exportWindowHasExpired — is used by the
 *        three read paths, the money guard, and a new cron that writes the
 *        status. Nothing is deleted, and an admin can reopen.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    exportWindowHasExpired,
    exportWindowAcceptsInvestment,
    exportWindowEndDate,
    EXPORT_WINDOW_CLOSED_STATUS,
    EXPORT_WINDOW_INVESTABLE_STATUSES,
    EXPORT_AGGREGATION_STATUSES,
} from '@/lib/export-window-status';

// ─── mocks ───────────────────────────────────────────────────────────────────

const mockClaim = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(),
    claimStatusTransitionFromAny: (...a: any[]) => mockClaim(...a),
}));

// ─── fixtures ────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const STATUS_LIB = 'src/lib/export-window-status.ts';
const CRON = 'src/app/api/cron/close-export-windows/route.ts';
const AGGREGATION = 'src/app/actions/export-aggregation.ts';
const INVESTMENTS = 'src/app/actions/export-investments.ts';

const WINDOWS = COLLECTIONS.EXPORT_WINDOWS;
const SECRET = 'cron-secret-for-tests';

const PAST = '2020-01-01T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';

let store: FakeDbHandle;

function source(rel: string): string {
    return stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });
}

function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const e of readdirSync(dir)) {
            if (e === 'node_modules' || e === '__tests__') continue;
            const full = join(dir, e);
            if (statSync(full).isDirectory()) walk(full);
            else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full.slice(ROOT.length + 1));
        }
    };
    walk(join(ROOT, 'src'));
    return out.sort();
}

function seedWindow(id: string, over: Record<string, unknown> = {}): void {
    store.seed(WINDOWS, id, {
        commodity: 'Sesame', status: 'open',
        slotPrice: 1000, targetVolume: 5000, currentVolume: 0,
        startDate: '2026-01-01T00:00:00.000Z', endDate: FUTURE,
        createdAt: '2026-01-01T00:00:00.000Z',
        ...over,
    });
}

const cron = async (auth: string | null = `Bearer ${SECRET}`) => {
    const { GET } = await import('@/app/api/cron/close-export-windows/route');
    const req = { headers: { get: (k: string) => (k === 'authorization' ? auth : null) } };
    const res = await GET(req as any);
    return { status: res.status, body: await res.json() };
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    process.env.CRON_SECRET = SECRET;
    mockClaim.mockResolvedValue({ claimed: true, status: 'open' });

    (global as unknown as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        { session: { user: { id: 'member-1', email: 'm@example.com' } } },
    ));
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#196 — one deadline rule, not a fourth copy of it', () => {
    it('a window past its endDate has expired', () => {
        expect(exportWindowHasExpired({ endDate: PAST })).toBe(true);
        expect(exportWindowHasExpired({ endDate: FUTURE })).toBe(false);
    });

    it('AN ABSENT OR UNREADABLE endDate IS NOT A DEADLINE', () => {
        // The rule the money guard has always applied — #272's reasoning, not
        // #245's. It is also what stops the cron closing a window nobody set a
        // date on.
        for (const endDate of [undefined, null, '', 'whenever', 0, NaN]) {
            expect({ endDate: String(endDate), expired: exportWindowHasExpired({ endDate }) })
                .toEqual({ endDate: String(endDate), expired: false });
        }
    });

    it('and it reads a Firestore Timestamp as readily as an ISO string', () => {
        // export_windows rows carry both shapes. A predicate that understood
        // only one would silently never expire half the collection.
        const asTimestamp = { toDate: () => new Date(PAST) };

        expect(exportWindowHasExpired({ endDate: asTimestamp })).toBe(true);
        expect(exportWindowEndDate(asTimestamp)?.toISOString()).toBe(PAST);
    });

    it('the money guard uses the SAME predicate, not its own comparison', () => {
        // The whole reason this is extracted. Two copies of "is it past
        // endDate" is how the three investment doors came to disagree (#275).
        const fn = source(STATUS_LIB);
        const at = fn.indexOf('export function exportWindowAcceptsInvestment');
        expect(at).toBeGreaterThan(-1);
        const body = fn.slice(at);

        expect(body).toContain('exportWindowHasExpired(windowData, now)');
        expect(body).not.toMatch(/now > endDate/);
    });

    it('and still refuses an expired window at the money door', () => {
        // #275's guarantee, unchanged by the refactor.
        const verdict = exportWindowAcceptsInvestment({ status: 'open', endDate: PAST });

        expect(verdict.ok).toBe(false);
        expect((verdict as any).reason).toBe('expired');
    });

    it('"closed" is a word this vocabulary already accepts for an aggregation', () => {
        // So the cron is not inventing a status, and an admin can move it back.
        expect(EXPORT_AGGREGATION_STATUSES).toContain(EXPORT_WINDOW_CLOSED_STATUS);
        expect(EXPORT_AGGREGATION_STATUSES).toContain('open');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#196 — the lists stop offering what the money door will refuse', () => {
    const active = async () => {
        const { getActiveExportWindowsAction } = await import('@/app/actions/export-aggregation');
        return getActiveExportWindowsAction() as any;
    };
    const opportunities = async () => {
        const { getExportOpportunities } = await import('@/app/actions/export-investments');
        return getExportOpportunities(12) as any;
    };
    const byId = async (id: string) => {
        const { getExportOpportunityById } = await import('@/app/actions/export-investments');
        return getExportOpportunityById(id) as any;
    };

    it('getActiveExportWindowsAction DROPS AN ENDED WINDOW and keeps a live one', async () => {
        // THE test for the first list.
        seedWindow('live', { endDate: FUTURE });
        seedWindow('ended', { endDate: PAST });

        const res = await active();

        expect(res.success).toBe(true);
        expect(res.data.map((w: any) => w.id)).toEqual(['live']);
    });

    it('getExportOpportunities does too — the other mapper', async () => {
        // Two mappers, one shape: the pattern that has produced a finding every
        // time only one of a pair was corrected.
        seedWindow('live', { endDate: FUTURE });
        seedWindow('ended', { endDate: PAST });

        const res = await opportunities();

        expect(res.success).toBe(true);
        expect(res.data.map((w: any) => w.id)).toEqual(['live']);
    });

    it('AND THE DETAIL PAGE, which a bookmark reaches without either list', async () => {
        seedWindow('ended', { endDate: PAST });

        const res = await byId('ended');

        expect(res.success).toBe(false);
        expect(res.error).toContain('closed');
    });

    it('a live window is still served by all three', async () => {
        // Vacuity guard. A filter that dropped everything would pass every
        // assertion above.
        seedWindow('live', { endDate: FUTURE });

        expect((await active()).data).toHaveLength(1);
        expect((await opportunities()).data).toHaveLength(1);
        expect((await byId('live')).success).toBe(true);
    });

    it('and a window with NO deadline is still offered', async () => {
        // Nobody set a date, so nothing has expired. Dropping these would take
        // live opportunities off the site.
        seedWindow('undated', { endDate: null });

        expect((await active()).data.map((w: any) => w.id)).toEqual(['undated']);
        expect((await opportunities()).data.map((w: any) => w.id)).toEqual(['undated']);
        expect((await byId('undated')).success).toBe(true);
    });

    it('the paging cursor is taken from the RAW page, not the filtered one', async () => {
        // Otherwise a page of entirely-expired windows would end paging early
        // and hide every live window behind it. Asserted on source because the
        // cursor is computed from `snapshot.docs`, which the filter does not
        // touch.
        const src = source(INVESTMENTS);

        expect(src).toContain('const live = snapshot.docs.filter(');
        expect(src).toContain('snapshot.docs.length === limit ? snapshot.docs[snapshot.docs.length - 1].id : null');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#196 — THE CRON THAT CLOSES THEM', () => {
    it('refuses without the shared secret', async () => {
        seedWindow('ended', { endDate: PAST });

        expect((await cron(null)).status).toBe(401);
        expect((await cron('Bearer wrong')).status).toBe(401);
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('refuses to run at all when no secret is configured', async () => {
        // Failing closed. An unset secret must not mean "anyone may run it".
        delete process.env.CRON_SECRET;

        expect((await cron('Bearer anything')).status).toBe(500);
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('CLOSES AN EXPIRED WINDOW — the whole finding, as one assertion', async () => {
        seedWindow('ended', { endDate: PAST });

        const { body } = await cron();

        expect(body.closed).toBe(1);
        const [args] = mockClaim.mock.calls[0] as [any];
        expect(args).toMatchObject({
            collection: WINDOWS,
            id: 'ended',
            to: EXPORT_WINDOW_CLOSED_STATUS,
        });
        expect(args.fromAny).toEqual([...EXPORT_WINDOW_INVESTABLE_STATUSES]);
    });

    it('and LEAVES A LIVE ONE ALONE', async () => {
        seedWindow('live', { endDate: FUTURE });

        const { body } = await cron();

        expect(body.expired).toBe(0);
        expect(body.closed).toBe(0);
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('and a window with no deadline, which is not the same as an expired one', async () => {
        seedWindow('undated', { endDate: null });

        expect((await cron()).body.closed).toBe(0);
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('CLAIMS the transition, so two runs cannot both close one window', async () => {
        seedWindow('ended', { endDate: PAST });
        mockClaim.mockResolvedValue({ claimed: false, status: 'completed' });

        const { body } = await cron();

        expect(body.closed).toBe(0);
        expect(body.skipped).toBe(1);
        // Not reported as a failure: another run, or an admin, moved it first.
        expect(body.failed).toBe(0);
        expect(body.success).toBe(true);
    });

    it('records what it was, so a reopening admin can see it', async () => {
        seedWindow('ended', { endDate: PAST });

        await cron();

        const [args] = mockClaim.mock.calls[0] as [any];
        expect(args.recordPreviousAs).toBe('statusBeforeClose');
        expect(args.patch.closedBy).toBe('cron:close-export-windows');
        expect(typeof args.patch.closedAt).toBe('string');
    });

    it('ONE UNCLOSABLE WINDOW DOES NOT STOP THE REST, and is reported by name', async () => {
        // #298/#299's rule: a job that counts a failed write as done is worse
        // than one that does nothing.
        seedWindow('a', { endDate: PAST });
        seedWindow('b', { endDate: PAST });
        mockClaim
            .mockRejectedValueOnce(new Error('row locked'))
            .mockResolvedValue({ claimed: true, status: 'open' });

        const { body } = await cron();

        expect(body.closed).toBe(1);
        expect(body.failed).toBe(1);
        expect(body.success).toBe(false);
        expect(body.failures[0].id).toBe('a');
        expect(body.failures[0].reason).toContain('row locked');
    });

    it('reports a backlog rather than truncating silently', async () => {
        const src = source(CRON);

        expect(src).toContain('mayHaveMore: snapshot.docs.length >= MAX_PER_RUN');
        expect(src).toContain('.limit(MAX_PER_RUN)');
    });

    it('DELETES NOTHING — the standing rule for this codebase', async () => {
        seedWindow('ended', { endDate: PAST });

        await cron();

        const src = source(CRON);
        expect(src).not.toMatch(/\.delete\(|FieldValue\.delete|batch\.delete/);
        // And the row is still there afterwards, with its fields.
        expect(store.get(WINDOWS, 'ended')).toMatchObject({ commodity: 'Sesame' });
    });

    it('and moves nothing but the status — no money, no slots', async () => {
        const src = source(CRON);

        for (const forbidden of [
            'creditWalletOnce', 'debitJsonbBalance', 'claimPaymentOnce',
            'incrementWithinCeiling', 'createNotification', 'sendEmail',
        ]) {
            expect({ forbidden, present: src.includes(forbidden) })
                .toEqual({ forbidden, present: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#196 — the premise, re-measured', () => {
    it('THERE IS A WRITER OF "closed" NOW, and it is the cron', () => {
        // #275 established there was none by sweep. The same sweep, inverted.
        const writers = sourceFiles().filter((f) =>
            new RegExp(`to:\\s*EXPORT_WINDOW_CLOSED_STATUS`).test(source(f)));

        expect(writers).toEqual([CRON]);
    });

    it('and it is a real cron route beside the others', () => {
        // NAMED, not counted. My first draft asserted `length === 6`, which
        // #140 broke by adding a seventh job — a count fails on any addition,
        // including a correct one, while saying nothing about WHICH job went
        // missing. The set is the useful claim: losing one still fails here,
        // and adding one is a deliberate edit to this list.
        const crons = readdirSync(join(ROOT, 'src/app/api/cron')).sort();

        expect(crons).toEqual([
            'close-export-windows',
            'gdpr-purge',
            'process-email-queue',
            'reconcile-fulfilment',
            'reconcile-paystack',
            'release-escrow',
            'release-stale-reservations',
        ]);
    });

    it('and these sweeps read CODE, not the prose above it', () => {
        // The tombstone trap. Every claim in this suite is made against
        // comment-stripped source, so a write-up quoting a symbol cannot
        // satisfy an assertion about the symbol being used. Pinned in both
        // directions: the sentence exists in the file and NOT in what the
        // sweeps see.
        const raw = readFileSync(join(ROOT, CRON), 'utf-8');

        expect(raw).toContain('NOTHING EVER CLOSED AN EXPIRED EXPORT WINDOW');
        expect(source(CRON)).not.toContain('NOTHING EVER CLOSED AN EXPIRED EXPORT WINDOW');

        // And the same for the module the deadline rule lives in, since the
        // "uses the SAME predicate" assertion above reads it.
        const rawLib = readFileSync(join(ROOT, STATUS_LIB), 'utf-8');
        expect(rawLib).toContain('THE DEADLINE WAS CHECKED WHERE MONEY ENTERED AND NOWHERE ELSE');
        expect(source(STATUS_LIB)).not.toContain('THE DEADLINE WAS CHECKED WHERE MONEY ENTERED AND NOWHERE ELSE');
    });

    it('every read path that offers a window applies the deadline', () => {
        // The sweep that would have caught #275 before it shipped: any file
        // deciding a window is investable, and whether it asks about the date.
        const offers = [AGGREGATION, INVESTMENTS];

        for (const file of offers) {
            expect({ file, guards: source(file).includes('exportWindowHasExpired') })
                .toEqual({ file, guards: true });
        }
    });

    it('and the three MONEY doors still go through the shared verdict', () => {
        // #275's fix, re-measured rather than assumed — this finding changed
        // the function they all call.
        const doors = [
            'src/app/actions/export-payment.ts',
            'src/app/actions/export/_ex_investments.ts',
            AGGREGATION,
        ];

        for (const file of doors) {
            expect({ file, guards: source(file).includes('exportWindowAcceptsInvestment(') })
                .toEqual({ file, guards: true });
        }
    });
});
