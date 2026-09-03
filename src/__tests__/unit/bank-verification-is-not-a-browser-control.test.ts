/**
 * @jest-environment node
 */

/**
 *   #346 SECURITY: THE BANK VERIFICATION #284 BUILT COULD BE WALKED PAST — IN
 *        THE BROWSER, AND THEN AGAIN AT THE SERVER.
 *
 *        #284 replaced a simulated account resolution in both onboarding
 *        components with a real call to /api/kyc/verify-bank-account. Three
 *        things made that fix ineffective.
 *
 *        (1) AN EFFECT THAT REPORTED SUCCESS FROM TYPED INPUT.
 *
 *            Both components carried an "auto-propagate changes to parent"
 *            effect sitting above the verify handler:
 *
 *              onboarding/  if (bankName && accountNumber.length === 10 && accountName) {
 *                               onVerified({ ..., verified: true, ... });
 *                           }
 *              shared/      if (bankName && accountNumber.length === 10 && resolvedName) {
 *                               onVerified?.({ ..., accountName: resolvedName });
 *                           }
 *
 *            `accountName` / `resolvedName` are the state behind ORDINARY TEXT
 *            INPUTS the applicant fills in ("Enter your account name"). Pick a
 *            bank, type ten digits, type a name — and the parent was handed a
 *            complete, apparently-verified account. The verify button was
 *            never involved.
 *
 *            The consumers took that at face value: the export step gates on
 *            `!bankData?.verified`, which the literal supplied; the marketplace
 *            step gated on `!data?.accountName`, which the typed string
 *            supplied. A MARKETPLACE SELLER — the party escrow pays out to —
 *            finished registration with a payout account whose holder name they
 *            had typed themselves.
 *
 *        (2) THE SERVER NEVER CHECKED AT ALL.
 *
 *            _mp_onboarding required three non-empty strings and stored them.
 *            _ex_onboarding ran a Zod schema of the same shape, twice — the
 *            submit and the resubmit. Neither resolved anything. So even with
 *            both components perfect, the account name on a payout record was
 *            whatever the request said. The browser was the whole control,
 *            which is #345's shape one module over.
 *
 *            The resolution now lives in lib/bank-account-resolve.ts and runs
 *            at the point of record, in all three writers, and the BANK'S name
 *            is what gets stored. The route delegates to the same module, so
 *            there is one implementation rather than the two that #339 and #345
 *            each turned out to be.
 *
 *        (3) AND THE SAME FIVE LINES WERE AN UNBOUNDED RENDER LOOP.
 *
 *            `onVerified` was in both effects' dependency arrays. Marketplace
 *            passes an inline arrow; the export step declares its handler in
 *            the component body; and both wizards' setters do
 *            `setFormData(prev => ({ ...prev, ...stepData }))` — a new object
 *            every time. So: effect → parent setState → re-render → new
 *            callback identity → effect. With a localStorage write per pass.
 *            The callback is held in a ref now, so each effect depends on the
 *            DATA it sends rather than the identity of the function it sends it
 *            to.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const SHARED = 'src/components/shared/BankAccountVerification.tsx';
const EXPORT_COMPONENT = 'src/components/onboarding/BankAccountVerification.tsx';
const MP_STEP = 'src/app/marketplace/onboarding/steps/BankAccountStep.tsx';
const MP_ACTION = 'src/app/actions/marketplace/_mp_onboarding.ts';
const EX_ACTION = 'src/app/actions/export/_ex_onboarding.ts';
const ROUTE = 'src/app/api/kyc/verify-bank-account/route.ts';
const RESOLVER = 'src/lib/bank-account-resolve.ts';

const COMPONENTS = [SHARED, EXPORT_COMPONENT];

// ─────────────────────────────────────────────────────────────────────────────
describe('#346 — the propagation effect no longer asserts a verification', () => {
    it.each(COMPONENTS)('%s does NOT hardcode verified: true in an effect', (file) => {
        // THE test for the export copy, which wrote the literal. Scoped to the
        // effect: handleVerify legitimately passes verified: true, because it
        // has just had the bank confirm the account.
        const code = source(file);
        const effect = code.slice(code.indexOf('onVerifiedRef.current'));

        expect(effect.slice(0, 400)).not.toMatch(/verified:\s*true/);
    });

    it('the export copy propagates the verified STATE', () => {
        const code = source(EXPORT_COMPONENT);

        expect(code).toMatch(/onVerifiedRef\.current\(\{[\s\S]{0,400}?\n\s*verified,/);
        expect(code).toMatch(/accountName: verified \? accountName : ""/);
    });

    it('and the shared copy derives it from the resolution status', () => {
        const code = source(SHARED);

        expect(code).toContain('verificationStatus === "success" && Boolean(resolvedName)');
        expect(code).toMatch(/accountName: verified \? resolvedName : ""/);
    });

    it.each(COMPONENTS)('%s: the account-name input is READ-ONLY', (file) => {
        // The other half. An editable field feeding the propagated name is the
        // bypass, whatever the effect then does with it.
        const code = source(file);
        const nameInput = code.slice(code.indexOf('Account Name'));

        expect(nameInput).toContain('readOnly');
        expect(nameInput.slice(0, 900)).not.toMatch(/onChange=\{\(e\) => \{?\s*set(Resolved|Account)Name/);
    });

    it.each(COMPONENTS)('%s: handleVerify still sets it from the endpoint', (file) => {
        // Vacuity guard: the fix must not have removed the path that works.
        const code = source(file);

        expect(code).toContain('/api/kyc/verify-bank-account');
        expect(code).toMatch(/verified:\s*true/);   // present, in the handler
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#346 — the effect cannot drive an unbounded render loop', () => {
    it.each(COMPONENTS)('%s holds onVerified in a ref, out of the deps', (file) => {
        const code = source(file);

        expect(code).toContain('const onVerifiedRef = useRef(onVerified);');
        expect(code).toContain('onVerifiedRef.current = onVerified;');

        // The propagation effect's dependency array, and what must not be in it.
        const deps = code.slice(code.indexOf('onVerifiedRef.current?.(') >= 0
            ? code.indexOf('onVerifiedRef.current?.(')
            : code.indexOf('onVerifiedRef.current('));
        const arr = deps.slice(deps.indexOf('}, ['), deps.indexOf(']);') + 3);

        expect(arr).not.toContain('onVerified');
        expect(arr).toContain('accountNumber');   // vacuity guard on the slice
    });

    it('and the parents really do produce a new callback every render', () => {
        // The cost, pinned rather than asserted from memory: without the ref
        // these two are what make the effect re-run forever.
        expect(source(MP_STEP)).toContain('function handleVerified(');
        expect(source('src/app/marketplace/onboarding/page.tsx'))
            .toContain('onChange={(bankAccount) => updateFormData({ bankAccount })}');
        expect(source('src/app/export/onboarding/page.tsx'))
            .toMatch(/setFormData\(\(prev: any\) => \{[\s\S]{0,80}?\.\.\.prev, \.\.\.stepData/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#346 — the server resolves the account it is about to record', () => {
    const SAVED_ENV = { ...process.env };
    const realFetch = global.fetch;
    afterEach(() => {
        process.env = { ...SAVED_ENV };
        global.fetch = realFetch;
        jest.restoreAllMocks();
    });

    it('MARKETPLACE ONBOARDING REFUSES AN UNRESOLVABLE SELLER ACCOUNT', () => {
        const code = source(MP_ACTION);

        expect(code).toContain('resolveBankAccount(bankAccount.accountNumber, bankAccount.bankCode)');
        expect(code).toMatch(/if \(!resolution\.ok\) \{[\s\S]{0,300}?success: false/);
    });

    it('and stores the BANK’S name, not the submitted one', () => {
        const code = source(MP_ACTION);

        expect(code).toContain('accountName: resolvedAccountName');
        // Every write goes through the one object.
        expect(code).toContain('bankAccount: bankAccountRecord');
        expect(code).toContain('bankDetails: bankAccountRecord');
        expect(code).toContain('accountName: bankAccountRecord.accountName');
        expect(code).not.toMatch(/accountName: bankAccount\.accountName/);
    });

    it('EXPORT ONBOARDING DOES THE SAME, ON BOTH ITS WRITERS', () => {
        // Submit and resubmit are two writers of one record — the shape that
        // has produced a finding every time one of the pair was fixed alone.
        const code = source(EX_ACTION);

        expect(code.match(/resolveBankAccount\(/g) ?? []).toHaveLength(2);
        expect(code.match(/bank: verifiedBank,/g) ?? []).toHaveLength(2);
        expect(code).not.toMatch(/bank: validatedData\.bank,/);
        expect(code).not.toMatch(/accountName: validatedData\.bank\.accountName/);
    });

    it('a buyer is not asked to resolve an account they do not have', () => {
        // The guard is scoped: only a seller has a payout account, and making
        // buyer registration depend on a Paystack call would be a new outage.
        expect(source(MP_ACTION)).toMatch(/if \(isSeller\) \{[\s\S]{0,200}?resolveBankAccount/);
    });

    it('AND A REFUSAL FROM THE RESOLVER LEAVES THE ROUTE AS A NON-200', async () => {
        // Executed, not read. The source assertion below cannot tell a route
        // that mirrors the refusal from one that calls the resolver and ignores
        // the answer — a mutant that replaced the `!result.ok` guard with
        // `false` survived every structural check in this file.
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_key';
        global.fetch = jest.fn(async () => ({
            ok: false, status: 422, json: async () => ({ message: 'Could not resolve account name' }),
        })) as any;

        const { POST } = await import('@/app/api/kyc/verify-bank-account/route');
        const response: any = await POST(new Request('http://localhost/api/kyc/verify-bank-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountNumber: '0123456789', bankCode: '058' }),
        }) as any);

        expect(response.status).toBe(422);
        const body = await response.json();
        expect(body.success).toBe(false);
        expect(body.accountName).toBeUndefined();
    });

    it('and a resolution comes back as the bank’s name — the vacuity guard', async () => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_key';
        global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({ status: true, data: { account_name: 'ADA OBI', account_number: '0123456789' } }),
        })) as any;

        const { POST } = await import('@/app/api/kyc/verify-bank-account/route');
        const response: any = await POST(new Request('http://localhost/api/kyc/verify-bank-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountNumber: '0123456789', bankCode: '058' }),
        }) as any);

        expect(response.status).toBe(200);
        expect((await response.json()).accountName).toBe('ADA OBI');
    });

    it('and the route now delegates, so there is ONE resolver', () => {
        const route = source(ROUTE);

        expect(route).toContain('resolveBankAccount(accountNumber, bankCode)');
        expect(route).not.toContain('bank/resolve?account_number');
        expect(route).toContain('requireSession');
        expect(route).toContain('withRateLimit');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#346 — the resolver fails closed, every way it can fail', () => {
    const OLD = { ...process.env };
    const realFetch = global.fetch;

    beforeEach(() => { process.env.PAYSTACK_SECRET_KEY = 'sk_test_key'; });
    afterEach(() => {
        process.env = { ...OLD };
        global.fetch = realFetch;
        jest.restoreAllMocks();
    });

    async function resolver() {
        return (await import('@/lib/bank-account-resolve')).resolveBankAccount;
    }

    it('RESOLVES, AND RETURNS THE BANK’S NAME — the vacuity guard', async () => {
        global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({ status: true, data: { account_name: 'ADA OBI', account_number: '0123456789', bank_id: 7 } }),
        })) as any;

        const result = await (await resolver())('0123456789', '058');

        expect(result.ok).toBe(true);
        expect(result.accountName).toBe('ADA OBI');
    });

    it('a MISSING PAYSTACK KEY is a refusal, not a pass', async () => {
        delete process.env.PAYSTACK_SECRET_KEY;
        global.fetch = jest.fn() as any;

        const result = await (await resolver())('0123456789', '058');

        expect(result.ok).toBe(false);
        expect(result.status).toBe(503);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('A NETWORK FAULT IS A REFUSAL TOO', async () => {
        // The one that decides whether a Paystack outage records unverified
        // payout accounts or refuses registrations. It refuses.
        global.fetch = jest.fn(async () => { throw new Error('ECONNRESET'); }) as any;

        const result = await (await resolver())('0123456789', '058');

        expect(result.ok).toBe(false);
        expect(result.status).toBe(503);
    });

    it('a 200 with no account_name is refused rather than read as blank', async () => {
        global.fetch = jest.fn(async () => ({
            ok: true, json: async () => ({ status: true, data: {} }),
        })) as any;

        expect((await (await resolver())('0123456789', '058')).ok).toBe(false);
    });

    it('an unparseable body is refused', async () => {
        global.fetch = jest.fn(async () => ({
            ok: true, json: async () => { throw new SyntaxError('not json'); },
        })) as any;

        expect((await (await resolver())('0123456789', '058')).ok).toBe(false);
    });

    it('and Paystack’s own error reaches the caller with its status', async () => {
        global.fetch = jest.fn(async () => ({
            ok: false, status: 422, json: async () => ({ message: 'Could not resolve account name' }),
        })) as any;

        const result = await (await resolver())('0123456789', '058');

        expect(result.ok).toBe(false);
        expect(result.status).toBe(422);
        expect(result.reason).toBe('Could not resolve account name');
    });

    it.each([
        ['too short', '01234'],
        ['not digits', 'abcdefghij'],
        ['eleven digits', '01234567890'],
        ['empty', ''],
    ])('a %s account number never reaches the network', async (_label, accountNumber) => {
        global.fetch = jest.fn() as any;

        expect((await (await resolver())(accountNumber, '058')).ok).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('and a missing bank code does not', async () => {
        global.fetch = jest.fn() as any;

        expect((await (await resolver())('0123456789', '')).ok).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('the account number and bank code are URL-ENCODED into the query', async () => {
        // They reach a URL by string concatenation; an unencoded value is a
        // query-parameter injection into the Paystack request.
        const fetchMock = jest.fn(async () => ({
            ok: true,
            json: async () => ({ status: true, data: { account_name: 'ADA OBI' } }),
        })) as any;
        global.fetch = fetchMock;

        await (await resolver())('0123456789', '058&foo=bar');

        expect(String(fetchMock.mock.calls[0][0])).toContain('058%26foo%3Dbar');
    });
});
