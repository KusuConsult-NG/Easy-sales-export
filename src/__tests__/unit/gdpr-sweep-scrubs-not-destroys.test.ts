/**
 * @jest-environment node
 */

/**
 * The retention sweep destroyed rows the platform's own module retires — #327.
 *
 * The cron did:
 *
 *     batch.delete(doc.ref);                                  // USERS
 *     batch.delete(db.collection(COOPERATIVE_MEMBERS).doc(uid));
 *
 * under the note "we leave financial transactions and export windows intact for
 * absolute legal ledger integrity, but they are now detached from PII as the
 * user document holding names/banks is destroyed."
 *
 * The reference erasure path — actions/user.ts, built by #283/#300/#305 —
 * deletes nothing. It scrubs the user row with userErasurePatch, marks related
 * rows with erasedOwnerMarker, and writes an ERASURE_RETENTION record. Its own
 * comment says why the row survives: "We retain the UID so that database foreign
 * keys (like 'sellerId' on an order or 'buyerId' on a farm purchase) do not
 * break."
 *
 * This cron destroyed exactly that row thirty days later. The thing the erasure
 * path deliberately retained was removed by the job that runs after it, and the
 * ledger it claims to keep intact was left pointing at nothing. `update()` on a
 * missing document is a documented silent no-op on this adapter, which is the
 * whole reason #300 moved erasure off deletion.
 *
 * The membership row is worse: it holds savings and locked balances, and #319
 * established that the export payout looks it up by user id. Destroying it turns
 * a pending return into an unpayable one. The self-service path REFUSES erasure
 * while those balances are non-zero; this job checked nothing and deleted
 * anyway.
 *
 * Scrubbing is what makes this GDPR-compliant, not destruction — and it is the
 * owner's standing instruction for this codebase.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';
import { ERASED_FIELDS, erasedEmailFor } from '@/lib/user-erasure';

function source(rel: string): string {
    return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });
}

/** collection -> docId -> data */
let DOCS: Record<string, Record<string, any>> = {};
/** Every batched operation, in order. */
let OPS: Array<{ op: 'set' | 'update' | 'delete'; path: string; id: string; data?: any }> = [];

/** Milliseconds from a Date, a Timestamp or an ISO string. */
function millis(v: any): number {
    if (v == null) return NaN;
    if (typeof v?.toMillis === 'function') return v.toMillis();
    if (typeof v?.toDate === 'function') return v.toDate().getTime();
    if (v instanceof Date) return v.getTime();
    return new Date(String(v)).getTime();
}

function makeCollection(name: string): any {
    const filters: Array<[string, string, any]> = [];
    const q: any = {
        where: (f: string, op: string, v: any) => { filters.push([f, op, v]); return q; },
        orderBy: () => q, limit: () => q, all: () => q, select: () => q,
        get: async () => {
            let rows = Object.entries(DOCS[name] ?? {});
            for (const [f, op, v] of filters) {
                // `== null` is the "not yet swept" filter, and it must match a
                // row where the key is ABSENT as well as one holding null —
                // that is what raw_data->>'x' IS NULL does in Postgres.
                if (op === '==' && v === null) rows = rows.filter(([, d]) => (d as any)[f] == null);
                else if (op === '==') rows = rows.filter(([, d]) => (d as any)[f] === v);
                // The 30-day window. A no-op `<=` let a just-deleted account be
                // swept in the test while the real query would have excluded it
                // — the harness reporting a defect the code does not have.
                else if (op === '<=') rows = rows.filter(([, d]) => millis((d as any)[f]) <= millis(v));
            }
            return {
                docs: rows.map(([id, data]) => ({
                    id, data: () => data,
                    ref: { __collection: name, __id: id },
                })),
                empty: rows.length === 0,
            };
        },
        doc: (id: string) => ({ __collection: name, __id: id, id }),
    };
    return q;
}

function applyOp(op: 'set' | 'update' | 'delete', ref: any, data?: any) {
    const path = ref.__collection;
    const id = ref.__id;
    OPS.push({ op, path, id, data });
    if (op === 'delete') { delete DOCS[path]?.[id]; return; }
    (DOCS[path] ||= {})[id] = op === 'set'
        ? { ...(DOCS[path]?.[id] ?? {}), ...data }
        : { ...(DOCS[path]?.[id] ?? {}), ...data };
}

jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: {
        collection: (name: string) => makeCollection(name),
        batch: () => ({
            set: (ref: any, data: any) => applyOp('set', ref, data),
            update: (ref: any, data: any) => applyOp('update', ref, data),
            delete: (ref: any) => applyOp('delete', ref),
            commit: async () => undefined,
        }),
    },
}));

const mockDeleteUser = jest.fn(async (_uid: string) => ({ error: null as any }));
jest.mock('@/lib/supabase', () => ({
    supabaseAdmin: { auth: { admin: { deleteUser: (...a: any[]) => (mockDeleteUser as any)(...a) } } },
}));

jest.mock('@/lib/chatbot-db', () => ({
    purgeChatbotDataOlderThan: jest.fn(async () => 0),
}));

const SECRET = 'test-cron-secret';

async function runSweep() {
    const { GET } = await import('@/app/api/cron/gdpr-purge/route');
    const res: any = await GET({
        headers: { get: (h: string) => (h === 'Authorization' ? `Bearer ${SECRET}` : null) },
    } as any);
    return { status: res.status ?? 200, body: await res.json() };
}

const LONG_AGO = new Date(Date.now() - 60 * 86_400_000).toISOString();

function erasedUser(id: string, extra: Record<string, unknown> = {}) {
    return {
        [id]: {
            deletedAt: LONG_AGO,
            fullName: 'Ada Lovelace',
            firstName: 'Ada', lastName: 'Lovelace',
            email: 'ada@example.com',
            phone: '+2348000000000',
            bvn: '12345678901', nin: '98765432109',
            nextOfKin: { name: 'Someone Else', phone: '+2348111111111' },
            documents: { idCard: 'https://res.cloudinary.com/x/id.png' },
            ...extra,
        },
    };
}

beforeEach(() => {
    jest.resetModules();
    // resetModules does NOT clear call history; both are needed.
    jest.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    delete process.env.GDPR_PURGE_DELETE_AUTH;
    DOCS = {};
    OPS = [];
});

describe('nothing is destroyed', () => {
    it('THE test: the sweep deletes no row at all', async () => {
        DOCS[COLLECTIONS.USERS] = erasedUser('u1');
        DOCS[COLLECTIONS.COOPERATIVE_MEMBERS] = { u1: { userId: 'u1', savingsBalance: 40_000 } };

        await runSweep();

        expect(OPS.filter((o) => o.op === 'delete')).toEqual([]);
        expect(DOCS[COLLECTIONS.USERS].u1).toBeDefined();
        expect(DOCS[COLLECTIONS.COOPERATIVE_MEMBERS].u1).toBeDefined();
    });

    it('the membership balances survive, so a payout owed can still be found', async () => {
        // #319: the export payout looks this row up by user id. Destroying it
        // turned a pending return into an unpayable one.
        DOCS[COLLECTIONS.USERS] = erasedUser('u2');
        DOCS[COLLECTIONS.COOPERATIVE_MEMBERS] = {
            u2: { userId: 'u2', savingsBalance: 40_000, lockedBalance: 5_000 },
        };

        await runSweep();

        expect(DOCS[COLLECTIONS.COOPERATIVE_MEMBERS].u2.savingsBalance).toBe(40_000);
        expect(DOCS[COLLECTIONS.COOPERATIVE_MEMBERS].u2.lockedBalance).toBe(5_000);
    });

    it('the user row survives so the ledger keys it still resolve', async () => {
        // The erasure path retains the UID precisely so `sellerId` on an order
        // keeps resolving. This job used to remove it thirty days later.
        DOCS[COLLECTIONS.USERS] = erasedUser('u3');

        await runSweep();

        expect(DOCS[COLLECTIONS.USERS].u3).toBeDefined();
        expect(source('src/app/api/cron/gdpr-purge/route.ts')).not.toContain('batch.delete(');
    });
});

describe('the PII is genuinely gone', () => {
    it('every field the shared definition names is removed from the user row', async () => {
        DOCS[COLLECTIONS.USERS] = erasedUser('u4');

        await runSweep();

        const patch = OPS.find((o) => o.path === COLLECTIONS.USERS && o.op === 'update')!.data;

        for (const field of ERASED_FIELDS) {
            expect(patch).toHaveProperty(field);
        }
    });

    it('the name and email are replaced, not just dropped', async () => {
        // Several screens read them unconditionally and would render "undefined".
        DOCS[COLLECTIONS.USERS] = erasedUser('u5');

        await runSweep();

        const patch = OPS.find((o) => o.path === COLLECTIONS.USERS && o.op === 'update')!.data;

        expect(patch.fullName).toBe('Redacted User');
        expect(patch.email).toBe(erasedEmailFor('u5'));
    });

    it('the membership row is scrubbed too, not merely marked', async () => {
        // /admin/cooperatives/members writes firstName, lastName, phone, email
        // and nextOfKin onto this row, so marking it alone would leave a name
        // behind on the GDPR enforcer's own watch.
        DOCS[COLLECTIONS.USERS] = erasedUser('u6');
        DOCS[COLLECTIONS.COOPERATIVE_MEMBERS] = {
            u6: { userId: 'u6', firstName: 'Ada', phone: '+2348000000000', savingsBalance: 1 },
        };

        await runSweep();

        const patch = OPS.find((o) => o.path === COLLECTIONS.COOPERATIVE_MEMBERS)!.data;

        expect(patch.ownerErased).toBe(true);
        expect(patch).toHaveProperty('firstName');
        expect(patch).toHaveProperty('phone');
        expect(patch).toHaveProperty('nextOfKin');
    });

    it('the retention record keeps the document references and the email', async () => {
        // Without it the Cloudinary assets outlive the only record of whose they
        // were — #292/#300, closed by the owner as "retain, never delete".
        DOCS[COLLECTIONS.USERS] = erasedUser('u7');

        await runSweep();

        const retention = OPS.find((o) => o.path === COLLECTIONS.ERASURE_RETENTION)!;

        expect(retention.op).toBe('set');
        expect(retention.data.emailAtErasure).toBe('ada@example.com');
        expect(retention.data.documents).toEqual({ idCard: 'https://res.cloudinary.com/x/id.png' });
        expect(retention.data.reason).toBe('right_to_erasure');
    });

    it('the retention record is written BEFORE the row loses its documents', async () => {
        // Order matters: reading the user row after scrubbing it would retain
        // nulls.
        DOCS[COLLECTIONS.USERS] = erasedUser('u8');

        await runSweep();

        const retentionAt = OPS.findIndex((o) => o.path === COLLECTIONS.ERASURE_RETENTION);
        const scrubAt = OPS.findIndex((o) => o.path === COLLECTIONS.USERS && o.op === 'update');

        expect(retentionAt).toBeGreaterThan(-1);
        expect(retentionAt).toBeLessThan(scrubAt);
    });

    it('the account can no longer sign in', async () => {
        // `deleted: true` is read by nothing in the sign-in path; `suspended` is
        // the field lib/auth.ts refuses on.
        DOCS[COLLECTIONS.USERS] = erasedUser('u9');

        await runSweep();

        expect(DOCS[COLLECTIONS.USERS].u9.suspended).toBe(true);
        expect(DOCS[COLLECTIONS.USERS].u9.deleted).toBe(true);
    });
});

describe('a swept row is not swept again forever', () => {
    it('it drops out of the query once marked', async () => {
        // The consequence of not deleting: without a completion marker the same
        // rows would be re-selected every day and the sweep would never reach
        // newer ones.
        DOCS[COLLECTIONS.USERS] = erasedUser('u10');

        const first = await runSweep();
        expect(first.body.erasedCount).toBe(1);

        jest.resetModules();
        OPS = [];
        const second = await runSweep();

        expect(second.body.erasedCount).toBe(0);
        expect(OPS).toEqual([]);
    });

    it('a row that has never been swept is selected', async () => {
        // Vacuity guard on the filter: an `== null` that matched nothing would
        // make the sweep do nothing at all and still report success.
        DOCS[COLLECTIONS.USERS] = erasedUser('u11');

        const { body } = await runSweep();

        expect(body.erasedCount).toBe(1);
    });

    it('a recently deleted account is left alone until the window elapses', async () => {
        DOCS[COLLECTIONS.USERS] = {
            u12: { deletedAt: new Date().toISOString(), fullName: 'Recent' },
        };

        const { body } = await runSweep();

        expect(body.erasedCount).toBe(0);
        expect(DOCS[COLLECTIONS.USERS].u12.fullName).toBe('Recent');
    });
});

describe('the guards that were already right stay right', () => {
    it('an unconfigured secret refuses to run', async () => {
        delete process.env.CRON_SECRET;
        DOCS[COLLECTIONS.USERS] = erasedUser('u13');

        const { status } = await runSweep();

        expect(status).toBe(500);
        expect(OPS).toEqual([]);
    });

    it('a wrong secret refuses to run', async () => {
        DOCS[COLLECTIONS.USERS] = erasedUser('u14');
        const { GET } = await import('@/app/api/cron/gdpr-purge/route');
        const res: any = await GET({
            headers: { get: () => 'Bearer wrong' },
        } as any);

        expect(res.status).toBe(401);
        expect(OPS).toEqual([]);
    });

    it('auth deletion stays behind its explicit flag', async () => {
        // The owner's gate: auth.users is currently the best recovery source for
        // accounts this cron has "purged", so repairing deletion destroys it.
        DOCS[COLLECTIONS.USERS] = erasedUser('u15');

        const { body } = await runSweep();

        expect(body.authDeletionEnabled).toBe(false);
        expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it('and runs when the flag is explicitly set', async () => {
        // Vacuity guard: a gate that can never open is a different defect.
        process.env.GDPR_PURGE_DELETE_AUTH = 'true';
        DOCS[COLLECTIONS.USERS] = erasedUser('u16');

        const { body } = await runSweep();

        expect(body.authDeletionEnabled).toBe(true);
        expect(mockDeleteUser).toHaveBeenCalledWith('u16');
    });
});

describe('the reference path this was aligned with', () => {
    it('the self-service erasure still deletes nothing either', () => {
        // Pinned so the alignment is not later reversed — by making the
        // reference match the cron rather than the other way round.
        const src = source('src/app/actions/user.ts');

        expect(src).toContain('userErasurePatch(userId)');
        expect(src).toContain('erasureRetentionRecord(userId');
        expect(src).not.toContain('batch.delete(');
    });

    it('both paths use the SAME shared definition', () => {
        // COUNTED: the whole point of lib/user-erasure is that there is one
        // list, because a hand-written second one is how #283's omission
        // happened.
        const paths = [
            'src/app/actions/user.ts',
            'src/app/api/cron/gdpr-purge/route.ts',
        ];

        for (const rel of paths) {
            expect(source(rel)).toContain('userErasurePatch(');
        }
    });
});
