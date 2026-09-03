/**
 * @jest-environment node
 */

/**
 * A cooperative membership could be claimed with an email address.
 *
 * `getDashboardDataAction` looks for the caller's membership through four
 * fallbacks. The third searched by email:
 *
 *     .where("email", "==", userEmail.toLowerCase()).limit(1)
 *     if (!memberDoc.data().userId) {
 *         await memberDoc.ref.update({ userId });   // permanent
 *     }
 *     membershipSnapshot = ... // returned as the caller's
 *
 * A matching email is not proof of ownership. The membership was bound to the
 * caller — permanently — and returned as theirs, `savingsBalance` and
 * `loanBalance` included.
 *
 * HOW SOMEBODY WOULD REACH IT
 * ---------------------------
 * The caller's email comes from their own profile, and profile.ts lets them
 * change it. So: set your address to that of an ORPHANED membership — a member
 * who paid by form submission and never registered, which is exactly the case
 * Fallback 4's own comment describes — then load this dashboard and inherit
 * their cooperative savings.
 *
 * Supabase enforces uniqueness among registered addresses, so the target has to
 * be an address no account currently holds. An orphaned membership is precisely
 * that.
 *
 * THE FIX
 * -------
 * Claiming now needs the same evidence Fallback 4 demands one block below: a
 * completed cooperative registration payment whose reference matches the
 * membership AND whose userId is the caller. That ties the record to the
 * caller's money rather than to a string they can edit.
 *
 * A membership already carrying the caller's userId is theirs and is returned
 * as before. A membership with no paymentReference is read past, not claimed.
 *
 * THE SECOND ONE
 * --------------
 * Fallback 4 synthesised a member document with
 * `set({ ..., membershipStatus: "pending" }, { merge: true })` straight onto
 * `doc(userId)`. If a record existed at that id but the lookups above had missed
 * it — no userId field, a different email — loading the dashboard would demote
 * an ACTIVE member to pending. A read endpoint should not be able to do that.
 * It now uses an existing document rather than writing over it.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const CALLER = 'caller-1';
const VICTIM_EMAIL = 'orphan@example.com';
const MEMBER_DOC = 'member-doc-1';
const PAYMENT_REF = 'PSK-REF-ORPHAN';

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p), createAdminAuditLog: jest.fn(async () => ({})) }));
jest.mock('@/lib/firestore-utils', () => ({
    runQueryWithRetry: (fn: any) => fn(),
    safeCollection: jest.fn(),
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles: [] } },
        error: null,
    }));
}

/**
 * The lookup chain reads several collections. Answers are routed by collection
 * name, with the caller's own user document keyed by id.
 */
function setWorld(opts: {
    membershipByUserId?: any[];
    docAtCallerId?: Record<string, any> | null;
    membershipByEmail?: Record<string, any> | null;
    paymentForRef?: { userId: string } | null;
} = {}) {
    const byUserId = opts.membershipByUserId ?? [];
    const docAtId = opts.docAtCallerId ?? null;
    const byEmail = opts.membershipByEmail ?? null;
    const payment = opts.paymentForRef ?? null;

    let coopMemberCall = 0;
    let callerDocCall = 0;
    let paymentCall = 0;

    (global as any).mockFirestoreGet.mockImplementation((idOrCollection: string) => {
        if (idOrCollection === CALLER) {
            // TWO different collections are read at doc(userId): Fallback 2 looks
            // for a MEMBER document there, and Fallback 3 then reads the caller's
            // USER document for their email. The harness passes only the id, so a
            // fixture cannot tell them apart by argument — it separates them by
            // ORDER, which is the sequence the function actually performs.
            //
            // The first version returned an existing document for both, so
            // Fallback 2 short-circuited and the email path was never reached;
            // the three refusals passed because nothing happened at all.
            callerDocCall += 1;
            if (callerDocCall === 1) {
                // Fallback 2 — the member document at the caller's id.
                return Promise.resolve(
                    docAtId
                        ? { exists: true, empty: false, size: 1, docs: [], ref: { id: CALLER }, data: () => docAtId }
                        : { exists: false, empty: true, size: 0, docs: [], ref: { id: CALLER }, data: () => undefined }
                );
            }
            // Fallback 3 — the caller's user document, for their email.
            return Promise.resolve({
                exists: true, empty: false, size: 1, docs: [], ref: { id: CALLER },
                data: () => ({ email: VICTIM_EMAIL }),
            });
        }
        if (idOrCollection === 'cooperative_members') {
            coopMemberCall += 1;
            // First call: the userId query. Second: the email query.
            if (coopMemberCall === 1) {
                return Promise.resolve({
                    exists: false, empty: byUserId.length === 0, size: byUserId.length,
                    docs: byUserId, data: () => ({}),
                });
            }
            return Promise.resolve(
                byEmail
                    ? {
                        exists: false, empty: false, size: 1,
                        docs: [{ id: MEMBER_DOC, ref: { id: MEMBER_DOC, update: (p: any) => { (global as any).__claimed = p; return Promise.resolve(); } }, data: () => byEmail }],
                        data: () => ({}),
                    }
                    : { exists: false, empty: true, size: 0, docs: [], data: () => ({}) }
            );
        }
        // COLLECTIONS.PROCESSED_PAYMENTS is camelCase 'processedPayments', not the
        // snake_case the table uses. Keying on the wrong one made the payment
        // lookup return empty, so the legitimate claim never happened — and the
        // three refusals above passed for the wrong reason. The success case is
        // what exposed it.
        if (idOrCollection === 'processedPayments') {
            paymentCall += 1;
            const row = payment
                ? { id: 'pay-1', data: () => ({ userId: payment.userId, reference: PAYMENT_REF, type: 'cooperative_membership_registration', status: 'completed' }) }
                : null;

            // Two different queries hit this collection, and they filter on
            // different things — Fallback 3 by REFERENCE, Fallback 4 by the
            // caller's USERID. The harness ignores filters, so the fixture
            // applies them by order.
            //
            // Without this, Fallback 4 received a payment belonging to somebody
            // else and claimed the membership itself — so "refuses when the
            // payment belongs to somebody else" failed while pointing at the
            // wrong function.
            if (paymentCall === 1) {
                // by reference: whoever owns it
                return Promise.resolve(
                    row
                        ? { exists: false, empty: false, size: 1, docs: [row], data: () => ({}) }
                        : { exists: false, empty: true, size: 0, docs: [], data: () => ({}) }
                );
            }
            // by userId: only if it is genuinely the caller's
            return Promise.resolve(
                row && payment?.userId === CALLER
                    ? { exists: false, empty: false, size: 1, docs: [row], data: () => ({}) }
                    : { exists: false, empty: true, size: 0, docs: [], data: () => ({}) }
            );
        }
        return Promise.resolve({ exists: false, empty: true, size: 0, docs: [], data: () => ({}) });
    });
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: false, empty: true, docs: [], data: () => ({}),
    }));
    (global as any).__claimed = undefined;
}

async function loadDashboard() {
    const { getDashboardDataAction } = await import('@/app/actions/cooperative/_dashboard');
    return getDashboardDataAction();
}

/** The membership record the email fallback bound to the caller, if any. */
function claimedPatch(): any {
    return (global as any).__claimed;
}

describe('a membership is not claimed by matching an email', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(CALLER);
    });

    it('refuses to bind an orphaned membership with no payment evidence', async () => {
        // THE test. The membership has savings and no userId; the caller's
        // profile email happens to match.
        setWorld({
            membershipByEmail: { email: VICTIM_EMAIL, savingsBalance: 750_000, paymentReference: PAYMENT_REF },
            paymentForRef: null,
        });

        await loadDashboard();

        expect(claimedPatch()).toBeUndefined();
    });

    it('refuses when the payment behind that membership belongs to somebody else', async () => {
        // The sharper version: a real payment exists, and it is not the
        // caller's.
        setWorld({
            membershipByEmail: { email: VICTIM_EMAIL, savingsBalance: 750_000, paymentReference: PAYMENT_REF },
            paymentForRef: { userId: 'somebody-else' },
        });

        await loadDashboard();

        expect(claimedPatch()).toBeUndefined();
    });

    it('refuses an orphaned membership with no payment reference at all', async () => {
        setWorld({
            membershipByEmail: { email: VICTIM_EMAIL, savingsBalance: 750_000 },
        });

        await loadDashboard();

        expect(claimedPatch()).toBeUndefined();
    });

    it('binds the membership when the caller paid for it', async () => {
        // Vacuity guard, and the legitimate case this fallback exists for: a
        // member whose record lost its userId link, proven by their own payment.
        setWorld({
            membershipByEmail: { email: VICTIM_EMAIL, savingsBalance: 750_000, paymentReference: PAYMENT_REF },
            paymentForRef: { userId: CALLER },
        });

        await loadDashboard();

        expect(claimedPatch()).toMatchObject({ userId: CALLER });
    });

    it('returns a membership that already carries the caller\'s id without rewriting it', async () => {
        setWorld({
            membershipByEmail: { email: VICTIM_EMAIL, userId: CALLER, savingsBalance: 10_000 },
        });

        const r: any = await loadDashboard();

        expect(r.success).toBe(true);
        // Already theirs, so no claim write is needed.
        expect(claimedPatch()).toBeUndefined();
    });
});

describe('the dashboard does not demote an existing member', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(CALLER);
    });

    it('uses a member document already at the caller id rather than overwriting it', async () => {
        // Fallback 4 wrote membershipStatus: "pending" onto doc(userId) with
        // merge: true. An active member whose record the earlier lookups missed
        // would be demoted by loading their own dashboard.
        setWorld({
            docAtCallerId: { userId: CALLER, membershipStatus: 'active', savingsBalance: 500_000 },
        });

        const r: any = await loadDashboard();

        expect(r.success).toBe(true);
        const writes = (global as any).mockFirestoreSet.mock.calls
            .map((c: any[]) => c[c.length - 1])
            .filter((d: any) => d && d.membershipStatus === 'pending');
        expect(writes).toEqual([]);
    });
});

describe('access control', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    it('refuses an unauthenticated caller', async () => {
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: null, error: { error: 'Authentication required' },
        }));
        setWorld();

        const r: any = await loadDashboard();

        expect(r.success).toBe(false);
    });

    it('takes no user id as a parameter', async () => {
        // Every lookup is scoped to session.user.id; there is no argument to
        // substitute. Asserted on the signature, because adding one later would
        // not fail a behavioural test.
        const mod: any = await import('@/app/actions/cooperative/_dashboard');

        expect(mod.getDashboardDataAction.length).toBe(0);
    });
});
