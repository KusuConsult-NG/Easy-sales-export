/**
 * @jest-environment node
 */

/**
 *   #358 THE SECOND OPTIMISTIC-LOCK HELPER WAS THE EXACT BUG THE FIRST ONE WAS
 *        WRITTEN TO FIX, STILL IN THE TREE UNDER THE MORE FINDABLE NAME.
 *
 *        lib/data-integrity.ts said "Ensures that an update only proceeds if
 *        the version in the database matches the version the client last saw."
 *        It did not ensure that:
 *
 *            return await db.runTransaction(async (transaction) => {
 *                const doc = await transaction.get(docRef);
 *                const serverVersion = doc.data()._version || 0;
 *                if (clientVersion !== undefined && serverVersion > clientVersion) throw ...;
 *                updateFn(transaction, data);
 *                transaction.update(docRef, { _version: FieldValue.increment(1), ... });
 *            });
 *
 *        `runTransaction` here is not a database transaction —
 *        supabase-db.ts:2156 builds a queue, runs the callback, flushes. No
 *        lock, no isolation, no rollback. Two callers read the SAME `_version`,
 *        both pass the comparison, both write, and the second reverts the first
 *        from a snapshot taken moments earlier while reporting success.
 *
 *        WHAT MAKES THIS DIFFERENT FROM #355. lib/optimistic-locking.ts says
 *        all of the above in its own header, about its own former body — and it
 *        was fixed, onto claim_versioned_update (migration 020), a conditional
 *        UPDATE that locks the row and re-reads it under the lock. So the repair
 *        already existed, tested and in use by two live callers. This file was
 *        the second copy, left behind with the original defect.
 *
 *        #353(b) and #355's shape — two modules named for one job, the real one
 *        and the imposter — with an extra edge. `data-integrity` is the name
 *        somebody greps for when they want integrity, and actions/orders.ts
 *        ALREADY IMPORTED IT. It called it nowhere (the #357 shape: an import
 *        with no call), so nothing was losing writes. It was one keystroke away.
 *
 *        FIXED, NOT DELETED. The signature is unchanged, so any caller — the
 *        one that already imports it included — now gets the real CAS. The
 *        `transaction` handed to updateFn is a collector: it captures the patch
 *        rather than queueing it onto the unlocked replay path.
 *
 *        And it now REFUSES a FieldValue sentinel in the patch instead of
 *        writing it. claim_versioned_update applies the patch as JSONB and does
 *        not resolve sentinels, so an increment() passed here would be stored
 *        as a literal `{_methodName: "increment"}` object — the silent
 *        corruption. lib/optimistic-locking.ts warns about this in prose; here
 *        it throws.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { FieldValue } from '@/lib/firestore-compat';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const HELPER = 'src/lib/data-integrity.ts';
const REAL = 'src/lib/optimistic-locking.ts';

const versionedUpdate = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/optimistic-locking', () => ({
    versionedUpdate: (...args: any[]) => versionedUpdate(...args),
}));

/** A document reference whose get() answers with `data`, or nothing. */
function refFor(data: Record<string, any> | null) {
    return {
        id: 'order-1',
        path: 'orders/order-1',
        get: async () => ({ exists: data !== null, data: () => data }),
    } as any;
}

beforeEach(() => {
    jest.clearAllMocks();
    versionedUpdate.mockResolvedValue(undefined);
});

async function run(ref: any, clientVersion: number | undefined, updateFn: any) {
    const { withOptimisticLock } = await import('@/lib/data-integrity');
    return withOptimisticLock(ref, clientVersion, updateFn);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#358 — the patch goes through the real compare-and-swap', () => {
    it('IT CALLS versionedUpdate, NOT runTransaction', async () => {
        // THE test. The old body never reached a CAS at all.
        await run(refFor({ _version: 3, status: 'pending' }), 3, (tx: any, current: any) => {
            expect(current.status).toBe('pending');
            tx.update(null, { status: 'confirmed' });
        });

        expect(versionedUpdate).toHaveBeenCalledTimes(1);
        const [, ref, expectedVersion, patch] = versionedUpdate.mock.calls[0] as [unknown, { id: string }, unknown, unknown];
        expect(ref.id).toBe('order-1');
        expect(expectedVersion).toBe(3);
        expect(patch).toEqual({ status: 'confirmed' });
    });

    it('THE ADAPTER TRANSACTION IS NOT USED — that was the whole defect', () => {
        // Measured on the source, because the point is that no write is queued
        // onto the unlocked replay path.
        const code = source(HELPER);

        expect(code).not.toContain('db.runTransaction');
        expect(code).not.toContain('transaction.get(');
        expect(code).toContain('await versionedUpdate(');
    });

    it('the caller\'s expected version is passed through, including undefined', async () => {
        // `undefined` asserts nothing but still takes the lock — the documented
        // behaviour for records written before versioning existed.
        await run(refFor({ _version: 7 }), undefined, (tx: any) => tx.update(null, { a: 1 }));

        expect(versionedUpdate.mock.calls[0][2]).toBeUndefined();
    });

    it('several updates from one updateFn are merged into ONE patch', async () => {
        // Two CAS calls would be two chances to lose a race.
        await run(refFor({ _version: 1 }), 1, (tx: any) => {
            tx.update(null, { a: 1 });
            tx.update(null, { b: 2 });
            tx.set(null, { c: 3 });
        });

        expect(versionedUpdate).toHaveBeenCalledTimes(1);
        expect(versionedUpdate.mock.calls[0][3]).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('updateFn receives the CURRENT document, so a read-modify-write still reads', async () => {
        const seen: any[] = [];
        await run(refFor({ _version: 2, total: 500 }), 2, (_tx: any, current: any) => seen.push(current));

        expect(seen).toEqual([{ _version: 2, total: 500 }]);
    });

    it('A MISSING DOCUMENT IS NOT A CONFLICT', async () => {
        // Different failure, different message — telling somebody to refresh a
        // record that does not exist is the wrong instruction.
        await expect(run(refFor(null), 1, () => {})).rejects.toThrow('Document does not exist');
        expect(versionedUpdate).not.toHaveBeenCalled();
    });

    it('and a STALE_DATA rejection from the CAS reaches the caller', async () => {
        versionedUpdate.mockRejectedValue(new Error('STALE_DATA: Concurrency Conflict'));

        await expect(run(refFor({ _version: 9 }), 4, (tx: any) => tx.update(null, { a: 1 })))
            .rejects.toThrow(/STALE_DATA/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#358 — sentinels are refused rather than stored', () => {
    it('A FieldValue.increment IN THE PATCH THROWS', async () => {
        // claim_versioned_update writes the patch as JSONB. A sentinel would be
        // stored as `{_methodName: "increment"}` — silent corruption of the
        // very field somebody was trying to increment.
        await expect(
            run(refFor({ _version: 1 }), 1, (tx: any) => tx.update(null, { count: FieldValue.increment(1) })),
        ).rejects.toThrow(/'count' is a FieldValue sentinel/);

        expect(versionedUpdate).not.toHaveBeenCalled();
    });

    it('and so does a serverTimestamp', async () => {
        await expect(
            run(refFor({ _version: 1 }), 1, (tx: any) => tx.update(null, { seenAt: FieldValue.serverTimestamp() })),
        ).rejects.toThrow(/FieldValue sentinel/);
    });

    it('a plain value of course does not', async () => {
        // The other side. Sentinel detection must not refuse ordinary data.
        await run(refFor({ _version: 1 }), 1, (tx: any) => tx.update(null, {
            count: 4, when: new Date(0), nested: { a: 1 }, list: [1, 2], nothing: null,
        }));

        expect(versionedUpdate).toHaveBeenCalledTimes(1);
    });

    it('_version and updatedAt are stripped — the SQL function sets both', async () => {
        await run(refFor({ _version: 1 }), 1, (tx: any) => tx.update(null, {
            status: 'x', _version: 99, updatedAt: 'yesterday',
        }));

        expect(versionedUpdate.mock.calls[0][3]).toEqual({ status: 'x' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#358 — the two helpers, and the import that was one keystroke away', () => {
    it('THE REAL ONE STILL USES THE POSTGRES CAS', () => {
        // Vacuity guard on the whole finding: delegating is only a fix while
        // the thing delegated to is real.
        const real = source(REAL);

        expect(real).toContain('claimVersionedUpdate({');
        expect(real).toContain('from "@/lib/wallet-ledger"');
    });

    it('and claim_versioned_update is a real migration, not an aspiration', () => {
        const sql = readFileSync('supabase/migrations/020_floored_debit_and_versioned_cas.sql', 'utf-8');

        expect(sql).toContain('CREATE OR REPLACE FUNCTION claim_versioned_update(');
        expect(sql).toMatch(/p_expected\s+NUMERIC/);
    });

    it('THE HEADER NO LONGER CLAIMS TO ENSURE SOMETHING IT DID NOT', () => {
        const raw = readFileSync(HELPER, 'utf-8');

        expect(raw).toMatch(/#358 THIS WAS THE EXACT BUG lib\/optimistic-locking\.ts WAS WRITTEN TO FIX/);
        // The old sentence survives only inside the retraction that quotes it.
        expect(raw.match(/Ensures that an update only proceeds/g) ?? []).toHaveLength(1);
        expect(raw).toMatch(/Its header said "Ensures that an update only proceeds/);
    });

    it('actions/orders.ts still imports it, which is why fixing beat labelling', () => {
        // The reason this was repaired rather than documented. If the import
        // ever grows a call, that call now reaches the CAS.
        const orders = source('src/app/actions/orders.ts');

        expect(orders).toContain('import { withOptimisticLock } from "@/lib/data-integrity";');
    });

    it('NEITHER HELPER READS _version AND WRITES IT BACK BY HAND', () => {
        // The class ratchet. The defect is a read-compare-write on _version
        // outside a CAS; this is that shape, in the two files that own it.
        for (const file of [HELPER, REAL]) {
            const code = source(file);

            expect(code).not.toMatch(/_version:\s*currentVersion \+ 1/);
            expect(code).not.toMatch(/_version:\s*FieldValue\.increment/);
        }
    });
});
