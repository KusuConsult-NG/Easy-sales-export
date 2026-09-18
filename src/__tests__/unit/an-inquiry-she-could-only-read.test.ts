/**
 * @jest-environment node
 */

/**
 *   #872 MY INQUIRIES WAS A LIST SHE COULD READ AND NOTHING ELSE.
 *
 *   THE OWNER: "how does my inquiries work because i believe its not well
 *   wired."
 *
 *   MEASURED, and the report is right. A buyer asks about a parcel;
 *   submitLandInquiryAction writes the row and rings the owner's bell; the owner
 *   opens My Inquiries and reads it. There the feature ended. Nothing anywhere
 *   in this codebase wrote a reply, a status change, or any record that the
 *   owner had responded — so every inquiry sat at "pending" for ever, and the
 *   only way to answer was to copy an email address out of the screen and leave
 *   the platform.
 *
 *   The same shape as the marketplace quotes, which BuyerQuotesClient already
 *   documents in its own header: "There is no seller-response flow in this
 *   codebase."
 *
 * ── THE REPLY IS AN EMAIL, AND THE DATA FORCES THAT ─────────────────────────
 *
 *   An in-app thread is the obvious answer and it cannot work here. The intake
 *   is PUBLIC — an enquirer should not need an account, which is right — so an
 *   inquiry carries buyerName, buyerEmail and buyerPhone and NEVER a buyerId.
 *   getLandInquiryByIdAction's own guard says so and refuses to pretend
 *   otherwise: "A buyerId comparison here would be dead code that reads as
 *   though it grants the enquirer access."
 *
 *   There is no account to open a conversation with. Email is the channel the
 *   enquirer actually gave, so email is the reply.
 *
 *   EXECUTED, not scanned. The ordering below — sent first, recorded second —
 *   is the behaviour, and a source scan cannot see it.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));
jest.mock('next/cache', () => ({
    revalidateTag: () => undefined, revalidatePath: () => undefined,
    updateTag: () => undefined, unstable_cache: (fn: any) => fn,
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateAdminGlobalStats: async () => undefined,
}));

const sent: Array<{ to: unknown; subject: string; message: string; replyTo?: string }> = [];
let emailConfigured = true;
let sendFails = false;

jest.mock('@/lib/email-notifications', () => ({
    canSendEmail: (_c: string, to: unknown) =>
        emailConfigured && typeof to === 'string' && !!to.trim(),
    getBaseUrl: () => 'https://easysalesexport.com',
    sendEmailNotification: async (data: any) => {
        sent.push(data);
        return sendFails ? { success: false, error: 'Resend refused it' } : { success: true };
    },
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;

const OWNER = 'owner-1';
const INQUIRIES = COLLECTIONS.LAND_INQUIRIES;

const actAs = (id: string, roles: string[] = ['farmer']) =>
    mockRequireSession.mockResolvedValue({
        session: { user: { id, roles, email: `${id}@e.com`, name: 'Ngozi Eze' } },
        error: null,
    });

const seedInquiry = (over: Record<string, unknown> = {}) => {
    store.seed(INQUIRIES, 'inq-1', {
        id: 'inq-1',
        listingOwnerId: OWNER,
        listingTitle: '2 hectares at Ugwuoba',
        buyerName: 'Emeka Nwosu',
        buyerEmail: 'emeka@example.com',
        buyerPhone: '08040000000',
        message: 'Is the borehole working?',
        status: 'pending',
        read: false,
        ...over,
    });
};

const reply = async (text = 'Yes, it was serviced last month.') => {
    const { replyToLandInquiryAction } = await import('@/app/actions/land-listings');
    return await replyToLandInquiryAction('inq-1', text) as any;
};

const inquiry = () => store.get(INQUIRIES, 'inq-1') as Record<string, any>;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    sent.length = 0;
    emailConfigured = true;
    sendFails = false;
    actAs(OWNER);
    seedInquiry();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#872 — the owner can answer', () => {
    it('THE REPORTED GAP: a reply reaches the enquirer', async () => {
        const res = await reply();

        expect(res.success).toBe(true);
        // Was: impossible. Nothing in the codebase wrote a reply at all.
        expect(sent).toHaveLength(1);
        expect(sent[0].to).toBe('emeka@example.com');
    });

    it('AND IT CARRIES WHAT SHE WROTE AND WHICH LISTING IT IS ABOUT', async () => {
        await reply('Yes, it was serviced last month.');

        expect(sent[0].message).toContain('serviced last month');
        expect(sent[0].subject).toContain('2 hectares at Ugwuoba');
    });

    it('AND THE ENQUIRER CAN ANSWER HER BACK', async () => {
        /*
         *   The whole point of an email reply to somebody with no account: the
         *   thread continues in their inbox. Without a Reply-To it goes to the
         *   platform's own sending address and the conversation stops.
         */
        await reply();

        expect(sent[0].replyTo).toBe(`${OWNER}@e.com`);
    });

    it('AND THE INQUIRY RECORDS THAT SHE ANSWERED', async () => {
        //   An owner who answers and cannot see that she answered will answer
        //   again. This screen is how she decides whom she still owes a reply.
        await reply();

        expect(inquiry().status).toBe('replied');
        expect(inquiry().read).toBe(true);
        expect(inquiry().replies).toHaveLength(1);
        expect(inquiry().replies[0].message).toContain('serviced last month');
    });

    it('AND A SECOND REPLY IS KEPT BESIDE THE FIRST', async () => {
        await reply('First answer.');
        await reply('Second answer.');

        expect(inquiry().replies.map((r: any) => r.message))
            .toEqual(['First answer.', 'Second answer.']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#872 — and nothing is recorded that did not happen', () => {
    it('A FAILED SEND LEAVES THE INQUIRY PENDING', async () => {
        /*
         *   SENT FIRST, RECORDED SECOND, and this is why. Marking an inquiry
         *   "replied" when the email never went out tells the owner she has
         *   answered somebody she has not — on the one screen she uses to decide
         *   who is still waiting.
         */
        sendFails = true;

        const res = await reply();

        expect(res.success).toBe(false);
        expect(inquiry().status).toBe('pending');
        expect(inquiry().replies).toBeUndefined();
    });

    it('AND SO DOES AN EMAIL SERVICE THAT IS NOT CONFIGURED', async () => {
        emailConfigured = false;

        const res = await reply();

        expect(res.success).toBe(false);
        expect(sent).toHaveLength(0);
        expect(inquiry().status).toBe('pending');
    });

    it('AND AN INQUIRY WITH NO ADDRESS SAYS SO, and names what she does have', async () => {
        /*
         *   The intake takes a phone OR an email, so an inquiry can arrive with
         *   nowhere to write to. "Failed to send" would send her looking for a
         *   fault; the phone number is on the screen in front of her.
         */
        seedInquiry({ buyerEmail: '' });

        const res = await reply();

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/phone/i);
    });

    it('AND AN EMPTY REPLY IS REFUSED BEFORE ANYTHING IS SENT', async () => {
        const res = await reply('   ');

        expect(res.success).toBe(false);
        expect(sent).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#872 — and only the people who may read it may answer it', () => {
    it('A STRANGER CANNOT REPLY', async () => {
        /*
         *   Reading an enquirer's contact details and WRITING to them are the
         *   same privilege. A reply door looser than the read door would hand
         *   somebody's inbox to whoever could guess an id — and the notification
         *   sent on submission puts ids in circulation.
         */
        actAs('stranger-1', ['farmer']);

        const res = await reply();

        expect(res.success).toBe(false);
        expect(sent).toHaveLength(0);
        expect(inquiry().status).toBe('pending');
    });

    it('AND AN ADMIN CAN, matching the read door exactly', async () => {
        actAs('admin-1', ['super_admin']);

        expect((await reply()).success).toBe(true);
    });

    it('AND A CALLER WITH NO SESSION CANNOT', async () => {
        mockRequireSession.mockResolvedValue({
            session: null, error: { error: 'Authentication required' },
        });

        expect((await reply()).success).toBe(false);
        expect(sent).toHaveLength(0);
    });

    it('AND A MISSING INQUIRY IS NOT FOUND, not a crash', async () => {
        const { replyToLandInquiryAction } = await import('@/app/actions/land-listings');
        const res = await replyToLandInquiryAction('no-such-inquiry', 'hello') as any;

        expect(res.success).toBe(false);
        expect(sent).toHaveLength(0);
    });
});
