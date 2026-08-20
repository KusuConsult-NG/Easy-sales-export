/**
 * The WAVE payout, and the two guards that read a derived copy instead of the
 * record.
 *
 * THE PAYOUT DEFECT, PLAINLY
 * --------------------------
 * processWaveWithdrawalAction takes a compare-and-swap on the withdrawal before
 * calling Paystack, specifically so that two admins cannot both pay one request.
 * Then the catch block around the payout reverted the record to `pending` on ANY
 * throw — and both `paystackPayout` and the `batch.commit()` that records its
 * success are inside that block:
 *
 *     transfer succeeds → commit throws → catch → status: "pending"
 *
 * The money is gone and the request is back in the queue, where approving it
 * again sends a second transfer. The lock was undone by the error handler
 * beneath it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const WITHDRAWALS = 'src/app/actions/wave/_wv_admin_withdrawals.ts';
const MEMBERSHIP = 'src/app/actions/wave/_wv_membership.ts';
const EARNINGS = 'src/app/actions/wave/_wv_earnings.ts';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('a dispatched transfer is never returned to the payable queue', () => {
    it('tracks whether the transfer was handed to Paystack', () => {
        const src = code(WITHDRAWALS);

        expect(src).toContain('let payoutDispatched = false');
        // Set immediately before the call, not after it — the window that matters
        // is "we asked and do not know the answer".
        const setAt = src.indexOf('payoutDispatched = true');
        const callAt = src.indexOf('await paystackPayout(');
        expect(setAt).toBeGreaterThan(-1);
        expect(setAt).toBeLessThan(callAt);
    });

    it('parks it for reconciliation instead of reverting', () => {
        const src = code(WITHDRAWALS);

        expect(src).toContain('if (payoutDispatched) {');
        expect(src).toContain('status: "payout_dispatched_unconfirmed"');
        expect(src).toContain('needsReconciliation: true');
    });

    it('the catch does not write pending while a transfer is outstanding', () => {
        // The assertion that would have failed before. Inside the dispatched
        // branch there must be no route back to a payable state.
        const src = code(WITHDRAWALS);

        // Sliced between two CODE markers. The first attempt used a comment as
        // the end marker, and code() strips comments — so the slice ran to the end
        // of the file and picked up the not-dispatched branch's legitimate
        // rollback. A source-scanning test has to navigate by code.
        const start = src.indexOf('if (payoutDispatched) {');
        const end = src.indexOf('await returnWithdrawalToPending(ref, "Critical error before');

        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);

        const branch = src.slice(start, end);

        expect(branch).not.toContain('"pending"');
        expect(branch).not.toContain('returnWithdrawalToPending');
    });

    it('says what has to be checked, in the log and to the caller', () => {
        const src = source(WITHDRAWALS);

        expect(src).toContain('RECONCILE');
        expect(src).toContain('Do NOT re-approve until checked against Paystack');
    });

    it('still returns to pending when nothing was dispatched', () => {
        // The vacuity guard. If every failure parked the record, a genuinely
        // failed payout could never be retried — which is worse than the defect.
        const src = code(WITHDRAWALS);

        expect(src).toContain('await returnWithdrawalToPending(ref, "Critical error before the transfer was submitted"');
        // Paystack answering "no" is also a safe retry, and clears the flag.
        expect(src).toContain('payoutDispatched = false;');
    });
});

describe('the rollback is a claim, not a blind write', () => {
    it('goes through one helper rather than three inline updates', () => {
        const src = code(WITHDRAWALS);

        expect(src).toContain('async function returnWithdrawalToPending');
        expect(src).not.toMatch(/status: "pending",\s*\n\s*payoutError/);
    });

    it('claims from approved_processing', () => {
        // Reopening a withdrawal is reopening a payment. An unconditional write
        // did it regardless of what state the record had reached.
        const src = code(WITHDRAWALS);
        const fn = src.slice(src.indexOf('async function returnWithdrawalToPending'));

        expect(fn.slice(0, 900)).toContain('from: "approved_processing"');
        expect(fn.slice(0, 900)).toContain('to: "pending"');
    });

    it('reports a refused rollback rather than throwing over the real error', () => {
        const src = code(WITHDRAWALS);
        const fn = src.slice(src.indexOf('async function returnWithdrawalToPending'));

        expect(fn.slice(0, 1200)).toContain('logger.warn');
    });
});

describe('the payout reads bank details the way the rest of the file does', () => {
    it('resolves them through the canonical normaliser', () => {
        // It read `userData.bankCode`, a TOP-LEVEL field no WAVE path writes: the
        // application and the admin approval both store bankDetails.bankCode. So
        // the guard could not pass for a member enrolled through WAVE, and every
        // automated payout answered "User bank details missing".
        //
        // extractCanonicalUser is already imported and already used in this file to
        // build the bank details shown in the admin list — the list could see the
        // account and the payout could not.
        const src = code(WITHDRAWALS);

        expect(src).not.toContain('userData.bankCode');
        expect(src).toContain('extractCanonicalUser(userData ?? {})');
        expect(src).toContain('canonical.bankDetails.bankCode');
    });

    it('names which detail is missing', () => {
        // "Missing bank details" was reported for an account number that was
        // present and a code that was stored one level down.
        const src = code(WITHDRAWALS);

        expect(src).toContain('!accountNumber ? "account number" : null');
        expect(src).toContain('!bankCode ? "bank code" : null');
    });
});

describe('the wallet mirror cannot fail the money decision', () => {
    it('is written through a non-fatal helper', () => {
        // These ran after the status claim and after the balance restore, with no
        // catch: a missing mirror row threw, the admin was told the action failed,
        // and the rejection had already happened.
        const src = code(WITHDRAWALS);

        expect(src).toContain('async function mirrorWithdrawalStatus');
        expect(src).toMatch(/mirrorWithdrawalStatus\(withdrawalId, "completed"\)/);
        expect(src).toMatch(/mirrorWithdrawalStatus\(withdrawalId, "rejected"\)/);
    });

    it('is not part of the approve batch any more', () => {
        // In the batch, a missing wallet row failed the whole commit — including
        // the record of a payout that had already been made.
        const src = code(WITHDRAWALS);
        const batch = src.slice(src.indexOf('const batch = db.batch()'), src.indexOf('await batch.commit()'));

        expect(batch).not.toContain('WALLET_TRANSACTIONS');
    });

    it('swallows its own failure and says so', () => {
        // Asserted as the try/catch, not as the presence of a log line. A mutation
        // that deleted the catch and left the logger.warn behind passed the first
        // version of this test — checking that the handler EXISTS is not the same
        // as checking that the call is inside it.
        const src = code(WITHDRAWALS);
        const fn = src.slice(src.indexOf('async function mirrorWithdrawalStatus'));
        const body = fn.slice(0, 900);

        const tryAt = body.indexOf('try {');
        const updateAt = body.indexOf('.update({');
        const catchAt = body.indexOf('} catch');

        expect(tryAt).toBeGreaterThan(-1);
        expect(updateAt).toBeGreaterThan(tryAt);
        expect(catchAt).toBeGreaterThan(updateAt);
        expect(body.slice(catchAt)).toContain('logger.warn');
    });
});

describe('every status where money is committed is subtracted from the balance', () => {
    it('includes the two the payout path writes', () => {
        // `approved_processing` is the lock taken before calling Paystack;
        // `payout_dispatched_unconfirmed` is where an unrecorded transfer is
        // parked. Neither was subtracted, so a backfill during a payout credited
        // the member the amount again.
        const src = code(EARNINGS);

        expect(src).toContain('"approved_processing"');
        expect(src).toContain('"payout_dispatched_unconfirmed"');
    });

    it('still excludes rejected, which restores the balance separately', () => {
        const src = code(EARNINGS);
        const list = src.slice(
            src.indexOf('const COMMITTED_WITHDRAWAL_STATUSES = ['),
            src.indexOf('];', src.indexOf('const COMMITTED_WITHDRAWAL_STATUSES = [')),
        );

        expect(list).not.toContain('rejected');
    });

    it('every status the payout path can write is either committed or restoring', () => {
        // The invariant, checked against the writers rather than a hand-kept list:
        // a status this file sets on a withdrawal must be accounted for in the
        // balance, or the money silently stops being tracked.
        const withdrawalSrc = code(WITHDRAWALS);
        const earningsSrc = code(EARNINGS);

        const written = new Set<string>();
        for (const m of withdrawalSrc.matchAll(/(?:to|status):\s*"([a-z_]+)"/g)) {
            written.add(m[1]);
        }

        // These are the two outcomes that legitimately do NOT reduce the balance.
        const restoring = new Set(['rejected', 'pending']);

        const unaccounted = [...written].filter(
            (s) => !restoring.has(s) && !earningsSrc.includes(`"${s}"`),
        );

        expect(unaccounted).toEqual([]);
    });
});

describe('enrolment cannot overwrite a review decision', () => {
    it('checks the application, not only the registration copy', () => {
        // The previous guard read serviceRegistrations.wave.status alone. Both
        // verdict paths claim the application first and write the user document
        // after, separately — so a failed second write leaves a rejected
        // application with an empty registration status, and empty passed the
        // guard.
        const src = code(MEMBERSHIP);
        const fn = src.slice(src.indexOf('_enrollInWaveAction'));

        expect(fn).toContain('COLLECTIONS.WAVE_APPLICATIONS');

        // BOTH halves of the expression. The first version asserted only the
        // registration half, so replacing the application fallback with an empty
        // string — reinstating the exact defect — still passed.
        expect(fn).toContain('const blockedBy = REVIEW_OWNS.includes(registrationStatus)');
        expect(fn).toMatch(/\?\s*registrationStatus\s*:\s*applicationStatus;/);
        // And the application status has to actually be computed from the rows.
        expect(fn).toContain('let applicationStatus = ""');
        expect(fn).toContain('if (blocking) applicationStatus = blocking;');
    });

    it('blocks on any application in a review-owned state', () => {
        // Not "the latest" — that needs a reliable ordering key, and this is the
        // collection whose sort key turned out not to exist.
        const src = code(MEMBERSHIP);
        const fn = src.slice(src.indexOf('_enrollInWaveAction'));

        expect(fn).toMatch(/\.find\(s => REVIEW_OWNS\.includes\(s\)\)/);
    });

    it('covers under_review, which the list omitted', () => {
        const src = code(MEMBERSHIP);
        expect(src).toContain('const REVIEW_OWNS = ["pending", "under_review", "rejected", "revision_required", "suspended"]');
    });
});

describe('a legacy application can only be claimed if it is unclaimed', () => {
    it('matches the authenticated address, not the one typed on the form', () => {
        // The fallback queried `email` — the optional address from the application
        // form, spread onto the document from validatedData, therefore
        // attacker-controlled. Combined with the promotion below it, typing
        // somebody else's address handed them an approved WAVE enrolment.
        const src = code(MEMBERSHIP);

        expect(src).not.toContain('.where("email", "==", userEmail)');
        expect(src).toContain('.where("userEmail", "==", userEmail)');
    });

    it('skips applications that already belong to another account', () => {
        // The !userId test guarded only the backfill write; the document was read
        // and its status promoted either way.
        const src = code(MEMBERSHIP);

        expect(src).toContain('const unclaimed = emailQuery.docs.find(d => !d.data()?.userId)');
        expect(src).toContain('appDoc = unclaimed;');
    });

    it('logs when matches exist but all are owned', () => {
        const src = source(MEMBERSHIP);
        expect(src).toContain('already belongs to another account; none claimed');
    });

    it('still claims an unowned one, so the narrowing is not a removal', () => {
        // Applications with no userId are why the self-healing branches in this
        // file exist. Claiming yours by signing in with the matching address has
        // to keep working.
        const src = code(MEMBERSHIP);
        expect(src).toContain('await unclaimed.ref.update({ userId: session.user.id })');
    });
});
