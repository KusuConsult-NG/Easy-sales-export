/**
 * @jest-environment node
 */

/**
 *   #567 MOVING A READ TO THE SERVER MUST NOT QUIETLY WIDEN IT.
 *
 *   Batch 17 finishes the API-route self-fetchers, and both of them are gated
 *   reads — which is the case where this conversion can do real damage rather
 *   than merely fail to help.
 *
 *   /wave/live-training's listing carries `roomKey`, the server-minted secret
 *   that opens the video classroom, and `customMeetingLink`. Its gate has
 *   already been wrong twice: once admitting every signed-in account on the
 *   platform to a women's-only programme's meeting links, and once REFUSING a
 *   member approved within the last hour because the session's copy of her
 *   status was stale and the route had no database fallback.
 *
 *   So the gate and the listing moved into one function together, and both the
 *   page and the route call it. A page that had copied the query and left the
 *   gate behind would be the first of those defects again; one that copied the
 *   gate would be a second place for the staleness rule to be got wrong.
 *
 *   /settings/security/mfa is the same concern in the other direction: its
 *   reader THROWS rather than returning false when it cannot read, because this
 *   endpoint's catch once replied "success, no second factor" to a database
 *   failure — telling a protected account it was unprotected. A seed that could
 *   absorb a failure would put that back.
 *
 * ── WHAT IS CHECKED HERE, AND WHY IT IS THE PAGE AND NOT THE ROUTE ──────────
 *
 *   The route's behaviour is covered by wave-training-access and
 *   mfa-status-never-guesses-off, which now read the shared functions. What
 *   those cannot see is the NEW caller: the server page. So this runs the page
 *   itself and asks what it hands to the client when the reader refuses, when
 *   it throws, and when there is no session at all.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the live-training page seeding a refusal as an empty list   KILLED (1 test)
 *     the MFA page seeding `{ enabled: false }` on a throw        KILLED (1)
 *     the MFA page seeding a value with no session                KILLED (1)
 *     reword this header                                          SURVIVED, as intended
 *
 *   AND ONE MUTANT WAS EQUIVALENT, WHICH TURNED OUT TO BE A PROPERTY WORTH
 *   KEEPING. Rewriting the page to ignore `allowed` and read `result.sessions`
 *   directly changed nothing — because the REFUSAL SHAPE HAS NO `sessions`
 *   FIELD AT ALL. `{ allowed: false }` is not a listing with a flag on it; it
 *   is a different value, and a caller that forgets the check gets `undefined`
 *   rather than a leak.
 *
 *   That is defence by data shape rather than by a guard, and it is worth more
 *   than the guard: a guard can be forgotten. It was accidental until the
 *   mutation run made it visible, so it is pinned below rather than left to be
 *   flattened by the next person who "simplifies" the return type.
 */

import React from 'react';

const waveReader = { readWaveTrainingSessions: jest.fn() };
const mfaReader = { readMfaStatus: jest.fn() };
const authFn = jest.fn();

jest.mock('@/lib/auth', () => ({ auth: (...a: any[]) => authFn(...a) }));
jest.mock('@/lib/wave-training-reader', () => ({
    readWaveTrainingSessions: (...a: any[]) => waveReader.readWaveTrainingSessions(...a),
}));
jest.mock('@/lib/mfa-status-reader', () => ({
    readMfaStatus: (...a: any[]) => mfaReader.readMfaStatus(...a),
}));
jest.mock('@/app/wave/(member)/live-training/LiveTrainingClient', () => ({
    __esModule: true, default: () => null,
}));
jest.mock('@/app/settings/security/mfa/MfaSetupClient', () => ({
    __esModule: true, default: () => null,
}));

const SESSIONS = [{ id: 's1', title: 'Phytosanitary basics', roomKey: 'secret-key' }];

async function liveTrainingSeed(): Promise<any> {
    const { default: Page } = await import('@/app/wave/(member)/live-training/page');
    const el = await Page();
    return (el as React.ReactElement<{ initial: unknown }>).props.initial;
}

async function mfaSeed(): Promise<any> {
    const { default: Page } = await import('@/app/settings/security/mfa/page');
    const el = await Page();
    return (el as React.ReactElement<{ initial: unknown }>).props.initial;
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    authFn.mockResolvedValue({ user: { id: 'u1', roles: ['wave_participant'] } });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#567 — the live training page never seeds past the gate', () => {
    it('A MEMBER WHO MAY READ IT GETS THE SCHEDULE', async () => {
        waveReader.readWaveTrainingSessions.mockResolvedValue({
            allowed: true, sessions: SESSIONS, cursor: null, hasMore: false,
        });

        expect(await liveTrainingSeed()).toEqual(SESSIONS);
    });

    it('A REFUSAL SEEDS NOTHING — NOT AN EMPTY SCHEDULE', async () => {
        //   THE CLAIM. "You may not see this" and "there is nothing scheduled"
        //   are different answers, and only one of them is this page's to give.
        //   Seeding [] would show a member turned away an empty timetable
        //   instead of letting the route say 403.
        waveReader.readWaveTrainingSessions.mockResolvedValue({ allowed: false });

        expect(await liveTrainingSeed()).toBeNull();
    });

    it('AND A THROWN READ SEEDS NOTHING EITHER', async () => {
        waveReader.readWaveTrainingSessions.mockRejectedValue(new Error('database down'));

        expect(await liveTrainingSeed()).toBeNull();
    });

    it('AND NO SESSION MEANS NO READ AT ALL', async () => {
        //   The page must not attempt a gated read without a caller to gate.
        authFn.mockResolvedValue(null);

        expect(await liveTrainingSeed()).toBeNull();
        expect(waveReader.readWaveTrainingSessions).not.toHaveBeenCalled();
    });

    it('AND THE REFUSAL CARRIES NO LISTING TO LEAK IN THE FIRST PLACE', async () => {
        //   The property that makes "forgot to check `allowed`" harmless — see
        //   the header. A refusal is a DIFFERENT VALUE, not a listing with a
        //   flag on it, so there is nothing for a careless caller to read.
        //
        //   Asserted against the real reader's type, by shape: if anyone ever
        //   widens the refusal to carry `sessions: []` for symmetry, this fails
        //   and the reason has to be revisited.
        const reader = require('fs').readFileSync(
            require('path').join(process.cwd(), 'src/lib/wave-training-reader.ts'), 'utf-8',
        ) as string;

        expect(reader).toContain('| { allowed: false }');
        expect(reader).toContain('return { allowed: false };');
        //   And nowhere does a refusal carry rows.
        expect(reader).not.toMatch(/allowed: false[^}]*sessions/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#567 — the MFA page never turns a failure into "off"', () => {
    it('A READABLE STATUS IS SEEDED', async () => {
        mfaReader.readMfaStatus.mockResolvedValue({ enabled: true });

        expect(await mfaSeed()).toEqual({ enabled: true });
    });

    it('AND A REAL "OFF" IS SEEDED TOO, BECAUSE IT IS AN ANSWER', async () => {
        //   The vacuity guard: seeding nothing whenever enabled is false would
        //   make every unprotected account pay for a round trip it did not need.
        mfaReader.readMfaStatus.mockResolvedValue({ enabled: false });

        expect(await mfaSeed()).toEqual({ enabled: false });
    });

    it('A THROWN READ SEEDS NOTHING — the screen keeps its own "unknown"', async () => {
        //   THE CLAIM. This endpoint once answered "success, no second factor"
        //   to a database failure. A seed of { enabled: false } here would be
        //   that defect again, arriving earlier.
        mfaReader.readMfaStatus.mockRejectedValue(new Error('database down'));

        expect(await mfaSeed()).toBeNull();
    });

    it('AND NO SESSION MEANS NO READ AT ALL', async () => {
        authFn.mockResolvedValue(null);

        expect(await mfaSeed()).toBeNull();
        expect(mfaReader.readMfaStatus).not.toHaveBeenCalled();
    });
});
