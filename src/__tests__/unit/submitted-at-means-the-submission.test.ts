/**
 * @jest-environment node
 */

/**
 *   #506 THE SEVENTH AND EIGHTH COPIES OF "WHICH APPLICATION IS CURRENT", AND
 *        A FIELD CALLED submittedAt THAT REPORTED createdAt.
 *
 *   _wv_applications.ts carried two more hand-written comparators, and these
 *   were the narrowest yet — both read `createdAt` ALONE:
 *
 *       const aTime = toMillis(a.createdAt);
 *
 *   The Farm Nation copies #505 retired at least attempted `submittedAt ||
 *   createdAt`. These ignored the field entirely — while the very next statement
 *   returned a value LABELLED submittedAt, and the branch forty lines above it
 *   returned `reg.submittedAt`. One function, two branches, two different
 *   answers to what "submitted" means.
 *
 *   AND THE LABEL WAS BACKWARDS:
 *
 *       submittedAt: serializeValue(data.createdAt || data.submittedAt || null)
 *
 *   createdAt FIRST. On a resubmitted application createdAt is when the row was
 *   first made and submittedAt is when the member last sent it, so a member who
 *   corrected and resubmitted was shown the OLDER date under the NEWER label —
 *   on the screen that tells them where their application stands.
 *
 * ── AND THE COMPARATOR DECIDES MORE THAN THE DISPLAY ────────────────────────
 *
 *   getWaveApplicationAction HEALS `serviceRegistrations.wave.applicationId`
 *   from whichever row its comparator picks, and _resubmitWaveApplicationAction
 *   requires that id and writes to exactly it. So the comparator chooses which
 *   application a member's correction lands on, one step removed — the same
 *   show/write divergence #504 found in the cooperative, reached by a different
 *   route.
 *
 *   Neither copy had a tiebreak, so tied or unreadable dates resolved by
 *   incidental order. And the getter's sorted `snap.docs` IN PLACE, which
 *   lib/latest-application.ts copies specifically to avoid.
 *
 *   ONE DEFINITION NOW, EIGHT COPIES RETIRED: #412 the first, #504 the second
 *   and third, #505 the fourth through sixth, this the seventh and eighth.
 *
 * ── AN EXISTING RATCHET ASKED FOR THE MECHANISM, NOT THE RULE ───────────────
 *
 *   most-recent-sort-key.test.ts required this file to contain `toMillis(` as a
 *   vacuity guard beside its two real refusals. Both comparators called it
 *   directly, so removing them removed the last call — and the ratchet failed
 *   against code that now reads dates through lib/latest-application.ts, which
 *   uses toMillis itself AND adds the tiebreaks the copies lacked. Widened to
 *   accept the shared reader. Sixteenth time in this audit that a test has
 *   pinned an implementation detail where it meant a rule.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the status comparator reverted to createdAt     KILLED
 *     the getter comparator reverted                  KILLED
 *     the submittedAt precedence put back             KILLED
 *     reword this header                              SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

let store: FakeDbHandle;

const MEMBER = 'wave-1';
const APPS = COLLECTIONS.WAVE_APPLICATIONS;

function actAs(id: string): void {
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles: ['general_user'], email: 'ada@example.com' } },
        error: null,
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(MEMBER);
    //   No serviceRegistrations.wave, so the status door falls through to the
    //   application query — the branch that carried the comparator.
    store.seed(COLLECTIONS.USERS, MEMBER, { email: 'ada@example.com' });
});

async function actions() {
    return import('@/app/actions/wave/_wv_applications');
}

const status = async () =>
    (await (await actions()).getWaveApplicationStatusAction()) as any;
const application = async () =>
    (await (await actions()).getWaveApplicationAction()) as any;

function seedApp(id: string, extra: Record<string, unknown>): void {
    store.seed(APPS, id, { userId: MEMBER, marker: id, ...extra });
}

const code = () => stripComments(
    readFileSync('src/app/actions/wave/_wv_applications.ts', 'utf-8'),
    { label: '_wv_applications.ts' },
);

// ─────────────────────────────────────────────────────────────────────────────
describe('#506 — submittedAt means the submission', () => {
    it('A RESUBMITTED APPLICATION REPORTS WHEN IT WAS SUBMITTED, NOT CREATED', async () => {
        //   THE test. `createdAt || submittedAt` handed back the row's creation
        //   date under a field named submittedAt, so a member who corrected and
        //   resent their application was shown the older date.
        seedApp('only', {
            status: 'pending',
            createdAt: '2026-01-01T00:00:00.000Z',
            submittedAt: '2026-06-01T00:00:00.000Z',
        });

        const res = await status();

        expect(res.success).toBe(true);
        expect(String(res.data.submittedAt)).toContain('2026-06-01');
    });

    it('AND FALLS BACK TO createdAt WHEN THERE IS NO SUBMISSION STAMP', async () => {
        //   The control for the fallback: reversing the precedence must not
        //   leave older rows reporting nothing.
        seedApp('only', { status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' });

        expect(String((await status()).data.submittedAt)).toContain('2026-01-01');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#506 — and the newest application is chosen consistently', () => {
    it('A ROW WITH submittedAt AND NO createdAt IS NOT THE OLDEST', async () => {
        //   `toMillis(createdAt)` scored this 0 — the oldest possible — so the
        //   member's most recent application sorted last.
        seedApp('older', { status: 'rejected', createdAt: '2026-01-01T00:00:00.000Z' });
        seedApp('newest', { status: 'pending', submittedAt: '2026-06-01T00:00:00.000Z' });

        expect((await status()).data.status).toBe('pending');
    });

    it('AND THE STATUS DOOR AND THE APPLICATION DOOR AGREE', async () => {
        //   The getter heals serviceRegistrations.wave.applicationId from its
        //   own comparator, and the resubmit writes to that id — so a
        //   disagreement here decides which row a correction lands on.
        seedApp('older', { status: 'rejected', createdAt: '2026-01-01T00:00:00.000Z' });
        seedApp('newest', { status: 'pending', submittedAt: '2026-06-01T00:00:00.000Z' });

        expect((await status()).data.status).toBe('pending');
        expect((await application()).data.marker).toBe('newest');
    });

    it('and tied dates resolve the same way twice', async () => {
        seedApp('aaa', { status: 'pending', submittedAt: '2026-03-01T00:00:00.000Z' });
        seedApp('zzz', { status: 'pending', submittedAt: '2026-03-01T00:00:00.000Z' });

        expect((await application()).data.marker).toBe((await application()).data.marker);
    });

    it('and a member with no application is told so', async () => {
        expect((await status()).data).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#506 — no hand-written comparator survives', () => {
    it('BOTH ARE GONE AND BOTH DOORS ASK THE SHARED RULE', () => {
        //   Comments stripped: this file's #506 header quotes the old
        //   comparator to explain it.
        const body = code();

        expect(body).not.toMatch(/const aTime = toMillis\(a\.createdAt\)/);
        expect(body).not.toMatch(/snap\.docs\.sort\(/);
        expect(body.match(/latestApplication\(/g)?.length).toBe(2);
    });
});
