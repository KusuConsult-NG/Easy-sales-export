/**
 * @jest-environment node
 */

/**
 *   #287 A REFUSED LOAN APPLICATION PRODUCED NOTHING AT ALL, AND
 *   #288 THE REASON WAS COMPOSED, THROWN, AND THEN THROWN AWAY.
 *
 *        /loans/apply is the ONLY loan application page in this product. Its
 *        submit handler was:
 *
 *            const result = await submitLoanApplication(data);
 *            if (result.success) { router.push(...) }
 *            // If not success, error handling should be done in the component
 *
 *        The component had no error handling. LoanWizard's submit was
 *        `try { await onSubmit(data) } finally { setIsSubmitting(false) }` —
 *        a finally and no catch, no error state, nothing rendered.
 *
 *        So EVERY failure produced the same thing: the button read
 *        "Submitting…", then read "Submit Application" again, and the applicant
 *        stayed on step 5 with no message. Not signed in, validation rejected
 *        server-side, one-open-application rule — all identical, all silent. A
 *        thrown error was worse: with no catch it became an unhandled promise
 *        rejection and the screen still said nothing.
 *
 *        The only move a dead button suggests is pressing it again, and for the
 *        one-application refusal that can never work.
 *
 *        THE UNREFERENCED COPY OF THIS WIZARD GOT IT RIGHT.
 *        components/LoanApplicationWizard.tsx has no importer anywhere in the
 *        repository, and it has `setError(res.error)`, a catch, and a finally.
 *        The wired one is the one that dropped the answer — #276, #277, #279
 *        and #281's shape with the halves the other way round. Pinned at the
 *        bottom of this file, because "the dead copy is the correct one" is the
 *        kind of thing that reads as an accident until somebody writes it down.
 *
 *        AND #288: THE ANSWER WAS DESTROYED BEFORE IT GOT THERE.
 *
 *        claimSingleOpenLoanApplication enforces one open application per
 *        borrower across BOTH loan collections. loan-actions.ts threw
 *
 *            new Error("Active or pending loan application already exists platform-wide.")
 *
 *        and its catch, two lines below, ended with a flat
 *        `"Failed to submit loan application"`. So the sentence was composed
 *        one line above the throw and replaced one line below it. Even a page
 *        that DID render result.error would have shown "failed", not "refused,
 *        and here is why".
 *
 *        The two sibling actions enforcing the same rule return
 *        `error?.message`, so they always told the member — in engineer's
 *        words. Three doors onto one rule: one silent, two speaking a language
 *        nobody outside the repository reads.
 *
 * WHY THE FIX THROWS RATHER THAN RETURNING
 * ----------------------------------------
 * A `void` return can be ignored by writing no code, which is exactly how this
 * survived a code review that left a comment saying somebody else would handle
 * it. A rejection cannot be ignored: the catch in LoanWizard is the only place
 * it can land, and it renders what it caught.
 *
 * WHY THE ACTION RETURNS RATHER THAN THROWING
 * -------------------------------------------
 * The opposite choice one layer down, and deliberately. Making the message
 * survive the catch would mean forwarding `error?.message` generally, which
 * also forwards messages nobody wrote for a person — a PostgREST failure would
 * read to the applicant as something they did. A refusal is not an exception
 * here; it is an ordinary answer, so it is returned as one and the catch keeps
 * its generic fallback for genuine faults.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';
import { ONE_OPEN_LOAN_APPLICATION_MESSAGE } from '@/lib/loan-application-location';

const PAGE = 'src/app/loans/apply/page.tsx';
const WIZARD = 'src/components/loans/LoanWizard.tsx';
const ORPHAN = 'src/components/LoanApplicationWizard.tsx';

const APPLICANT_FACING_DOORS = [
    'src/app/actions/loan-actions.ts',
    'src/app/actions/cooperative/_coop_money.ts',
    'src/app/actions/cooperative/_loans_applications.ts',
];

const mockClaimLoanApp = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    claimSingleOpenLoanApplication: (...a: any[]) => mockClaimLoanApp(...a),
    debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    claimPaymentOnce: jest.fn(), claimIdempotencyKey: jest.fn(),
    claimVersionedUpdate: jest.fn(), incrementWithinCeiling: jest.fn(),
    decrementManyOrFail: jest.fn(), markFulfilmentFailed: jest.fn(),
}));
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(), claimStatusTransitionFromAny: jest.fn(),
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles: ['user'] } },
        error: null,
    }));
}

function setDocs() {
    const snap = {
        exists: true,
        empty: false,
        docs: [{ id: 'member-1', data: () => ({ membershipStatus: 'active', userId: 'borrower-1' }) }],
        data: () => ({ membershipStatus: 'active', userId: 'borrower-1' }),
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

/** Matches loanApplicationSchema — the strict one. */
const APPLICATION = {
    amount: 200_000,
    purpose: 'working_capital',
    repaymentPeriod: 6,
    collateral: { type: 'Inventory', value: 500_000, description: 'Shop inventory held at the Enugu premises' },
    businessDetails: { name: 'Ada Stores', type: 'Retail', yearsInOperation: 4, annualRevenue: 4_800_000 },
    documents: [{ name: 'ID', url: 'https://example.com/id.pdf', type: 'id' }],
} as any;

async function submit(overrides: Record<string, any> = {}) {
    const { submitLoanApplication } = await import('@/app/actions/loan-actions');
    return submitLoanApplication({ ...APPLICATION, ...overrides }) as any;
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
}

function raw(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(rel: string): string {
    return raw(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#288 — the action says why it refused', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('borrower-1');
        setDocs();
        mockClaimLoanApp.mockResolvedValue({ claimed: true, existingId: null });
    });

    it('RETURNS THE ONE-APPLICATION RULE, NOT "Failed to submit loan application"', async () => {
        // The defect in one assertion. The old catch flattened this to a
        // generic failure, so an applicant could not tell a refusal from a
        // fault — and the refusal is the one they can act on.
        mockClaimLoanApp.mockResolvedValue({ claimed: false, existingId: 'existing-loan' });

        const result = await submit();

        expect(result.success).toBe(false);
        expect(result.error).toBe(ONE_OPEN_LOAN_APPLICATION_MESSAGE);
        expect(result.error).not.toMatch(/^Failed to submit/);
    });

    it('and the sentence is written for the applicant, not for the log', async () => {
        // It read "Active or pending loan application already exists
        // platform-wide." Two of the three doors showed that string to a
        // member verbatim.
        mockClaimLoanApp.mockResolvedValue({ claimed: false, existingId: 'x' });

        const result = await submit();

        expect(String(result.error)).not.toMatch(/platform-wide/i);
        // It has to say what to do next, or it is just a politer dead end.
        expect(String(result.error)).toMatch(/status|check/i);
    });

    it('STILL RETURNS THE GENERIC MESSAGE FOR A GENUINE FAULT', async () => {
        // The other half, and the reason the refusal is RETURNED rather than
        // made to survive the catch. Forwarding `error?.message` generally
        // would show a database failure to the applicant as though they had
        // caused it.
        mockClaimLoanApp.mockRejectedValue(new Error('relation "document_collections" does not exist'));

        const result = await submit();

        expect(result.success).toBe(false);
        expect(result.error).toBe('Failed to submit loan application');
        expect(String(result.error)).not.toMatch(/relation/);
    });

    it('and a normal application is still filed', async () => {
        // Vacuity guard: the happy path has to still reach the claim and come
        // back with a loan id.
        const result = await submit();

        expect(result.success).toBe(true);
        expect(result.data?.loanId).toBeTruthy();
        expect(mockClaimLoanApp).toHaveBeenCalledTimes(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#288 — one sentence, every applicant-facing door', () => {
    it('ALL THREE APPLICATION DOORS USE THE SHARED MESSAGE', () => {
        // Three actions enforce this rule for an applicant. Three hand-written
        // sentences is how they came to disagree about whether to say anything
        // at all.
        for (const door of APPLICANT_FACING_DOORS) {
            const src = codeOnly(door);
            expect({ door, uses: src.includes('ONE_OPEN_LOAN_APPLICATION_MESSAGE') })
                .toEqual({ door, uses: true });
        }
    });

    it('AND NO APPLICANT IS SHOWN THE ENGINEER PHRASING', () => {
        /**
         * Derived. The literal was written four times; the sweep finds a fifth.
         *
         * The two ADMIN sites are deliberately exempt and matched precisely: at
         * APPROVAL time an admin is told that the rule blocks a decision about
         * SOMEBODY ELSE, which is why their sentence ends "for this user". That
         * is a different audience and a correct message for it. Exempted by
         * that exact suffix rather than by filename, so a new applicant-facing
         * copy cannot inherit the exemption by living in the same file.
         */
        const files = walk(join(process.cwd(), 'src'))
            .map((f) => f.slice(process.cwd().length + 1))
            .filter((f) => !f.includes('__tests__'));

        expect(files.length).toBeGreaterThan(200);

        const offenders: string[] = [];
        for (const f of files) {
            raw(f).split('\n').forEach((line, i) => {
                if (!/already exists platform-wide/.test(line)) return;
                if (/already exists platform-wide for this user/.test(line)) return;

                // COMMENTS ARE NOT THE DEFECT — a STRING LITERAL is. Three of
                // the files fixed here quote the old wording in the comment
                // explaining why it changed, and the first version of this
                // sweep reported all three. Line numbers are still counted on
                // the raw file so an offender is clickable; only the decision
                // ignores comments. (#282's ratchet made the mirror-image
                // mistake by stripping comments before counting lines.)
                const trimmed = line.trim();
                if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
                if (!/["'`][^"'`]*already exists platform-wide/.test(line)) return;

                offenders.push(`${f}:${i + 1}`);
            });
        }

        // Was: loan-actions.ts, _coop_money.ts, _loans_applications.ts.
        expect(offenders).toEqual([]);
    });

    it('and the admin variant is still there, because it is a different audience', () => {
        // Vacuity guard from the other side: an exemption nobody uses would
        // make the sweep above pass by accident.
        const adminSites = walk(join(process.cwd(), 'src'))
            .map((f) => f.slice(process.cwd().length + 1))
            .filter((f) => !f.includes('__tests__'))
            .filter((f) => /already exists platform-wide for this user/.test(raw(f)));

        expect(adminSites.length).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#287 — the page cannot swallow a refusal any more', () => {
    const src = codeOnly(PAGE);

    it('THROWS WHEN THE APPLICATION WAS NOT FILED', () => {
        // Was: `if (result.success) { router.push(...) }` and no else at all.
        expect(src).toMatch(/if \(!result\.success\)/);
        expect(src).toMatch(/throw new Error\(result\.error/);
    });

    it('and it navigates ONLY on a success', () => {
        // Positional: the redirect must sit after the refusal check, not in a
        // branch beside it that a later edit could reach first.
        expect(src.indexOf('if (!result.success)')).toBeLessThan(src.indexOf('router.push(`/loans/success'));
    });

    it('the line comment that deferred the work to a component that never did it is gone', () => {
        // Read RAW, because this assertion is ABOUT a comment and codeOnly
        // strips them — the same trap that made #283's bulk-delete anchor slice
        // from index −1.
        //
        // Narrowed to a `//` LINE comment, which is what the original was. The
        // first version matched the whole file and failed on the block comment
        // in the fixed page that quotes the old handler to explain it. Third
        // time in this file that quoting the defect tripped an assertion about
        // the defect.
        const deferrals = raw(PAGE).split('\n')
            .filter((l) => l.trim().startsWith('//'))
            .filter((l) => /error handling should be done in the component/.test(l));

        expect(deferrals).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#287 — the wizard shows what it caught', () => {
    const src = codeOnly(WIZARD);

    it('SUBMIT HAS A CATCH, NOT ONLY A FINALLY', () => {
        // The defect. `try { await onSubmit(data) } finally { ... }` turned a
        // rejection into an unhandled promise rejection and rendered nothing.
        const start = src.indexOf('async function handleSubmit');
        expect(start).toBeGreaterThan(-1);
        const body = src.slice(start, start + 900);

        expect(body).toContain('await onSubmit(data)');
        expect(body).toMatch(/\}\s*catch\s*\(/);
        expect(body).toContain('setSubmitError(');
    });

    it('and it clears the previous error before trying again', () => {
        // Otherwise a stale refusal sits under a submission that succeeded, or
        // under one that failed differently.
        const start = src.indexOf('async function handleSubmit');
        const body = src.slice(start, start + 400);

        expect(body).toContain('setSubmitError(null)');
    });

    it('THE MESSAGE IS RENDERED, AND ANNOUNCED', () => {
        // Holding it in state and not painting it would be the same silence
        // with more code. role="alert" because the previous behaviour was
        // silent in every sense, including to a screen reader.
        expect(src).toMatch(/\{submitError && \(/);
        expect(src).toContain('{submitError}');
        expect(src).toContain('role="alert"');
    });

    it('and the failure message never claims the application was filed', () => {
        // The fallback wording matters: on success onSubmit navigates away, so
        // reaching the catch means it was NOT filed.
        const start = src.indexOf('async function handleSubmit');
        const body = src.slice(start, start + 900);

        expect(body).toMatch(/could not be submitted/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#289 — every field on the loan form has a name', () => {
    /**
     * All ten inputs were `<label className="...">Business Name</label>` beside
     * a sibling `<input>`: no htmlFor, no id, not nested. Nothing associated
     * them, so a screen reader announced ten unlabelled edit boxes on a form
     * asking for collateral value and annual revenue.
     *
     * Found because the render suite could not fill the form —
     * getByLabelText reaches a field the way a screen reader does, and the
     * wizard was unreachable by both for the same reason.
     */
    const src = codeOnly(WIZARD);

    it('EVERY LABEL POINTS AT A FIELD', () => {
        const labels = src.match(/<label\b[^>]*>/g) ?? [];

        expect(labels.length).toBeGreaterThanOrEqual(10);
        expect(labels.filter((l) => !/htmlFor=/.test(l))).toEqual([]);
    });

    it('and every htmlFor has an element carrying that id', () => {
        // The half that makes the first assertion mean something: htmlFor
        // pointing at nothing is the same silence with more attributes.
        const targets = [...src.matchAll(/htmlFor="([^"]+)"/g)].map((m) => m[1]);
        const ids = new Set([...src.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

        expect(targets.length).toBeGreaterThanOrEqual(10);
        expect(targets.filter((t) => !ids.has(t))).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#287 — the orphan wizard, pinned as an observation', () => {
    /**
     * components/LoanApplicationWizard.tsx is imported by nothing. It is also
     * the copy that handles errors correctly, which is why it is worth
     * recording rather than deleting: if somebody wires it up, this says the
     * live one has since caught up, and if somebody deletes it, this says what
     * was lost. Whether the cooperative loan wizard should be reachable at all
     * is a product decision, not an audit's.
     */
    it('is still unreferenced', () => {
        // MATCHED ON AN IMPORT OR AN ELEMENT, NOT ON THE NAME. The first
        // version tested `/LoanApplicationWizard/` against the whole file and
        // reported LoanWizard.tsx as an importer — because LoanWizard's comment
        // MENTIONS the orphan to explain that the dead copy is the correct one.
        // Exactly #282's ratchet mistake: matching a name instead of the thing
        // the name is doing.
        const importers = walk(join(process.cwd(), 'src'))
            .map((f) => f.slice(process.cwd().length + 1))
            .filter((f) => !f.includes('__tests__'))
            .filter((f) => f !== ORPHAN)
            .filter((f) => /from\s+["'][^"']*LoanApplicationWizard["']|<LoanApplicationWizard[\s/>]/.test(raw(f)));

        expect(importers).toEqual([]);
    });

    it('and it is the copy that always reported the refusal', () => {
        const src = codeOnly(ORPHAN);

        expect(src).toContain('setError(res.error');
        expect(src).toMatch(/\}\s*catch\s*\(/);
    });
});
