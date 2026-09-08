/**
 * @jest-environment node
 */

/**
 *   #520 THE ONE READER THAT READ THE TWO STATUS FIELDS BACKWARDS, AND COUNTED
 *        EVERY APPROVED MEMBER AS PENDING.
 *
 *   A cooperative membership row is created by _coop_registration carrying
 *   THREE status fields:
 *
 *       membershipStatus: "pending",
 *       paymentStatus:    "pending",
 *       status:           "pending"
 *
 *   Approval updates `membershipStatus` and leaves `status` alone. So an
 *   approved member carries `membershipStatus: "active"` and, for ever,
 *   `status: "pending"`.
 *
 *   Every reader on this platform resolves that with `membershipStatus ||
 *   status` — module-access-check, sms-broadcast, in-app-broadcast,
 *   broadcast-logic — and lib/cooperative-membership-status.ts already wrote the
 *   rule down and said why: "`membershipStatus` is preferred over `status`,
 *   which some legacy rows carry instead".
 *
 *   services/userMetrics.service.ts read them the other way round:
 *
 *       const statusVal = m.status || m.membershipStatus || "pending";
 *
 *   `status` is "pending" on every row that has ever been approved, so it won,
 *   every time. The cooperative admin report counted approved members as
 *   pending — and its OWN DOCSTRING says "approvedCount: docs where
 *   membershipStatus is 'active' OR 'approved'", which the code directly
 *   contradicted. It is live: _coop_admin_reports.ts calls it.
 *
 *   The rule lives in memberStatusOf now and every reader asks it, so another
 *   copy cannot be written in either direction.
 *
 *   THE RATCHET FOUND TWO MORE THE MOMENT IT SWEPT THE TREE, and both are
 *   reversed like userMetrics and both are user-facing:
 *
 *     api/admin/verify-id/lookup    `membData?.status || membData?.membershipStatus`
 *                                   — so an admin SCANNING AN APPROVED MEMBER'S
 *                                   ID CARD was shown "pending".
 *     admin/cooperatives/members    the detail panel displayed the same wrong
 *                                   value, and its approve/reject controls were
 *                                   gated on `app.status === "pending" ||
 *                                   app.data.membershipStatus === "pending"` —
 *                                   an OR, so an ALREADY-APPROVED member still
 *                                   showed the approve button.
 *
 *   That is why the sweep is in this file rather than a note: I had found three
 *   copies by grepping and believed I had them all.
 *
 * ── AND ORPHANED PAYMENTS WERE COUNTED AS PAID MEMBERS ──────────────────────
 *
 *   `validPaidUserIds` holds every user with a completed cooperative
 *   registration payment, including users with NO membership row — which the
 *   same function counts separately and calls orphaned. `paidMembersCount` was
 *   then `Math.min(validPaidUserIds.size, totalApplications)`, so those orphans
 *   counted toward paid membership, and `unpaidMembers`, derived by
 *   subtraction, understated by the same amount.
 *
 *   Not hypothetical here: this audit measured 48 cooperative_members
 *   references with no matching profile, and twelve completed registration
 *   payments whose references match no generator in this codebase. Counting the
 *   INTERSECTION is what "members who have paid" always meant, and it makes the
 *   Math.min clamp unnecessary rather than load-bearing.
 *
 * ── WHAT WAS CHECKED AND IS NOT CLAIMED ─────────────────────────────────────
 *
 *   fetchAllDocs pages with `.limit(1000).offset(n)` and no ORDER BY, which in
 *   Postgres is normally an unstable scan that can duplicate and skip rows. It
 *   is NOT a defect here: supabase-db applies `query.order('id')` whenever no
 *   orderBy was given, so the scan is ordered. I went looking for that before
 *   reporting it.
 *
 *   communications.service.ts has real defects — a catch returning [] so a
 *   broadcast to nobody reports success, a `status === "suspended"` filter on
 *   the field #518 proved nothing writes, an "active" audience that resolves to
 *   approved sellers only, and a silent `.limit(10000)` against 42,160 users.
 *   NONE of it is reachable: its only caller is sendBulkEmailAction, which #395
 *   already retired behind ADMIN_BULK_EMAIL_ACTION, and the live broadcast path
 *   is /api/admin/broadcast/send with its own targeting. Reporting it as a live
 *   defect would have been the mistake this audit has already made twice.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the precedence reversed again                   KILLED
 *     memberStatusOf ignoring membershipStatus        KILLED
 *     paidMembersCount back to the Math.min clamp     KILLED
 *     a sixth hand-written copy introduced            KILLED
 *     reword this header                              SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { memberStatusOf } from '@/lib/cooperative-membership-status';

let store: FakeDbHandle;

const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;
const PAYMENTS = COLLECTIONS.PROCESSED_PAYMENTS;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

const metrics = async (scope?: string) => {
    const { UserMetricsService } = await import('@/services/userMetrics.service');
    return (await UserMetricsService.getCooperativeMemberMetrics(scope)) as any;
};

/** A member as registration actually creates one, then approval updates it. */
function seedMember(id: string, over: Record<string, unknown> = {}): void {
    store.seed(MEMBERS, id, {
        userId: id,
        membershipStatus: 'pending',
        paymentStatus: 'pending',
        status: 'pending',
        ...over,
    });
}

function seedPayment(id: string, userId: string): void {
    store.seed(PAYMENTS, id, {
        userId,
        type: 'cooperative_membership_registration',
        status: 'completed',
        amount: 10_000,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#520 — an approved member is counted as approved', () => {
    it('APPROVAL UPDATES membershipStatus AND status STAYS "pending" — AND IT COUNTS AS APPROVED', async () => {
        //   THE test, seeded the way the platform actually writes: registration
        //   sets all three fields, approval touches one.
        seedMember('m1', { membershipStatus: 'active' });   // status still "pending"
        seedMember('m2');                                    // never approved

        const res = await metrics();

        expect(res.approvedCount).toBe(1);
        expect(res.pendingCount).toBe(1);
    });

    it('AND THE LEGACY "approved" SPELLING COUNTS TOO', async () => {
        //   cooperative-membership-status.ts: "'approved' is not a lesser
        //   status … it is the legacy spelling of the same state".
        seedMember('m1', { membershipStatus: 'approved' });

        expect((await metrics()).approvedCount).toBe(1);
    });

    it('AND A ROW WITH ONLY status STILL RESOLVES', async () => {
        //   The legacy shape the precedence exists to tolerate.
        store.seed(MEMBERS, 'm1', { userId: 'm1', status: 'active' });

        expect((await metrics()).approvedCount).toBe(1);
    });

    it('and a suspended member is neither approved nor pending', async () => {
        seedMember('m1', { membershipStatus: 'suspended' });

        const res = await metrics();
        expect(res.suspendedCount).toBe(1);
        expect(res.approvedCount).toBe(0);
        expect(res.pendingCount).toBe(0);
    });

    it('and the total still counts every row', async () => {
        //   The vacuity guard: a change that dropped rows would satisfy the
        //   assertions above.
        seedMember('m1', { membershipStatus: 'active' });
        seedMember('m2');
        seedMember('m3', { membershipStatus: 'suspended' });

        expect((await metrics()).totalApplications).toBe(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#520 — paid means a member who paid', () => {
    it('AN ORPHANED PAYMENT IS NOT A PAID MEMBER', async () => {
        //   THE test for the arithmetic. One member who has not paid, and a
        //   completed payment from somebody with no membership row: the old
        //   Math.min form reported 1 paid and 0 unpaid.
        seedMember('m1');
        seedPayment('p-orphan', 'ghost-user');

        const res = await metrics();

        expect(res.paidMembersCount).toBe(0);
        expect(res.unpaidMembers).toBe(1);
        expect(res.orphanedPaymentsCount).toBe(1);
    });

    it('AND A MEMBER WHO PAID THROUGH PAYSTACK IS COUNTED', async () => {
        //   The control: counting the intersection must not stop counting.
        seedMember('m1');
        seedPayment('p1', 'm1');

        const res = await metrics();
        expect(res.paidMembersCount).toBe(1);
        expect(res.unpaidMembers).toBe(0);
    });

    it('and a legacy member marked paid on the row is counted', async () => {
        //   The documented second source: "any legacy doc where paymentStatus
        //   === 'completed'".
        seedMember('m1', { paymentStatus: 'completed' });

        expect((await metrics()).paidMembersCount).toBe(1);
    });

    it('and both sources together do not double count', async () => {
        seedMember('m1', { paymentStatus: 'completed' });
        seedPayment('p1', 'm1');

        expect((await metrics()).paidMembersCount).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#520 — the helper itself', () => {
    it('PREFERS membershipStatus', () => {
        expect(memberStatusOf({ membershipStatus: 'active', status: 'pending' })).toBe('active');
    });

    it('and falls back to status, and then to pending', () => {
        expect(memberStatusOf({ status: 'active' })).toBe('active');
        expect(memberStatusOf({})).toBe('pending');
        expect(memberStatusOf(null)).toBe('pending');
    });

    it('and is tolerant of casing and whitespace', () => {
        expect(memberStatusOf({ membershipStatus: '  Active ' })).toBe('active');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#520 — the ratchet: no sixth copy, in either direction', () => {
    function sourceFiles(): string[] {
        const out: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const p = join(dir, entry);
                if (statSync(p).isDirectory()) {
                    if (entry === '__tests__' || entry === 'node_modules') continue;
                    walk(p);
                } else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
            }
        };
        walk(join(process.cwd(), 'src'));
        return out;
    }

    it('NO FILE HAND-WRITES THE PRECEDENCE', () => {
        //   Either order. The reversed spelling is the defect; the correct one
        //   is how the defect stayed invisible for five copies.
        const BY_HAND = /\.membershipStatus\s*\|\|\s*[\w.]+\.status|\.status\s*\|\|\s*[\w.]+\.membershipStatus/;
        const offenders = sourceFiles()
            .filter((f) => BY_HAND.test(stripComments(readFileSync(f, 'utf-8'), { label: f })))
            .map((f) => relative(process.cwd(), f))
            // broadcast-logic asks a caller-chosen field FIRST, which is a
            // different question and not this precedence.
            .filter((f) => f !== join('src', 'lib', 'broadcast-logic.ts'));

        expect(offenders).toEqual([]);
    });

    it('AND THE SWEEP ACTUALLY WALKED THE TREE', () => {
        //   #484's shape: a control that reads as present and is none.
        const files = sourceFiles();

        expect(files.length).toBeGreaterThan(500);
        const callers = files.filter((f) => readFileSync(f, 'utf-8').includes('memberStatusOf('));
        expect(callers.length).toBeGreaterThanOrEqual(4);
    });
});
