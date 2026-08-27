/**
 * @jest-environment node
 */

/**
 * Suspension revoked nothing, a scoped admin could act on any cooperative, and
 * one member's savings had two field names with the writers split between them.
 *
 * SUSPENSION WAS A LABEL
 * ----------------------
 * updateMemberStatusAction(memberId, "suspended") wrote
 * `membershipStatus: "suspended"` onto the member document and stopped. The
 * USER document was untouched: `roles` still contained "cooperative_member",
 * and `serviceRegistrations.cooperatives.status` still said "active".
 *
 * checkModuleAccess grants cooperative access from EITHER of those — Layer 1
 * is the JWT role alone, Layer 2 the registration status — so a suspended
 * member kept the dashboard, contributions, loans, withdrawals and the member
 * directory. An admin pressing Suspend changed a word on their own screen.
 *
 * Farm Nation already strips the `farmer` role when it rejects a seller. The
 * control existed in one module and was absent in this one.
 *
 * A SCOPED ADMIN COULD ACT ON ANY COOPERATIVE
 * -------------------------------------------
 * getAdminScope WAS called in this function — at the end, to choose which cache
 * keys to clear. It was never used to decide whether the caller was entitled to
 * touch this member. Both withdrawal actions in the sibling file carry that
 * check, labelled "Prevent IDOR"; the one that grants the cooperative_member
 * role and sets isVerified did not.
 *
 * ONE BALANCE, TWO FIELD NAMES
 * ----------------------------
 * The legacy nested member document (cooperatives/{id}/members/{userId}) keys
 * savings `balance`; COOPERATIVE_MEMBERS keys it `savingsBalance`. Four call
 * sites touch a nested member and they did not agree:
 *
 *   dashboard.ts             READ  `balance` only, in the nested branch — while
 *                                  the ROOT branch four lines above already read
 *                                  `savingsBalance ?? balance`
 *   cron/release-escrow      WRITE `savingsBalance`
 *   reject withdrawal        WRITE `balance`
 *
 * So an export return paid into a legacy member's savings by the cron landed in
 * `savingsBalance`, and their dashboard — reading the other name for exactly
 * those members — showed none of it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    readCooperativeBalance,
    balanceFieldOf,
    CANONICAL_BALANCE_FIELD,
} from '@/lib/cooperative-member-balance';

const ADMIN_MEMBERS = 'src/app/actions/cooperative/_coop_admin_members.ts';
const ADMIN_MONEY = 'src/app/actions/cooperative/_coop_admin_money.ts';
const DASHBOARD = 'src/app/actions/dashboard.ts';
const ESCROW_CRON = 'src/app/api/cron/release-escrow/route.ts';
const MODULE_ACCESS = 'src/lib/module-access-check.ts';
const FN_ADMIN = 'src/app/actions/farm-nation/_fn_admin.ts';

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

function fn(rel: string, name: string): string {
    const src = code(rel);
    const start = src.search(new RegExp(`(export )?(async )?function ${name}\\(`));
    expect(start).toBeGreaterThan(-1);
    const after = src.slice(start + 10);
    const end = after.search(/\n(export )?(async )?function /);
    return end > 0 ? after.slice(0, end) : after;
}

describe('what cooperative access is actually granted by', () => {
    it('the role OR the registration status, either one alone', () => {
        // THE premise for the suspension finding. Leaving both in place is why
        // writing membershipStatus revoked nothing.
        const access = code(MODULE_ACCESS);

        expect(access).toContain('if (hasAppAccess(jwtRoles, app))');
        expect(access).toContain('const VALID_STATUSES = ["approved", "active"];');
    });

    it('and "suspended" is in neither list, so revoking works', () => {
        const access = code(MODULE_ACCESS);
        const validLine = access.slice(access.indexOf('const VALID_STATUSES'), access.indexOf('const VALID_STATUSES') + 200);

        expect(validLine).not.toContain('suspended');
    });
});

describe('suspending a member', () => {
    const update = fn(ADMIN_MEMBERS, '_updateMemberStatusAction');

    it('removes the cooperative role', () => {
        // THE test.
        expect(update).toContain('} else if (status === "suspended") {');
        expect(update).toContain('roles: FieldValue.arrayRemove("cooperative_member")');
    });

    it('and takes the registration status down with it', () => {
        expect(update).toContain('"serviceRegistrations.cooperatives.status": "suspended"');
    });

    it('and records who did it', () => {
        expect(update).toContain('"serviceRegistrations.cooperatives.suspendedBy": session.user.id');
    });

    it('while reactivation still restores both, so this is reversible', () => {
        // Vacuity guard: a revocation with no way back would be a worse defect
        // than the one it fixes.
        expect(update).toContain('roles: FieldValue.arrayUnion("cooperative_member")');
        expect(update).toContain('if (status === "active" || status === "approved") {');
    });

    it('which is the same thing Farm Nation already did to a rejected seller', () => {
        // Vacuity guard: the pattern is the platform's own.
        expect(code(FN_ADMIN)).toContain('roles: FieldValue.arrayRemove("farmer")');
    });
});

describe('a cooperative-scoped admin', () => {
    const update = fn(ADMIN_MEMBERS, '_updateMemberStatusAction');

    it('cannot change a member of another cooperative', () => {
        // THE test.
        expect(update).toContain('const memberScope = await getAdminScope(session.user.id, roles);');
        expect(update).toContain('memberScope && memberData.cooperativeId && memberData.cooperativeId !== memberScope');
        expect(update).toContain('Cannot change membership status for another cooperative');
    });

    it('refusing before anything is written', () => {
        const guard = update.indexOf('Cannot change membership status for another cooperative');
        const write = update.indexOf('membershipStatus: status,');

        expect(guard).toBeGreaterThan(-1);
        expect(write).toBeGreaterThan(guard);
    });

    it('which is the check its own siblings already carried', () => {
        // Vacuity guard: both withdrawal actions in the neighbouring file apply
        // exactly this rule, which is what made its absence here a gap rather
        // than a design choice.
        const money = code(ADMIN_MONEY);

        expect(money).toContain('withdrawalData.cooperativeId !== adminScope');
        expect((money.match(/cooperativeId !== adminScope/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });
});

describe('the shared balance vocabulary', () => {
    it('reads a member holding either field', () => {
        expect(readCooperativeBalance({ savingsBalance: 12_000 })).toBe(12_000);
        expect(readCooperativeBalance({ balance: 9_500 })).toBe(9_500);
        expect(readCooperativeBalance({})).toBe(0);
        expect(readCooperativeBalance(null)).toBe(0);
    });

    it('and never produces a NaN into a dashboard figure', () => {
        expect(readCooperativeBalance({ savingsBalance: 'not a number' })).toBe(0);
        expect(readCooperativeBalance({ balance: undefined })).toBe(0);
    });

    it('and writes to whichever field the document already carries', () => {
        // Incrementing savingsBalance on a document holding its money in
        // `balance` would not migrate it — it would split the member's savings
        // across two numbers.
        expect(balanceFieldOf({ balance: 9_500 })).toBe('balance');
        expect(balanceFieldOf({ savingsBalance: 12_000 })).toBe('savingsBalance');
        expect(balanceFieldOf({ savingsBalance: 1, balance: 2 })).toBe('savingsBalance');
        expect(balanceFieldOf({})).toBe(CANONICAL_BALANCE_FIELD);
        expect(CANONICAL_BALANCE_FIELD).toBe('savingsBalance');
    });

    it('treating a zero balance as present, not absent', () => {
        // `?? 0` on the read and `!== undefined` on the field choice: a member
        // whose balance is legitimately 0 must not be redirected to the other
        // field name.
        expect(balanceFieldOf({ balance: 0 })).toBe('balance');
        expect(readCooperativeBalance({ balance: 0 })).toBe(0);
    });
});

describe('every path onto a legacy nested member uses it', () => {
    it('the dashboard reads both branches the same way', () => {
        // THE test. The nested branch read `balance` only while the root branch
        // above it already accepted either.
        const dashboard = code(DASHBOARD);

        expect(dashboard).toContain('readCooperativeBalance(rootMemberDoc.data())');
        expect(dashboard).toContain('readCooperativeBalance(nestedMemberDoc.data())');
        expect(dashboard).not.toContain('nestedMemberDoc.data()?.balance');
    });

    it('the escrow cron credits the field the member actually has', () => {
        const cron = code(ESCROW_CRON);

        // Was `balanceFieldOf(memberDoc.data())`. #319 gave the cron two places
        // to find a member — the current top-level record and the legacy nested
        // one — so the document's data is resolved into `memberData` before the
        // single credit rather than read off one snapshot inline. The rule this
        // test exists for is unchanged: the increment goes to whichever field
        // that document already carries, never a fixed name.
        expect(cron).toContain('[balanceFieldOf(memberData)]: FieldValue.increment(totalPayout)');
        expect(cron).not.toContain('{ savingsBalance: FieldValue.increment(totalPayout)');
    });

    it('and a rejected withdrawal refunds that same field', () => {
        const money = code(ADMIN_MONEY);

        expect(money).toContain('[balanceFieldOf(nestedDoc.data())]: FieldValue.increment(amount)');
        expect(money).not.toContain('balance: FieldValue.increment(amount),');
    });

    it('which is a real collision, not a hypothetical one', () => {
        // Vacuity guard: these three genuinely operate on the same document.
        for (const rel of [DASHBOARD, ESCROW_CRON, ADMIN_MONEY]) {
            expect(code(rel)).toContain('.collection("members")');
        }
    });
});
