/**
 * @jest-environment node
 */

/**
 *   #208 (from #284) THE ACCOUNTS ALREADY ON FILE COULD NOT BE TOLD APART FROM
 *        THE VERIFIED ONES.
 *
 *        #284 found both onboarding flows SIMULATING bank verification:
 *
 *            // SIMULATED VERIFICATION (Requested for demo/testing)
 *            const simulatedName = "SIMULATED ACCOUNT NAME";
 *            const newAccountName = accountName || "SIMULATED ACCOUNT NAME";
 *
 *        The second form is the worse one: whatever the applicant typed into
 *        the account-name box became the confirmed holder name. Either way the
 *        record written was
 *
 *            { bankName, accountNumber, accountName, verified: true }
 *
 *        and #284's fix writes THE SAME SHAPE. Both say `verified: true`.
 *        Neither says how. So "re-verify the affected rows", "freeze their
 *        payouts" and "ask those members to re-enter their details" all began
 *        with knowing WHICH rows, and nothing in the data answered that. The
 *        population was not identifiable, so it was recorded and left.
 *
 *   WHAT IS ACTUALLY AT RISK, MEASURED
 *
 *        The account NUMBER plus bank code routes the money, and Paystack
 *        refuses a number that does not resolve — a made-up number fails loudly
 *        at payout. The account NAME was never the routing key.
 *
 *        The exposure is narrower than "money goes anywhere" and worse than it
 *        sounds: the simulated flow let somebody enter a REAL, RESOLVABLE
 *        account belonging to SOMEBODY ELSE and be marked verified, because
 *        nothing compared the bank's answer with the applicant. That payout
 *        succeeds; it pays the wrong person.
 *
 *   THE DECISION
 *
 *        1. The resolution is STAMPED where it happens.
 *        2. Money does not move to an unstamped account — checked inside
 *           paystackPayout, the one chokepoint all five payout paths use.
 *        3. There is a way out that needs no operator per member: the member
 *           re-verifies, and the payout proceeds.
 *
 *        A THIRD DOOR TURNED UP WHILE WIRING IT. _withdrawFromWalletAction took
 *        `bankDetails` as a PARAMETER and stored it verbatim, so a wallet
 *        withdrawal went to an account named in the request and never resolved
 *        at all — #284's defect in a worse form, since onboarding at least
 *        intended to verify. It resolves now, and the debit is reversed if the
 *        account is refused.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    BANK_NAME_SOURCE_RESOLVED,
    UNRESOLVED_ACCOUNT_REFUSAL,
    bankAccountResolutionStamp,
    isResolvedBankAccount,
} from '@/lib/bank-account-provenance';

// ─── fixtures ────────────────────────────────────────────────────────────────

const ROOT = process.cwd();

const RULE = 'src/lib/bank-account-provenance.ts';
const TRANSFER = 'src/lib/paystack-transfer.ts';
const REVERIFY = 'src/app/actions/bank-account.ts';
const SCREEN = 'src/app/profile/bank-account/page.tsx';

/** Every payout path in the platform. */
const PAYOUT_SITES = [
    'src/app/actions/admin/_withdrawals.ts',
    'src/app/actions/admin/_loans.ts',
    'src/app/actions/order-management.ts',
    'src/app/actions/wallet.ts',
    'src/app/actions/wave/_wv_admin_withdrawals.ts',
];

/** Every place a bank account is resolved and stored. */
const RESOLVE_SITES = [
    'src/app/actions/marketplace/_mp_onboarding.ts',
    'src/app/actions/export/_ex_onboarding.ts',
    'src/app/actions/wallet.ts',
    'src/app/actions/bank-account.ts',
];

const ACCOUNT = { accountNumber: '0123456789', bankCode: '058', accountName: 'A MEMBER' };
const CONFIRMED = bankAccountResolutionStamp(new Date('2026-01-01T00:00:00.000Z'));

function source(rel: string): string {
    const full = join(ROOT, rel);
    // A missing file would slice every sweep to nothing and pass vacuously.
    expect(existsSync(full)).toBe(true);
    return stripComments(readFileSync(full, 'utf-8'), { label: rel });
}

// ─── a fetch double, so no payout is ever attempted for real ─────────────────

let calls: string[];
let realFetch: typeof globalThis.fetch;

beforeEach(() => {
    jest.clearAllMocks();
    calls = [];
    realFetch = globalThis.fetch;
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_key';
    globalThis.fetch = (async (url: any) => {
        calls.push(String(url));
        return {
            ok: true,
            status: 200,
            json: async () => ({
                status: true,
                data: { recipient_code: 'RCP_1', transfer_code: 'TRF_1', reference: 'REF' },
            }),
        } as any;
    }) as any;
});

afterEach(() => { globalThis.fetch = realFetch; });

const transfers = async () => await import('@/lib/paystack-transfer');

// ─────────────────────────────────────────────────────────────────────────────
describe('#208 — what counts as a confirmed account', () => {
    it('THE TEST IS THE STAMP, NOT `verified` — which the simulated flow wrote too', () => {
        // Reading `verified` would be reading the defect's own output and
        // calling it evidence.
        expect(isResolvedBankAccount({ verified: true })).toBe(false);
        expect(isResolvedBankAccount({ verified: true, accountName: 'SIMULATED ACCOUNT NAME' }))
            .toBe(false);
        expect(isResolvedBankAccount({ ...CONFIRMED })).toBe(true);
    });

    it('a half-written stamp is not a verification', () => {
        // A marker with no date is a partial write, and #140 settled the same
        // question for a hold with no pendingSince: an undated fact is not one.
        expect(isResolvedBankAccount({ accountNameSource: BANK_NAME_SOURCE_RESOLVED })).toBe(false);
        expect(isResolvedBankAccount({
            accountNameSource: BANK_NAME_SOURCE_RESOLVED, accountResolvedAt: '',
        })).toBe(false);
        expect(isResolvedBankAccount({
            accountNameSource: BANK_NAME_SOURCE_RESOLVED, accountResolvedAt: 'not a date',
        })).toBe(false);
    });

    it('another source value does not pass', () => {
        expect(isResolvedBankAccount({
            accountNameSource: 'typed_by_applicant', accountResolvedAt: CONFIRMED.accountResolvedAt,
        })).toBe(false);
    });

    it('an absent or empty record is not confirmed', () => {
        expect(isResolvedBankAccount(null)).toBe(false);
        expect(isResolvedBankAccount(undefined)).toBe(false);
        expect(isResolvedBankAccount({})).toBe(false);
    });

    it('the stamp a resolver writes is one this check accepts', () => {
        // Guards the pair: a writer and a reader that disagree would freeze
        // every account for ever, which is the failure mode of this decision.
        expect(isResolvedBankAccount(bankAccountResolutionStamp())).toBe(true);
    });

    it('the rule module imports NOTHING, so mocking a database cannot break it', () => {
        expect(source(RULE)).not.toMatch(/^\s*import\s/m);
    });

    it('AND source() REALLY STRIPS COMMENTS — the tombstone trap, guarded', () => {
        /**
         * Every sweep below reads through source(). This module's write-up
         * quotes the defect verbatim — `verified: true`, "SIMULATED ACCOUNT
         * NAME" — so a source() that stopped stripping would make the prose
         * indistinguishable from the code to every assertion in this file. That
         * is the trap that fired on #284's own sweep twice, and once on #208.
         */
        const raw = readFileSync(join(ROOT, RULE), 'utf-8');
        const stripped = source(RULE);

        // Present in the write-up...
        expect(raw).toContain('SIMULATED ACCOUNT NAME');
        expect(raw).toContain('the applicant typed');
        // ...and absent from what the sweeps actually read.
        expect(stripped).not.toContain('SIMULATED ACCOUNT NAME');
        expect(stripped).not.toContain('the applicant typed');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#208 — money does not move to an unconfirmed account', () => {
    it('THE PAYOUT IS REFUSED, AND NOTHING IS SENT', async () => {
        const { paystackPayout } = await transfers();

        const res = await paystackPayout(ACCOUNT, 5000, 'Payout', 'REF-1', { verified: true });

        expect(res.success).toBe(false);
        expect(res.error).toBe(UNRESOLVED_ACCOUNT_REFUSAL);
        // Not one request — no recipient created, no transfer attempted.
        expect(calls).toHaveLength(0);
    });

    it('and the refusal is NEVER indeterminate — it happens before any request', async () => {
        // #250's distinction. "We do not know whether the money moved" must not
        // be claimed for a case where nothing was sent, or a caller parks a
        // payout for reconciliation that never needed it.
        const { paystackPayout } = await transfers();
        const res = await paystackPayout(ACCOUNT, 5000, 'Payout', 'REF-1', {});

        expect(res.indeterminate).toBeFalsy();
        expect(res.duplicate).toBeFalsy();
    });

    it('THE REFUSAL NAMES THE WAY OUT, not just the refusal', () => {
        // A message that says only "not allowed" becomes a support ticket and
        // then somebody paying by hand — the control routed around rather than
        // enforced.
        expect(UNRESOLVED_ACCOUNT_REFUSAL).toMatch(/re-verify/i);
        expect(UNRESOLVED_ACCOUNT_REFUSAL).toMatch(/profile/i);
        expect(UNRESOLVED_ACCOUNT_REFUSAL).toMatch(/retried/i);
    });

    it('a CONFIRMED account still pays, so the gate is not a brick wall', async () => {
        const { paystackPayout } = await transfers();

        const res = await paystackPayout(ACCOUNT, 5000, 'Payout', 'REF-1', CONFIRMED);

        expect(res.success).toBe(true);
        expect(calls.length).toBeGreaterThan(0);
    });

    it('the amount and reference checks still answer first', async () => {
        // Those are caller bugs and have their own diagnostics (#249, #251).
        // The account gate is the last thing before the network, not the first
        // thing before everything.
        const { paystackPayout } = await transfers();

        const badAmount = await paystackPayout(ACCOUNT, 0, 'Payout', 'REF-1', {});
        expect(badAmount.error).toMatch(/invalid amount/i);

        const noRef = await paystackPayout(ACCOUNT, 5000, 'Payout', '  ', {});
        expect(noRef.error).toMatch(/reference/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#208 — the check is at the chokepoint, not at the call sites', () => {
    it('EVERY PAYOUT PATH GOES THROUGH paystackPayout', () => {
        expect(PAYOUT_SITES).toHaveLength(5);
        for (const site of PAYOUT_SITES) {
            expect(source(site)).toContain('paystackPayout(');
        }
    });

    it('and the decision lives in ONE place', () => {
        // Five copies of one rule is the shape this codebase keeps unpicking.
        // A call site that computed the answer itself could get it wrong; one
        // that forgets to pass the record cannot compile.
        const holders = [TRANSFER, ...PAYOUT_SITES]
            .filter((f) => source(f).includes('isResolvedBankAccount('));

        expect(holders).toEqual([TRANSFER]);
    });

    it('THE PARAMETER IS REQUIRED, so a new payout path cannot forget it', () => {
        const src = source(TRANSFER);
        // No `?` and no default — tsc names every site that omits it.
        expect(src).toMatch(/source: MaybeResolvedBankAccount,/);
        expect(src).not.toMatch(/source\?: MaybeResolvedBankAccount/);
    });

    it('AND EACH SITE PASSES THE RECORD IT READ, BY NAME', () => {
        /**
         * A literal at a call site — `true`, `{}`, or a stamp built on the
         * spot — is the call site deciding, which is exactly what putting the
         * check in one place avoids. `{}` is the dangerous one: it type-checks,
         * it looks like "no extra data", and it silently means "unconfirmed"
         * for a member whose account IS confirmed.
         *
         * Named per site rather than pattern-matched, because each reads its
         * record from a different place and the RIGHT name is the point.
         */
        const EXPECTED: Record<string, string> = {
            'src/app/actions/admin/_withdrawals.ts': 'userData,',
            'src/app/actions/admin/_loans.ts': 'borrowerData,',
            'src/app/actions/order-management.ts': 'bankDetails,',
            'src/app/actions/wallet.ts': 'bankDetails,',
            // This module's bank block lives behind extractCanonicalUser, and
            // the stamp is on the block the account came from.
            'src/app/actions/wave/_wv_admin_withdrawals.ts': 'canonical.bankDetails,',
        };

        expect(Object.keys(EXPECTED).sort()).toEqual([...PAYOUT_SITES].sort());

        for (const [site, name] of Object.entries(EXPECTED)) {
            const src = source(site);
            const call = src.slice(src.indexOf('paystackPayout('));
            const args = call.slice(0, call.indexOf(');') + 2);

            expect(args).toContain(name);
            // No object literal standing in for the record.
            expect(args).not.toMatch(/payoutReference\([^)]*\),\s*(true|\{)/);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#208 — the stamp is written wherever an account is resolved', () => {
    it('EVERY RESOLVE SITE STAMPS WHAT IT RESOLVED', () => {
        // A resolver that did not stamp would leave a correctly-verified member
        // frozen for ever — the failure mode of this whole decision.
        expect(RESOLVE_SITES).toHaveLength(4);
        for (const site of RESOLVE_SITES) {
            const src = source(site);
            expect(src).toContain('resolveBankAccount(');
            expect(src).toContain('bankAccountResolutionStamp()');
        }
    });

    it('and nowhere writes the marker by hand', () => {
        // The literal at a write site is a second definition of the stamp.
        for (const site of RESOLVE_SITES) {
            expect(source(site)).not.toContain(`"${BANK_NAME_SOURCE_RESOLVED}"`);
        }
    });

    it('THE WALLET WITHDRAWAL RESOLVES ITS DESTINATION — it stored the request verbatim', () => {
        const src = source('src/app/actions/wallet.ts');

        // The bank's answer is stored, not the caller's.
        expect(src).toContain('accountName: resolution.accountName ?? ""');
        expect(src).toContain('bankDetails: confirmedBankDetails');
        // And the raw parameter is not what lands on the row any more.
        expect(src).not.toMatch(/status: "pending",\s*\n\s*bankDetails,/);
    });

    it('and a refused account GIVES THE MONEY BACK', () => {
        // The debit happens before the resolve, so a refusal that just returned
        // would leave a member down the money with no withdrawal row — #299's
        // shape, where a failed step reported success over a wrong balance.
        const src = source('src/app/actions/wallet.ts');
        const slice = src.slice(src.indexOf('const resolution = await resolveBankAccount'));

        expect(slice).toContain('creditWalletOnce({');
        expect(slice).toContain('WITHDRAW-REVERSAL-');
        // ...and a reversal that itself fails is reported, not swallowed.
        expect(slice).toContain('if (!refund.claimed) {');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#208 — the refusal points somewhere that exists', () => {
    it('THERE IS A MEMBER-FACING RE-VERIFICATION ACTION', () => {
        // Before this, every bank-verification control lived inside the two
        // onboarding wizards, which somebody already onboarded cannot re-enter.
        // A refusal naming a step the product does not have is #362's shape.
        // EXPORTED, not merely mentioned: withSafeAction's first argument is
        // the action's NAME, so a file that had stopped exporting it would
        // still contain the string.
        const src = source(REVERIFY);
        expect(src).toMatch(/export const reverifyBankAccountAction = withSafeAction\(/);
        expect(src).toMatch(/export const getBankAccountStatusAction = withSafeAction\(/);
        expect(src).toContain('resolveBankAccount(');
    });

    it('AND A SCREEN, LINKED FROM THE PROFILE', () => {
        expect(existsSync(join(ROOT, SCREEN))).toBe(true);
        expect(source('src/app/profile/page.tsx')).toContain('href="/profile/bank-account"');

        // AWAITED, not merely named. `void 0 && reverifyBankAccountAction(...)`
        // contains the string and calls nothing — asserting the name appears is
        // asserting it was typed, which is #382's lesson in another place.
        const screen = source(SCREEN);
        expect(screen).toContain('await reverifyBankAccountAction(');
        expect(screen).toContain('await getBankAccountStatusAction()');
    });

    it('the caller does not send a holder name — that was the defect', () => {
        // The signature takes a number, a code and a bank name. A holder name
        // parameter would be the applicant typing it again.
        const src = source(REVERIFY);
        const signature = src.slice(
            src.indexOf('async function _reverifyBankAccountAction'),
            src.indexOf('): Promise<ActionResponse<{ accountName: string }>>'),
        );
        expect(signature).toContain('accountNumber: string');
        expect(signature).toContain('bankCode: string');
        expect(signature).not.toMatch(/accountName\s*:/);
    });

    it('an unresolvable account is REFUSED, not recorded', () => {
        const src = source(REVERIFY);
        const fn = src.slice(src.indexOf('async function _reverifyBankAccountAction'));
        const slice = fn.slice(0, fn.indexOf('export const reverifyBankAccountAction'));

        expect(slice).toContain('if (!resolution.ok) {');
        // The refusal returns BEFORE the write.
        expect(slice.indexOf('if (!resolution.ok) {')).toBeLessThan(slice.indexOf('.update({'));
    });

    it('IT WRITES BOTH SHAPES THE PAYOUT PATHS READ', () => {
        // The user row carries the account top-level AND in a nested
        // bankDetails block, and different payout paths read different ones.
        // Stamping one would leave a member confirmed for some of their money.
        const src = source(REVERIFY);
        const stamps = src.match(/\.\.\.stamp,/g) ?? [];

        expect(stamps.length).toBe(2);
        expect(src).toContain('bankAccountNumber: number,');
        expect(src).toContain('bankDetails: {');
    });

    it('the status read masks the account number', () => {
        // The member needs to recognise which account is on file, not read it
        // back — #152's reasoning applied to their own record.
        const src = source(REVERIFY);
        expect(src).toContain('accountNumberTail');
        expect(src).toContain('number.slice(-4)');
    });

    it('and a failed status read is a FAILURE, not "not confirmed"', () => {
        // #313's lesson: those are different states, and a member should not be
        // told to redo something over a database blip.
        const src = source(REVERIFY);
        const fn = src.slice(src.indexOf('async function _getBankAccountStatusAction'));
        expect(fn).toContain('Could not read your bank account');
        expect(fn).not.toMatch(/catch[\s\S]{0,200}resolved: false/);
    });

    it('every action there is scoped to the session — none takes a userId', () => {
        const src = source(REVERIFY);
        const signatures = src.match(/async function _\w+Action\(([^)]*)\)/g) ?? [];
        expect(signatures.length).toBe(2);
        for (const sig of signatures) expect(sig).not.toMatch(/userId/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#208 — what this deliberately does NOT claim', () => {
    it('the population held is EVERY unstamped record, not "everything before #284"', () => {
        /**
         * Those two differ: a seller onboarded between #284 and this change was
         * resolved properly and still has no stamp, so their payout is held
         * until they re-verify. Inventing a cut-off DATE to exclude them would
         * assert a distinction that cannot be checked against the data.
         *
         * The module says so, and this pins that it keeps saying so — the
         * honest limit is the part most likely to be quietly dropped later.
         */
        const raw = readFileSync(join(ROOT, RULE), 'utf-8');
        expect(raw).toContain('EVERY record written before the stamp existed');
        expect(raw).toContain('Holding a payout is recoverable in one click');
    });

    it('and nothing here reads a cut-off date', () => {
        // A date comparison would be exactly the invented distinction above.
        for (const f of [RULE, TRANSFER]) {
            expect(source(f)).not.toMatch(/new Date\(['"]20\d\d-/);
        }
    });
});
