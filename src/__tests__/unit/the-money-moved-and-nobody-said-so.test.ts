/**
 * @jest-environment node
 */

/**
 *   #863 SHE LISTED HER LAND AND HEARD NOTHING. HE PAID FOR IT AND HEARD
 *   NOTHING. SHE WAS NOT TOLD IT WAS SOLD.
 *
 *   THE OWNER: "After listing notification email to be sent and also after a
 *   transaction."
 *
 *   MEASURED, both halves:
 *
 *     THE LISTING   submitLandListingAction rang the bell — "Your land listing
 *                   has been submitted for verification" — and sent no email.
 *                   A seller who submits a form and closes the tab, which is
 *                   what submitting a form usually means, had no record that
 *                   it arrived anywhere.
 *
 *     THE PAYMENT   lib/property-purchase-fulfilment.ts, the ONE place a Farm
 *                   Nation property payment completes — deliberately extracted
 *                   so the Paystack callback and the webhook cannot answer the
 *                   same payment differently (#721) — contained no
 *                   notification of any kind. A status, a ledger row, a
 *                   payments row, an escrow flag, and not one word to either
 *                   party.
 *
 *   THE SELLER'S HALF IS THE ONE THAT WAS MISSING ENTIRELY. A buyer at least
 *   sees the callback page when the callback door runs. The seller has no page
 *   in this flow: her land is sold, the money is held, and the only record is a
 *   status on a row she would have to go looking for. When the WEBHOOK door
 *   runs — a buyer who closed the tab, which is the case #721 exists for —
 *   nobody saw anything at all.
 *
 * ── AND THE LISTING NOTICE SAYS THE PART IT USED TO LEAVE OUT ───────────────
 *
 *   That the listing is NOT visible to buyers yet. #856 is why that matters:
 *   until it, an unverified listing wore a "Verified Land" badge, so a seller
 *   had every reason to believe she was live. Telling her it is under review is
 *   the other half of that repair, and it is asserted below rather than left to
 *   the wording.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

jest.mock('next/cache', () => ({
    revalidateTag: () => undefined,
    revalidatePath: () => undefined,
    unstable_cache: (fn: any) => fn,
}));

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: jest.fn(async () => undefined),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));

/** Whether markFulfilmentFailed was reached — the thing a throw here would cost. */
const markedFailed: string[] = [];
jest.mock('@/lib/wallet-ledger', () => ({
    markFulfilmentFailed: async (reference: string) => { markedFailed.push(reference); },
}));

const sent: Array<{ to: unknown; subject: string; message: string }> = [];
let emailWorks = true;

jest.mock('@/lib/email-notifications', () => ({
    canSendEmail: (_context: string, to: unknown) => typeof to === 'string' && !!to.trim(),
    getBaseUrl: () => 'https://easysalesexport.com',
    sendEmailNotification: async (data: any) => {
        sent.push(data);
        if (!emailWorks) throw new Error('Resend is down');
        return { success: true };
    },
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;

const SELLER = 'seller-1';
const BUYER = 'buyer-1';
const NOTIFICATIONS = COLLECTIONS.NOTIFICATIONS;

/** Every in-app notice written during the run. */
const notices = () => store.all(NOTIFICATIONS).map(([, d]) => d as Record<string, any>);
const noticeFor = (userId: string) => notices().filter((n) => n.userId === userId);

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    sent.length = 0;
    markedFailed.length = 0;
    emailWorks = true;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#863 — a seller hears that her listing arrived', () => {
    const asSeller = () => mockRequireSession.mockResolvedValue({
        session: {
            user: {
                id: SELLER, email: 'ngozi@example.com', name: 'Ngozi Eze',
                roles: ['farmer'],
                serviceRegistrations: { farmNation: { status: 'approved' } },
            },
        },
        error: null,
    });

    const submit = async (over: Record<string, unknown> = {}) => {
        const { submitLandListingAction } = await import('@/app/actions/land-listings');
        return await submitLandListingAction({
            ownerId: SELLER,
            ownerName: 'Ngozi Eze',
            ownerEmail: 'ngozi@example.com',
            title: '2 hectares at Ugwuoba',
            description: 'Cleared farmland with road access.',
            location: { state: 'Enugu', lga: 'Oji River', address: 'Ugwuoba' },
            size: 2,
            price: 5_000_000,
            imageUrls: [],
            documentUrls: ['https://files/cofo.pdf'],
            ...over,
        } as never) as any;
    };

    beforeEach(() => {
        asSeller();
        store.seed(COLLECTIONS.USERS, SELLER, {
            email: 'ngozi@example.com',
            roles: ['farmer'],
            serviceRegistrations: { farmNation: { status: 'approved' } },
        });
    });

    it('THE REPORTED GAP: the submission sends an email', async () => {
        const res = await submit();

        expect(res.success).toBe(true);
        // Was: zero. The bell rang and nothing else happened.
        expect(sent).toHaveLength(1);
        expect(sent[0].to).toBe('ngozi@example.com');
    });

    it('AND STILL RINGS THE BELL', async () => {
        //   The half that must not regress while adding the other.
        await submit();

        expect(noticeFor(SELLER)).toHaveLength(1);
    });

    it('AND BOTH NAME THE LISTING', async () => {
        await submit();

        expect(noticeFor(SELLER)[0].message).toContain('2 hectares at Ugwuoba');
        expect(sent[0].message).toContain('2 hectares at Ugwuoba');
    });

    it('AND BOTH SAY IT IS NOT VISIBLE TO BUYERS YET', async () => {
        /*
         *   #856's other half. Until that finding, an unverified listing wore a
         *   "Verified Land" badge — so a seller had every reason to think she
         *   was live, and the notice that could have corrected her did not say.
         */
        await submit();

        expect(noticeFor(SELLER)[0].message).toContain('not visible to buyers');
        expect(sent[0].message).toContain('not visible to buyers');
    });

    it("AND SEND HER TO HER OWN LISTINGS, not to the page that would refuse her", async () => {
        /*
         *   The public property page is the one screen that will not show a
         *   listing an admin has not verified — which is every listing at this
         *   moment. A Farm Nation seller belongs on /farm-nation/my-properties;
         *   /land/submit, which has no per-listing page at all, keeps "/land".
         */
        await submit({ manageLink: '/farm-nation/my-properties' });

        expect(noticeFor(SELLER)[0].link).toBe('/farm-nation/my-properties');
        expect(sent[0].message).toContain('https://easysalesexport.com/farm-nation/my-properties');
    });

    it('AND THE OTHER MODULE KEEPS THE LINK IT HAD', async () => {
        //   /land/submit passes none, and "/land" is what the notice said
        //   before this parameter existed.
        await submit();

        expect(noticeFor(SELLER)[0].link).toBe('/land');
    });

    it('AND THE FARM NATION FORM ACTUALLY PASSES ITS OWN', async () => {
        /*
         *   A parameter with a default is a parameter nobody has to pass, and a
         *   caller that forgets gets the other module's link silently. Read from
         *   source because it is a fact about the caller, not about this run.
         */
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');
        const rel = 'src/app/farm-nation/(member)/list-land/page.tsx';
        const src = stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

        expect(src).toContain('manageLink: "/farm-nation/my-properties"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#863 — and both parties hear that the money moved', () => {
    const REFERENCE = 'PS-REF-001';

    const seedPaidProperty = (over: Record<string, unknown> = {}) => {
        store.seed(COLLECTIONS.LAND_LISTINGS, 'land-1', {
            id: 'land-1',
            title: '2 hectares at Ugwuoba',
            ownerId: SELLER,
            price: 5_000_000,
            status: 'pending_escrow',
            ...over,
        });
        store.seed(COLLECTIONS.USERS, SELLER, { email: 'ngozi@example.com' });
        store.seed(COLLECTIONS.USERS, BUYER, { email: 'emeka@example.com' });
        store.seed(COLLECTIONS.FARM_NATION_TRANSACTIONS, 'tx-1', {
            id: 'tx-1',
            paymentReference: REFERENCE,
            propertyPrice: 5_000_000,
            buyerId: BUYER,
            buyerEmail: 'emeka@example.com',
            sellerId: SELLER,
            status: 'pending_payment',
        });
    };

    const fulfil = async (over: Record<string, unknown> = {}) => {
        const { fulfilPropertyPurchase } = await import('@/lib/property-purchase-fulfilment');
        return await fulfilPropertyPurchase({
            reference: REFERENCE,
            amountInNaira: 5_000_000,
            buyerId: BUYER,
            propertyId: 'land-1',
            ...over,
        } as never);
    };

    it('THE REPORTED GAP: the buyer is told', async () => {
        seedPaidProperty();

        await fulfil();

        // Was: zero notices, either channel, either party.
        expect(noticeFor(BUYER)).toHaveLength(1);
        expect(sent.some((e) => e.to === 'emeka@example.com')).toBe(true);
    });

    it('AND SO IS THE SELLER, who had no page in this flow at all', async () => {
        seedPaidProperty();

        await fulfil();

        expect(noticeFor(SELLER)).toHaveLength(1);
        expect(sent.some((e) => e.to === 'ngozi@example.com')).toBe(true);
    });

    it("AND BOTH ARE TOLD IT IS HELD IN ESCROW, not paid out", async () => {
        /*
         *   The fact that decides what each of them does next. The seller who
         *   believes she has been paid hands over the documents; the buyer who
         *   believes the seller has the money has no idea what he is waiting
         *   for.
         */
        seedPaidProperty();

        await fulfil();

        expect(noticeFor(BUYER)[0].message).toContain('escrow');
        expect(noticeFor(SELLER)[0].message).toContain('escrow');
        for (const email of sent) expect(email.message).toContain('escrow');
    });

    it('AND THE BUYER GETS THE REFERENCE AND THE AMOUNT', async () => {
        //   The reference is what identifies this payment in any query he ever
        //   raises about it, and it exists nowhere he can see.
        seedPaidProperty();

        await fulfil();

        const email = sent.find((e) => e.to === 'emeka@example.com')!;
        expect(noticeFor(BUYER)[0].message).toContain(REFERENCE);
        expect(email.message).toContain(REFERENCE);
        expect(email.message).toContain('5,000,000');
    });

    it('AND THE SELLER IS TOLD THE PRICE', async () => {
        seedPaidProperty();

        await fulfil();

        expect(noticeFor(SELLER)[0].message).toContain('5,000,000');
    });

    it('AND THE WEBHOOK DOOR, WITH NO SESSION, STILL REACHES THE BUYER', async () => {
        /*
         *   The case this module exists for: a buyer who paid and closed the
         *   tab. The webhook carries no session and so no address — it comes off
         *   the purchase record, which is the read this function already does.
         */
        seedPaidProperty();

        await fulfil({ buyerEmail: undefined });

        expect(sent.some((e) => e.to === 'emeka@example.com')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#863 — and telling them can never unmake the payment', () => {
    const REFERENCE = 'PS-REF-002';

    const seedPaidProperty = (over: Record<string, unknown> = {}) => {
        store.seed(COLLECTIONS.LAND_LISTINGS, 'land-2', {
            id: 'land-2', title: 'Plot 4', ownerId: SELLER,
            price: 1_000_000, status: 'pending_escrow', ...over,
        });
        store.seed(COLLECTIONS.USERS, SELLER, { email: 'ngozi@example.com' });
        store.seed(COLLECTIONS.FARM_NATION_TRANSACTIONS, 'tx-2', {
            id: 'tx-2', paymentReference: REFERENCE, propertyPrice: 1_000_000,
            buyerId: BUYER, buyerEmail: 'emeka@example.com', status: 'pending_payment',
        });
    };

    const fulfil = async (over: Record<string, unknown> = {}) => {
        const { fulfilPropertyPurchase } = await import('@/lib/property-purchase-fulfilment');
        return await fulfilPropertyPurchase({
            reference: REFERENCE, amountInNaira: 1_000_000,
            buyerId: BUYER, propertyId: 'land-2', ...over,
        } as never);
    };

    it('A DEAD EMAIL SERVICE DOES NOT MARK THE PAYMENT UNFULFILLED', async () => {
        /*
         *   THE RULE THIS SECTION EXISTS FOR, and the reason the notices are
         *   wrapped rather than trusted. A throw from the notices reaches this
         *   function's catch, which calls markFulfilmentFailed on a payment that
         *   WAS fulfilled and rethrows — so the webhook answers 500 and Paystack
         *   retries a delivered purchase.
         */
        seedPaidProperty();
        emailWorks = false;

        await expect(fulfil()).resolves.toEqual({ propertyId: 'land-2' });

        expect(markedFailed).toEqual([]);
        expect(store.get(COLLECTIONS.LAND_LISTINGS, 'land-2')!.escrowHeldAt).toBeDefined();
        expect(store.get(COLLECTIONS.FARM_NATION_TRANSACTIONS, 'tx-2')!.status)
            .toBe('payment_confirmed');
    });

    it('AND A LISTING WITH NO OWNER STILL PAYS AND STILL TELLS THE BUYER', async () => {
        /*
         *   A sale has completed against a parcel nobody is recorded as owning.
         *   That is worth a log line and somebody's attention — it is not a
         *   reason to leave the buyer unnotified as well.
         *
         *   THIS, NOT THE `allSettled`, IS WHAT MAKES THAT TRUE. The first
         *   version of the notifier's comment credited `Promise.allSettled`;
         *   mutation-testing swapped it for `Promise.all` and no test moved,
         *   because every leaf already swallows and neither branch can reject.
         *   The guarantee is the early return on a missing seller, which is
         *   what this pins.
         */
        seedPaidProperty({ ownerId: undefined });

        await expect(fulfil()).resolves.toEqual({ propertyId: 'land-2' });

        expect(noticeFor(SELLER)).toHaveLength(0);
        expect(noticeFor(BUYER)).toHaveLength(1);
    });

    it('AND AN UNDERPAYMENT IS STILL REFUSED, and announces nothing', async () => {
        /*
         *   The notices sit after every write, so a fulfilment that throws
         *   before them tells nobody a purchase completed. Same ordering rule as
         *   #862's dispatch, in the place where it costs the most.
         */
        seedPaidProperty();

        await expect(fulfil({ amountInNaira: 10 })).rejects.toThrow(/does not cover/);

        expect(markedFailed).toEqual([REFERENCE]);
        expect(notices()).toHaveLength(0);
        expect(sent).toHaveLength(0);
    });
});
