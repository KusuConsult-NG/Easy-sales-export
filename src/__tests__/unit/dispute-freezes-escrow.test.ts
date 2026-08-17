/**
 * Filing a dispute has to freeze the money, not just the order.
 *
 * TWO DISPUTE SYSTEMS OVER ONE ESCROW
 * -----------------------------------
 * The platform has two paths for raising a dispute, both live in the UI:
 *
 *   /escrow/[id]/dispute        → marketplace/_escrow_disputes.ts
 *                                 sets the ESCROW to "disputed"
 *
 *   /dashboard/disputes/new     → actions/disputes.ts
 *                                 claimed the ORDER into "disputed" and never
 *                                 touched ESCROW_TRANSACTIONS at all
 *
 * THE CONSEQUENCE
 * ---------------
 * api/cron/release-escrow selects escrows on
 *
 *     status == "funded" AND releaseRequestedAt <= threshold
 *
 * and its own comment states the guard it depends on: "a buyer filing a dispute
 * moves the status off 'funded', and this then refuses to release." True of the
 * escrow-keyed path. False of the order-keyed one.
 *
 * So a buyer who disputed from the dashboard had the order marked disputed while
 * the money stayed releasable, and the cron paid the seller out from under an open
 * dispute.
 *
 * It compounds: resolveDisputeAction claims the escrow from
 * ["funded", "disputed", "pending"]. Once the cron has moved it to "released", the
 * dispute cannot be resolved either — an admin can decide on a refund and have no
 * way to execute it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const DISPUTES = 'src/app/actions/disputes.ts';
const ESCROW_DISPUTES = 'src/app/actions/marketplace/_escrow_disputes.ts';
const CRON = 'src/app/api/cron/release-escrow/route.ts';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/** Just the createDisputeAction body, so assertions cannot drift into resolve. */
function createDisputeBody(): string {
    const src = code(DISPUTES);
    const start = src.indexOf('_createDisputeAction');
    const end = src.indexOf('_getBuyerDisputesAction');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
}

describe('the order-keyed dispute path freezes the escrow', () => {
    it('claims the escrow off funded', () => {
        // THE test. Without this the cron releases the money mid-dispute.
        const body = createDisputeBody();

        expect(body).toContain('COLLECTIONS.ESCROW_TRANSACTIONS');
        expect(body).toContain('from: "funded"');
        expect(body).toContain('to: "disputed"');
    });

    it('claims rather than blind-writes', () => {
        // The escrow could be released between the read and the write; a plain
        // update would overwrite a completed release with "disputed" and lose the
        // record that the money had gone.
        const body = createDisputeBody();

        expect(body).toContain('claimStatusTransition({');
        expect(body).not.toMatch(/escrowRef\.update\(\{\s*status:\s*"disputed"/);
    });

    it('locates the escrow the same way the resolution does', () => {
        // resolveDisputeAction finds it by orderId and takes the active row. If the
        // two disagreed about which escrow a dispute is against, freezing one and
        // resolving another would be worse than not freezing at all.
        const body = createDisputeBody();

        expect(body).toContain('.where("orderId", "==", orderId)');
        expect(body).toMatch(/status === "funded" \|\| status === "disputed" \|\| status === "pending"/);

        // The resolution lives in _updateDisputeStatusAction, not in a function
        // called _resolveDisputeAction — the first version of this test guessed the
        // latter, so the slice was empty and the assertion compared against
        // nothing.
        const src = code(DISPUTES);
        const resolveAt = src.indexOf('_updateDisputeStatusAction');
        expect(resolveAt).toBeGreaterThan(-1);

        const resolve = src.slice(resolveAt);
        expect(resolve).toContain('.where("orderId", "==", dispute.orderId)');
        expect(resolve).toMatch(/status === "funded" \|\| status === "disputed" \|\| status === "pending"/);
    });

    it('links the dispute onto the escrow it froze', () => {
        const body = createDisputeBody();
        expect(body).toContain('disputeId: disputeRef.id,');
    });
});

describe('what it records when it could not freeze', () => {
    it('marks a dispute filed against already-settled money', () => {
        // A buyer may dispute a completed order. The admin resolving it must know
        // there is nothing left to refund BEFORE choosing a resolution, rather than
        // finding out when the escrow claim refuses.
        const body = createDisputeBody();

        expect(body).toContain('escrowAlreadySettled');
        expect(body).toContain('escrowFrozen,');
    });

    it('still creates the dispute either way', () => {
        // Refusing to record a dispute because the money has gone would be a worse
        // failure than the one being fixed.
        const body = createDisputeBody();

        const freezeAt = body.indexOf('to: "disputed"');
        const writeAt = body.indexOf('await disputeRef.set(disputeData)');
        expect(writeAt).toBeGreaterThan(freezeAt);

        // And the freeze cannot abort the dispute by throwing.
        expect(body).toContain('} catch (e) {');
        expect(body).toContain('Could not freeze the escrow for the disputed order');
    });

    it('warns in both unfrozen cases', () => {
        const src = source(DISPUTES);

        expect(src).toContain('The funds have left escrow');
        expect(src).toContain('no funded');
    });

    it('carries the flags on the stored type, not through a cast', () => {
        // They were first written through `as Partial<Dispute>`, which silences the
        // excess-property check — so the fields would have been written to the
        // database and invisible to every reader's type.
        const body = createDisputeBody();
        expect(body).not.toContain('} as Partial<Dispute>;');

        const types = source('packages/marketplace/src/types.ts');
        expect(types).toContain('escrowFrozen?: boolean;');
        expect(types).toContain('escrowAlreadySettled?: string | null;');
    });
});

describe('the guard the cron depends on', () => {
    it('the cron still selects only funded escrows', () => {
        // If this ever widens, freezing the escrow stops being sufficient and this
        // whole fix needs revisiting.
        const src = code(CRON);

        expect(src).toContain('.where("status", "==", "funded")');
        expect(src).toContain('.where("releaseRequestedAt", "<=", thresholdTimestamp)');
    });

    it('and claims from funded, so a frozen escrow is refused twice over', () => {
        const src = code(CRON);
        expect(src).toContain('from: "funded"');
        expect(src).toContain('to: "released"');
    });

    it('the escrow-keyed path still freezes too, so both agree', () => {
        // The path that was already right. If it regressed, the dashboard fix would
        // mask it.
        const src = code(ESCROW_DISPUTES);
        expect(src).toMatch(/status: "disputed"/);
    });
});

/**
 * BEHAVIOURAL, not textual.
 *
 * The source assertions above are necessary but not sufficient, and a mutation run
 * proved it: three reintroductions of the defect passed them.
 *
 *   `if (status === "funded")` → `if (false)`   the freeze becomes dead code and
 *                                                every string the tests match is
 *                                                still in the file
 *   the escrow lookup key changed               `.where("orderId", "==", orderId)`
 *                                                also appears in the duplicate-
 *                                                dispute check above it, so the
 *                                                substring survived
 *   `throw e` added inside the catch             the handler and its message are
 *                                                both still there
 *
 * Source scanning cannot see control flow. These drive the action and assert what
 * it DOES.
 */
describe('createDisputeAction, executed', () => {
    const ORDER_ID = 'ORD-1';
    const BUYER = 'buyer-1';
    const SELLER = 'seller-1';
    const ESCROW_ID = 'ESC-ORD-1-selle';

    let claimCalls: any[];
    /** Every .where() the escrow lookup made, so the KEY can be asserted. */
    let escrowWhere: any[][];

    function loadAction(opts: {
        escrowStatus?: string | null;
        escrowMissing?: boolean;
        claimResult?: { claimed: boolean; status: string | null };
        claimThrows?: boolean;
    } = {}) {
        jest.resetModules();
        claimCalls = [];
        escrowWhere = [];

        jest.doMock('@/lib/status-transition', () => ({
            claimStatusTransition: jest.fn(async (p: any) => {
                claimCalls.push(p);
                if (opts.claimThrows) throw new Error('boom');
                return opts.claimResult ?? { claimed: true, status: p.to };
            }),
            claimStatusTransitionFromAny: jest.fn(async (p: any) => {
                claimCalls.push(p);
                return { claimed: true, status: p.to };
            }),
        }));

        const escrowDocs = opts.escrowMissing
            ? []
            : [{
                id: ESCROW_ID,
                ref: { update: jest.fn(async () => ({})) },
                data: () => ({ status: opts.escrowStatus ?? 'funded', orderId: ORDER_ID, sellerId: SELLER }),
            }];

        // Typed parameters, or TypeScript infers the call tuple as `[]` and
        // `setSpy.mock.calls[0][0]` is a compile error even though the test passes.
        const setSpy = jest.fn(async (_data: any) => ({}));
        const updateSpy = jest.fn(async (_data: any) => ({}));

        jest.doMock('@/lib/supabase-db', () => {
            /**
             * Each collection gets its OWN chainable query.
             *
             * The first version shared one object and overrode `get` on the
             * collection, but `.where()` returned the shared query — so the
             * duplicate-dispute check read the escrow docs and the action stopped at
             * "Active dispute already exists for this order", never reaching the
             * freeze this file is about.
             */
            const makeQuery = (docs: any[]) => {
                const q: any = {
                    where: jest.fn(() => q),
                    limit: jest.fn(() => q),
                    orderBy: jest.fn(() => q),
                    get: jest.fn(async () => ({ empty: docs.length === 0, docs })),
                };
                return q;
            };

            const collection = jest.fn((name: string) => {
                if (name === 'disputes') {
                    // No pre-existing active dispute on this order.
                    const q = makeQuery([]);
                    q.doc = jest.fn(() => ({
                        id: 'dispute-1',
                        set: setSpy,
                        get: jest.fn(async () => ({ exists: false })),
                    }));
                    return q;
                }
                if (name === 'marketplaceOrders') {
                    const q = makeQuery([]);
                    q.doc = jest.fn(() => ({
                        id: ORDER_ID,
                        update: updateSpy,
                        get: jest.fn(async () => ({
                            exists: true,
                            data: () => ({ buyerId: BUYER, sellerId: SELLER, status: 'delivered' }),
                        })),
                    }));
                    return q;
                }
                if (name === 'escrow_transactions') {
                    const q = makeQuery(escrowDocs);
                    // Record the filter, so a mutation that looks the escrow up by a
                    // different key is caught. Without this the mock returns the same
                    // docs whatever it is asked for, and changing `orderId` to
                    // `buyerId` — which would freeze an escrow belonging to a
                    // DIFFERENT order — passed every assertion.
                    q.where = jest.fn((...args: any[]) => { escrowWhere.push(args); return q; });
                    q.doc = jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })) }));
                    return q;
                }
                const q = makeQuery([]);
                q.doc = jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })) }));
                return q;
            });
            return { supabaseDb: { collection, runTransaction: jest.fn(), batch: jest.fn() }, getAdminDb: () => ({ collection }) };
        });

        jest.doMock('@/lib/session-guard', () => ({
            requireSession: jest.fn(async () => ({
                session: { user: { id: BUYER, email: 'b@e.com', roles: ['buyer'] } },
                error: null,
            })),
        }));

        return { setSpy, updateSpy };
    }

    afterEach(() => {
        jest.dontMock('@/lib/status-transition');
        jest.dontMock('@/lib/supabase-db');
        jest.dontMock('@/lib/session-guard');
        jest.resetModules();
    });

    async function fileDispute() {
        const mod = await import('@/app/actions/disputes');
        return mod.createDisputeAction({
            orderId: ORDER_ID,
            reason: 'not_delivered' as any,
            // At least 50 characters — the action validates the length, and a short
            // fixture made every one of these tests fail before reaching the freeze.
            description: 'The order was never delivered to the address given at checkout.',
            // Evidence is required by the action's validation, so an empty array
            // never reaches the escrow freeze.
            evidenceUrls: ['https://example.test/receipt.png'],
        } as any);
    }

    it('claims the funded escrow into disputed', async () => {
        // Kills "if (false)": a dead branch makes no call.
        loadAction({ escrowStatus: 'funded' });
        await fileDispute();

        const escrowClaim = claimCalls.find(
            (c) => c.collection === 'escrow_transactions' && c.to === 'disputed',
        );
        expect(escrowClaim).toBeDefined();
        expect(escrowClaim.from).toBe('funded');
        expect(escrowClaim.id).toBe(ESCROW_ID);
    });

    it('looks the escrow up by orderId', async () => {
        // The resolution finds it the same way. If the two disagreed about which
        // escrow a dispute is against, freezing one and resolving another would be
        // worse than not freezing at all.
        loadAction({ escrowStatus: 'funded' });
        await fileDispute();

        expect(escrowWhere).toContainEqual(['orderId', '==', ORDER_ID]);
    });

    it('does not claim an escrow that is already disputed', async () => {
        loadAction({ escrowStatus: 'disputed' });
        await fileDispute();

        expect(claimCalls.filter((c) => c.collection === 'escrow_transactions')).toHaveLength(0);
    });

    it('does not claim an unfunded escrow', async () => {
        // Nothing for the cron to release, so nothing to freeze.
        loadAction({ escrowStatus: 'pending' });
        await fileDispute();

        expect(claimCalls.filter((c) => c.collection === 'escrow_transactions')).toHaveLength(0);
    });

    it('still records the dispute when the freeze throws', async () => {
        // Kills the `throw e` mutation: the dispute must survive a failed freeze.
        const { setSpy } = loadAction({ escrowStatus: 'funded', claimThrows: true });
        const res: any = await fileDispute();

        expect(res.success).toBe(true);
        expect(setSpy).toHaveBeenCalled();
        expect(setSpy.mock.calls[0][0]).toMatchObject({ escrowFrozen: false });
    });

    it('records escrowFrozen true when the claim succeeds', async () => {
        const { setSpy } = loadAction({ escrowStatus: 'funded' });
        await fileDispute();

        expect(setSpy.mock.calls[0][0]).toMatchObject({ escrowFrozen: true, escrowAlreadySettled: null });
    });

    it('records the settled status when the money has already gone', async () => {
        const { setSpy } = loadAction({ escrowStatus: 'released' });
        const res: any = await fileDispute();

        expect(res.success).toBe(true);
        expect(setSpy.mock.calls[0][0]).toMatchObject({
            escrowFrozen: false,
            escrowAlreadySettled: 'released',
        });
    });

    it('records a lost race as unfrozen rather than claiming success', async () => {
        loadAction({ escrowStatus: 'funded', claimResult: { claimed: false, status: 'released' } });
        const { setSpy } = loadAction({
            escrowStatus: 'funded',
            claimResult: { claimed: false, status: 'released' },
        });
        await fileDispute();

        expect(setSpy.mock.calls[0][0]).toMatchObject({
            escrowFrozen: false,
            escrowAlreadySettled: 'released',
        });
    });
});
