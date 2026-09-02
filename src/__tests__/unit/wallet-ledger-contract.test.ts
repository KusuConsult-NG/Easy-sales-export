/**
 * @jest-environment node
 */

/**
 * The atomic money primitives — the EIGHT with no coverage, and the contract
 * with Postgres pinned.
 *
 * lib/__tests__/wallet-ledger.test.ts already covers four of the twelve
 * exports: creditWalletOnce, debitWalletOnce, debitWalletLocked and
 * claimPaymentOnce. That suite is not duplicated here. What it leaves at 0% is
 * everything added after it — the JSONB balance debits, the floored debit, the
 * idempotency claim, the versioned CAS, the single-open-loan claim, the two
 * bounded counters, and the two functions that must never throw.
 *
 * WHAT THIS FILE IS
 * -----------------
 * Every function here is a thin wrapper: validate the arguments, call an RPC,
 * unwrap the row, map the columns. The money logic lives in SQL. So the two
 * things that can go wrong on this side are the two halves of the contract:
 *
 *   the ARGUMENTS   a name that does not match the SQL signature. PostgREST
 *                   cannot resolve the overload and the call errors — loud, and
 *                   every money path using it is down.
 *
 *   the COLUMNS     a name that does not match `RETURNS TABLE`. That one is
 *                   SILENT: `row.balance` is undefined, `Number(undefined ?? 0)`
 *                   is 0, `Boolean(undefined)` is false. A debit that succeeded
 *                   reports `ok: false`, or a wallet reports a zero balance.
 *
 * Both were checked against supabase/migrations for all ten RPCs and both were
 * sound — no defect was found in this file. The check itself was one-off, so
 * the ratchet at the foot makes it permanent: rename a parameter in a migration
 * without renaming it here, or here without there, and it fails.
 *
 * That is the same shape as the ratchet #343 added for lib/auth.ts reading
 * fields off a cached profile the builder never set — a projection between two
 * systems, tested by neither of them.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockRpc = jest.fn(async (_name: string, _args: any) => ({ data: null as any, error: null as any }));

jest.mock('@/lib/supabase', () => ({
    supabaseAdmin: { rpc: (name: string, args: any) => mockRpc(name, args) },
}));

beforeEach(() => {
    jest.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
});

async function ledger() {
    return import('@/lib/wallet-ledger');
}

/** The RPC answers with one row, as PostgREST returns a RETURNS TABLE result. */
function rpcReturns(row: Record<string, unknown>) {
    mockRpc.mockResolvedValue({ data: [row], error: null });
}

const argsOf = (call = 0) => mockRpc.mock.calls[call]?.[1] as Record<string, unknown>;
const nameOf = (call = 0) => mockRpc.mock.calls[call]?.[0];

// ─── the row unwrap, which the existing suite does not reach ─────────────────

describe('the PostgREST row unwrap', () => {
    it('accepts a bare row as well as a one-row array', async () => {
        // The functions read `Array.isArray(data) ? data[0] : data`. Every case
        // in lib/__tests__/wallet-ledger.test.ts hands back an array, so the
        // other branch had never run.
        mockRpc.mockResolvedValue({ data: { claimed: true, balance: 7 }, error: null });
        const { creditWalletOnce } = await ledger();

        expect(await creditWalletOnce({ reference: 'r', userId: 'u', amount: 1 }))
            .toEqual({ claimed: true, balance: 7 });
    });

    it('and treats an empty array as no result rather than as a zero balance', async () => {
        mockRpc.mockResolvedValue({ data: [], error: null });
        const { creditWalletOnce } = await ledger();

        await expect(creditWalletOnce({ reference: 'r', userId: 'u', amount: 1 }))
            .rejects.toThrow('Wallet credit returned no result');
    });
});

// ─── the JSONB balances ──────────────────────────────────────────────────────

describe('debitJsonbBalance', () => {
    it('names the table, the field and the collection', async () => {
        rpcReturns({ ok: true, balance: 50_000, reason: null });
        const { debitJsonbBalance } = await ledger();

        await debitJsonbBalance({
            table: 'document_collections', id: 'm-1', field: 'savingsBalance',
            amount: 10_000, collection: 'cooperative_members',
        });

        expect(nameOf()).toBe('debit_jsonb_balance');
        expect(argsOf()).toEqual({
            p_table: 'document_collections', p_id: 'm-1', p_field: 'savingsBalance',
            p_amount: 10_000, p_collection: 'cooperative_members',
        });
    });

    it('sends a null collection for a dedicated table', async () => {
        rpcReturns({ ok: true, balance: 1, reason: null });
        const { debitJsonbBalance } = await ledger();

        await debitJsonbBalance({ table: 'wallets', id: 'w-1', field: 'lockedBalance', amount: 1 });
        expect(argsOf().p_collection).toBeNull();
    });

    it('refuses a missing field, which would decrement nothing', async () => {
        const { debitJsonbBalance } = await ledger();

        await expect(debitJsonbBalance({ table: 't', id: 'i', field: '', amount: 1 }))
            .rejects.toThrow('field is required');
        expect(mockRpc).not.toHaveBeenCalled();
    });
});

describe('debitJsonbBalanceWithFloor', () => {
    it('applies the floor under the same lock as the debit', async () => {
        rpcReturns({ ok: true, balance: 5_000, reason: null });
        const { debitJsonbBalanceWithFloor } = await ledger();

        await debitJsonbBalanceWithFloor({
            table: 'document_collections', id: 'm-1', field: 'savingsBalance',
            amount: 1_000, floor: 5_000, collection: 'cooperative_members',
        });

        expect(nameOf()).toBe('debit_jsonb_balance_with_floor');
        expect(argsOf().p_floor).toBe(5_000);
    });

    it('keeps below_floor distinct from insufficient_funds', async () => {
        // The member HAS the money; they are not allowed to take all of it, and
        // telling them "insufficient funds" would be false.
        rpcReturns({ ok: false, balance: 5_500, reason: 'below_floor' });
        const { debitJsonbBalanceWithFloor } = await ledger();

        const result = await debitJsonbBalanceWithFloor({
            table: 't', id: 'i', field: 'f', amount: 1_000, floor: 5_000,
        });

        expect(result.reason).toBe('below_floor');
    });

    it('refuses a negative floor', async () => {
        const { debitJsonbBalanceWithFloor } = await ledger();

        await expect(debitJsonbBalanceWithFloor({
            table: 't', id: 'i', field: 'f', amount: 1, floor: -1,
        })).rejects.toThrow('floor must be >= 0');
    });

    it('but accepts a floor of zero, which is a real policy', async () => {
        rpcReturns({ ok: true, balance: 0, reason: null });
        const { debitJsonbBalanceWithFloor } = await ledger();

        await expect(debitJsonbBalanceWithFloor({
            table: 't', id: 'i', field: 'f', amount: 1, floor: 0,
        })).resolves.toMatchObject({ ok: true });
    });
});

// ─── claiming ────────────────────────────────────────────────────────────────

describe('claimIdempotencyKey', () => {
    it('defaults to the idempotency_keys collection', async () => {
        rpcReturns({ claimed: true, held_at: null });
        const { claimIdempotencyKey } = await ledger();

        await claimIdempotencyKey({ key: 'k-1', userId: 'u-1', action: 'create_export_window' });

        expect(nameOf()).toBe('claim_idempotency_key');
        expect(argsOf().p_collection).toBe('idempotency_keys');
    });

    it('reads held_at, the snake_case column the function returns', async () => {
        rpcReturns({ claimed: false, held_at: '2026-03-01T00:00:00.000Z' });
        const { claimIdempotencyKey } = await ledger();

        expect(await claimIdempotencyKey({ key: 'k-1' }))
            .toEqual({ claimed: false, heldAt: '2026-03-01T00:00:00.000Z' });
    });
});

describe('claimVersionedUpdate', () => {
    it('distinguishes a missing record from a lost claim', async () => {
        // Confusing the two turns "no such record" into a spurious "someone
        // else edited this".
        rpcReturns({ claimed: false, version: null });
        const { claimVersionedUpdate } = await ledger();

        expect(await claimVersionedUpdate({ table: 't', id: 'i', expectedVersion: 3 }))
            .toEqual({ claimed: false, version: null });

        rpcReturns({ claimed: false, version: 7 });
        expect(await claimVersionedUpdate({ table: 't', id: 'i', expectedVersion: 3 }))
            .toEqual({ claimed: false, version: 7 });
    });

    it('treats version 0 as a version, not as absent', async () => {
        rpcReturns({ claimed: true, version: 0 });
        const { claimVersionedUpdate } = await ledger();

        expect((await claimVersionedUpdate({ table: 't', id: 'i' })).version).toBe(0);
    });

    it('asserts nothing when no expected version is given, but still locks', async () => {
        rpcReturns({ claimed: true, version: 1 });
        const { claimVersionedUpdate } = await ledger();

        await claimVersionedUpdate({ table: 't', id: 'i' });
        expect(argsOf().p_expected).toBeNull();
    });
});

describe('claimSingleOpenLoanApplication', () => {
    it('names the blocking application when it refuses', async () => {
        rpcReturns({ claimed: false, existing_id: 'loan-9' });
        const { claimSingleOpenLoanApplication } = await ledger();

        const result = await claimSingleOpenLoanApplication({
            userId: 'u-1', id: 'loan-10', table: 'cooperative_loans', row: { amount: 1 },
        });

        expect(argsOf().p_target_table).toBe('cooperative_loans');
        expect(result).toEqual({ claimed: false, existingId: 'loan-9' });
    });
});

// ─── counters ────────────────────────────────────────────────────────────────

describe('decrementManyOrFail', () => {
    it('succeeds trivially on an empty basket, without calling the database', async () => {
        const { decrementManyOrFail } = await ledger();

        expect(await decrementManyOrFail([])).toEqual({ ok: true, failedId: null, reason: null });
        expect(mockRpc).not.toHaveBeenCalled();
    });

    it('names the item that could not afford the change', async () => {
        rpcReturns({ ok: false, failed_id: 'p-2', reason: 'insufficient_stock' });
        const { decrementManyOrFail } = await ledger();

        const result = await decrementManyOrFail([
            { collection: 'products', id: 'p-1', field: 'stock', amount: 1 },
            { collection: 'products', id: 'p-2', field: 'stock', amount: 4 },
        ]);

        expect(result).toEqual({ ok: false, failedId: 'p-2', reason: 'insufficient_stock' });
    });

    it('validates every item before sending any of them', async () => {
        const { decrementManyOrFail } = await ledger();

        await expect(decrementManyOrFail([
            { collection: 'products', id: 'p-1', field: 'stock', amount: 1 },
            { collection: 'products', id: 'p-2', field: 'stock', amount: 0 },
        ])).rejects.toThrow('amount must be positive for p-2');
        expect(mockRpc).not.toHaveBeenCalled();
    });
});

describe('incrementWithinCeiling', () => {
    it('passes the ceiling field so the cap is read from the same record', async () => {
        rpcReturns({ ok: true, value: 12, reason: null });
        const { incrementWithinCeiling } = await ledger();

        await incrementWithinCeiling({
            collection: 'events', id: 'e-1', field: 'currentParticipants',
            amount: 1, ceilingField: 'maxParticipants',
        });

        expect(argsOf().p_ceiling_field).toBe('maxParticipants');
    });

    it('reports a refusal without inventing a value', async () => {
        rpcReturns({ ok: false, value: 20, reason: 'at_capacity' });
        const { incrementWithinCeiling } = await ledger();

        expect(await incrementWithinCeiling({
            collection: 'c', id: 'i', field: 'f', amount: 1, ceilingField: 'max',
        })).toEqual({ ok: false, value: 20, reason: 'at_capacity' });
    });
});

// ─── the two that must never throw ───────────────────────────────────────────

describe('markFulfilmentFailed', () => {
    it('patches the processed_payments row, which is keyed by the reference', async () => {
        mockRpc.mockResolvedValue({ data: null, error: null });
        const { markFulfilmentFailed } = await ledger();

        await markFulfilmentFailed('PSK-1', 'Escrow row could not be written');

        expect(nameOf()).toBe('apply_document_patch');
        expect(argsOf()).toMatchObject({ p_table: 'processed_payments', p_id: 'PSK-1' });
        const patch: any = argsOf().p_patch;
        expect(patch.status).toBe('fulfilment_failed');
        expect(patch.fulfilmentError).toBe('Escrow row could not be written');
    });

    it('truncates a runaway reason rather than storing it whole', async () => {
        mockRpc.mockResolvedValue({ data: null, error: null });
        const { markFulfilmentFailed } = await ledger();

        await markFulfilmentFailed('PSK-1', 'x'.repeat(2_000));
        expect(String((argsOf().p_patch as any).fulfilmentError)).toHaveLength(500);
    });

    it('never throws when the patch errors — the caller is mid-catch', async () => {
        // It is called on the way to re-raising the ORIGINAL error. Throwing
        // here would replace the reason the payment failed.
        mockRpc.mockResolvedValue({ data: null, error: { message: 'table is gone' } });
        const { markFulfilmentFailed } = await ledger();

        await expect(markFulfilmentFailed('PSK-1', 'reason')).resolves.toBeUndefined();
    });

    it('and never throws when the RPC itself rejects', async () => {
        mockRpc.mockRejectedValue(new Error('connection reset'));
        const { markFulfilmentFailed } = await ledger();

        await expect(markFulfilmentFailed('PSK-1', 'reason')).resolves.toBeUndefined();
    });
});

describe('compensateJsonbDebit', () => {
    const mockUpdate = jest.fn(async (_patch: any) => undefined);

    beforeEach(() => {
        mockUpdate.mockClear();
        mockUpdate.mockResolvedValue(undefined);
        jest.doMock('@/lib/supabase-db', () => ({
            supabaseDb: { collection: () => ({ doc: () => ({ update: (p: any) => mockUpdate(p) }) }) },
        }));
    });

    it('puts the amount back, and any counter the failed work had already moved', async () => {
        const { compensateJsonbDebit } = await ledger();

        await compensateJsonbDebit({
            table: 'document_collections', id: 'm-1', field: 'savingsBalance',
            amount: 10_000, reason: 'withdrawal request row could not be written',
            also: { lockedBalance: -10_000 }, collection: 'cooperative_members',
        });

        expect(mockUpdate).toHaveBeenCalledTimes(1);
        const patch: any = mockUpdate.mock.calls[0][0];
        expect(patch).toHaveProperty('savingsBalance');
        expect(patch).toHaveProperty('lockedBalance');
        expect(patch).toHaveProperty('updatedAt');
    });

    it('never throws when the compensation itself fails', async () => {
        // The irreducible case. The caller is already handling a failure and
        // masking it with a second one helps nobody; it is logged with every
        // identifier needed to settle by hand.
        mockUpdate.mockRejectedValue(new Error('connection reset'));
        const { compensateJsonbDebit } = await ledger();

        await expect(compensateJsonbDebit({
            table: 't', id: 'i', field: 'f', amount: 1, reason: 'x',
        })).resolves.toBeUndefined();
    });
});

// ─── the contract with Postgres ──────────────────────────────────────────────

/**
 * EVERY RPC THIS FILE CALLS, CHECKED AGAINST THE MIGRATION THAT DEFINES IT.
 *
 * This is a projection between two systems that neither of them tests. The two
 * halves fail very differently:
 *
 *   an ARGUMENT name that does not match the SQL signature — PostgREST cannot
 *   resolve the overload, the call errors, and every money path using it is
 *   down. Loud, and found in minutes.
 *
 *   a COLUMN name that does not match `RETURNS TABLE` — SILENT. `row.balance`
 *   is undefined, `Number(undefined ?? 0)` is 0 and `Boolean(undefined)` is
 *   false. A debit that succeeded reports `ok: false`; a wallet reports a zero
 *   balance. Nothing errors and nothing logs.
 *
 * Both were sound when this was written. The point is that they stay sound:
 * rename a parameter in a migration and not here, or here and not there, and
 * this fails. It is the same shape as the ratchet #343 added for lib/auth.ts
 * reading fields off a cached profile the builder never set.
 */
describe('the RPC contract with the migrations', () => {
    const { readFileSync, readdirSync } = require('fs');
    const { join } = require('path');

    const LEDGER = join(process.cwd(), 'src/lib/wallet-ledger.ts');
    const MIGRATIONS = join(process.cwd(), 'supabase/migrations');

    /** Every `supabaseAdmin.rpc("name", { ... })` call, with its argument names. */
    function rpcCalls(): Array<{ name: string; args: string[]; columns: string[] }> {
        const src: string = readFileSync(LEDGER, 'utf-8');
        const found: Array<{ name: string; args: string[]; columns: string[] }> = [];
        const re = /supabaseAdmin\.rpc\(\s*"([a-z_]+)"\s*,\s*\{/g;

        let m: RegExpExecArray | null;
        const starts: Array<{ name: string; open: number }> = [];
        while ((m = re.exec(src)) !== null) {
            starts.push({ name: m[1], open: src.indexOf('{', m.index + m[0].length - 1) });
        }

        starts.forEach((call, i) => {
            // Balanced scan of the argument object.
            let depth = 0;
            let end = call.open;
            for (; end < src.length; end++) {
                if (src[end] === '{') depth++;
                else if (src[end] === '}') { depth--; if (depth === 0) break; }
            }
            const body = src.slice(call.open, end + 1);

            const args: string[] = [];
            let nesting = 0;
            for (const line of body.split('\n')) {
                const key = line.trim().match(/^(p_[a-z_]+)\s*:/);
                if (key && nesting <= 1) args.push(key[1]);
                nesting += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
            }

            // Columns are read between this call and the next one.
            const nextStart = i + 1 < starts.length ? starts[i + 1].open : src.length;
            const segment = src.slice(end, nextStart);
            const columns = [...new Set(
                [...segment.matchAll(/\b(?:row|r)\.([a-z_]+)/g)].map((c) => c[1]),
            )];

            found.push({ name: call.name, args: [...new Set(args)], columns });
        });

        return found;
    }

    /**
     * Every SQL function, by a BALANCED SCAN rather than one regex.
     *
     * A single expression over the concatenated migrations over-matches: the
     * non-greedy parameter group runs past a function whose header it cannot
     * close locally and swallows the next definition. That silently dropped
     * claim_payment_once, and a ratchet that quietly stops seeing one of the
     * things it checks is worse than no ratchet — hence the premise test above.
     */
    function sqlFunctions(): Record<string, { params: string[]; columns: string[] }> {
        const sql = readdirSync(MIGRATIONS)
            .filter((f: string) => f.endsWith('.sql'))
            .sort()
            .map((f: string) => readFileSync(join(MIGRATIONS, f), 'utf-8'))
            .join('\n');

        const out: Record<string, { params: string[]; columns: string[] }> = {};
        const head = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_]+)\s*\(/gi;

        let m: RegExpExecArray | null;
        while ((m = head.exec(sql)) !== null) {
            const open = sql.lastIndexOf('(', head.lastIndex);
            let depth = 0;
            let close = open;
            for (; close < sql.length; close++) {
                if (sql[close] === '(') depth++;
                else if (sql[close] === ')') { depth--; if (depth === 0) break; }
            }

            const params = [...new Set(
                [...sql.slice(open, close).matchAll(/\b(p_[a-z_]+)\b/g)].map((x) => x[1]),
            )];

            const after = sql.slice(close + 1, close + 400);
            const bodyAt = after.search(/\bAS\s*\$\$|\bLANGUAGE\b/i);
            const returns = bodyAt >= 0 ? after.slice(0, bodyAt) : after;
            const table = returns.match(/TABLE\s*\(([\s\S]*?)\)/i);
            const columns = table
                ? [...table[1].matchAll(/(\w+)\s+(?:BOOLEAN|TEXT|NUMERIC|INT|BIGINT|JSONB|TIMESTAMPTZ)/gi)]
                      .map((c) => c[1].toLowerCase())
                : [];

            // A later migration replacing a function wins, which is what the
            // database ends up with.
            out[m[1]] = { params, columns };
        }
        return out;
    }

    const calls = rpcCalls();
    const functions = sqlFunctions();

    it('finds every RPC call in the module', () => {
        // The premise. If the parser stops matching, everything below passes
        // vacuously — which is the failure mode a ratchet must not have.
        const names = calls.map((c) => c.name);

        expect(names.length).toBeGreaterThanOrEqual(11);
        expect(names).toEqual(expect.arrayContaining([
            'credit_wallet_once', 'debit_wallet_once', 'debit_wallet_locked',
            'claim_payment_once', 'claim_idempotency_key', 'debit_jsonb_balance',
            'debit_jsonb_balance_with_floor', 'claim_versioned_update',
            'decrement_many_or_fail', 'increment_within_ceiling',
            'claim_single_open_loan_application',
        ]));
    });

    it('and parses every migration that defines one', () => {
        for (const { name } of calls) {
            expect(functions[name]).toBeDefined();
        }
    });

    it.each(
        [...new Map(calls.map((c) => [c.name, c])).values()].map((c) => [c.name, c] as const),
    )('%s is called with the parameters it declares', (_name: string, call: any) => {
        const declared = functions[call.name].params;
        for (const arg of call.args) {
            expect(declared).toContain(arg);
        }
    });

    it.each(
        [...new Map(calls.map((c) => [c.name, c])).values()]
            .filter((c) => c.columns.length > 0)
            .map((c) => [c.name, c] as const),
    )('%s is read for the columns it returns', (_name: string, call: any) => {
        const declared = functions[call.name].columns;
        // Only checked where the function is a RETURNS TABLE; a scalar return
        // has no column names to disagree about.
        if (declared.length === 0) return;
        for (const column of call.columns) {
            expect(declared).toContain(column);
        }
    });
});
