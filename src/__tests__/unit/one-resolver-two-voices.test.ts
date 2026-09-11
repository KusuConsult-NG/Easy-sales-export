/**
 * @jest-environment node
 */

/**
 *   #646 ONE RESOLVER, TWO VOICES.
 *
 *   Recorded as open during #642 and closed here. `actions/paystack.ts::
 *   verifyBankAccount` wrote its own `fetch` to Paystack's `/bank/resolve`
 *   while `lib/bank-account-resolve` existed for exactly that call — #346 built
 *   that module so callers would stop writing their own, and it reached the
 *   route and not the action.
 *
 *   AND THERE WERE THREE, NOT TWO. The sweep below — every file mentioning
 *   `/bank/resolve` — found `lib/paystack-transfer.ts::resolveAccountNumber`,
 *   which #642 and I had both missed by assuming the count. It is the worst of
 *   the three: both parameters interpolated RAW, with no `encodeURIComponent`
 *   and no plausibility check on either. Nothing calls it, which is how it
 *   survived three passes over this area — the payout pipeline's own note
 *   records that "resolveAccountNumber is exported and this never called it".
 *
 *   A dead duplicate is still a duplicate: it is what somebody copies next. It
 *   delegates now rather than being deleted, with its return shape unchanged.
 *
 *   Two implementations of one third-party call is how they come to disagree
 *   about what a failure means, and these already had:
 *
 *     the bank code       the action refused anything but 3-6 digits before
 *                         spending a request; the module sent it to Paystack to
 *                         be refused there.
 *     a 404               the action turned it into "Account not found. Please
 *                         verify your account number and selected bank are
 *                         correct."; the module passed Paystack's own wording
 *                         through.
 *     a missing key       the action said "Payment service not configured.
 *                         Please contact support."; the module said
 *                         "Verification service currently unavailable."
 *
 * ── THE RESOLUTION MOVES; THE WORDING STAYS ─────────────────────────────────
 *
 *   Consolidating by adopting the blunter message would have been a regression
 *   wearing the clothes of a cleanup. "Could not resolve account name" is
 *   Paystack telling a developer something; "verify your account number and
 *   selected bank are correct" is the platform telling a member what to do
 *   next, and it is the message a person acts on.
 *
 *   So the module answers with a machine-readable `code` and the action turns
 *   that into its own sentences. Branching on the CODE is the other half of the
 *   repair: the action used to test
 *
 *       data.message?.toLowerCase().includes('could not resolve')
 *
 *   which is a branch on a third party's prose — it breaks silently, in
 *   production, on a day nobody deployed anything.
 *
 * ── AND THE STRICTER OF THE TWO CHECKS WINS ─────────────────────────────────
 *
 *   `isPlausibleBankCode` is the action's rule, moved into the module, so BOTH
 *   doors now refuse a malformed code before spending a request. That is the
 *   direction consolidation should go: the door with the better check teaches
 *   the other, rather than the merge settling on whatever the shared module
 *   happened to have.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    resolveBankAccount,
    isPlausibleAccountNumber,
    isPlausibleBankCode,
} from '@/lib/bank-account-resolve';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full) && !/\.d\.ts$/.test(full)) out.push(full);
    }
    return out;
}

const APP_FILES = walk(join(ROOT, 'src'))
    .map((f) => relative(ROOT, f))
    .filter((f) => !f.includes('__tests__') && !f.includes('/testing/'));

const ACTION = 'src/app/actions/paystack.ts';
const ROUTE = 'src/app/api/kyc/verify-bank-account/route.ts';
const MODULE = 'src/lib/bank-account-resolve.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#646 — there is one implementation of the call', () => {
    it('NOBODY ASKS PAYSTACK FOR A BANK RESOLUTION EXCEPT THE MODULE', () => {
        /*
         *   Swept, not spot-checked: the defect was one call site out of two
         *   writing its own, so "the one I know about is fixed" is not the
         *   assertion worth making.
         */
        const offenders = APP_FILES
            .filter((f) => f !== MODULE)
            .filter((f) => /\/bank\/resolve/.test(code(f)));
        expect({ offenders }).toEqual({ offenders: [] });
    });

    it('AND BOTH DOORS CALL IT', () => {
        //   "Nobody writes their own" is also satisfied by nobody resolving at
        //   all.
        for (const door of [ACTION, ROUTE]) {
            expect({ door, delegates: code(door).includes('resolveBankAccount(accountNumber, bankCode)') })
                .toEqual({ door, delegates: true });
        }
    });

    it('AND SO DOES THE THIRD ONE, which nothing calls', () => {
        /*
         *   Kept rather than deleted: a future caller of
         *   `resolveAccountNumber` gets the checked implementation instead of
         *   the raw one, and the return shape is unchanged so adopting it costs
         *   nothing. A dead duplicate is what somebody copies next.
         */
        const transfer = code('src/lib/paystack-transfer.ts');
        expect(transfer).toContain('await resolveBankAccount(accountNumber, bankCode)');
        expect(transfer).not.toContain('account_number=${accountNumber}');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#646 — the member still gets the better sentence', () => {
    /*
     *   Each of these is a message the action produced before the merge and
     *   still produces after it. They are the reason this is a consolidation
     *   rather than a deletion.
     */
    /**
     * Each code, and the sentence the member sees for it.
     *
     * BOUND TO ITS OWN BRANCH, not merely present in the file. The first
     * version asserted each message appeared somewhere, and a mutant that
     * replaced the `unresolvable` arm with Paystack's raw reason SURVIVED —
     * because "Account not found…" also appears in the provider-error arm below
     * it. #635's weakness exactly: a string being present is not that string
     * being used where it matters.
     */
    const KEPT: Array<[string, string]> = [
        ['missing_fields', 'Account number and bank code are required'],
        ['bad_account_number', 'Account number must be exactly 10 digits'],
        ['bad_bank_code', 'Invalid bank selected. Please choose your bank from the dropdown list.'],
        ['not_configured', 'Payment service not configured. Please contact support.'],
        ['unreachable', 'Network error. Please check your connection and try again.'],
        ['unresolvable', 'Account not found. Please verify your account number and selected bank are correct.'],
    ];

    /** The body of one `case '<code>':` arm, up to the next case label. */
    function arm(codeName: string): string {
        const src = code(ACTION);
        const from = src.indexOf(`case '${codeName}':`);
        expect({ codeName, found: from > -1 }).toEqual({ codeName, found: true });
        const next = src.indexOf('case ', from + 1);
        return src.slice(from, next === -1 ? src.length : next);
    }

    it.each(KEPT)('THE %s ARM SAYS: %s', (codeName, message) => {
        expect(arm(codeName)).toContain(message);
    });

    it('AND THE PROVIDER-ERROR ARM STILL DISTINGUISHES ITS THREE CASES', () => {
        //   Paystack answered and refused; its status says which of three very
        //   different things happened, and a member can act on only one.
        const providerArm = code(ACTION).slice(code(ACTION).indexOf("case 'provider_error':"));
        expect(providerArm).toContain('Payment service authentication error. Please contact support.');
        expect(providerArm).toContain('Too many verification attempts. Please wait a moment and try again.');
        expect(providerArm).toContain('Account not found. Please verify your account number and selected bank are correct.');
    });

    it('AND BRANCHES ON THE CODE, not on a third party\'s prose', () => {
        const action = code(ACTION);
        expect(action).toContain('switch (resolution.code)');
        //   The branch that used to decide this.
        expect(action).not.toMatch(/toLowerCase\(\)\.includes\('could not resolve'\)/);
        expect(action).not.toMatch(/data\.message\?\.toLowerCase\(\)/);
    });

    it('AND EVERY CODE THE MODULE CAN RETURN HAS A BRANCH', () => {
        /*
         *   The union and the switch are two lists of one thing. A code added
         *   to the module with no arm here falls to `default` and shows the raw
         *   reason — which is the blunter message this finding is about,
         *   arriving by the back door.
         */
        const declared = [...code(MODULE)
            .slice(code(MODULE).indexOf('export type BankResolutionCode'),
                   code(MODULE).indexOf('export interface BankAccountResolution'))
            .matchAll(/"(\w+)"/g)].map((m) => m[1]);
        expect(declared.length).toBeGreaterThanOrEqual(7);

        const action = code(ACTION);
        const missing = declared.filter((c) => !action.includes(`case '${c}':`));
        expect({ missing }).toEqual({ missing: [] });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#646 — and the stricter of the two checks is the one that survived', () => {
    it('THE MODULE REFUSES A MALFORMED BANK CODE, which it did not before', async () => {
        const fetchMock = jest.fn();
        const original = global.fetch;
        global.fetch = fetchMock as unknown as typeof fetch;
        try {
            const result = await resolveBankAccount('0123456789', '58');
            expect(result.ok).toBe(false);
            expect(result.code).toBe('bad_bank_code');
            //   Refused before the request, which is the point: an implausible
            //   code is "not worth a request", in the module's own words about
            //   the account number beside it.
            expect(fetchMock).not.toHaveBeenCalled();
        } finally {
            global.fetch = original;
        }
    });

    it('AND THE TWO PLAUSIBILITY RULES ARE SIBLINGS', () => {
        expect(isPlausibleAccountNumber('0123456789')).toBe(true);
        expect(isPlausibleAccountNumber('012345678')).toBe(false);
        expect(isPlausibleAccountNumber(1234567890 as unknown as string)).toBe(false);

        expect(isPlausibleBankCode('058')).toBe(true);
        expect(isPlausibleBankCode('000058')).toBe(true);
        expect(isPlausibleBankCode('58')).toBe(false);
        expect(isPlausibleBankCode('0000058')).toBe(false);
        expect(isPlausibleBankCode('05a')).toBe(false);
        expect(isPlausibleBankCode(58 as unknown as string)).toBe(false);
    });

    it('AND A GOOD PAIR STILL REACHES PAYSTACK', async () => {
        //   Otherwise "refuses malformed input" would also be true of a module
        //   that refuses everything.
        const fetchMock = jest.fn(async () => ({
            ok: true,
            json: async () => ({ status: true, data: { account_name: 'ADA OBI', account_number: '0123456789', bank_id: 9 } }),
        }));
        const original = global.fetch;
        const key = process.env.PAYSTACK_SECRET_KEY;
        global.fetch = fetchMock as unknown as typeof fetch;
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
        try {
            const result = await resolveBankAccount('0123456789', '058');
            expect(result).toMatchObject({ ok: true, accountName: 'ADA OBI', bankId: 9 });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = original;
            if (key === undefined) delete process.env.PAYSTACK_SECRET_KEY;
            else process.env.PAYSTACK_SECRET_KEY = key;
        }
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the action writes its own fetch again               KILLED
 *     THE DEFECT: the third copy goes back to a raw URL                KILLED
 *     a code loses its branch and falls through to `default`          KILLED
 *     the bank-code rule is removed from the module                   KILLED
 *     the bank-code rule accepts two digits                           KILLED
 *     the module stops refusing before the request                    KILLED
 *     a kept member-facing message is replaced by Paystack's          KILLED
 *     the encoding is dropped from the one implementation             KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 *   "A kept member-facing message is replaced by Paystack's" is the one this
 *   whole finding turns on: consolidating by adopting the blunter wording would
 *   look like a cleanup and be a regression, and nothing else here would notice.
 *
 * ── AND IT SURVIVED THE FIRST RUN ───────────────────────────────────────────
 *
 *   The kept messages were asserted as PRESENT IN THE FILE, and "Account not
 *   found…" appears twice — once in the `unresolvable` arm and once in the
 *   provider-error arm that reads a 404. Replacing one left the other, and the
 *   assertion stayed green over the exact regression it was written to catch.
 *
 *   #635's weakness, restated: a string being present is not that string being
 *   used where it matters. Each message is bound to its own `case` arm now,
 *   read as the slice between one case label and the next.
 */
