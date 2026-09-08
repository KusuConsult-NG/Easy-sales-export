/**
 * @jest-environment node
 */

/**
 *   #504 THE REVISION FLOW HAND-WROTE "WHICH RECORD IS CURRENT" TWICE, AND THE
 *        TWO COPIES DID NOT AGREE.
 *
 *   getCooperativeApplicationAction chose the row to SHOW:
 *
 *       snap.docs.map(d => d.data()).sort((a, b) =>
 *           toMillis(b.createdAt) - toMillis(a.createdAt))
 *
 *   and resubmitCooperativeApplicationAction, ninety lines below, chose the row
 *   to WRITE:
 *
 *       snap.docs.sort((a, b) =>
 *           toMillis(b.data().createdAt) - toMillis(a.data().createdAt))
 *
 *   The same question, asked twice, of different objects — one sorts plain
 *   data, the other sorts snapshots, and the second sorts `snap.docs` IN PLACE,
 *   which lib/latest-application.ts copies specifically to avoid.
 *
 *   BOTH ARE NARROWER THAN THE SHARED RULE. #412 replaced this very comparator
 *   in _coop_identity.ts and recorded why: `createdAt` alone "scores 0 for a
 *   date-only string or an epoch number, where the shared reader handles both,
 *   and it had no tiebreak at all". The shared rule reads `submittedAt ??
 *   createdAt`, tiebreaks on the decided stamps, then on document id — so it
 *   returns the same answer every time, and warns when no candidate carries a
 *   readable date rather than choosing in silence.
 *
 * ── WHY IT MATTERS HERE MORE THAN ANYWHERE ──────────────────────────────────
 *
 *   This is the flow where a member corrects what an admin asked them to
 *   correct. With no tiebreak both comparators return 0 for tied or unreadable
 *   dates and the answer comes from incidental order — so the row the member is
 *   SHOWN and the row their correction is WRITTEN to could differ. They edit
 *   what is in front of them, press save, and it lands on another record.
 *   Nothing errors. The admin sees the same application unchanged and asks
 *   again, and the member does it again.
 *
 *   Duplicate rows are not hypothetical: #502 found an endpoint creating a
 *   second, blank membership for members who had already paid.
 *
 *   A ROW WITH submittedAt AND NO createdAt is the sharpest case, and it is the
 *   first test below. The old comparator scored it 0 — the oldest possible —
 *   so the newest application in the collection sorted last.
 *
 *   RESIDUAL, STATED RATHER THAN HIDDEN: both doors ask one rule now and
 *   therefore agree, but the answer is still RECOMPUTED rather than carried.
 *   The stronger fix is for the getter to return the chosen document id and the
 *   resubmit to write the row it is handed — a change to the form's contract,
 *   worth doing, and not silently as part of this.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the getter reverted to its own comparator      KILLED
 *     the resubmit reverted to its own comparator    KILLED
 *     the shared rule made to read createdAt only    KILLED
 *     reword this header                             SURVIVED, as intended
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

const MEMBER = 'member-1';
const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;

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
    store.seed(COLLECTIONS.USERS, MEMBER, {
        email: 'ada@example.com',
        serviceRegistrations: { cooperatives: { status: 'revision_required' } },
    });
});

async function actions() {
    return import('@/app/actions/cooperative/_coop_registration');
}

const getApplication = async () =>
    (await (await actions()).getCooperativeApplicationAction()) as any;

/** A member row. `marker` identifies which one a door picked. */
function seedRow(id: string, extra: Record<string, unknown>): void {
    store.seed(MEMBERS, id, {
        userId: MEMBER,
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Obi',
        marker: id,
        ...extra,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#504 — the newest application is the one shown', () => {
    it('A ROW WITH submittedAt AND NO createdAt IS NOT TREATED AS THE OLDEST', async () => {
        //   THE test. `toMillis(createdAt)` scores this 0 — the oldest possible
        //   — so the member's most recent application sorted last and the stale
        //   one was put in front of them to edit.
        seedRow('older', { createdAt: '2026-01-01T00:00:00.000Z' });
        seedRow('newest', { submittedAt: '2026-06-01T00:00:00.000Z' });

        const res = await getApplication();

        expect(res.success).toBe(true);
        expect(res.data.application.marker).toBe('newest');
    });

    it('AND createdAt STILL DECIDES WHEN THAT IS ALL THERE IS', async () => {
        //   The control for the ordinary case: the shared rule must not change
        //   the answer where the old comparator was already right.
        seedRow('older', { createdAt: '2026-01-01T00:00:00.000Z' });
        seedRow('newer', { createdAt: '2026-06-01T00:00:00.000Z' });

        expect((await getApplication()).data.application.marker).toBe('newer');
    });

    it('AND TIED DATES ARE BROKEN DETERMINISTICALLY, NOT BY LUCK', async () => {
        //   Neither hand-written comparator had a tiebreak, so both returned 0
        //   and the answer came from whatever order the snapshot arrived in.
        seedRow('aaa', { createdAt: '2026-03-01T00:00:00.000Z' });
        seedRow('zzz', { createdAt: '2026-03-01T00:00:00.000Z' });

        const first = (await getApplication()).data.application.marker;
        const again = (await getApplication()).data.application.marker;

        expect(first).toBe(again);
    });

    it('and a member with one application still gets it', async () => {
        seedRow('only', { createdAt: '2026-03-01T00:00:00.000Z' });

        expect((await getApplication()).data.application.marker).toBe('only');
    });

    it('and a member with none is told so', async () => {
        expect(await getApplication()).toMatchObject({
            success: false, error: 'No application found',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#504 — and it is the row the correction is written to', () => {
    /**
     * The point of the finding. Two doors, one question: whichever row the
     * getter shows, the resubmit must write THAT one, or the member's correction
     * lands on a record they never saw.
     */
    it('THE DOOR THAT SHOWS AND THE DOOR THAT WRITES PICK THE SAME ROW', async () => {
        seedRow('older', { createdAt: '2026-01-01T00:00:00.000Z' });
        seedRow('newest', { submittedAt: '2026-06-01T00:00:00.000Z' });

        const shown = (await getApplication()).data.application.marker;

        const form = new FormData();
        for (const [k, v] of Object.entries({
            firstName: 'Ada', lastName: 'Obi', dateOfBirth: '1990-01-01',
            gender: 'female', email: 'ada@example.com', phone: '08012345678',
            stateOfOrigin: 'Plateau', lga: 'Jos North', ward: 'Ward 1',
            residentialAddress: '12 Market Road', occupation: 'Trader',
            nextOfKinName: 'Ola Obi', nextOfKinPhone: '08087654321',
            nextOfKinAddress: '12 Market Road',
            //   The resubmit refuses without these; the finding is about
            //   WHICH row is written, so the form has to be a valid one.
            validIdUrl: 'https://res.cloudinary.com/x/id.png',
            validIdName: 'id.png',
            passportPhotoUrl: 'https://res.cloudinary.com/x/photo.png',
            passportPhotoName: 'photo.png',
        })) form.set(k, v as string);

        await (await actions()).resubmitCooperativeApplicationAction(form);

        //   Whichever row was shown is the one that moved. The other is
        //   untouched — asserted both ways so a fix that wrote BOTH rows would
        //   not pass.
        const written = store.get(MEMBERS, shown === 'newest' ? 'newest' : 'older')!;
        const untouched = store.get(MEMBERS, shown === 'newest' ? 'older' : 'newest')!;

        expect(shown).toBe('newest');
        expect(written.residentialAddress).toBe('12 Market Road');
        expect(untouched.residentialAddress).toBeUndefined();
    });

    it('AND NEITHER DOOR REORDERS THE SNAPSHOT IT WAS GIVEN', () => {
        //   The resubmit copy called `snap.docs.sort(...)`, which mutates.
        //   sortApplicationsNewestFirst copies first and says so in its header;
        //   pinned here because an in-place sort is invisible until something
        //   downstream reads the same array.
        //   COMMENTS STRIPPED. The first version of this read the raw file,
        //   and the #504 header in that file QUOTES both old comparators in
        //   order to explain them — so the assertion failed against correct
        //   code. Same trap #493 recorded: when the explanation contains the
        //   thing being banned, assert on the code, not the file.
        const body = stripComments(
            readFileSync('src/app/actions/cooperative/_coop_registration.ts', 'utf-8'),
            { label: '_coop_registration.ts' });

        expect(body).not.toMatch(/snap\.docs\.sort\(/);
        expect(body).not.toMatch(/snap\.docs\.map\(d => d\.data\(\)\)\.sort\(/);
    });

    it('AND BOTH ASK THE SHARED RULE', () => {
        const body = stripComments(
            readFileSync('src/app/actions/cooperative/_coop_registration.ts', 'utf-8'),
            { label: '_coop_registration.ts' });

        expect(body.match(/latestApplication\(snap\.docs\)/g)?.length).toBe(2);
    });
});
