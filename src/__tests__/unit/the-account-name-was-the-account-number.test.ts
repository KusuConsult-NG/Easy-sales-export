/**
 * @jest-environment node
 */

/**
 *   #537 TWO DEFECTS ON THE SCREEN WHERE A LOAN IS AUTHORISED, AND A THIRD
 *        SHAPE THAT #535'S OWN RATCHET COULD NOT SEE.
 *
 * ── (a) THE ACCOUNT NAME WAS THE ACCOUNT NUMBER ─────────────────────────────
 *
 *   getAdminLoanApplicationsAction resolved the payee's account name through a
 *   seven-term fallback chain whose fifth term was
 *
 *       user.bankAccount?.accountNumber
 *
 *   Its own sibling — getAdminLoanApplicationsExportAction, 190 lines below,
 *   enriching the SAME rows for the CSV — reads `bankAccount?.accountName`, and
 *   so does every other one of the twenty sites in this codebase that resolves
 *   an account name. This was the only one that did not.
 *
 *   It bites a borrower whose bank details live only under `user.bankAccount`:
 *   no `bankDetails` object, no top-level `bankAccountName`. On that shape
 *   `accountNumber` is always populated, so the wrong term never fell through —
 *   it SHADOWED the `user.fullName` term immediately after it, which is the
 *   value that would otherwise have been correct.
 *
 *   What an approver saw on /admin/cooperatives/loans was a string of digits in
 *   the Account Name field, beside the same digits in Account Number, on the
 *   screen where a disbursement is authorised. Exporting the identical row to
 *   CSV showed the real name. Two doors onto one field, disagreeing — and the
 *   one a human reads before releasing money was the wrong one.
 *
 * ── (b) THE EXPORT BUTTON WAS THE WAY ROUND THE RESTRICTION ─────────────────
 *
 *   #535 put bank details on the loans queue behind
 *   mayRevealMemberPii("cooperatives:approve_loans"), on roles re-read from the
 *   database. The export of that same queue attached bankName, accountNumber
 *   and accountName to every row behind nothing but `isAdmin(session.user.roles)`
 *   — the stale JWT claim #356 established can be hours out of date.
 *
 *   So an admin role the SCREEN refuses to show an account number to could
 *   press Export and download all of them, and a revoked admin could do it
 *   until their token expired.
 *
 * ── (c) WHY THE RATCHET SAID THIS FILE WAS DONE ─────────────────────────────
 *
 *   #535's sweep asked, of each of the thirteen decider files:
 *
 *       expect(code(f).includes('mayRevealMemberPii(')).toBe(true)
 *
 *   A FILE-LEVEL CONTAINMENT CHECK. _loans_applications.ts contains the call —
 *   in one of its two readers. A file with two exports, one gated and one open,
 *   passed while half of it stayed open.
 *
 *   That is the same instrument weakness that let the settings mutant survive
 *   in #532: asking whether the text is PRESENT rather than whether the code
 *   RUNS it. Rewritten per-function here, it found two more of exactly this
 *   shape, both in files the old check passed:
 *
 *     _ac_admin_applications.ts   _getPendingAcademyApplicationsAction
 *                                 — the queue an academy admin works from,
 *                                   while the two readers below it are gated
 *     _wv_admin_applications.ts   _getStandardWaveApplicationsAction
 *                                 — the bigger of the file's two lists, while
 *                                   the sibling above it is gated
 *
 *   THE SPREADS ARE PART OF THE GATE. Each of these returns the raw row with
 *   `...app`, and the WAVE one also spreads `...canonical`, which carries its
 *   own `bankDetails`. Gating only the keys a function ADDS leaves the copies
 *   under other names — the omission #535 had to correct on the screen door.
 *   The first version of the WAVE fix did exactly that and the withheld-case
 *   test below caught it.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   The four remaining functions that touch these fields without asking the
 *   rule are payout PROCESSORS — _processWithdrawalAction,
 *   _processWaveWithdrawalAction, _approveSellerVerificationAction and the
 *   firstWithAccount helper. They read an account in order to PAY it, and
 *   return status objects rather than PII. They are named below as a control:
 *   if a future edit makes one of them return a member's details, it leaves the
 *   allow-list and the sweep fails.
 *
 *   This also does not make these three screens safe against a stale token —
 *   their own call gates are untouched and still among the 88 that
 *   half-converted-off-the-stale-token.test.ts counts and caps. It closes the
 *   FIELDS, and says so rather than implying more.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     screen door's accountName back to `?.accountNumber`   KILLED (3 tests)
 *     the loans export gate hard-coded true                 KILLED (2)
 *     the loans export emission made unconditional          KILLED (2)
 *     the academy gate hard-coded true                      KILLED (1)
 *     WAVE gate left on, `...canonical` spread unfiltered   KILLED (1)
 *     WAVE gate left on, raw row spread unfiltered          KILLED (1)
 *     one allow-list name misspelt                          KILLED (2)
 *     the splitter reverted to its first-`{` version        KILLED (1) — the
 *                                                           guard on the
 *                                                           measurement itself
 *     reword the source header                              SURVIVED, as intended
 *
 *   The first anchored swap was REFUSED by its own `assert count == 1`: the
 *   chain it meant to mutate now appears twice in that file, because the export
 *   door reads the identical one. That is the finding restated — the two doors
 *   agree — and it is why the swaps are anchored rather than global.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { auth } from '@/lib/auth';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: p });

let store: FakeDbHandle;

const ADMIN = 'admin-1';
const BORROWER = 'borrower-1';

/** The bank details this borrower has, and the ONLY place they live. */
const ACCOUNT_NUMBER = '0123456789';
const ACCOUNT_NAME = 'ADAEZE N OBI';

/**
 * Sign the caller in at both doors.
 *
 * `requireSession` is what the actions themselves call; `auth` is what
 * requireAdmin re-reads underneath mayRevealMemberPii. A test that set only one
 * of them measures the other door's default, so both are set from one place.
 */
function actAs(id: string, tokenRoles: string[], recordRoles: string[] | null): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles: tokenRoles, email: `${id}@example.com`, name: id } },
        error: null,
    }));
    (auth as unknown as jest.Mock).mockImplementation(() => Promise.resolve(
        { user: { id, roles: tokenRoles, email: `${id}@example.com` } },
    ));
    if (recordRoles !== null) {
        store.seed(COLLECTIONS.USERS, id, { roles: recordRoles, email: `${id}@example.com` });
    }
}

beforeEach(() => {
    //   No resetModules: requireAdmin reads auth() from @/lib/auth and a fresh
    //   registry hands it a different copy of that mock than actAs configures.
    jest.clearAllMocks();
    store = installFakeDb();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#537(a) — the name beside the number', () => {
    /**
     * A borrower whose bank details live ONLY under `bankAccount`. This is the
     * shape the defect needed: with a `bankDetails` object or a top-level
     * `bankAccountName` present, an earlier term in the chain wins and the bug
     * is invisible — which is why it survived in production.
     */
    function seedBorrowerWithNestedBankAccountOnly(): void {
        store.seed(COLLECTIONS.USERS, BORROWER, {
            fullName: 'Adaeze Obi',
            email: 'adaeze@example.com',
            bankAccount: {
                bankName: 'Zenith Bank',
                accountNumber: ACCOUNT_NUMBER,
                accountName: ACCOUNT_NAME,
                bankCode: '057',
            },
        });
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'app-1', {
            userId: BORROWER, status: 'pending', amount: 250_000,
            appliedAt: '2026-03-01T00:00:00.000Z',
        });
    }

    beforeEach(() => {
        actAs(ADMIN, ['super_admin'], ['super_admin']);
        seedBorrowerWithNestedBankAccountOnly();
    });

    it('THE APPROVER IS SHOWN THE ACCOUNT NAME, NOT THE ACCOUNT NUMBER AGAIN', async () => {
        const { getAdminLoanApplicationsAction } =
            await import('@/app/actions/cooperative/_loans_applications');

        const result = await getAdminLoanApplicationsAction({});
        expect(result.success).toBe(true);

        const row = ((result.data ?? []) as Record<string, unknown>[])[0];
        expect(row).toBeDefined();

        //   Stated both ways deliberately. The positive assertion alone would
        //   pass on a chain that reached `user.fullName`, which is a DIFFERENT
        //   correct-looking answer; the negative alone would pass on a blank.
        expect(row.accountName).toBe(ACCOUNT_NAME);
        expect(row.accountName).not.toBe(ACCOUNT_NUMBER);
    });

    it('AND THE EXPORT OF THAT ROW AGREES WITH THE SCREEN', async () => {
        //   The pair is the finding. Either door drifting from the other fails
        //   here, whichever one is wrong.
        const { getAdminLoanApplicationsAction, getAdminLoanApplicationsExportAction } =
            await import('@/app/actions/cooperative/_loans_applications');

        const screen = await getAdminLoanApplicationsAction({});
        const csv = await getAdminLoanApplicationsExportAction({});

        const onScreen = ((screen.data ?? []) as Record<string, unknown>[])[0];
        const inCsv = ((csv.data ?? []) as Record<string, unknown>[])[0];

        expect(inCsv).toBeDefined();
        expect(onScreen.accountName).toBe(inCsv.accountName);
        expect(onScreen.accountNumber).toBe(inCsv.accountNumber);
    });

    it('AND THE NUMBER ITSELF IS STILL CORRECT — the fix did not swap the pair', async () => {
        //   The vacuity guard: setting BOTH fields to the account name would
        //   satisfy the assertions above.
        const { getAdminLoanApplicationsAction } =
            await import('@/app/actions/cooperative/_loans_applications');

        const row = ((( await getAdminLoanApplicationsAction({})).data ?? []) as Record<string, unknown>[])[0];
        expect(row.accountNumber).toBe(ACCOUNT_NUMBER);
    });

    it('AND A BORROWER WITH NO ACCOUNT NAME ANYWHERE FALLS BACK TO THEIR OWN NAME', async () => {
        //   The term the wrong one was shadowing. Without this, a fix that
        //   simply DELETED the offending term would pass every test above.
        store.seed(COLLECTIONS.USERS, BORROWER, {
            fullName: 'Adaeze Obi',
            bankAccount: { bankName: 'Zenith Bank', accountNumber: ACCOUNT_NUMBER },
        });

        const { getAdminLoanApplicationsAction } =
            await import('@/app/actions/cooperative/_loans_applications');

        const row = ((( await getAdminLoanApplicationsAction({})).data ?? []) as Record<string, unknown>[])[0];
        expect(row.accountName).toBe('Adaeze Obi');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#537(b) — the export obeys the same restriction as the screen', () => {
    beforeEach(() => {
        store.seed(COLLECTIONS.USERS, BORROWER, {
            fullName: 'Adaeze Obi',
            bankDetails: {
                bankName: 'Zenith Bank', accountNumber: ACCOUNT_NUMBER,
                accountName: ACCOUNT_NAME, bankCode: '057',
            },
        });
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'app-1', {
            userId: BORROWER, status: 'pending', amount: 250_000,
            appliedAt: '2026-03-01T00:00:00.000Z',
        });
    });

    it('AN ADMIN THE SCREEN WITHHOLDS FROM CANNOT EXPORT THE ACCOUNT NUMBERS EITHER', async () => {
        //   `support` is an admin role — it passes the isAdmin gate the export
        //   had — and it does not carry cooperatives:approve_loans.
        actAs(ADMIN, ['support'], ['support']);

        const { getAdminLoanApplicationsAction, getAdminLoanApplicationsExportAction } =
            await import('@/app/actions/cooperative/_loans_applications');

        const screen = await getAdminLoanApplicationsAction({});
        const csv = await getAdminLoanApplicationsExportAction({});

        const onScreen = ((screen.data ?? []) as Record<string, unknown>[])[0];
        const inCsv = ((csv.data ?? []) as Record<string, unknown>[])[0];

        //   The screen already withheld them. The export is the door that did not.
        expect(onScreen?.accountNumber).toBeUndefined();
        expect(inCsv).toBeDefined();
        expect(inCsv.accountNumber).toBeUndefined();
        expect(inCsv.accountName).toBeUndefined();
        expect(inCsv.bankName).toBeUndefined();
        expect(JSON.stringify(inCsv)).not.toContain(ACCOUNT_NUMBER);
    });

    it('AND THE EXPORT STILL RETURNS THE ROWS — the fields go, not the report', async () => {
        //   A gate that emptied the CSV would satisfy the assertions above and
        //   break the screen's own export button.
        actAs(ADMIN, ['support'], ['support']);

        const { getAdminLoanApplicationsExportAction } =
            await import('@/app/actions/cooperative/_loans_applications');

        const csv = await getAdminLoanApplicationsExportAction({});
        const rows = (csv.data ?? []) as Record<string, unknown>[];

        expect(csv.success).toBe(true);
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe('app-1');
        expect(rows[0].amount).toBe(250_000);
    });

    it('AND AN ADMIN WHO MAY APPROVE LOANS STILL GETS THEM', async () => {
        //   The vacuity guard: a gate answering false for everybody passes every
        //   assertion above and silently empties a working report.
        actAs(ADMIN, ['support'], ['super_admin']);

        const { getAdminLoanApplicationsExportAction } =
            await import('@/app/actions/cooperative/_loans_applications');

        const inCsv = (((await getAdminLoanApplicationsExportAction({})).data ?? []) as Record<string, unknown>[])[0];
        expect(inCsv.accountNumber).toBe(ACCOUNT_NUMBER);
        expect(inCsv.accountName).toBe(ACCOUNT_NAME);
    });

    it('AND THE RECORD DECIDES IT, NOT THE TOKEN', async () => {
        //   The #535 property, on the door #535 missed: a token still claiming
        //   super_admin against a record that has been demoted.
        actAs(ADMIN, ['super_admin'], ['support']);

        const { getAdminLoanApplicationsExportAction } =
            await import('@/app/actions/cooperative/_loans_applications');

        const inCsv = (((await getAdminLoanApplicationsExportAction({})).data ?? []) as Record<string, unknown>[])[0];
        expect(inCsv.accountNumber).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#537(c) — the two the containment check could not see', () => {
    it('THE ACADEMY PENDING QUEUE WITHHOLDS BANK DETAILS FROM A ROLE THAT MAY NOT APPROVE', async () => {
        actAs(ADMIN, ['academy_admin'], ['support']);
        store.seed(COLLECTIONS.USERS, BORROWER, {
            fullName: 'Adaeze Obi',
            bankDetails: {
                bankName: 'Zenith Bank', accountNumber: ACCOUNT_NUMBER,
                accountName: ACCOUNT_NAME, bankCode: '057',
            },
        });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'ac-1', {
            userId: BORROWER, status: 'pending', submittedAt: '2026-03-01T00:00:00.000Z',
        });

        const { getPendingAcademyApplicationsAction } =
            await import('@/app/actions/academy/_ac_admin_applications');

        const result = await getPendingAcademyApplicationsAction();
        const row = ((result.data ?? []) as Record<string, unknown>[])[0];

        expect(row).toBeDefined();
        expect(row.bankDetails).toBeUndefined();
        expect(JSON.stringify(row)).not.toContain(ACCOUNT_NUMBER);
    });

    it('AND HANDS THEM TO ONE THAT MAY', async () => {
        //   The token stays `academy_admin` — the action's OWN gate is what
        //   admits the caller to the queue, and it is deliberately untouched.
        //   Only the record changes, because only the record decides the fields.
        actAs(ADMIN, ['academy_admin'], ['super_admin']);
        store.seed(COLLECTIONS.USERS, BORROWER, {
            fullName: 'Adaeze Obi',
            bankDetails: {
                bankName: 'Zenith Bank', accountNumber: ACCOUNT_NUMBER,
                accountName: ACCOUNT_NAME, bankCode: '057',
            },
        });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'ac-1', {
            userId: BORROWER, status: 'pending', submittedAt: '2026-03-01T00:00:00.000Z',
        });

        const { getPendingAcademyApplicationsAction } =
            await import('@/app/actions/academy/_ac_admin_applications');

        const row = (((await getPendingAcademyApplicationsAction()).data ?? []) as Record<string, any>[])[0];
        expect(row.bankDetails?.accountNumber).toBe(ACCOUNT_NUMBER);
    });

    /**
     * The WAVE list is the one where gating the ADDED key was not enough.
     *
     * It returns `data: { ...app, ...canonical, bankDetails }`. `canonical`
     * carries its own `bankDetails`, and the raw row carries a top-level
     * `accountNumber` and `bankCode` — written by the approval path in the same
     * file. A first version gated only the explicit `bankDetails` key and this
     * test still found the account number, twice over.
     */
    function seedWaveApplicant(): void {
        store.seed(COLLECTIONS.USERS, BORROWER, {
            fullName: 'Adaeze Obi',
            email: 'adaeze@example.com',
            bankDetails: {
                bankName: 'Zenith Bank', accountNumber: ACCOUNT_NUMBER,
                accountName: ACCOUNT_NAME, bankCode: '057',
            },
        });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'wv-1', {
            userId: BORROWER, status: 'pending',
            createdAt: '2026-03-01T00:00:00.000Z',
            //   The row's OWN copies, as the approval path writes them.
            accountNumber: ACCOUNT_NUMBER, bankCode: '057', bankName: 'Zenith Bank',
        });
    }

    it('THE WAVE LIST WITHHOLDS THE ACCOUNT NUMBER IN EVERY PLACE IT APPEARS', async () => {
        actAs(ADMIN, ['wave_admin'], ['support']);
        seedWaveApplicant();

        const { getStandardWaveApplicationsAction } =
            await import('@/app/actions/wave/_wv_admin_applications');

        const result = await getStandardWaveApplicationsAction({});
        const rows = ((result as Record<string, any>).data ?? []) as Record<string, any>[];
        expect(rows.length).toBeGreaterThan(0);

        //   Serialised whole, because the value reaches the client through three
        //   routes — user.bankDetails, data.bankDetails and data.accountNumber —
        //   and closing two of the three is the defect, not the fix.
        expect(JSON.stringify(rows)).not.toContain(ACCOUNT_NUMBER);
        expect(rows[0].user?.bankDetails).toBeUndefined();
        expect(rows[0].data?.bankDetails).toBeUndefined();
        expect(rows[0].data?.accountNumber).toBeUndefined();
    });

    it('AND STILL RETURNS THEM TO A ROLE THAT MAY APPROVE WAVE APPLICATIONS', async () => {
        actAs(ADMIN, ['wave_admin'], ['super_admin']);
        seedWaveApplicant();

        const { getStandardWaveApplicationsAction } =
            await import('@/app/actions/wave/_wv_admin_applications');

        const rows = (((await getStandardWaveApplicationsAction({})) as Record<string, any>).data ?? []) as Record<string, any>[];
        expect(rows[0].user?.bankDetails?.accountNumber).toBe(ACCOUNT_NUMBER);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#537(c) — the check is per-function now, not per-file', () => {
    /**
     * Every file that decides whether a member's sensitive fields are returned.
     * Same list #535 uses; the difference is entirely in how it is read.
     */
    const DECIDERS = [
        'src/app/actions/academy/_ac_admin_applications.ts',
        'src/app/actions/academy/_ac_admin_reports.ts',
        'src/app/actions/admin/_exports.ts',
        'src/app/actions/admin/_marketplace.ts',
        'src/app/actions/admin/_users.ts',
        'src/app/actions/admin/_withdrawals.ts',
        'src/app/actions/cooperative/_coop_admin_members.ts',
        'src/app/actions/cooperative/_coop_admin_money.ts',
        'src/app/actions/cooperative/_loans_applications.ts',
        'src/app/actions/farm-nation-admin/_fna_finance.ts',
        'src/app/actions/farm-nation-admin/_fna_registrants.ts',
        'src/app/actions/marketplace/_escrow_actions.ts',
        'src/app/actions/wave/_wv_admin_applications.ts',
        'src/app/actions/wave/_wv_admin_withdrawals.ts',
        'src/app/api/admin/marketplace/seller-verifications/route.ts',
    ];

    /**
     * Functions that touch these fields in order to ACT on them rather than to
     * display them: they read an account so a transfer can be sent to it, or
     * copy it onto a record at approval, and return status objects.
     *
     * Named rather than pattern-matched, so adding one is a deliberate act.
     */
    const PAYOUT_PROCESSORS = new Set([
        'firstWithAccount',
        '_processWithdrawalAction',
        '_processWaveWithdrawalAction',
        '_approveSellerVerificationAction',
        '_approveWaveApplicationAction',
    ]);

    /**
     * Split a file into top-level function declarations.
     *
     * THE FIRST TWO VERSIONS OF THIS WERE WRONG AND BOTH LOOKED RIGHT.
     *
     *   1. Matching only `export function` found 11 functions across 15 files,
     *      because _users.ts and _exports.ts export `const x = withSafeAction(_x)`
     *      wrappers around unexported `_x` declarations. The bodies that emit the
     *      PII are never themselves exported.
     *
     *   2. Taking the body as the first `{` after the name captured the inline
     *      OBJECT TYPE of the first parameter — `options: { statusFilter?: … }` —
     *      as the entire function. Under that reading
     *      getAdminLoanApplicationsExportAction's "body" was a type literal
     *      containing no PII and no gate, so the known defect DID NOT APPEAR.
     *      The measurement said clean and the bug was there.
     *
     * So the body opens at the first `{` that is past the closing paren of the
     * parameter list AND at angle-bracket depth zero, which steps over the
     * braces inside a `Promise<{ … }>` return type as well.
     */
    function functions(src: string): { name: string; body: string }[] {
        const out: { name: string; body: string }[] = [];
        const re = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) {
            const start = m.index;
            let i = src.indexOf('(', start);
            if (i < 0) continue;
            let paren = 0;
            for (; i < src.length; i++) {
                if (src[i] === '(') paren++;
                else if (src[i] === ')') { paren--; if (paren === 0) { i++; break; } }
            }
            let angle = 0;
            for (; i < src.length; i++) {
                if (src[i] === '<') angle++;
                else if (src[i] === '>') angle = Math.max(0, angle - 1);
                else if (src[i] === '{' && angle === 0) break;
            }
            let depth = 0;
            for (; i < src.length; i++) {
                if (src[i] === '{') depth++;
                else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
            }
            out.push({ name: m[1], body: src.slice(start, i) });
        }
        return out;
    }

    const EMITS_PII = /accountNumber|accountName|bankCode/;
    const ASKS_A_RULE =
        /mayRevealMemberPii|maySee|mayView|mayReveal|hasAdminPermission\(\s*(?:gate|callerRoles|roles)/;

    it('THE SPLITTER SEES WHOLE FUNCTIONS — the guard on the measurement itself', () => {
        //   #484's shape: a scan whose reach is wrong reports "no offenders"
        //   for the same reason it reports nothing at all. Both numbers below
        //   were wrong in a draft of this file and both drafts passed the sweep.
        const all = DECIDERS.flatMap(f => functions(code(f)));
        expect(all.length).toBeGreaterThan(40);

        //   And the specific trap: the function whose first parameter is an
        //   inline object type must come back with its real body.
        const exporter = functions(code('src/app/actions/cooperative/_loans_applications.ts'))
            .find(f => f.name === 'getAdminLoanApplicationsExportAction');
        expect(exporter).toBeDefined();
        expect(exporter!.body).toContain('EXPORT_ROW_CAP');
        expect(exporter!.body.length).toBeGreaterThan(2000);
    });

    it('EVERY FUNCTION THAT HANDS BACK A MEMBER\'S BANK FIELDS ASKS THE SHARED RULE', () => {
        const offenders: string[] = [];
        for (const f of DECIDERS) {
            for (const fn of functions(code(f))) {
                if (!EMITS_PII.test(fn.body)) continue;
                if (PAYOUT_PROCESSORS.has(fn.name)) continue;
                if (!ASKS_A_RULE.test(fn.body)) offenders.push(`${f}::${fn.name}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('AND THE ALLOW-LIST NAMES FUNCTIONS THAT EXIST', () => {
        //   An allow-list of misspellings would silence the sweep and read as
        //   deliberate. Every name must resolve to a real declaration.
        const declared = new Set(DECIDERS.flatMap(f => functions(code(f))).map(fn => fn.name));
        for (const name of PAYOUT_PROCESSORS) {
            expect({ name, declared: declared.has(name) }).toEqual({ name, declared: true });
        }
    });

    it('AND THE SWEEP CAN STILL FAIL — a known-open shape is detected', () => {
        //   The control. A check that cannot fail is the defect class this audit
        //   keeps finding, so the sweep is run against a synthetic offender.
        const planted = `
export async function _leakingReaderAction(options: { limit?: number }): Promise<{ ok: true }> {
    const rows = await db.collection("x").get();
    return rows.map(r => ({ accountNumber: r.accountNumber, bankCode: r.bankCode }));
}`;
        const found = functions(planted)
            .filter(fn => EMITS_PII.test(fn.body) && !ASKS_A_RULE.test(fn.body))
            .map(fn => fn.name);
        expect(found).toEqual(['_leakingReaderAction']);
    });
});
