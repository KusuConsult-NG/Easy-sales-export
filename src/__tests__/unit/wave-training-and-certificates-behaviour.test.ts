/**
 * @jest-environment node
 */

/**
 * The last three unexecuted WAVE files, EXECUTED.
 * _wv_admin_live.ts was at 12.7%, _wv_admin_resources.ts at 12.5% and
 * _wv_certificates.ts at 45.5%.
 *
 *   #158 generateCertificateAction was gated on
 *        `roles.includes("admin") || roles.includes("super_admin")`, read off
 *        the session. That excludes wave_admin — the role that RUNS the training
 *        these certificates are for, and that every other action in the WAVE
 *        admin area admits through PERMISSION_MATRIX. The person who taught the
 *        course could not certify anyone who took it.
 *
 *   #159 The certificate's audit row passed the RECIPIENT's id as the audit
 *        log's `userId`, the field every other call site fills with
 *        session.user.id. So each certificate was recorded as issued BY the
 *        member who received it — the one question the log exists to answer was
 *        the one it could not. Same defect as #129. The action was "user_update"
 *        too, while "certificate_issued" sat unused in the union.
 *
 *   #160 No duplicate guard, and an id of `cert_${userId}_${Date.now()}`. Two
 *        clicks a second apart issued two certificates for one programme, both
 *        verifying as genuine; two in the same millisecond collided on the id
 *        and the second `set` overwrote the first, so the number printed from
 *        the first response no longer existed.
 *
 *   #161 getEventParticipantsAction queried the registrations, built
 *        `participants`, and returned `data: null`. The admin screen reads
 *        `result.data?.participants` and shows "Failed to load participants"
 *        when it is absent — so View Participants has never succeeded, for any
 *        event, for anybody. The rows are hydrated now too: the registration
 *        holds only a userId, and the screen rendered a column of ids.
 *
 *   #162 Deleting a training event cleaned up its live-session documents and
 *        left every REGISTRATION pointing at an event that no longer exists.
 *        _member.ts walks those rows for the member's training history and
 *        dashboard counts.
 *
 *   #163 Go Live and End Session wrote `status` blind. Go Live worked on a
 *        completed event (reopening it), a cancelled one, and an already-ongoing
 *        one (two admins each overwriting the other's meetingLink). End Session
 *        worked on an event that had never started.
 *
 *   #164 The edit form could set status to "ongoing", which writes the status
 *        with no meetingLink and no session row — members see a live event with
 *        no room to join.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));
jest.mock('@/lib/auth', () => ({
    auth: async () => null, signIn: async () => undefined,
    signOut: async () => undefined, handlers: {},
}));

const mockClaimFromAny = jest.fn(async () => ({ claimed: true, status: 'upcoming' })) as jest.Mock<any>;
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(),
    claimStatusTransitionFromAny: (...a: any[]) => mockClaimFromAny(...a),
    markFulfilmentFailed: jest.fn(),
}));

let store: FakeDbHandle;

const MEMBER = 'member-1';
const EVENT = 'event-1';
const USERS = COLLECTIONS.USERS;
const EVENTS = COLLECTIONS.WAVE_TRAINING_EVENTS;
const SESSIONS = COLLECTIONS.WAVE_TRAINING_SESSIONS;
const REGS = COLLECTIONS.WAVE_TRAINING_REGISTRATIONS;
const CERTS = COLLECTIONS.WAVE_CERTIFICATES;

function actAs(id: string | null, roles: string[] = ['general_user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: `${id}@e.com` } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs('wave-1', ['wave_admin']);
    // clearAllMocks clears CALLS, not implementations.
    mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'upcoming' });
    store.seed(USERS, MEMBER, {
        firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com', phone: '08030000000',
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#158–#160 — issuing a WAVE certificate', () => {
    const issue = async (
        userId = MEMBER, programme = 'Export Readiness', type = 'training',
    ) =>
        (await (await import('@/app/actions/wave/_wv_certificates'))
            .generateCertificateAction(userId as never, programme as never, type as never)) as any;

    it('refuses a caller with no session, and an ordinary member', async () => {
        actAs(null);
        expect(await issue()).toMatchObject({ success: false });

        actAs(MEMBER);
        expect(await issue()).toMatchObject({ success: false });
    });

    // ── #158 ────────────────────────────────────────────────────────────────
    it.each(['super_admin', 'admin', 'wave_admin'])(
        'LETS %s ISSUE ONE — the roles that hold wave:manage_training', async (role) => {
            actAs('admin-x', [role]);

            const res = await issue();
            expect(res.success).toBe(true);
            expect(store.size(CERTS)).toBe(1);
        });

    it.each(['academy_admin', 'marketplace_admin', 'support', 'moderator', 'cooperative_admin'])(
        'refuses %s — they do not run WAVE training', async (role) => {
            actAs('other-1', [role]);

            expect(await issue()).toMatchObject({ success: false });
            expect(store.size(CERTS)).toBe(0);
        });

    it('names the member, resolved the way every other screen resolves it', async () => {
        const res = await issue();
        expect(res.data.memberName).toBe('Ada Obi');
    });

    it('refuses a member who does not exist', async () => {
        expect(await issue('nobody')).toMatchObject({ success: false });
    });

    // ── #159 ────────────────────────────────────────────────────────────────
    it('RECORDS THE ISSUING ADMIN, NOT THE RECIPIENT', async () => {
        actAs('issuing-admin', ['wave_admin']);

        await issue();

        const audit = (globalThis as any).mockCreateAdminAuditLog as jest.Mock<any>;
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'certificate_issued',
            userId: 'issuing-admin',
            targetType: 'wave_certificate',
        }));
        // The member is the target of the act, carried where it can be searched.
        const [{ metadata }] = audit.mock.calls[0] as [any];
        expect(metadata.memberId).toBe(MEMBER);
    });

    // ── #160 ────────────────────────────────────────────────────────────────
    it('ISSUES ONE CERTIFICATE PER MEMBER PER PROGRAMME, NOT ONE PER CLICK', async () => {
        const first = await issue(MEMBER, 'Export Readiness', 'training');
        const second = await issue(MEMBER, 'Export Readiness', 'training');

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        expect(store.size(CERTS)).toBe(1);
        // And the second call returns the certificate that exists, rather than
        // a new number the database does not hold.
        expect(second.data.certificateNumber).toBe(first.data.certificateNumber);
    });

    it('survives two simultaneous clicks without losing a certificate number', async () => {
        const [a, b] = await Promise.all([issue(), issue()]);

        expect(store.size(CERTS)).toBe(1);
        const stored = store.all(CERTS)[0][1] as any;
        // Whichever won, the number the caller was handed is the one on file.
        expect([a.data.certificateNumber, b.data.certificateNumber])
            .toContain(stored.certificateNumber);
    });

    it('still issues separately for a DIFFERENT programme and a different type', async () => {
        await issue(MEMBER, 'Export Readiness', 'training');
        await issue(MEMBER, 'Logistics Basics', 'training');
        await issue(MEMBER, 'Export Readiness', 'completion');

        expect(store.size(CERTS)).toBe(3);
    });

    it('writes both field vocabularies, so the unified endpoint can read it', async () => {
        await issue();

        const row = store.all(CERTS)[0][1] as any;
        expect(row).toMatchObject({ memberId: MEMBER, userId: MEMBER, type: 'training' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#161 — the participant list', () => {
    const participants = async () =>
        (await (await import('@/app/actions/wave/_wv_admin_resources'))
            .getEventParticipantsAction(EVENT as never)) as any;

    beforeEach(() => {
        store.seed(REGS, 'reg-1', {
            userId: MEMBER, eventId: EVENT, attended: false,
            registeredAt: '2026-05-01T00:00:00.000Z',
        });
    });

    it('RETURNS THE PARTICIPANTS INSTEAD OF null', async () => {
        const res = await participants();

        expect(res.success).toBe(true);
        expect(res.data).not.toBeNull();
        expect(res.data.participants).toHaveLength(1);
    });

    it('hydrates the name and email, so the register is readable', async () => {
        const [row] = (await participants()).data.participants;

        expect(row.userId).toBe(MEMBER);
        expect(row.user.name).toBe('Ada Obi');
        expect(row.user.email).toBe('ada@example.com');
    });

    it('leaves user null for a registration whose member record is gone', async () => {
        store.seed(REGS, 'reg-2', {
            userId: 'erased-1', eventId: EVENT, attended: false,
            registeredAt: '2026-05-02T00:00:00.000Z',
        });

        const rows = (await participants()).data.participants;
        expect(rows.find((r: any) => r.userId === 'erased-1').user).toBeNull();
    });

    it('returns an empty list rather than failing for an event nobody joined', async () => {
        store.clear();
        const res = await participants();
        expect(res.success).toBe(true);
        expect(res.data.participants).toEqual([]);
    });

    // ── #164 (the gate) ─────────────────────────────────────────────────────
    it.each(['academy_admin', 'marketplace_admin', 'support'])(
        'refuses %s — every sibling in this file requires wave:manage_training', async (role) => {
            actAs('other-1', [role]);
            expect(await participants()).toMatchObject({ success: false });
        });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#162 — deleting a training event', () => {
    const remove = async () =>
        (await (await import('@/app/actions/wave/_wv_admin_resources'))
            .deleteTrainingEventAction(EVENT as never)) as any;

    beforeEach(() => {
        store.seed(EVENTS, EVENT, { title: 'Export Readiness', status: 'upcoming' });
        store.seed(SESSIONS, 'sess-1', { roomName: `wave-training-${EVENT}`, isActive: true });
        store.seed(REGS, 'reg-1', { userId: MEMBER, eventId: EVENT, attended: false });
        store.seed(REGS, 'reg-2', { userId: 'member-2', eventId: EVENT, attended: false });
        // A registration for a DIFFERENT event, which must survive.
        store.seed(REGS, 'reg-other', { userId: MEMBER, eventId: 'event-2', attended: false });
    });

    it('RELEASES THE REGISTRATIONS THAT POINTED AT IT', async () => {
        expect(await remove()).toMatchObject({ success: true });

        expect(store.size(EVENTS)).toBe(0);
        expect(store.size(SESSIONS)).toBe(0);
        const remaining = store.all(REGS).map(([id]) => id);
        expect(remaining).toEqual(['reg-other']);
    });

    it('refuses a role that does not manage WAVE training', async () => {
        actAs('other-1', ['academy_admin']);

        expect(await remove()).toMatchObject({ success: false });
        expect(store.size(EVENTS)).toBe(1);
        expect(store.size(REGS)).toBe(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#163 — starting and ending a live session', () => {
    const goLive = async (link?: string) =>
        (await (await import('@/app/actions/wave/_wv_admin_live'))
            .startWaveLiveSessionAction(EVENT as never, link as never)) as any;

    const end = async () =>
        (await (await import('@/app/actions/wave/_wv_admin_live'))
            .endWaveLiveSessionAction(EVENT as never)) as any;

    beforeEach(() => {
        store.seed(EVENTS, EVENT, {
            title: 'Export Readiness', description: 'Two hours on paperwork',
            duration: '2 hours', status: 'upcoming',
        });
    });

    it('CLAIMS THE TRANSITION rather than writing the status blind', async () => {
        await goLive('https://meet.example/abc');

        expect(mockClaimFromAny).toHaveBeenCalledWith(expect.objectContaining({
            collection: EVENTS,
            id: EVENT,
            fromAny: ['upcoming'],
            to: 'ongoing',
        }));
    });

    it('creates the room with the parsed duration and the custom link', async () => {
        const res = await goLive('https://meet.example/abc');

        expect(res.success).toBe(true);
        expect(res.data.roomName).toBe(`wave-training-${EVENT}`);
        const [, room] = store.all(SESSIONS)[0];
        expect(room).toMatchObject({
            roomName: `wave-training-${EVENT}`,
            isActive: true,
            durationMinutes: 120,
            customMeetingLink: 'https://meet.example/abc',
        });
    });

    it('REFUSES TO REOPEN A COMPLETED SESSION, and creates no room', async () => {
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'completed' });

        const res = await goLive();

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/completed/i);
        expect(store.size(SESSIONS)).toBe(0);
    });

    it('refuses a cancelled event', async () => {
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'cancelled' });

        expect(await goLive()).toMatchObject({ success: false });
        expect(store.size(SESSIONS)).toBe(0);
    });

    it('TELLS THE SECOND ADMIN THE SESSION IS ALREADY LIVE instead of overwriting the link', async () => {
        // The first Go Live won the claim; the second sees status "ongoing".
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'ongoing' });

        const res = await goLive('https://meet.example/SECOND-ADMIN');

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/already live/i);
        expect(store.size(SESSIONS)).toBe(0);
    });

    it('reports a missing event rather than inventing a room for it', async () => {
        store.clear();
        expect(await goLive()).toMatchObject({ success: false });
    });

    it('reactivates the existing room on a legitimate restart', async () => {
        store.seed(SESSIONS, 'sess-1', {
            roomName: `wave-training-${EVENT}`, isActive: false, durationMinutes: 30,
        });

        await goLive();

        expect(store.size(SESSIONS)).toBe(1);
        expect(store.get(SESSIONS, 'sess-1')).toMatchObject({ isActive: true, durationMinutes: 120 });
    });

    // ── ending ──────────────────────────────────────────────────────────────
    it('ends an ongoing session and deactivates its room', async () => {
        store.seed(SESSIONS, 'sess-1', { roomName: `wave-training-${EVENT}`, isActive: true });
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'ongoing' });

        expect(await end()).toMatchObject({ success: true });
        expect(mockClaimFromAny).toHaveBeenCalledWith(expect.objectContaining({
            fromAny: ['ongoing'], to: 'completed',
        }));
        expect(store.get(SESSIONS, 'sess-1')).toMatchObject({ isActive: false });
    });

    it('WILL NOT COMPLETE A SESSION THAT NEVER STARTED', async () => {
        store.seed(SESSIONS, 'sess-1', { roomName: `wave-training-${EVENT}`, isActive: true });
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'upcoming' });

        const res = await end();

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/upcoming/i);
        // And the room is left alone, so nobody in it is cut off by a refusal.
        expect(store.get(SESSIONS, 'sess-1')).toMatchObject({ isActive: true });
    });

    it('says so plainly when the session has already ended', async () => {
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'completed' });

        expect(String((await end()).error)).toMatch(/already ended/i);
    });

    it('refuses both to a role that does not manage WAVE training', async () => {
        actAs('other-1', ['marketplace_admin']);

        expect(await goLive()).toMatchObject({ success: false });
        expect(await end()).toMatchObject({ success: false });
        expect(mockClaimFromAny).not.toHaveBeenCalled();
    });

    it('distinguishes start from end in the audit log', async () => {
        const audit = (globalThis as any).mockCreateAdminAuditLog as jest.Mock<any>;

        await goLive();
        expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({ phase: 'start' }),
        }));

        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'ongoing' });
        await end();
        expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({ phase: 'end' }),
        }));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#164 — the edit form cannot declare an event live', () => {
    const edit = async (data: Record<string, unknown>) =>
        (await (await import('@/app/actions/wave/_wv_admin_resources'))
            .updateTrainingEventAction(EVENT as never, data as never)) as any;

    beforeEach(() => {
        store.seed(EVENTS, EVENT, { title: 'Export Readiness', status: 'upcoming' });
    });

    it('REFUSES status "ongoing" and points at Go Live', async () => {
        const res = await edit({ status: 'ongoing' });

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/Go Live/i);
        expect(store.get(EVENTS, EVENT)).toMatchObject({ status: 'upcoming' });
    });

    it('still allows the three ordinary status edits', async () => {
        for (const status of ['completed', 'cancelled', 'upcoming']) {
            expect(await edit({ status })).toMatchObject({ success: true });
            expect(store.get(EVENTS, EVENT)).toMatchObject({ status });
        }
    });

    it('still allows an ordinary field edit', async () => {
        expect(await edit({ title: 'Export Readiness II' })).toMatchObject({ success: true });
        expect(store.get(EVENTS, EVENT)).toMatchObject({ title: 'Export Readiness II' });
    });
});
