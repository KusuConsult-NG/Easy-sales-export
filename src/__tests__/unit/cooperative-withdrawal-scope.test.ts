/**
 * @jest-environment node
 */

/**
 * THE IDOR GUARD ON BOTH WITHDRAWAL DECISIONS CANNOT FIRE.
 *
 * approveWithdrawalAction and rejectWithdrawalAction each carry a check
 * against a cooperative admin touching another cooperative's money:
 *
 *     if (adminScope && data?.cooperativeId && data.cooperativeId !== adminScope) {
 *         throw new Error("Unauthorized: ...another cooperative");
 *     }
 *
 * `adminScope` is always null there, so it never runs. Both actions gate on
 * `finance:process_withdrawals`, which admin-permissions.ts grants to exactly
 * super_admin and admin — asserted below by execution rather than by reading
 * the table — and getAdminScope returns null for precisely those two roles:
 *
 *     if (userRoles.includes("super_admin") || userRoles.includes("admin")) return null;
 *
 * Every caller that passes the gate is unscoped by definition. The guard is
 * unreachable defensive code that reads as protection.
 *
 * AND IT WOULD NOT WORK IF IT WERE REACHED
 * ----------------------------------------
 * Two defects sit behind it, so arming the guard would not be enough.
 *
 * The middle conjunct is falsy when a row has no cooperativeId, which collapses
 * the whole condition to "allowed". Three places create a
 * cooperative_withdrawals row and only ONE records the field:
 *
 *     cooperative/_withdrawal.ts         cooperativeId: membership.cooperativeId || "default"
 *     cooperative/_coop_money.ts         absent
 *     api/cooperative/withdraw/route.ts  absent
 *
 * — and the two that omit it are the member page and the API route, which is
 * to say the two a member actually reaches.
 *
 * WHY FIX A GUARD NOBODY CAN TRIP
 * -------------------------------
 * Because arming it is a one-line change. This codebase says so itself, beside
 * `users:export`: "Granting it to one of them later is a one-line change to a
 * named permission, which is the whole reason these routes moved off
 * isAdmin()." The day `finance:process_withdrawals` is added to
 * cooperative_admin — the obvious next step for a platform with per-cooperative
 * administrators — the guard starts running against rows two-thirds of which
 * cannot satisfy it, and a scoped admin can approve (releasing locked funds) or
 * reject (refunding them) another cooperative's withdrawals.
 *
 * So: the check fails closed on an unlabelled record instead of waving it
 * through, both writers record the cooperative, and a ratchet fires if the
 * permission is ever granted to a role getAdminScope would scope — which is
 * the moment this stops being latent.
 *
 * A platform admin (scope null) is unaffected throughout, so no existing
 * withdrawal becomes unreachable.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { isWithinAdminScope } from '@/lib/cooperative-admin-scope';

const SCOPED_ADMIN = 'admin-of-coop-a';
const MEMBER_OF_B = 'member-of-coop-b';
const COOP_A = 'coop-a';
const COOP_B = 'coop-b';

/** Status transitions run through Postgres CAS, which the fake store cannot serve. */
const claimStatusTransition = jest.fn(
    async (_a: { collection: string; id: string; from: string; to: string; patch: Record<string, unknown> }) => ({
        claimed: true, exists: true, status: 'pending' as string | null,
    }),
);

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (a: any) => claimStatusTransition(a),
    claimStatusTransitionFromAny: (a: any) => claimStatusTransition(a),
}));
// The WHOLE module surface these actions use. A mock covering two thirds of
// it fails as "(0, _auditlog.recordAdminAction) is not a function" inside a
// generic catch, which reads as a defect in the code under test — this audit
// has now hit that trap four times.
jest.mock('@/lib/audit-log', () => ({
    logAuditAction: jest.fn(async () => ({})),
    createAdminAuditLog: jest.fn(async () => ({})),
    recordAdminAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/email-notifications', () => ({
    sendWithdrawalApprovedEmail: jest.fn(async () => ({ success: true })),
    sendWithdrawalRejectedEmail: jest.fn(async () => ({ success: true })),
    getBaseUrl: () => 'https://easysalesexport.com',
}));

let store: FakeDbHandle;

function actAs(id: string, roles: string[]): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() =>
        Promise.resolve({
            session: { user: { id, roles, email: `${id}@example.com` } },
            error: null,
        }),
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    claimStatusTransition.mockImplementation(async () => ({ claimed: true, exists: true, status: 'pending' }));

    // An admin scoped to cooperative A: holds the withdrawal permission, and
    // carries a cooperativeId, which is what getAdminScope reads.
    store.seed(COLLECTIONS.USERS, SCOPED_ADMIN, {
        email: `${SCOPED_ADMIN}@example.com`,
        roles: ['cooperative_admin'],
        cooperativeId: COOP_A,
    });
    store.seed(COLLECTIONS.USERS, MEMBER_OF_B, { email: `${MEMBER_OF_B}@example.com`, fullName: 'Other Member' });
    store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER_OF_B, {
        userId: MEMBER_OF_B, cooperativeId: COOP_B, savingsBalance: 0, lockedBalance: 50_000,
    });
    actAs(SCOPED_ADMIN, ['cooperative_admin']);
});

async function actions() {
    return import('@/app/actions/cooperative/_coop_admin_money');
}

/**
 * A withdrawal by a member of cooperative B, requested 48 hours ago so the
 * approval hold is satisfied and the scope check is what decides.
 */
function seedWithdrawal(id: string, opts: { cooperativeId?: string } = {}): void {
    store.seed(COLLECTIONS.COOPERATIVE_WITHDRAWALS, id, {
        userId: MEMBER_OF_B,
        amount: 50_000,
        status: 'pending',
        requestedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        ...(opts.cooperativeId === undefined ? {} : { cooperativeId: opts.cooperativeId }),
    });
}

// ─── the rule ────────────────────────────────────────────────────────────────

describe('isWithinAdminScope', () => {
    it('lets a platform admin act on anything, labelled or not', () => {
        expect(isWithinAdminScope(null, COOP_B)).toBe(true);
        expect(isWithinAdminScope(null, undefined)).toBe(true);
    });

    it('lets a scoped admin act on their own cooperative', () => {
        expect(isWithinAdminScope(COOP_A, COOP_A)).toBe(true);
    });

    it('refuses a scoped admin another cooperative', () => {
        expect(isWithinAdminScope(COOP_A, COOP_B)).toBe(false);
    });

    it('TREATS AN UNLABELLED RECORD AS "default", NOT AS EVERYONE\'S', () => {
        // The defect in one line. An absent cooperativeId short-circuited the
        // whole condition to false, which read as "allowed" — so an admin of
        // any cooperative could act on it.
        expect(isWithinAdminScope(COOP_A, undefined)).toBe(false);
        expect(isWithinAdminScope(COOP_A, null)).toBe(false);
        expect(isWithinAdminScope(COOP_A, '')).toBe(false);
        expect(isWithinAdminScope(COOP_A, '   ')).toBe(false);
    });

    it('and the admin of "default" still reaches those records', () => {
        // Refusing outright would lock a scoped admin out of the legacy
        // members that make up most of the table. Nine writers already spell
        // absence `cooperativeId || "default"`, so absence has an owner.
        expect(isWithinAdminScope('default', undefined)).toBe(true);
        expect(isWithinAdminScope('default', '')).toBe(true);
        expect(isWithinAdminScope('default', 'default')).toBe(true);
        expect(isWithinAdminScope('default', COOP_B)).toBe(false);
    });
});

// ─── why it is latent, and the ratchet that ends that ────────────────────────

describe('the guard is currently unreachable', () => {
    it('ONLY super_admin AND admin CAN PROCESS WITHDRAWALS', async () => {
        // Computed from the permission table rather than read off it, because
        // the whole finding turns on this set.
        const { hasAdminPermission } = await import('@/lib/admin-permissions');
        const ROLES = [
            'super_admin', 'admin', 'moderator', 'support', 'wave_admin',
            'cooperative_admin', 'marketplace_admin', 'export_admin',
            'farm_nation_admin', 'academy_admin',
        ];

        const holders = ROLES.filter((r) => hasAdminPermission([r], 'finance:process_withdrawals'));

        expect(holders).toEqual(['super_admin', 'admin']);
    });

    it('AND getAdminScope TREATS BOTH OF THEM AS UNSCOPED', async () => {
        // Which is what makes adminScope always null inside the two decisions,
        // and the IDOR check beneath it dead code.
        const { getAdminScope } = await import('@/lib/cooperative-admin-scope');
        store.seed(COLLECTIONS.USERS, 'scoped-super', { roles: ['super_admin'], cooperativeId: COOP_A });
        store.seed(COLLECTIONS.USERS, 'scoped-plain', { roles: ['admin'], cooperativeId: COOP_A });

        // Even carrying a cooperativeId on the profile — the thing that scopes
        // everyone else — these two come back unscoped.
        expect(await getAdminScope('scoped-super', ['super_admin'])).toBeNull();
        expect(await getAdminScope('scoped-plain', ['admin'])).toBeNull();
    });

    it('THE RATCHET: granting the permission to a scopeable role must revisit this file', async () => {
        /**
         * The day `finance:process_withdrawals` is added to cooperative_admin —
         * a one-line change, and the obvious next step for a platform with
         * per-cooperative administrators — the guard below stops being dead and
         * starts deciding who may move whose money.
         *
         * This fails on that line, which is the point. It is not asking for the
         * permission never to be granted; it is asking that whoever grants it
         * reads the guard, the two writers, and this test first.
         */
        const { hasAdminPermission } = await import('@/lib/admin-permissions');
        const { getAdminScope } = await import('@/lib/cooperative-admin-scope');

        const scopeable: string[] = [];
        for (const role of ['cooperative_admin', 'wave_admin', 'marketplace_admin',
            'export_admin', 'farm_nation_admin', 'academy_admin', 'moderator', 'support']) {
            if (!hasAdminPermission([role], 'finance:process_withdrawals')) continue;
            store.seed(COLLECTIONS.USERS, `probe-${role}`, { roles: [role], cooperativeId: COOP_A });
            if ((await getAdminScope(`probe-${role}`, [role])) !== null) scopeable.push(role);
        }

        expect(scopeable).toEqual([]);
    });
});

describe('a platform admin is unaffected by the stricter rule', () => {
    it('can still approve a withdrawal that carries no cooperativeId', async () => {
        // Failing closed must not strand the rows already in the table. It
        // moves them to the admin whose authority covers them — which today is
        // every admin who can reach this action at all.
        store.seed(COLLECTIONS.USERS, 'platform-admin', { roles: ['super_admin'], email: 'p@example.com' });
        actAs('platform-admin', ['super_admin']);
        seedWithdrawal('w-unlabelled');
        const { approveWithdrawalAction } = await actions();

        const res: any = await approveWithdrawalAction('w-unlabelled');

        expect(res.success).toBe(true);
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER_OF_B)!.lockedBalance).toBe(0);
    });

    it('and can still reject one, refunding the member', async () => {
        store.seed(COLLECTIONS.USERS, 'platform-admin', { roles: ['super_admin'], email: 'p@example.com' });
        actAs('platform-admin', ['super_admin']);
        seedWithdrawal('w-unlabelled');
        const { rejectWithdrawalAction } = await actions();

        const res: any = await rejectWithdrawalAction('w-unlabelled', 'incomplete bank details');

        expect(res.success).toBe(true);
        const member = store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER_OF_B)!;
        expect(member.savingsBalance).toBe(50_000);
        expect(member.lockedBalance).toBe(0);
    });

    it('and a role without the permission is refused before scope is consulted', async () => {
        // cooperative_admin today. The refusal is the permission gate, not the
        // IDOR check — worth pinning so the two are not confused when the
        // ratchet above eventually fires.
        seedWithdrawal('w-unlabelled', { cooperativeId: COOP_B });
        const { approveWithdrawalAction } = await actions();

        const res: any = await approveWithdrawalAction('w-unlabelled');

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/unauthorized/i);
        expect(String(res.error)).not.toMatch(/another cooperative/i);
    });
});

// ─── the writers that left the field off ─────────────────────────────────────

describe('every writer of cooperative_withdrawals records the cooperative', () => {
    it('ALL THREE CREATORS SET cooperativeId ON THE WITHDRAWAL ROW ITSELF', () => {
        /**
         * Asserted at the source rather than by driving three flows, because
         * the claim is about a field being present in a literal — which is
         * what a source check establishes and what a behavioural test of any
         * ONE path cannot: the defect was that two paths differed from a
         * third, so exercising one proves nothing about the set.
         *
         * Scoped to the withdrawal literal, not the file. An earlier version
         * searched the whole file for `cooperativeId:` and passed with the
         * withdrawal write stripped, because _coop_money.ts sets that field on
         * a contribution row 400 lines further down. A mutation walked past it.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');

        // Where each file builds the object it writes to the collection.
        const sites: Array<[string, string]> = [
            ['src/app/actions/cooperative/_withdrawal.ts', 'withdrawalRef.set({'],
            ['src/app/actions/cooperative/_coop_money.ts', 'withdrawalRef.set({'],
            ['src/app/api/cooperative/withdraw/route.ts', 'const withdrawalData = {'],
        ];

        for (const [file, anchor] of sites) {
            const text = readFileSync(join(process.cwd(), file), 'utf-8');
            expect({ file, writesCollection: text.includes('COLLECTIONS.COOPERATIVE_WITHDRAWALS') })
                .toEqual({ file, writesCollection: true });

            const at = text.indexOf(anchor);
            expect({ file, foundLiteral: at !== -1 }).toEqual({ file, foundLiteral: true });

            // The literal, to its closing brace at the same indentation.
            const literal = text.slice(at, at + 1400);
            const body = literal.slice(0, literal.indexOf('\n        }'));

            expect({ file, setsCooperativeId: /cooperativeId:\s*\S/.test(body) })
                .toEqual({ file, setsCooperativeId: true });
        }
    });
});

// ─── the same guard where it IS reachable ────────────────────────────────────

/**
 * The withdrawal copies of this guard are latent. The third copy is not.
 *
 * _coop_admin_members.ts gates updateMemberStatusAction on
 * `cooperatives:approve_members`, which cooperative_admin HOLDS — so a
 * genuinely scoped admin reaches the check, unlike the withdrawal actions
 * whose permission only super_admin and admin carry.
 *
 * And the records it guards are mostly unlabelled: admin/_legacy.ts, the bulk
 * legacy member import, writes COOPERATIVE_MEMBERS rows with no cooperativeId,
 * and that import is where most members came from. So the guard collapsed to
 * "allowed" for exactly them, and a cooperative admin could activate, approve
 * or suspend a member of any other cooperative — the thing the comment above
 * it says it prevents.
 */
describe('changing a member\'s status across cooperatives', () => {
    const SCOPED = 'coop-a-admin';

    beforeEach(() => {
        store.seed(COLLECTIONS.USERS, SCOPED, {
            email: 'a@example.com', roles: ['cooperative_admin'], cooperativeId: COOP_A,
        });
        actAs(SCOPED, ['cooperative_admin']);
    });

    async function members() {
        return import('@/app/actions/cooperative/_coop_admin_members');
    }

    it('IS REFUSED FOR A MEMBER WITH NO cooperativeId, WHICH IS MOST OF THEM', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'legacy-member', {
            userId: 'legacy-user', fullName: 'Imported Member', membershipStatus: 'pending',
        });
        const { updateMemberStatusAction } = await members();

        const res: any = await updateMemberStatusAction('legacy-member', 'active');

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/another cooperative/i);
    });

    it('and the member is not activated', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'legacy-member', {
            userId: 'legacy-user', fullName: 'Imported Member', membershipStatus: 'pending',
        });
        const { updateMemberStatusAction } = await members();

        await updateMemberStatusAction('legacy-member', 'active');

        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, 'legacy-member')!.membershipStatus).toBe('pending');
    });

    it('is refused for a member of a named other cooperative', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'b-member', {
            userId: 'b-user', cooperativeId: COOP_B, membershipStatus: 'pending',
        });
        const { updateMemberStatusAction } = await members();

        const res: any = await updateMemberStatusAction('b-member', 'active');

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/another cooperative/i);
    });

    it('but their OWN cooperative\'s member is still theirs to approve', async () => {
        // The fix must not take away the authority a scoped admin does have.
        store.seed(COLLECTIONS.USERS, 'a-user', { email: 'm@example.com', roles: [] });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'a-member', {
            userId: 'a-user', cooperativeId: COOP_A, membershipStatus: 'pending',
        });
        const { updateMemberStatusAction } = await members();

        const res: any = await updateMemberStatusAction('a-member', 'active');

        expect(res.success).toBe(true);
    });
});
