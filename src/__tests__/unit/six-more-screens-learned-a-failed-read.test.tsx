/**
 * @jest-environment jsdom
 */

/**
 *   #592 SIX MORE SCREENS LEARNED THE DIFFERENCE BETWEEN "NOTHING" AND "COULD
 *        NOT READ" — AND THE INSTRUMENT THAT COUNTS THEM WAS OVER-COUNTING BY
 *        ONE.
 *
 *   #588 measured this class, capped it at 35, and drove it to 30 with a first
 *   batch of five. This is the second batch. The six are the ones where being
 *   told your things are gone costs something:
 *
 *     dashboard/wallet          "No transactions yet. Fund your wallet to get
 *                               started" — over a wallet whose history could not
 *                               be read, NEXT TO A BALANCE that says money has
 *                               moved. `loadTransactions` gated on
 *                               `res.success && res.data?.transactions` and had
 *                               NO else and NO try at all: a refusal drew the
 *                               empty state, and a rejection also skipped
 *                               `setTxLoading(false)` and left the history
 *                               spinning for as long as the page stayed open.
 *                               That second half is #407's shape, two modals
 *                               down the same file.
 *
 *     dashboard/disputes        "No Disputes. You have no disputes" with a
 *                               button to open one. A dispute is money held in
 *                               escrow and not released; telling somebody who
 *                               filed one that they did not invites them to file
 *                               it twice, and suggests the claim they made
 *                               against a seller was never recorded.
 *
 *     escrow/[id]/chat          "No messages yet. Start the conversation" — on
 *                               the record a buyer and a seller build about a
 *                               consignment, and the one an admin reads before
 *                               releasing or refunding the money.
 *
 *     wave/shipments            "No Shipments Yet. Your shipments will appear
 *                               here once orders are placed", over goods on a
 *                               lorry. THIS SCREEN WROTE THE FAILURE IN rather
 *                               than merely failing to record it — `setShipments
 *                               ([])` in the else AND in the catch — which is
 *                               the loudest version of the defect, and the same
 *                               thing #588 found on the cooperative savings
 *                               screen.
 *
 *     dashboard/certificates    "No Academy certificates yet — complete courses
 *                               in the Academy to earn verifiable certificates",
 *                               on the tab this screen OPENS on. Two lists, two
 *                               endpoints, two independent failures.
 *
 *     export/products           "No Products Yet. You haven't submitted any
 *                               products for export yet" — and a duplicate
 *                               export listing is a duplicate consignment.
 *
 * ── AND THE COUNT ITSELF WAS WRONG, BY ONE, IN THE DIRECTION THAT FLATTERS ──
 *
 *   AUDIT THE INSTRUMENT BEFORE BELIEVING THE MEASUREMENT. Working through the
 *   thirty, MessagesClient turned out to distinguish already and to have done so
 *   for some time: it keeps a `listError`, shows "This list may be out of date"
 *   over a list it could not refresh, and its empty state is
 *
 *       conversations.length === 0 && !listError ? "No conversations yet" : …
 *
 *   which is exactly the reading this ratchet asks for. #588's predicate missed
 *   it because it accepted the literal spelling `setError(` and the identifier
 *   `error` and nothing else, so a screen that named its state `listError` read
 *   as an offender.
 *
 *   THE OBVIOUS WIDENING WAS TRIED FIRST AND REJECTED. Accepting any
 *   `set*Error(` excuses ProfileClient's `setPasswordError` and FinancialStep's
 *   `setBvnError` — form errors that say nothing about whether a list was read —
 *   and accepting any `*Error &&` does the same. Measured: it would have swapped
 *   one false positive for nineteen false negatives, taking the count from 30 to
 *   48 offenders under a stricter reading and excusing screens this audit fixed
 *   by hand.
 *
 *   So the new clause is narrow and about USE, not spelling: an empty-state
 *   condition that itself consults an error. `conversations.length === 0 &&
 *   !listError ?` distinguishes; a `setPasswordError` in a modal does not. Net
 *   effect on the count: exactly one screen, verified by hand, and the six here.
 *   35 → 30 → 23.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   NO READ WAS MADE MORE RELIABLE. Every one of these screens still fails
 *   exactly as often as it did; what changed is what it says when it does.
 *
 *   THE POLLING SCREENS ONLY BLANK AN EMPTY LIST. Disputes polls every ten
 *   seconds and the escrow chat every five, so `loadFailed && list.length === 0`
 *   is the condition on both: a single failed tick over rows already on screen
 *   leaves them alone. That is MessagesClient's precedent, and the reason it is
 *   not in the count.
 *
 *   TWO COUNTS WERE HIDDEN AS WELL AS TWO LISTS, and that is deliberate: the
 *   shipments screen's four stat cards and the certificates screen's "(0)" are
 *   derived entirely from the list that failed to load, so leaving them would
 *   have kept the same claim in a smaller font.
 *
 *   MUTATION-TESTED, WITH A CONTROL — see the table at the foot of this file.
 *
 *   AND THE MOCKS ARE HOISTED, NEVER jest.doMock. doMock needs
 *   jest.resetModules(), which re-instantiates React for anything imported after
 *   it, and the component then renders against a different React than this file
 *   holds: "Cannot read properties of null (reading 'useState')". #579, #587 and
 *   #588 each lost tests to that; it is written down in #588's header too.
 */

import React from 'react';
import { render, waitFor, act, fireEvent } from '@testing-library/react';

const getUserExportProductsAction = jest.fn() as jest.Mock<any>;
const getShipmentTrackingAction = jest.fn() as jest.Mock<any>;
const getMyDisputes = jest.fn() as jest.Mock<any>;
const getWalletAction = jest.fn() as jest.Mock<any>;
const getWalletTransactionsAction = jest.fn() as jest.Mock<any>;
const getEscrowMessagesAction = jest.fn() as jest.Mock<any>;
const getEscrowTransactionByIdAction = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/export-products', () => ({
    getUserExportProductsAction: (...a: any[]) => getUserExportProductsAction(...a),
    deleteExportProductAction: jest.fn(),
}));
jest.mock('@/app/actions/wave', () => ({
    getShipmentTrackingAction: (...a: any[]) => getShipmentTrackingAction(...a),
    calculateEarningsAction: jest.fn(),
    withdrawEarningsAction: jest.fn(),
}));
jest.mock('@/app/actions/my-data', () => ({
    getMyDisputes: (...a: any[]) => getMyDisputes(...a),
}));
jest.mock('@/app/actions/wallet', () => ({
    getWalletAction: (...a: any[]) => getWalletAction(...a),
    getWalletTransactionsAction: (...a: any[]) => getWalletTransactionsAction(...a),
    fundWalletViaPaystackAction: jest.fn(),
    withdrawFromWalletAction: jest.fn(),
}));
jest.mock('@/app/actions/health', () => ({
    getFeatureTogglesAction: jest.fn(async () => ({ success: true, error: null, data: {} })),
}));
jest.mock('@/app/actions/marketplace', () => ({
    getEscrowMessagesAction: (...a: any[]) => getEscrowMessagesAction(...a),
    getEscrowTransactionByIdAction: (...a: any[]) => getEscrowTransactionByIdAction(...a),
    sendEscrowMessageAction: jest.fn(),
}));
jest.mock('@/app/actions/messages', () => ({
    startSupportConversationAction: jest.fn(),
}));
jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast: jest.fn() }),
}));
jest.mock('next-auth/react', () => ({
    useSession: () => ({
        data: { user: { id: 'u1', name: 'Ada', email: 'ada@example.com', roles: [] } },
        status: 'authenticated',
    }),
}));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/',
    useParams: () => ({ id: 'esc-1' }),
}));
jest.mock('@/hooks/useFirebaseAuthed', () => ({
    useFirebaseAuthed: () => ({ ready: true, user: { uid: 'u1' } }),
}));
jest.mock('@/hooks/use-storage', () => ({
    useStorage: () => ({ uploadFile: jest.fn(), uploadState: { progress: 0 } }),
}));

/** The panel's own two sentences, as the person reading the screen sees them. */
const FAILED = /we could not load/i;
const NOTHING_IS_LOST = /nothing is lost/i;

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#592 — the wallet', () => {
    async function wallet() {
        getWalletAction.mockResolvedValue({
            success: true, error: null,
            data: { balance: 25_000, pendingBalance: 0, bankDetails: null },
        });
        const { default: WalletClient } = await import('@/app/dashboard/wallet/WalletClient');
        return render(<WalletClient initial={null} />);
    }

    it('A HISTORY THAT COULD NOT BE READ IS NOT "No transactions yet"', async () => {
        getWalletTransactionsAction.mockResolvedValue({ success: false, error: 'unavailable', data: null });

        const { container } = await wallet();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).toMatch(NOTHING_IS_LOST);
        expect(container.textContent).not.toMatch(/no transactions yet|fund your wallet to get started/i);
    });

    it('AND A REJECTED READ IS THE SAME, AND STOPS THE SPINNER', async () => {
        //   The other half of #407's shape: there was no try around this call,
        //   so a rejection skipped setTxLoading(false) and the history span for
        //   as long as the page was open.
        getWalletTransactionsAction.mockRejectedValue(new Error('network down'));

        const { container } = await wallet();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.querySelectorAll('.animate-spin')).toHaveLength(0);
    });

    it('AND A GENUINELY EMPTY HISTORY STILL SAYS SO', async () => {
        //   THE vacuity guard. A screen that showed the failure panel over every
        //   empty list would be the same defect wearing the fix's clothes.
        getWalletTransactionsAction.mockResolvedValue({
            success: true, error: null, data: { transactions: [], hasMore: false },
        });

        const { container } = await wallet();

        await waitFor(() => expect(container.textContent).toMatch(/no transactions yet/i));
        expect(container.textContent).not.toMatch(FAILED);
    });

    it('AND A HISTORY THAT READS SHOWS THE ROWS', async () => {
        getWalletTransactionsAction.mockResolvedValue({
            success: true, error: null,
            data: {
                transactions: [{
                    id: 't1', amount: -5000, description: 'Withdrawal to GTBank',
                    type: 'withdrawal', status: 'success', createdAt: new Date().toISOString(),
                }],
                hasMore: false,
            },
        });

        const { container } = await wallet();

        await waitFor(() => expect(container.textContent).toContain('Withdrawal to GTBank'));
        expect(container.textContent).not.toMatch(FAILED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#592 — the disputes screen', () => {
    async function disputes() {
        const { default: DisputesClient } = await import('@/app/dashboard/disputes/DisputesClient');
        return render(<DisputesClient initial={null} />);
    }

    it('A READ THAT THREW IS NOT "You have no disputes"', async () => {
        getMyDisputes.mockRejectedValue(new Error('firestore unavailable'));

        const { container } = await disputes();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/you have no disputes|open a dispute/i);
    });

    it('AND SOMEBODY WITH NO DISPUTES IS STILL TOLD SO', async () => {
        getMyDisputes.mockResolvedValue([]);

        const { container } = await disputes();

        await waitFor(() => expect(container.textContent).toMatch(/no disputes/i));
        expect(container.textContent).not.toMatch(FAILED);
    });

    it('AND A FAILED POLL OVER A LIST ALREADY ON SCREEN LEAVES IT THERE', async () => {
        /**
         *   The rule this screen shares with the escrow chat and with
         *   MessagesClient, which is why none of them may simply blank on a
         *   failure: they POLL. One bad tick every ten seconds must not replace
         *   a dispute list that loaded fine a moment ago.
         */
        getMyDisputes.mockResolvedValueOnce([{
            id: 'd1', orderId: 'o1', buyerId: 'u1', title: 'Wrong quantity delivered',
            description: 'Short by 3 bags', status: 'open', createdAt: new Date(),
        }]);
        getMyDisputes.mockRejectedValue(new Error('poll failed'));

        const { container } = await disputes();

        await waitFor(() => expect(container.textContent).toContain('Wrong quantity delivered'));
        //   Let at least one failing tick land.
        await new Promise(r => setTimeout(r, 0));
        expect(container.textContent).toContain('Wrong quantity delivered');
        expect(container.textContent).not.toMatch(FAILED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#592 — the escrow chat', () => {
    async function chat() {
        getEscrowTransactionByIdAction.mockResolvedValue({
            success: true, error: null,
            data: { id: 'esc-1', buyerId: 'u1', sellerId: 's1', amount: 120_000, status: 'funded' },
        });
        const { default: EscrowChatClient } =
            await import('@/app/escrow/[id]/chat/EscrowChatClient');
        return render(<EscrowChatClient escrowId="esc-1" initial={null} />);
    }

    it('A CONVERSATION THAT COULD NOT BE READ IS NOT AN EMPTY ONE', async () => {
        getEscrowMessagesAction.mockResolvedValue({ success: false, error: 'unavailable', data: null });

        const { container } = await chat();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no messages yet|start the conversation/i);
    });

    it('AND A THROWN READ IS THE SAME', async () => {
        getEscrowMessagesAction.mockRejectedValue(new Error('network down'));

        const { container } = await chat();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no messages yet/i);
    });

    it('AND A CHAT NOBODY HAS WRITTEN IN STILL INVITES THE FIRST MESSAGE', async () => {
        getEscrowMessagesAction.mockResolvedValue({ success: true, error: null, data: [] });

        const { container } = await chat();

        await waitFor(() => expect(container.textContent).toMatch(/no messages yet/i));
        expect(container.textContent).not.toMatch(FAILED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#592 — the shipments screen, which wrote the failure in', () => {
    async function shipments() {
        const { default: WaveShipmentsClient } =
            await import('@/app/wave/(member)/shipments/WaveShipmentsClient');
        return render(<WaveShipmentsClient initial={null} />);
    }

    it('A FAILED READ IS NOT "No Shipments Yet"', async () => {
        getShipmentTrackingAction.mockResolvedValue({ success: false, error: 'unavailable', data: null });

        const { container } = await shipments();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no shipments yet|once orders are placed/i);
    });

    it('AND THE FOUR COUNTS DO NOT READ ZERO OVER IT', async () => {
        //   Every one of Total / Pending / In Transit / Delivered is derived
        //   from the list that failed to load. Left in, they make the same claim
        //   the empty state made, in a smaller font.
        getShipmentTrackingAction.mockRejectedValue(new Error('network down'));

        const { container } = await shipments();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/in transit|delivered|total shipments/i);
    });

    it('AND A MEMBER WITH NO SHIPMENTS SEES THE COUNTS AND THE EMPTY STATE', async () => {
        getShipmentTrackingAction.mockResolvedValue({ success: true, error: null, data: [] });

        const { container } = await shipments();

        await waitFor(() => expect(container.textContent).toMatch(/no shipments yet/i));
        expect(container.textContent).toMatch(/total shipments/i);
        expect(container.textContent).not.toMatch(FAILED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#592 — the certificates screen, where the two lists fail apart', () => {
    /** The screen opens on the academy tab; this asks for the other half. */
    async function openUploadedTab(container: HTMLElement) {
        const tab = Array.from(container.querySelectorAll('button'))
            .find(b => /uploaded docs/i.test(b.textContent || ''));
        if (!tab) throw new Error('the Uploaded Docs tab is gone — this test is measuring nothing');
        await act(async () => { fireEvent.click(tab); });
    }

    async function certificates(uploaded: any, academy: any) {
        (global as any).fetch = jest.fn(async (url: string) =>
            String(url).includes('academy')
                ? { ok: true, json: async () => academy }
                : { ok: true, json: async () => uploaded }
        );
        const { default: CertificatesClient } =
            await import('@/app/dashboard/certificates/CertificatesClient');
        return render(<CertificatesClient initial={null} />);
    }

    async function certificatesWithNetworkDown() {
        (global as any).fetch = jest.fn(async () => { throw new Error('network down'); });
        const { default: CertificatesClient } =
            await import('@/app/dashboard/certificates/CertificatesClient');
        return render(<CertificatesClient initial={null} />);
    }

    it('AND A NETWORK THAT IS DOWN FAILS BOTH, BECAUSE NEITHER WAS READ', async () => {
        /**
         *   A SURVIVING MUTANT IS WHY THIS TEST EXISTS. Emptying the shared
         *   `catch` — the one that covers the `Promise.all` around both fetches
         *   — changed nothing, because every other test in this describe mocks
         *   `fetch` to RESOLVE with a `{ success: false }` body. The refusal path
         *   was covered from three angles and the throw path from none.
         *
         *   Both flags are set there deliberately: the two requests are in one
         *   Promise.all, so a throw means neither list was read, not that either
         *   is empty.
         */
        const { container } = await certificatesWithNetworkDown();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no academy certificates yet/i);

        await openUploadedTab(container);
        expect(container.textContent).toMatch(FAILED);
        expect(container.textContent).not.toMatch(/no documents yet/i);
    });

    it('A LEARNER WHOSE ACADEMY CERTIFICATES COULD NOT BE READ IS NOT TOLD TO GO EARN SOME', async () => {
        const { container } = await certificates(
            { success: true, certificates: [] },
            { success: false, error: 'unavailable' },
        );

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no academy certificates yet/i);
    });

    it('AND NEITHER DOES THE COUNT BESIDE IT', async () => {
        //   "Academy Certificates (0)" is the empty state again, in a smaller
        //   font, and it sits directly above the panel.
        const { container } = await certificates(
            { success: true, certificates: [] },
            { success: false, error: 'unavailable' },
        );

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).toContain('Academy Certificates');
        expect(container.textContent).not.toContain('Academy Certificates (0)');
    });

    it('AND THE OTHER LIST IS NOT BLAMED FOR IT', async () => {
        /**
         *   ONE FLAG FOR TWO ENDPOINTS WOULD HAVE BEEN THE BUG AGAIN. #563 is
         *   this screen's own history: the academy half was empty on every load
         *   while the uploaded half worked, because the two replies do not have
         *   the same shape. They fail independently too, so they are tracked
         *   independently.
         *
         *   The two halves are TABS, and "academy" is the one this screen opens
         *   on — which is why #563 mattered — so the uploaded half has to be
         *   asked for.
         */
        const { container } = await certificates(
            { success: true, certificates: [] },
            { success: false, error: 'unavailable' },
        );

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        await openUploadedTab(container);

        expect(container.textContent).toMatch(/no documents yet/i);
        //   No panel at all on the half that read fine.
        expect(container.textContent).not.toMatch(FAILED);
        expect(container.textContent).toContain('Your Uploaded Documents (0)');
    });

    it('AND WHEN BOTH FAIL, BOTH SAY SO — AND NEITHER SHOWS A COUNT OF ZERO', async () => {
        const { container } = await certificates(
            { success: false, error: 'unavailable' },
            { success: false, error: 'unavailable' },
        );

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        await openUploadedTab(container);

        expect(container.textContent).toMatch(FAILED);
        expect(container.textContent).toContain('Your Uploaded Documents');
        expect(container.textContent).not.toContain('Your Uploaded Documents (0)');
    });

    it('AND A LEARNER WITH NO CERTIFICATES AT ALL IS TOLD THAT, NOT THIS', async () => {
        const { container } = await certificates(
            { success: true, certificates: [] },
            { success: true, data: { certificates: [] } },
        );

        await waitFor(() => expect(container.textContent).toMatch(/no academy certificates yet/i));
        expect(container.textContent).not.toMatch(FAILED);
        expect(container.textContent).toContain('Academy Certificates (0)');

        await openUploadedTab(container);
        expect(container.textContent).toMatch(/no documents yet/i);
        expect(container.textContent).not.toMatch(FAILED);
        expect(container.textContent).toContain('Your Uploaded Documents (0)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#592 — the export seller\'s own products', () => {
    async function products() {
        const { default: MyExportProductsClient } =
            await import('@/app/export/(app)/products/MyExportProductsClient');
        return render(<MyExportProductsClient initial={null} />);
    }

    it('AN EXPORTER IS NOT INVITED TO SUBMIT A PRODUCT THEY MAY ALREADY HAVE LISTED', async () => {
        getUserExportProductsAction.mockResolvedValue({ success: false, error: 'unavailable', data: null });

        const { container } = await products();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no products yet|submit first product/i);
    });

    it('AND A THROWN READ IS THE SAME', async () => {
        getUserExportProductsAction.mockRejectedValue(new Error('network down'));

        const { container } = await products();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no products yet/i);
    });

    it('AND AN EXPORTER WITH NOTHING LISTED IS STILL INVITED TO LIST', async () => {
        getUserExportProductsAction.mockResolvedValue({ success: true, error: null, data: [] });

        const { container } = await products();

        await waitFor(() => expect(container.textContent).toMatch(/no products yet/i));
        expect(container.textContent).not.toMatch(FAILED);
    });
});

/**
 * ── THE MUTATION TABLE ──────────────────────────────────────────────────────
 *
 *   Against a green baseline, one anchored swap at a time, each restored and
 *   verified with `diff -q` before the next:
 *
 *     wallet: the else branch dropped                   KILLED
 *     wallet: the panel branch removed                  KILLED (2 tests)
 *     wallet: the new catch stops recording             KILLED
 *     wallet: the flag set on success too               KILLED (the vacuity guard)
 *     disputes: the catch stops recording again         KILLED
 *     disputes: the guard dropped to `loadFailed` alone KILLED (the poll test)
 *     escrow chat: the else branch removed              KILLED
 *     escrow chat: the catch stops recording            KILLED
 *     shipments: setShipments([]) restored in the catch KILLED
 *     shipments: the stats grid unhidden                KILLED
 *     shipments: the panel branch removed               KILLED (2)
 *     certificates: one flag shared by both lists       KILLED
 *     certificates: the shared catch stops recording    KILLED  ← see below
 *     certificates: only one of the two flags set there KILLED
 *     certificates: the uploaded "(0)" restored         KILLED
 *     certificates: the academy "(0)" restored          KILLED
 *     export products: the else branch removed          KILLED
 *     export products: the catch stops recording        KILLED
 *     ratchet: CAP raised to 100                        KILLED
 *     ratchet: CAP lowered to 20                        KILLED
 *     ratchet: the new clause widened to "mentions an
 *              error anywhere in the file"              KILLED (3)
 *     ratchet: the new clause made inert                KILLED (3)
 *     ratchet: one entry dropped from the FIXED ledger  KILLED
 *     reword this header                                SURVIVED, as intended
 *
 *   ONE MUTANT SURVIVED THE FIRST RUN. Emptying the certificates screen's
 *   SHARED catch — the one around the `Promise.all` that holds both fetches —
 *   changed nothing, because every test in that describe mocked `fetch` to
 *   RESOLVE with a `{ success: false }` body. The refusal path was covered from
 *   three angles and the throw path from none, which is the same "covered where
 *   it was easy" gap #588's first run had. There is a network-down test now, and
 *   a second mutant that sets only one of the two flags dies on it too.
 */
