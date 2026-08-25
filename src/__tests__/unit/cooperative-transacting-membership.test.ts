/**
 * @jest-environment node
 */

/**
 * Six doors asked "may this member transact?" and gave three answers.
 *
 *   /api/cooperative/apply-loan            membershipStatus !== "active"  refuse
 *   /api/cooperative/withdraw              membershipStatus !== "active"  refuse
 *   /api/cooperative/create-fixed-savings  not ("approved" or "active")   refuse
 *   _coop_money submitWithdrawalAction     membershipStatus !== "active"  refuse
 *   _coop_money _applyForLoanAction        NO STATUS CHECK AT ALL
 *   _coop_money _createFixedSavingsAction  NO STATUS CHECK AT ALL
 *
 * "APPROVED" IS NOT A LESSER STATUS. It is the legacy spelling of the same
 * state, and the codebase says so: the member directory queries
 * `where("membershipStatus", "in", ["approved", "active"])` under the comment
 * 'both are fully approved members', the admin member list does the same,
 * updateMemberStatusAction accepts either and grants the cooperative_member
 * role for both, and the ID-card reader treats both as issued.
 *
 * So a legacy member at "approved" appeared in the directory, held the role and
 * carried an ID card — and was refused when they tried to withdraw their own
 * savings or apply for a loan, by three doors of six, with nothing saying why.
 *
 * AND TWO DOORS ASKED NOTHING. The two server actions checked only that a
 * membership ROW existed, so a member still at "pending" — registered, unpaid,
 * onboarding incomplete — could file a loan application and lock savings into a
 * fixed plan through the page, while the routes doing the same work refused
 * them. The loan path is bounded by the savings-multiple eligibility check
 * (a pending member has no savings), but a control that holds only because
 * another number happens to be zero is not a control; the fixed-savings one is
 * not bounded at all.
 *
 * SEPARATELY: THE REGISTRATION VERIFIER NEVER CHECKED WHOSE PAYMENT IT WAS
 * -----------------------------------------------------------------------
 * /api/cooperative/verify-payment took a reference, confirmed with Paystack
 * that SOMEBODY had paid, and claimed it for session.user.id. It never looked
 * at the payer recorded in the metadata — which initiateCooperativePaymentAction
 * does record, and which the contribution verifier beside it already compares:
 *
 *     if (userId !== session.user.id) return 'Payment verification failed:
 *         User mismatch'                    (cooperative/_payment.ts)
 *
 * So anyone holding a valid reference could be granted a completed membership
 * on another member's money — and did not even need to win the race, because
 * the lost-claim branch calls syncAlreadyProcessed for the CALLER, writing
 * paymentStatus: "completed" onto their membership regardless.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    canTransactAsMember,
    COOPERATIVE_TRANSACTING_STATUSES,
    NOT_A_TRANSACTING_MEMBER_MESSAGE,
} from '@/lib/cooperative-membership-status';

const MONEY = 'src/app/actions/cooperative/_coop_money.ts';
const WITHDRAWAL = 'src/app/actions/cooperative/_withdrawal.ts';
const MEMBERSHIP = 'src/app/actions/cooperative/_coop_membership.ts';
const ADMIN_MEMBERS = 'src/app/actions/cooperative/_coop_admin_members.ts';
const VERIFY_ROUTE = 'src/app/api/cooperative/verify-payment/route.ts';
const CONTRIB_ACTION = 'src/app/actions/cooperative/_payment.ts';

const TRANSACTING_DOORS: Array<[string, string]> = [
    ['apply-loan route', 'src/app/api/cooperative/apply-loan/route.ts'],
    ['withdraw route', 'src/app/api/cooperative/withdraw/route.ts'],
    ['create-fixed-savings route', 'src/app/api/cooperative/create-fixed-savings/route.ts'],
    ['the money actions', MONEY],
];

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

describe('the transacting rule', () => {
    it('admits both spellings of an approved membership', () => {
        expect(canTransactAsMember({ membershipStatus: 'active' })).toBe(true);
        expect(canTransactAsMember({ membershipStatus: 'approved' })).toBe(true);
        expect([...COOPERATIVE_TRANSACTING_STATUSES]).toEqual(['active', 'approved']);
    });

    it('and refuses the ones that are not', () => {
        expect(canTransactAsMember({ membershipStatus: 'pending' })).toBe(false);
        expect(canTransactAsMember({ membershipStatus: 'rejected' })).toBe(false);
        expect(canTransactAsMember({ membershipStatus: 'revision_required' })).toBe(false);
    });

    it('including suspended, now that suspension revokes the role too', () => {
        // The two agree rather than one covering for the other.
        expect(canTransactAsMember({ membershipStatus: 'suspended' })).toBe(false);
        expect([...COOPERATIVE_TRANSACTING_STATUSES]).not.toContain('suspended');
    });

    it('failing closed on a row with no status at all', () => {
        expect(canTransactAsMember({})).toBe(false);
        expect(canTransactAsMember(null)).toBe(false);
        expect(canTransactAsMember(undefined)).toBe(false);
    });

    it('and reading `status` for the rows that carry it instead', () => {
        // Some member rows carry `status` rather than `membershipStatus` — the
        // legacy imports, and joinCooperativeAction, which writes both. A member
        // is not refused over which field their row happens to use.
        expect(canTransactAsMember({ status: 'active' })).toBe(true);

        // Asserted as "the writer still uses the field" rather than by pinning
        // the literal `status: "active"`. That pin named a defect: #233 found
        // joinCooperativeAction writing an ACTIVE membership with no fee, no
        // onboarding and no admin, which checkModuleAccess Layer 2.6 and this
        // very function both honoured. The row is written "pending" now. The
        // premise this test rests on — that rows exist carrying `status` — is
        // unchanged, and pinning the old value would have made the fix look
        // like a regression.
        expect(code('src/app/actions/cooperative/_coop_registration.ts'))
            .toMatch(/\bstatus: "pending"/);
    });

    it('tolerating casing and whitespace, which a JSONB row can carry', () => {
        expect(canTransactAsMember({ membershipStatus: ' Active ' })).toBe(true);
        expect(canTransactAsMember({ membershipStatus: 'APPROVED' })).toBe(true);
    });
});

describe('"approved" really is the legacy spelling, not a lesser state', () => {
    it('because the directory serves both', () => {
        // THE premise. Without it, widening two doors would be a loosening
        // rather than a correction.
        const raw = readFileSync(join(process.cwd(), MEMBERSHIP), 'utf-8');

        expect(code(MEMBERSHIP)).toContain('.where("membershipStatus", "in", ["approved", "active"])');
        expect(raw).toContain('both are fully approved members');
    });

    it('and the admin list serves both', () => {
        expect(code(ADMIN_MEMBERS)).toContain('q.where("membershipStatus", "in", ["approved", "active"])');
    });

    it('and the admin action grants the role for either', () => {
        expect(code(ADMIN_MEMBERS)).toContain('if (status === "active" || status === "approved") {');
        expect(code(ADMIN_MEMBERS)).toContain('roles: FieldValue.arrayUnion("cooperative_member")');
    });
});

describe.each(TRANSACTING_DOORS)('%s', (_label: string, rel: string) => {
    it('asks the shared rule', () => {
        // THE test.
        const src = code(rel);

        expect(src).toContain('canTransactAsMember(');
        expect(src).toContain('NOT_A_TRANSACTING_MEMBER_MESSAGE');
    });

    it('and no longer compares the status by hand', () => {
        const src = code(rel);

        expect(src).not.toContain('membershipStatus !== "active"');
        expect(src).not.toContain("membershipStatus !== 'active'");
        expect(src).not.toContain('membershipStatus !== "approved" && ');
    });
});

describe('the two doors that asked nothing', () => {
    it('the loan action now refuses a member who is not active', () => {
        // THE test for the first.
        const apply = fn(MONEY, '_applyForLoanAction');

        expect(apply).toContain('if (!canTransactAsMember(membershipData))');
    });

    it('before it reaches the eligibility check that used to mask it', () => {
        const apply = fn(MONEY, '_applyForLoanAction');
        const guard = apply.indexOf('if (!canTransactAsMember(membershipData))');
        const eligibility = apply.indexOf('isEligibleForLoan(');

        expect(guard).toBeGreaterThan(-1);
        expect(eligibility).toBeGreaterThan(guard);
    });

    it('and the fixed-savings action refuses one too', () => {
        // THE test for the second — the one nothing else bounded.
        const create = fn(MONEY, '_createFixedSavingsAction');

        expect(create).toContain('if (!canTransactAsMember(membershipSnapshot.docs[0].data()))');
    });

    it('before it debits anything', () => {
        const create = fn(MONEY, '_createFixedSavingsAction');
        const guard = create.indexOf('canTransactAsMember(');
        const debit = create.indexOf('await debitJsonbBalance({');

        expect(guard).toBeGreaterThan(-1);
        expect(debit).toBeGreaterThan(guard);
    });
});

describe('one message for all of them', () => {
    it('rather than five phrasings of one problem', () => {
        expect(NOT_A_TRANSACTING_MEMBER_MESSAGE).toContain('membership must be active');

        for (const [, rel] of TRANSACTING_DOORS) {
            const src = code(rel);
            expect(src).not.toContain('Only active members can request withdrawals');
            expect(src).not.toContain('Your membership must be approved first');
        }
    });

    it('and the withdrawal request door was already covered by its own guard', () => {
        // Vacuity guard: _withdrawal.ts reserves funds through
        // debitJsonbBalanceWithFloor, which fails on a missing member row, so it
        // is not a fifth place the status rule has to be repeated.
        expect(code(WITHDRAWAL)).toContain('debitJsonbBalanceWithFloor({');
    });
});

describe('the registration verifier', () => {
    const verify = code(VERIFY_ROUTE);

    it('refuses a payment that belongs to somebody else', () => {
        // THE test.
        expect(verify).toContain('const payerId = verifyData.data.metadata?.userId');
        expect(verify).toContain('if (payerId && payerId !== userId) {');
        expect(verify).toContain('this payment belongs to another account');
    });

    it('checking before it claims the payment or syncs the caller', () => {
        const guard = verify.indexOf('if (payerId && payerId !== userId) {');
        const claim = verify.indexOf('const claim = await claimPaymentOnce({');
        const sync = verify.indexOf('await syncAlreadyProcessed(');

        expect(guard).toBeGreaterThan(-1);
        expect(claim).toBeGreaterThan(guard);
        expect(sync).toBeGreaterThan(guard);
    });

    it('and still accepts a legacy reference that records no payer', () => {
        // Refusing those would break verification of real old payments to close
        // a hole that only exists where the field is present and wrong.
        expect(verify).toContain('if (!payerId) {');
        expect(verify).toContain('accepted as a legacy reference');
    });

    it('reading a payer the initiator really does record', () => {
        // Vacuity guard: if nothing wrote it, the check would never fire.
        const initiator = fn(MONEY, '_initiateCooperativePaymentAction');

        expect(initiator).toContain('userId,');
        expect(initiator).toContain('membershipId: userId,');
        expect(initiator).toContain('type: "cooperative_membership_registration"');
    });

    it('which is the check its contribution sibling already applied', () => {
        // Vacuity guard: the rule is the platform's own.
        expect(code(CONTRIB_ACTION)).toContain('if (userId !== session.user.id)');
        expect(code(CONTRIB_ACTION)).toContain('User mismatch');
    });
});

describe("the member's own withdrawal history", () => {
    // /cooperatives/withdrawals asked getMyWithdrawals for the member's
    // withdrawals, and that function read "withdrawals" — the platform WALLET
    // collection. Every cooperative withdrawal request is written to
    // cooperative_withdrawals, by all three doors that create one. So the page
    // was handed a list that structurally could not contain a single
    // cooperative withdrawal, and rendered "no withdrawals yet" to members
    // whose money had already been paid out.
    const MY_DATA = 'src/app/actions/my-data.ts';
    const HISTORY_PAGE = 'src/app/cooperatives/(member)/withdrawals/page.tsx';

    it('reads the collection cooperative withdrawals are written to', () => {
        // THE test.
        const myData = fn(MY_DATA, 'getMyWithdrawals');

        expect(myData).toContain('db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS)');
        expect(myData).toContain('.where("userId", "==", userId)');
    });

    it('without dropping the platform wallet ones it already returned', () => {
        const myData = fn(MY_DATA, 'getMyWithdrawals');

        expect(myData).toContain('db.collection(COLLECTIONS.WITHDRAWALS)');
        expect(myData).toContain('source: "wallet"');
        expect(myData).toContain('source: "cooperative"');
    });

    it('newest first, across both', () => {
        // Each collection is ordered independently by the database; a merged
        // list has to be re-sorted or the second one lands underneath the first
        // regardless of date.
        const myData = fn(MY_DATA, 'getMyWithdrawals');

        expect(myData).toContain('toMillis(b.requestedAt) - toMillis(a.requestedAt)');
    });

    it('and the page it feeds really is the cooperative one', () => {
        // Vacuity guard, and the reason this was a live defect rather than a
        // latent one.
        const page = readFileSync(join(process.cwd(), HISTORY_PAGE), 'utf-8');

        expect(page).toContain('getMyWithdrawals');
        expect(page).toContain('Withdrawal History');
    });

    it('which sums only completed withdrawals, so the status fix matters too', () => {
        const page = readFileSync(join(process.cwd(), HISTORY_PAGE), 'utf-8');

        expect(page).toContain('w.status === "completed"');
    });
});
