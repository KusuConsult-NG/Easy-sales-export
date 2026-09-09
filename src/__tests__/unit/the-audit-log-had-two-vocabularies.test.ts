/**
 * @jest-environment node
 */

/**
 *   #533 THE AUDIT LOG HAD TWO VOCABULARIES, AND ONE MODULE'S APPROVALS WERE
 *        FILED UNDER ANOTHER MODULE'S NAME.
 *
 *   AuditAction is a union of 165 names and it is the platform's whole
 *   vocabulary for "what happened". Nine names were being written into the log
 *   that it has never contained:
 *
 *     _ac_admin_catalog.ts   CREATE_COURSE, UPDATE_COURSE
 *     _coop_admin_money.ts   APPROVE_WITHDRAWAL, REJECT_WITHDRAWAL
 *     _ex_investments.ts     EXTEND_ESCROW
 *     _fn_admin.ts           VERIFY_PROPERTY, UNVERIFY_PROPERTY
 *     approve-member route   filed as 'wave_approve'
 *     reject-member route    filed as 'wave_reject'
 *
 *   SCREAMING_CASE is not a style disagreement here. Nothing else in the union
 *   is written that way except three legacy FETCH_ names, so a course creation
 *   could not be found beside any other content event, and an approved
 *   cooperative withdrawal could not be found beside the ones the admin queue
 *   records.
 *
 * ── THE WORST OF THEM IS NOT A CASE PROBLEM ─────────────────────────────────
 *
 *       await logAuditAction("wave_approve", memberId, "cooperative_member", {
 *           adminId: session.user.id,
 *           action: "cooperative_membership_approved",
 *       });
 *
 *   A COOPERATIVE membership approval, filed under WAVE's action name, with the
 *   name it meant put in the METADATA — where nothing that reads the log looks
 *   for an action. So "who approved this cooperative member" returned nothing
 *   from a search of cooperative actions, and an audit of WAVE approvals
 *   returned cooperative rows. Both halves wrong, from one line. The rejection
 *   route does the same with 'wave_reject'.
 *
 *   The platform names this act per module already — academy_approve,
 *   wave_approve, export_approve, farm_nation_reject — and simply had no
 *   cooperative pair. It has one now.
 *
 * ── HOW A SECOND VOCABULARY GOT IN, AND WHY IT CANNOT AGAIN ─────────────────
 *
 *   LegacyAuditLogEntry declared `action: string`, and the implementation then
 *   wrote `entry.action as AuditAction`. logAuditAction's own parameter was
 *   `actionOrEntry: any`, so neither an object literal nor a positional call was
 *   ever checked. A union of 165 names, a field that accepts any string, and a
 *   cast that accepts anything at all.
 *
 *   Both are typed now, and the COMPILER enumerated the class: tightening them
 *   produced exactly five TS2322 errors naming seven of the nine offenders — a
 *   stronger and cheaper instrument than any sweep in this file, and one that
 *   fails `npm run build` rather than waiting for a test run.
 *
 * ── AND ONE OF THEM ALSO THREW ──────────────────────────────────────────────
 *
 *   _verifyPropertyAction logged through logAuditAction, which routes to
 *   createAuditLog — the form that RETHROWS. By the time that line runs the
 *   parcel has already been transitioned: claimStatusTransitionFromAny has
 *   claimed it and written `verified`. So a failed log write landed in the
 *   function's outer catch and returned success:false for a verification that
 *   HAD happened — the admin told the parcel was not verified while the listing
 *   says it was. recordAdminAction exists for exactly this, its own header
 *   describes the same failure on the withdrawal path, and the two sibling
 *   actions in that very file already used it. Two of three again.
 *
 * ── WHAT WAS CHECKED AND IS NOT CLAIMED ─────────────────────────────────────
 *
 *   THE UNION ALREADY HELD TWO SPELLINGS OF ONE EVENT before this finding:
 *   'withdrawal_approve'/'withdrawal_reject' (written by the admin queue) and
 *   'withdrawal_approved'/'withdrawal_rejected' (written by the wallet queue).
 *   That is a real duplication and it is NOT changed here — both are live, both
 *   are correct English, and converting a working path for tidiness is a change
 *   with no defect behind it. The new cooperative withdrawal rows use the admin
 *   queue's spelling so that one search finds every admin-processed withdrawal.
 *   It is recorded rather than quietly left.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the cooperative approval back under wave_approve   KILLED
 *     the cooperative rejection back under wave_reject   KILLED
 *     the property row back on the throwing logger       KILLED
 *     a SCREAMING name restored                          KILLED (by tsc)
 *     the union's action field loosened to string        KILLED
 *     reword this header                                 SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

/**
 * The status transition, mocked — the pattern the four suites that touch it use.
 *
 * claimStatusTransitionFromAny issues a real Supabase RPC over HTTP; the fake
 * database does not intercept it, so an unmocked call comes back
 * "Status transition failed: TypeError: fetch failed" and the action reports
 * success:false. That reads exactly like the defect under test and is the
 * harness, so it is mocked rather than interpreted — and the mock WRITES the
 * patch into the fake store, because the last assertion below is about the
 * parcel still being verified after the audit write fails.
 */
const mockClaim = jest.fn(async (opts: any) => {
    const current = (store.get(opts.collection, opts.id) ?? {}) as Record<string, unknown>;
    if (!opts.fromAny.includes(String(current.status))) {
        return { claimed: false, status: current.status ?? null, exists: current !== undefined };
    }
    store.seed(opts.collection, opts.id, { ...current, ...opts.patch, status: opts.to });
    return { claimed: true, status: current.status, exists: true };
}) as jest.Mock<any>;

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (...a: any[]) => (mockClaim as any)(...a),
    claimStatusTransitionFromAny: (...a: any[]) => (mockClaim as any)(...a),
}));

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: p });

const AUDIT_LOG = 'src/lib/audit-log.ts';

/**
 * The text of an `action:` property's value, up to the comma that closes it.
 *
 * Depth-aware because the value is often a nested ternary spanning lines, and
 * because the properties after it (`targetType: "academy_application"`) look
 * exactly like action names to a fixed-width window.
 */
function actionValue(after: string): string {
    let depth = 0;
    for (let i = 0; i < after.length; i++) {
        const c = after[i];
        if (c === '(' || c === '{' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (c === '}') { if (depth === 0) return after.slice(0, i); depth--; }
        else if (c === ',' && depth === 0) return after.slice(0, i);
    }
    return after.slice(0, 300);
}

/** Every name the platform admits, read from the union itself. */
function knownActions(): Set<string> {
    const src = readFileSync(join(ROOT, AUDIT_LOG), 'utf-8');
    const union = src.slice(
        src.indexOf('export type AuditAction'),
        src.indexOf('const AUDIT_LOGS_COLLECTION'),
    );
    return new Set([...union.matchAll(/\|\s*'([^']+)'/g)].map((m) => m[1]));
}

let store: FakeDbHandle;

/**
 * recordAdminAction goes to a DIFFERENT global than createAdminAuditLog.
 *
 * In the real module the two are the same function — `export const
 * createAdminAuditLog = recordAdminAction` — but jest.setup mocks them
 * separately, so a test watching mockCreateAdminAuditLog sees nothing from a
 * caller that used recordAdminAction. Measured after the first run reported an
 * empty array against an action that plainly writes a row.
 */
const mockAudit = (globalThis as any).mockRecordAdminAction as jest.Mock<any>;
const mockLegacyAudit = (globalThis as any).mockCreateAdminAuditLog as jest.Mock<any>;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    mockAudit.mockImplementation(() => Promise.resolve());
    mockLegacyAudit.mockImplementation(() => Promise.resolve());
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#533 — one vocabulary', () => {
    const KNOWN = knownActions();

    it('THE UNION IS THE VOCABULARY, and it is not empty', () => {
        //   #484's shape — every assertion below is measured against this set,
        //   so an empty or mis-sliced union would make them all vacuous.
        expect(KNOWN.size).toBeGreaterThan(150);
        expect(KNOWN.has('land_verified')).toBe(true);
    });

    it('AND IT NOW NAMES THE FOUR EVENTS IT WAS MISSING', () => {
        //   Each of these was being written under a name from somewhere else.
        for (const name of ['cooperative_approve', 'cooperative_reject', 'escrow_extended', 'land_unverified']) {
            expect({ name, known: KNOWN.has(name) }).toEqual({ name, known: true });
        }
    });

    it('NO AUDIT CALL ANYWHERE WRITES A NAME THE UNION DOES NOT HAVE', () => {
        //   THE sweep. Derived from the union and from the call sites, so a
        //   tenth invented name fails here as well as at the compiler.
        const AUDIT_CALL = /(createAdminAuditLog|recordAdminAction|createAuditLog|logAuditAction|logFinancialAction|logAdminFinancialAction)\s*\(/g;
        const offenders: Array<{ file: string; name: string }> = [];

        const walk = (dir: string) => {
            for (const e of readdirSync(dir)) {
                const full = join(dir, e);
                if (statSync(full).isDirectory()) {
                    if (e !== '__tests__' && e !== 'node_modules') walk(full);
                } else if (/\.tsx?$/.test(e) && !full.endsWith('audit-log.ts')) {
                    const src = stripComments(readFileSync(full, 'utf-8'), { label: full });
                    for (const m of src.matchAll(AUDIT_CALL)) {
                        const win = src.slice(m.index!, m.index! + 700);
                        const a = win.indexOf('action:');
                        if (a === -1) continue;
                        //   The VALUE of `action:`, delimited properly — third
                        //   attempt, and the first two are why this is a scanner
                        //   rather than a regex.
                        //
                        //   A single line missed _marketplace.ts, whose nested
                        //   ternary puts its condition on its own line, so the
                        //   window saw only `"approve"`. A fixed 300-character
                        //   window then swallowed the SIBLING properties and
                        //   reported targetType values as action names. The
                        //   value ends at the comma that closes the property,
                        //   and finding it means counting brackets — #512's
                        //   lesson, that a nesting problem needs a scanner.
                        const region = actionValue(win.slice(a + 7))
                            .replace(/[\w.]+\s*[!=]==?\s*["'][^"']*["']/g, '');
                        for (const q of region.matchAll(/["']([A-Za-z_][A-Za-z0-9_:.]*)["']/g)) {
                            if (!KNOWN.has(q[1])) {
                                offenders.push({ file: full.slice(ROOT.length + 1), name: q[1] });
                            }
                        }
                    }
                }
            }
        };
        walk(join(ROOT, 'src'));

        expect(offenders).toEqual([]);
    });

    it('AND THE SWEEP FINDS REAL CALL SITES', () => {
        //   The vacuity guard for the sweep above: if the walk or the regex
        //   stopped matching, "no offenders" would be true of nothing.
        const AUDIT_CALL = /(createAdminAuditLog|recordAdminAction|createAuditLog|logAuditAction)\s*\(/g;
        let sites = 0;
        const walk = (dir: string) => {
            for (const e of readdirSync(dir)) {
                const full = join(dir, e);
                if (statSync(full).isDirectory()) { if (e !== '__tests__') walk(full); }
                else if (/\.tsx?$/.test(e)) {
                    sites += [...readFileSync(full, 'utf-8').matchAll(AUDIT_CALL)].length;
                }
            }
        };
        walk(join(ROOT, 'src/app'));

        expect(sites).toBeGreaterThan(100);
    });

    it('and no SCREAMING name is written by an audit call any more', () => {
        //   Stated as its own shape, because the sweep above would also pass if
        //   somebody ADDED the SCREAMING names to the union.
        for (const gone of ['CREATE_COURSE', 'UPDATE_COURSE', 'APPROVE_WITHDRAWAL',
            'REJECT_WITHDRAWAL', 'EXTEND_ESCROW', 'VERIFY_PROPERTY', 'UNVERIFY_PROPERTY']) {
            expect({ gone, known: knownActions().has(gone) }).toEqual({ gone, known: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#533 — the type is the ratchet', () => {
    it('THE LEGACY ENTRY NO LONGER TAKES ANY STRING', () => {
        //   This is what let the second vocabulary in: `action: string`, then
        //   `entry.action as AuditAction`. Tightening it made the COMPILER
        //   enumerate the class — five TS2322 errors, seven names.
        const src = code(AUDIT_LOG);
        const iface = src.slice(src.indexOf('export interface LegacyAuditLogEntry'));

        expect(iface.slice(0, 300)).toContain('action: AuditAction;');
        expect(iface.slice(0, 300)).not.toContain('action: string;');
    });

    it('AND THE FUNCTION NO LONGER TAKES `any`', () => {
        const src = code(AUDIT_LOG);
        const fn = src.slice(src.indexOf('export async function logAuditAction'));

        expect(fn.slice(0, 400)).toContain('actionOrEntry: AuditAction | LegacyAuditLogEntry');
    });

    it('AND THE TWO CASTS THAT DEFEATED IT ARE GONE', () => {
        const src = code(AUDIT_LOG);

        expect(src).not.toContain('entry.action as AuditAction');
        expect(src).not.toContain('actionOrEntry as AuditAction');
        expect(src).not.toContain('actionOrEntry as LegacyAuditLogEntry');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#533 — a cooperative decision is recorded as a cooperative decision', () => {
    const APPROVE = 'src/app/api/admin/cooperative/approve-member/route.ts';
    const REJECT = 'src/app/api/admin/cooperative/reject-member/route.ts';

    it('THE APPROVAL IS NO LONGER FILED AS wave_approve', () => {
        const src = code(APPROVE);

        expect(src).toContain('logAuditAction("cooperative_approve"');
        expect(src).not.toContain('"wave_approve"');
    });

    it('AND THE REJECTION IS NO LONGER FILED AS wave_reject', () => {
        const src = code(REJECT);

        expect(src).toContain('logAuditAction("cooperative_reject"');
        expect(src).not.toContain('"wave_reject"');
    });

    it('AND THE REAL NAME IS NOT LEFT HIDING IN THE METADATA', () => {
        //   Where it was: the row said wave_approve and the metadata said
        //   cooperative_membership_approved. A reader that filters on the action
        //   never sees the second.
        for (const f of [APPROVE, REJECT]) {
            expect(code(f)).not.toContain('cooperative_membership_');
        }
    });

    it('and both routes still write a row at all', () => {
        //   The vacuity guard: deleting the call satisfies every assertion above.
        for (const f of [APPROVE, REJECT]) {
            expect(code(f)).toContain('logAuditAction(');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#533 — verifying a parcel is recorded without risking the verification', () => {
    const FN = 'src/app/actions/farm-nation/_fn_admin.ts';

    const verify = async (propertyId: string, verified: boolean) => {
        const { verifyPropertyAction } = await import('@/app/actions/farm-nation/_fn_admin');
        return (await verifyPropertyAction(propertyId, verified)) as any;
    };

    beforeEach(() => {
        (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: 'admin-1', roles: ['super_admin'], email: 'a@e.com' } },
            error: null,
        }));
        //   'pending_verification', not 'pending'. APPROVABLE_FROM_STATUSES is
        //   IN_REVIEW_STATUSES + PURCHASABLE_STATUSES + 'rejected', and a bare
        //   'pending' is in none of them — the shared rule #520's neighbours
        //   built. Measured from the module rather than guessed, after the first
        //   run refused the transition and looked like a defect.
        store.seed(COLLECTIONS.LAND_LISTINGS, 'p-1', {
            status: 'pending_verification', ownerId: 'owner-1',
            documents: { cOfO: 'https://res.cloudinary.com/x/cofo.pdf' },
        });
    });

    it('THE ROW USES THE UNION\'S NAME', async () => {
        const res = await verify('p-1', true);

        expect(res.success).toBe(true);
        const rows = mockAudit.mock.calls.map((c: any[]) => c[0]);
        expect(rows).toContainEqual(expect.objectContaining({
            action: 'land_verified',
            targetId: 'p-1',
            targetType: 'land_listing',
        }));
    });

    it('AND UN-VERIFYING HAS A NAME OF ITS OWN', async () => {
        store.seed(COLLECTIONS.LAND_LISTINGS, 'p-1', {
            status: 'verified', ownerId: 'owner-1', verified: true,
            documents: { cOfO: 'https://res.cloudinary.com/x/cofo.pdf' },
        });

        await verify('p-1', false);

        const rows = mockAudit.mock.calls.map((c: any[]) => c[0]);
        expect(rows.map((r: any) => r.action)).toContain('land_unverified');
    });

    it('AND THE WRITER IT USES CANNOT REPORT THE VERIFICATION AS FAILED', async () => {
        //   THE behavioural half, asserted on the REAL function.
        //
        //   The parcel has already been transitioned by the time the row is
        //   written. logAuditAction routes to createAuditLog, which rethrows, so
        //   a failed log write landed in this action's outer catch and returned
        //   success:false for a verification that HAD happened.
        //
        //   Making the MOCK throw would prove nothing — jest.setup's stub has no
        //   try/catch of its own, so it would only show that a throwing function
        //   throws. The property belongs to the real recordAdminAction, and this
        //   executes it: with no database behind it the underlying write fails,
        //   and it still returns normally.
        const actual = jest.requireActual('@/lib/audit-log') as typeof import('@/lib/audit-log');

        //   The failure is INJECTED at the store. Without this the fake happily
        //   writes the row and both assertions pass for the wrong reason —
        //   which is what the first version of this test did, resolving to a
        //   document id and proving nothing about swallowing anything.
        (globalThis as any).mockFirestoreAdd.mockImplementation(() => {
            throw new Error('audit table is down');
        });

        await expect(actual.recordAdminAction({
            action: 'land_verified',
            userId: 'admin-1',
            targetId: 'p-1',
            targetType: 'land_listing',
        })).resolves.toBeUndefined();
    });

    it('AND createAuditLog — the one it used to go through — DOES throw', async () => {
        //   The other half of the same claim, so "recordAdminAction is safe" is
        //   a measured difference rather than an assertion about one function.
        const actual = jest.requireActual('@/lib/audit-log') as typeof import('@/lib/audit-log');

        (globalThis as any).mockFirestoreAdd.mockImplementation(() => {
            throw new Error('audit table is down');
        });

        await expect(actual.createAuditLog({
            action: 'land_verified',
            userId: 'admin-1',
        })).rejects.toBeDefined();
    });

    it('and it uses the same non-throwing writer as its two siblings', () => {
        const src = code(FN);

        expect(src).not.toContain('logAuditAction');
        expect([...src.matchAll(/recordAdminAction\(/g)]).toHaveLength(3);
    });
});
