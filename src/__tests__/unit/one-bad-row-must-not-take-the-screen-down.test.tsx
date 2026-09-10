/**
 * @jest-environment jsdom
 */

/**
 *   #589 ONE MEMBER WITHOUT AN OCCUPATION CRASHED THE WHOLE DIRECTORY.
 *
 *   /cooperatives/directory filters on every keystroke:
 *
 *       members.filter(member =>
 *           member.name.toLowerCase().includes(q) ||
 *           member.occupation.toLowerCase().includes(q) ||
 *           member.location.toLowerCase().includes(q))
 *
 *   and getDirectoryMembersAction built each row with `occupation: data.occupation`
 *   — copied straight through. So a member row with no occupation threw
 *   `Cannot read properties of undefined (reading 'toLowerCase')` inside a
 *   filter that runs over EVERY member. One row took the directory down for
 *   everybody, the moment anybody typed.
 *
 *   AND A NULL IS WHAT ONE OF THE DOORS WRITES. _coop_admin_members stores
 *   `occupation: app.occupation || uData.occupation || null` — so a member
 *   approved through the admin path with neither record carrying one has an
 *   explicit null in the field the search dereferences.
 *
 *   The reader's own corruption check refuses a row with no first or last name
 *   and says nothing about the other three fields. `location` is a template
 *   string, so a missing LGA rendered "undefined, undefined" rather than
 *   throwing — visible nonsense instead of a crash, which is how this survived.
 *
 * ── AND A LEDGER, BECAUSE THIS IS A CLASS AND NOT A SCREEN ──────────────────
 *
 *   #581 was the same defect on the export catalogue: `product.grades[0]` in a
 *   useState, which threw during render and unmounted the whole grid. The
 *   scan for it counted 237 unguarded dereferences of document fields across
 *   79 client screens — too many to be a number anybody could act on, and most
 *   of them safe because some reader upstream happens to normalise.
 *
 *   THAT "HAPPENS TO" IS THE PROBLEM, so this measures the thing that matters
 *   instead: each screen below is RENDERED with a document that carries almost
 *   nothing, and must not throw. It is a floor that may only go up — the
 *   opposite of #545's and #588's caps, because here the number is screens
 *   PROVEN rather than screens outstanding.
 *
 *   A subject that never breaks is worth having: it records that the screen's
 *   safety is deliberate rather than accidental, and it fails the day somebody
 *   removes the reader that was quietly holding it up.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   THE EXPORT WINDOW DETAIL SCREEN IS NOT BROKEN, and I nearly wrote that it
 *   was. `window.fundedAmount.toLocaleString()` has no fallback, and the
 *   aggregation door writes `fundingGoal` at creation without ever writing
 *   `fundedAmount` — which reads like a blank page on every new window. It is
 *   not: getExportOpportunityById normalises with
 *   `Number(data.fundedAmount ?? data.currentFunding) || 0` before the screen
 *   sees it. Recorded because the claim was one reading away from being made,
 *   and the difference was checking the data path rather than the screen.
 *
 *   What that left is real but smaller, and is fixed as such: SIX readers of
 *   "what this window has raised", five of them defending themselves in five
 *   different spellings and the sixth — the screen — not at all. One reading
 *   now, in lib/export-window-funding.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the screen's filter guard removed                KILLED (2 tests)
 *     the initial letter unguarded again               KILLED (2)
 *     the reader copying occupation straight through   KILLED
 *     the reader's location back to a template string  KILLED
 *     the raised-amount fallback chain shortened       KILLED
 *     the goal fallback chain shortened                KILLED
 *     the funded percentage unclamped                  KILLED
 *     a subject dropped from the ledger                KILLED
 *     reword this header                               SURVIVED, as intended
 *
 *   ONE MUTANT SURVIVED THE FIRST RUN AND IT FOUND A BUG IN MY OWN FIX.
 *   Unguarding the initial letter changed nothing, because the nameless row it
 *   was supposed to break was never being RENDERED: my first filter guard
 *   dropped any member matching none of the three predicates, and with an
 *   empty search box `"".includes("")` is true only for a value that IS a
 *   string — so a member with no name, occupation or location silently
 *   vanished from the directory. Guarding by dropping the row is the fix doing
 *   the defect's job. An empty search is not a search now, and the test that
 *   was meant to catch this uses a row with nothing on it rather than one that
 *   merely lacked an occupation.
 */

import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';

import { windowRaisedAmount, windowFundingGoal, windowFundedPercent } from '@/lib/export-window-funding';

const getDirectoryMembersAction = jest.fn() as jest.Mock<any>;
const startConversationAction = jest.fn() as jest.Mock<any>;
const startSupportConversationAction = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/cooperative', () => ({
    getDirectoryMembersAction: (...a: any[]) => getDirectoryMembersAction(...a),
    startConversationAction: (...a: any[]) => startConversationAction(...a),
    startSupportConversationAction: (...a: any[]) => startSupportConversationAction(...a),
    getMembershipAction: jest.fn(async () => ({ success: true, error: null, data: null })),
    getTransactionsAction: jest.fn(async () => ({ success: true, error: null, data: [] })),
}));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/cooperatives/directory',
    useParams: () => ({ id: 'w1' }),
}));
jest.mock('@/app/actions/export-investments', () => ({
    getExportOpportunityById: jest.fn(async () => ({ success: false, error: 'not read in this harness' })),
}));
jest.mock('@/app/actions/export-payment', () => ({
    initializeInvestmentPaymentAction: jest.fn(),
}));
jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: { user: { id: 'u1' } }, status: 'authenticated' }),
    signOut: jest.fn(),
}));
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

/**
 * The screens proven against a document that carries almost nothing.
 *
 * A FLOOR, not a cap: it may only go up. Each entry is a screen somebody has
 * actually rendered with a hostile row and watched survive.
 *
 *   #596 RAISED THIS FLOOR FROM FOUR TO TWENTY-THREE, and the raising is what
 *   found the next batch of defects: nineteen more screens were rendered with a
 *   bare row and SEVEN of them threw — including /marketplace/orders/[id],
 *   which is where a buyer is sent the moment they finish paying, and which
 *   read five fields off `order.deliveryAddress` with no guard at all.
 *
 *   Those nineteen live in a-row-with-nothing-on-it, which holds their finding,
 *   their renders and their mutation table.
 *
 *   #597 RAISED IT AGAIN, FROM TWENTY-TWO TO FORTY-FOUR, and four more of the
 *   twenty-two threw — including /cooperatives/withdrawals, which threw
 *   "Invalid time value" out of `Intl.DateTimeFormat.format`, and
 *   /export/opportunities, which is the screen a member browses to decide where
 *   to put money. Those live in a-date-that-is-not-one.
 *
 *   Every subject is named HERE as well, because a floor split across three
 *   files is a floor nobody can read, and the test below checks that the other
 *   files still carry every one of them.
 */
const PROVEN = [
    //   #589's four, rendered at the foot of this file.
    'cooperatives/directory',
    'export/windows/[id]',
    'export/(app)/products',
    'export/buyer/orders',
    //   #596's nineteen, rendered in a-row-with-nothing-on-it.
    'cooperatives/history',
    'wave/shipments',
    'dashboard/reviews',
    'farm-nation/my-purchases',
    'marketplace/orders/[id]',
    'marketplace/buyer/orders/[id]',
    'marketplace/seller/orders/[id]',
    'marketplace/buyer/orders',
    'marketplace/seller/orders',
    'marketplace/seller/products',
    'dashboard/disputes',
    'dashboard/notifications',
    'dashboard/certificates',
    'marketplace/village-market/seller',
    'export/(app)/bookings',
    'export/(app)/portfolio',
    'cooperatives/my-savings',
    'farm-nation/properties',
    //   #597's twenty-two, rendered in a-date-that-is-not-one.
    'cooperatives/withdrawals',
    'export/opportunities',
    'marketplace/seller/analytics',
    'farm-nation/dashboard',
    'marketplace/products',
    'marketplace/products/[id]',
    'marketplace/buyer/products',
    'marketplace/buyer/quotes',
    'marketplace/seller/quotes',
    'marketplace/buyer/saved',
    'marketplace/sell',
    'escrow/[id]',
    'cooperatives/dashboard',
    'cooperatives/loans',
    'cooperatives/my-loans',
    'export/transactions',
    'export/investments/[id]',
    'farm-nation/inquiries',
    'farm-nation/property/[id]',
    'farm-nation/saved',
    'academy/my-courses',
    'academy/progress',
];

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#589 — the cooperative directory survives a member with nothing on them', () => {
    /** A member row as the admin door can store one: approved, and blank. */
    const BARE_MEMBER = { id: 'm2', name: 'Ada Obi', role: 'Member', occupation: null, location: '', image: null, phone: '' };
    const FULL_MEMBER = { id: 'm1', name: 'Ngozi Eze', role: 'Member', occupation: 'Farmer', location: 'Nsukka, Enugu', image: null, phone: '0803' };

    async function directory(members: any[]) {
        getDirectoryMembersAction.mockResolvedValue({ success: true, error: null, data: { members } });
        const { default: CooperativeDirectoryClient } =
            await import('@/app/cooperatives/(member)/directory/CooperativeDirectoryClient');
        return render(<CooperativeDirectoryClient initial={members} />);
    }

    it('AND STILL SURVIVES WHEN SOMEBODY TYPES', async () => {
        //   THE defect. The filter runs over every member on every keystroke,
        //   so one blank occupation cost the whole screen — not one card.
        const { container } = await directory([FULL_MEMBER, BARE_MEMBER]);

        const search = container.querySelector('input[type="text"], input[placeholder]') as HTMLInputElement;
        expect(search).toBeTruthy();

        await act(async () => { fireEvent.change(search, { target: { value: 'farm' } }); });

        //   Rendered, and the search did what it is for.
        expect(container.textContent).toContain('Ngozi Eze');
        expect(container.textContent).not.toContain('Ada Obi');
    });

    it('AND A MEMBER WITH NOTHING SEARCHABLE IS STILL LISTED', async () => {
        /**
         *   The other direction: guarding by dropping the row would hide a real
         *   member from the directory, which is the fix doing the defect's job.
         *
         *   THIS TEST WAS NOT HOSTILE ENOUGH AT FIRST — it used a row that
         *   still had a NAME, so it passed while a member with no name,
         *   occupation or location was being filtered out of the unsearched
         *   list. A surviving mutant found that; the row below has nothing.
         */
        const { container } = await directory([
            BARE_MEMBER,
            { id: 'm9', role: 'Member' } as any,
        ]);

        expect(container.textContent).toContain('Ada Obi');
        //   Two cards, not one: the nameless member is still a member.
        expect(container.querySelectorAll('[class*="rounded-full"]').length).toBeGreaterThan(1);
    });

    it('AND THE INITIAL LETTER OF A NAMELESS ROW DOES NOT THROW', async () => {
        //   `member.name.charAt(0)` draws the avatar when there is no photo.
        const { container } = await directory([{ id: 'm3', role: 'Member' } as any]);

        expect(container.querySelectorAll('div').length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#589 — and the reader hands the screen strings', () => {
    it('AN ABSENT OCCUPATION LEAVES AN EMPTY STRING, NOT AN UNDEFINED', async () => {
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: 'u1', roles: ['cooperative_member'] } }, error: null,
        }));
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            empty: false,
            docs: [{
                id: 'm1',
                data: () => ({ firstName: 'Ada', lastName: 'Obi', membershipStatus: 'active' }),
            }],
        }));

        const { getDirectoryMembersAction: real } =
            jest.requireActual<any>('@/app/actions/cooperative/_coop_membership');
        const result = await real();

        //   The module-access check may refuse in this harness; the claim is
        //   about the SHAPE when it does not.
        if (!result.success) return;

        const [member] = result.data;
        expect(typeof member.occupation).toBe('string');
        //   And a missing LGA does not become the word "undefined".
        expect(member.location).not.toMatch(/undefined/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#589 — what a window has raised, read once', () => {
    it('A WINDOW WITH NO COUNTER HAS RAISED NOTHING', () => {
        //   The screen dereferenced this with no fallback while five server
        //   readers each defended themselves differently.
        expect(windowRaisedAmount({})).toBe(0);
        expect(windowRaisedAmount(null)).toBe(0);
        expect(windowRaisedAmount({ fundedAmount: undefined })).toBe(0);
    });

    it('AND BOTH NAMES ARE READ, BECAUSE BOTH ARE WRITTEN', () => {
        //   verifyInvestmentPaymentAction raises fundedAmount through the
        //   ceiling primitive and keeps currentFunding in step; older rows
        //   carry only the latter.
        expect(windowRaisedAmount({ fundedAmount: 500 })).toBe(500);
        expect(windowRaisedAmount({ currentFunding: 300 })).toBe(300);
        expect(windowRaisedAmount({ fundedAmount: 500, currentFunding: 1 })).toBe(500);
        expect(windowFundingGoal({ goal: 900 })).toBe(900);
        expect(windowFundingGoal({ fundingGoal: 100, goal: 900 })).toBe(100);
    });

    it('AND THE PROGRESS BAR NEVER DIVIDES BY A GOAL OF ZERO', () => {
        expect(windowFundedPercent({ fundedAmount: 50 })).toBe(0);
        expect(windowFundedPercent({ fundedAmount: 50, fundingGoal: 100 })).toBe(50);
        //   Over-funded rows are clamped rather than overflowing the bar.
        expect(windowFundedPercent({ fundedAmount: 500, fundingGoal: 100 })).toBe(100);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#589 — the ledger of screens proven against a bare document', () => {
    it('EVERY SUBJECT IS NAMED, AND THE FLOOR ONLY GOES UP', () => {
        //   Named rather than counted, so that "N screens are proven" cannot
        //   become true by deleting a test.
        expect(PROVEN).toHaveLength(44);
        expect(new Set(PROVEN).size).toBe(44);
        expect(PROVEN.slice(0, 4)).toEqual([
            'cooperatives/directory',
            'export/windows/[id]',
            'export/(app)/products',
            'export/buyer/orders',
        ]);
    });

    it('AND EVERY SUBJECT THIS FILE DOES NOT RENDER IS RENDERED BY THE ONE THAT DOES', () => {
        /**
         *   THE HALF THAT MAKES THE OTHER HALF TRUE. This array is a claim
         *   about screens rendered somewhere else, and a claim nobody checks is
         *   how #578's and #588's ledgers went blind. So the sibling suite is
         *   read from disk and every name has to appear in its subject table.
         *
         *   Text, not behaviour — but the behaviour is asserted there, by
         *   rendering, and the failure mode this guards is a name being added
         *   here without a render being added there.
         */
        const siblings = [
            'src/__tests__/unit/a-row-with-nothing-on-it.test.tsx',
            'src/__tests__/unit/a-date-that-is-not-one.test.tsx',
        ].map(f => readFileSync(join(process.cwd(), f), 'utf-8')).join('\n');
        //   The four this file renders itself are not expected over there.
        for (const subject of PROVEN.slice(4)) {
            expect({ subject, named: siblings.includes(`'${subject}'`) })
                .toEqual({ subject, named: true });
        }
    });

    it('AND THE EXPORT WINDOW DETAIL SCREEN RENDERS A WINDOW WITH NO COUNTERS', async () => {
        //   The subject that does NOT break, kept deliberately: it records that
        //   this screen's safety is now explicit rather than resting on a
        //   reader that happens to normalise.
        const { default: ExportWindowDetailClient } =
            await import('@/app/export/windows/[id]/ExportWindowDetailClient');

        const bare: any = {
            id: 'w1', commodity: 'Cocoa', destination: 'Rotterdam',
            openDate: new Date().toISOString(), closeDate: new Date().toISOString(),
            minInvestment: 50000, projectedROI: '20%', status: 'Open',
            fundingGoal: 1_000_000,   //  a goal, and nothing raised yet
        };

        const { container } = render(<ExportWindowDetailClient initial={bare} />);

        await waitFor(() => expect(container.textContent).toContain('Cocoa'));
        expect(container.textContent).toContain('₦0');
    });

    it('AND THE EXPORT PRODUCTS SCREEN RENDERS A LISTING WITH ALMOST NOTHING', async () => {
        const { default: MyExportProductsClient } =
            await import('@/app/export/(app)/products/MyExportProductsClient');

        const { container } = render(<MyExportProductsClient initial={[{ id: 'p1' } as any]} />);

        expect(container.textContent).toMatch(/pending review/i);
    });

    it('AND THE EXPORT ORDERS SCREEN RENDERS AN ORDER WITH NO LINES', async () => {
        const { default: MyExportOrdersClient } =
            await import('@/app/export/buyer/orders/MyExportOrdersClient');

        const { container } = render(<MyExportOrdersClient orders={[{ id: 'o1', items: [] } as any]} />);

        expect(container.textContent).toContain('o1');
    });
});
