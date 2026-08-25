/**
 * @jest-environment node
 */

/**
 *   #268 THE ONE PUBLIC ENDPOINT THAT MAILS STRANGERS HAD NO RATE LIMIT.
 *
 *        registerForBriefingAction is unauthenticated by design — it is the
 *        WAVE awareness briefing sign-up, reachable by anyone. On every
 *        successful call it does two outbound things:
 *
 *            sendBriefingConfirmationEmail(email, name)
 *            generateAndSendWhatsAppInvite("wave_briefing", { email, name })
 *
 *        and it had no limit of any kind. A loop with fresh addresses sends
 *        mail from our domain to arbitrary third parties as fast as requests
 *        can be made, and issues a WhatsApp invite for each. The cost is the
 *        Resend bill, the WhatsApp invites, a registrations collection full of
 *        junk that the admin briefing list then shows — and the part that does
 *        not wash out, sender reputation, because the recipients never asked
 *        for it and will mark it as spam.
 *
 *        THREE PUBLIC ENDPOINTS IN THIS CODEBASE SEND EMAIL TO AN
 *        UNAUTHENTICATED CALLER'S CHOSEN ADDRESS. TWO ARE LIMITED:
 *
 *          api/contact/route.ts        rateLimitConfig.contactForm
 *          actions/password-reset.ts   rateLimitConfig.contactForm
 *          actions/briefing.ts         nothing
 *
 *        and the unlimited one is the only one that ALSO sends a WhatsApp
 *        invite. password-reset.ts even carries the argument written out:
 *        "This endpoint is unauthenticated, sends a real email through Resend
 *        on every call, and had no limit of any kind — so one address could be
 *        mailed as fast as requests could be made, at the platform's cost and
 *        the recipient's expense." Same sentence, same file family, one copy
 *        short. The shape this audit keeps finding.
 *
 *        KEYED ON THE CALLER, NOT THE ADDRESS — and that differs from
 *        password-reset on purpose. There, the address is what is abused, so
 *        the address is the key. Here the duplicate check already refuses a
 *        second registration for the same email BEFORE anything is sent, so one
 *        address cannot be mailed twice however hard you try. What is abused is
 *        the endpoint, with a fresh address every time, so the caller is the
 *        key. getActionClientIp is what #260 made trustworthy.
 *
 *   #269 AND AN ANONYMOUS CALLER'S ROLES CAME FROM AN EMAIL THEY TYPED.
 *
 *        With no session, the action looked the submitted address up in USERS
 *        and adopted whatever it found:
 *
 *            const userQuery = await db.collection(USERS)
 *                .where("email", "==", emailToStore).limit(1).get();
 *            if (!userQuery.empty) userProfile = userQuery.docs[0].data();
 *            ...
 *            isUserAdmin = isAdmin(userProfile.roles)
 *
 *        `isUserAdmin` waives the female-only participation gate. So an
 *        unauthenticated caller who types an ADMIN's email address is treated
 *        as an admin for that decision. Nobody proved anything; they knew an
 *        address.
 *
 *        This is #36's class — "adopts an application matched on a free-text
 *        email" — and #83's, which found the #36 fix had landed on WAVE only.
 *        Here it is again, in a public action, conferring a privilege.
 *
 *        THE GENDER LOOKUP STAYS. Adopting a stranger's recorded gender can
 *        only make this gate stricter or leave it unchanged — genderToValidate
 *        prefers the submitted value, and an absent one skips the gate entirely
 *        — so it carries no claim. Roles are the half that grants something,
 *        and they now come only from an authenticated session.
 *
 * WHAT IS NOT A DEFECT HERE, HAVING CHECKED
 * -----------------------------------------
 * The female-only gate never fires for an ordinary anonymous registrant,
 * because the briefing form has no gender field and the gate is skipped when no
 * gender can be resolved. That is DESIGN, not an oversight: the form's role
 * options are "Woman seeking participation", "Investor", "Cooperative member",
 * "Farm owner" and "General interest", so the briefing deliberately admits
 * people who are not women. checkWaveEligibility records the same decision for
 * the account path — "not recorded is admitted... the block exists to stop men
 * enrolling, not to refuse anyone whose profile is incomplete". Left alone.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const sendBriefingConfirmationEmail = jest.fn(async () => ({ success: true })) as jest.Mock<any>;
jest.mock('@/lib/email-notifications', () => ({
    sendBriefingConfirmationEmail: (...a: any[]) => sendBriefingConfirmationEmail(...a),
}));

const generateAndSendWhatsAppInvite = jest.fn(async () => ({ success: true })) as jest.Mock<any>;
jest.mock('@/lib/whatsapp-invites', () => ({
    generateAndSendWhatsAppInvite: (...a: any[]) => generateAndSendWhatsAppInvite(...a),
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

const mockClientIp = jest.fn(async () => '198.51.100.7') as jest.Mock<any>;
jest.mock('@/lib/rate-limiter', () => {
    const actual = jest.requireActual('@/lib/rate-limiter') as any;
    return { ...actual, getActionClientIp: () => mockClientIp() };
});

jest.mock('@/lib/logger', () => ({
    logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

let store: FakeDbHandle;

const actions = async () => await import('@/app/actions/briefing');

/** A well-formed submission. Every field the page actually sends. */
let seq = 0;
const submission = (over: Record<string, unknown> = {}) => {
    seq += 1;
    return {
        firstName: 'Ada',
        lastName: 'Obi',
        fullName: 'Ada Obi',
        email: `guest${seq}@example.com`,
        phoneNumber: `080300000${String(seq).padStart(2, '0')}`,
        state: 'Lagos',
        role: 'general',
        ...over,
    } as any;
};

const register = async (over: Record<string, unknown> = {}) =>
    (await actions()).registerForBriefingAction(submission(over)) as any;

beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.resetModules();
    seq = 0;
    store = installFakeDb();

    mockRequireSession.mockResolvedValue({ session: null, error: { error: 'No session' } });
    mockClientIp.mockResolvedValue('198.51.100.7');
    sendBriefingConfirmationEmail.mockResolvedValue({ success: true });
    generateAndSendWhatsAppInvite.mockResolvedValue({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#268 — the endpoint is metered', () => {
    it('A SINGLE CALLER CANNOT MAIL AN UNBOUNDED NUMBER OF STRANGERS', async () => {
        // The whole defect: one IP, fresh addresses, no ceiling. 40 attempts
        // against a 30/hour bucket.
        const { registerForBriefingAction } = await actions();

        const outcomes: boolean[] = [];
        for (let i = 0; i < 40; i++) {
            outcomes.push((await registerForBriefingAction(submission()) as any).success);
        }

        expect(outcomes.filter(Boolean).length).toBeLessThan(40);
        // And the send count matches: a refused call must not have mailed.
        expect(sendBriefingConfirmationEmail.mock.calls.length)
            .toBe(outcomes.filter(Boolean).length);
    });

    it('AND A REFUSED CALL SENDS NO WHATSAPP INVITE EITHER', async () => {
        // The half that is easy to forget: the limiter has to sit before BOTH
        // outbound calls, not just the email.
        const { registerForBriefingAction } = await actions();
        for (let i = 0; i < 40; i++) await registerForBriefingAction(submission());

        expect(generateAndSendWhatsAppInvite.mock.calls.length)
            .toBe(sendBriefingConfirmationEmail.mock.calls.length);
    });

    it('and it writes no registration row when it refuses', async () => {
        // Otherwise the collection fills with junk the admin briefing list
        // shows, which is the cost that outlives the flood.
        const { registerForBriefingAction } = await actions();
        for (let i = 0; i < 40; i++) await registerForBriefingAction(submission());

        expect(store.size(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS))
            .toBe(sendBriefingConfirmationEmail.mock.calls.length);
    });

    it('A DIFFERENT CALLER IS UNAFFECTED, SO ONE FLOOD CANNOT SHUT THE PAGE', async () => {
        // The key is per-caller. A shared bucket would let one script deny the
        // briefing to everybody — which is #76's shape, where eight limiters
        // shared a namespace and telemetry could block a withdrawal.
        const { registerForBriefingAction } = await actions();
        for (let i = 0; i < 40; i++) await registerForBriefingAction(submission());

        mockClientIp.mockResolvedValue('203.0.113.99');
        expect((await registerForBriefingAction(submission()) as any).success).toBe(true);
    });

    it('an ordinary single registration still works', async () => {
        // Vacuity guard. A limiter set to zero would satisfy every assertion
        // above and close the sign-up entirely.
        const res = await register();

        expect(res.success).toBe(true);
        expect(store.size(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)).toBe(1);
        expect(sendBriefingConfirmationEmail).toHaveBeenCalledTimes(1);
        expect(generateAndSendWhatsAppInvite).toHaveBeenCalledTimes(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#269 — an email is not a proof of who you are', () => {
    beforeEach(() => {
        store.seed(COLLECTIONS.USERS, 'admin-1', {
            email: 'boss@easysalesexport.com',
            roles: ['super_admin'],
            gender: 'Male',
        });
    });

    it('TYPING AN ADMIN ADDRESS DOES NOT MAKE THE CALLER AN ADMIN', async () => {
        // The defect: no session, submit the admin's address and a male
        // gender, and isUserAdmin waived the participation gate.
        const res = await register({ email: 'boss@easysalesexport.com', gender: 'male' });

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/female/i);
        expect(sendBriefingConfirmationEmail).not.toHaveBeenCalled();
    });

    it('and a real admin, signed in, is still waived through', async () => {
        // The waiver is not removed — it is moved onto proof. An admin
        // registering a stand-in from their own console is a real case.
        mockRequireSession.mockResolvedValue({
            session: { user: { id: 'admin-1', email: 'boss@easysalesexport.com', roles: ['super_admin'] } },
            error: null,
        });

        expect((await register({ gender: 'male' })).success).toBe(true);
    });

    it('a signed-in ordinary account is not waived', async () => {
        store.seed(COLLECTIONS.USERS, 'user-9', { email: 'u9@example.com', roles: ['general_user'] });
        mockRequireSession.mockResolvedValue({
            session: { user: { id: 'user-9', email: 'u9@example.com', roles: ['general_user'] } },
            error: null,
        });

        expect((await register({ gender: 'male' })).success).toBe(false);
    });

    it('THE RECORDED GENDER IS STILL CONSULTED, BECAUSE IT CANNOT WAIVE', async () => {
        // Deliberately kept. genderToValidate prefers the SUBMITTED value and
        // skips the gate entirely when nothing resolves, so adopting a
        // stranger's recorded gender can only make this stricter — it grants
        // nothing, which is what made the roles half different.
        store.seed(COLLECTIONS.USERS, 'man-1', { email: 'man@example.com', roles: ['general_user'], gender: 'Male' });

        const res = await register({ email: 'man@example.com' });

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/female/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#268/#269 — what was already right stays right', () => {
    it('refuses a second registration for the same email, before mailing', async () => {
        await register({ email: 'twice@example.com' });
        sendBriefingConfirmationEmail.mockClear();

        const second = await register({ email: 'twice@example.com' });

        expect(second.success).toBe(false);
        expect(sendBriefingConfirmationEmail).not.toHaveBeenCalled();
    });

    it('refuses a second registration for the same phone number', async () => {
        await register({ phoneNumber: '08031111111' });
        const second = await register({ phoneNumber: '08031111111' });

        expect(second.success).toBe(false);
    });

    it('still validates the submission', async () => {
        expect((await register({ email: 'not-an-email' })).success).toBe(false);
        expect((await register({ phoneNumber: '123' })).success).toBe(false);
        expect(sendBriefingConfirmationEmail).not.toHaveBeenCalled();
    });

    it('records the registration even when the email provider fails', async () => {
        // The sign-up is the thing; the confirmation is a courtesy. Losing the
        // row because Resend is down is the outcome this codebase treats as the
        // worst one everywhere it appears.
        sendBriefingConfirmationEmail.mockResolvedValue({ success: false, error: 'provider down' });

        expect((await register()).success).toBe(true);
        expect(store.size(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#268 — every public email sender is metered', () => {
    /**
     * A ratchet. Two of three were limited and the third was not, which is how
     * this survived: the rule looked applied.
     */
    const PUBLIC_SENDERS = [
        'src/app/actions/briefing.ts',
        'src/app/actions/password-reset.ts',
        'src/app/api/contact/route.ts',
    ];

    it('finds them all, so the check below is not vacuous', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        for (const f of PUBLIC_SENDERS) {
            expect(readFileSync(join(process.cwd(), f), 'utf-8').length).toBeGreaterThan(200);
        }
    });

    it('NONE OF THEM SENDS WITHOUT A LIMITER', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');

        const offenders = PUBLIC_SENDERS.filter((f) => {
            const src = readFileSync(join(process.cwd(), f), 'utf-8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .split('\n')
                .filter((l) => !l.trim().startsWith('//'))
                .join('\n');
            return !/rateLimit\(/.test(src) || !/\.check\(/.test(src);
        });

        // Was: ["src/app/actions/briefing.ts"].
        expect(offenders).toEqual([]);
    });
});
