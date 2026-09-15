/**
 * @jest-environment node
 */

/**
 *   #764 THE PLATFORM REPORTED WHAT IT DID, AND NOTHING SHOWED IT TO ANYBODY.
 *
 *   Two reports from the owner, one after the other, and they are the same
 *   finding seen from two screens.
 *
 *       "audit log still shows this:
 *        { total: 5517, errors: 5, synced: 10, skipped: 5502,
 *          truncated: false, unhandled: 0, unhandledReferences: [] }"
 *
 *       "a lot of the logs shows metadata instead not the text to be displayed
 *        there why?"
 *
 * ── WHY THEY WERE READING A JSON BLOB IN THE FIRST PLACE ────────────────────
 *
 *   Because /admin/finance never told them. Its banner was built from one field
 *   of a seven-field response:
 *
 *       const msg = data.synced > 0
 *           ? `✓ Synced ${data.synced} new transaction(s) ...`
 *           : `✓ All Paystack transactions are up to date`;
 *
 *   Both branches open with a tick, and the banner is coloured green by
 *   `syncResult.startsWith("✓")`. So that run — ten fulfilled, FIVE THROWN —
 *   reported an unqualified success. `errors`, `unhandled`,
 *   `unhandledReferences` and `truncated` were all in the payload and none of
 *   them reached the screen.
 *
 *   #531 PUT THEM THERE FOR THIS. Its own note: "Named in the response so the
 *   admin who pressed the button sees them. These are payments a person made
 *   that nothing on this platform knows how to fulfil, which is the one result
 *   of this job that needs a human." The route reported faithfully; its only
 *   reader discarded it. The worst case is the second branch — a run that
 *   synced nothing, hit its page ceiling and could not route forty payments
 *   printed "✓ All Paystack transactions are up to date", in green.
 *
 * ── AND THE FALLBACK THEY WENT TO HAD NO SENTENCE EITHER ────────────────────
 *
 *   `details` is optional on AuditLogEntry. Counted across every
 *   recordAdminAction and createAdminAuditLog call in the repository:
 *
 *       with a details sentence        40
 *       METADATA AND NO SENTENCE      112
 *       neither                        31
 *
 *   The row renderer shows `Details:` only when the field is set, and dumps
 *   `JSON.stringify(metadata, null, 2)` whenever metadata is non-empty — so for
 *   112 of 183 write sites the expanded row IS the blob. Fixed in the reader,
 *   not at 112 call sites: the 113th is one person forgetting an optional
 *   field, and it has been optional since it was introduced.
 *
 * ── AND `errors` WAS THE ONE FIGURE NOBODY COULD ACT ON ─────────────────────
 *
 *   Every other number in that metadata answers a question. `skipped` means
 *   already recorded, `synced` means fulfilled by this run, `unhandled` NAMES
 *   its references. `errors` was a bare integer, and the catch that produces it
 *   writes no row anywhere — so unlike an unroutable payment, which at least
 *   leaves a processed_payments row, there was no collection to search. #760
 *   settled what that is worth: "the only record was a log line".
 *
 *   The same job's other door already did it right: cron/reconcile-paystack
 *   pushes { reference, amount, email, date, channel } onto a named list and
 *   persists it. The door that counted is the MANUAL repair tool — reached
 *   precisely when an admin is chasing a payment that did not land.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { summarisePaystackSync } from '@/lib/paystack-sync-summary';
import { describeAuditEntry, hasWrittenDetails, humaniseActionName } from '@/lib/audit-entry-description';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const SYNC_ROUTE = 'src/app/api/admin/finance/paystack-sync/route.ts';
const FINANCE_PAGE = 'src/app/admin/finance/page.tsx';
const AUDIT_PAGE = 'src/app/admin/audit-logs/page.tsx';

/** The owner's actual run. */
const OWNERS_RUN = {
    total: 5517,
    errors: 5,
    synced: 10,
    skipped: 5502,
    truncated: false,
    unhandled: 0,
    unhandledReferences: [],
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#764 — the owner\'s own run does not report as a success', () => {
    it('THE RUN THEY PASTED IS A WARNING, NOT A TICK', () => {
        /*
         *   THE test. Five transactions threw; the screen said
         *   "✓ Synced 10 new transactions from Paystack".
         */
        const verdict = summarisePaystackSync(OWNERS_RUN);

        expect(verdict.tone).toBe('warning');
        expect(verdict.message).toContain('5 transactions failed');
        //   And what DID land stays in the headline — "ten went through and
        //   five did not" is a different instruction from either half alone.
        expect(verdict.message).toContain('Synced 10');
    });

    it('AND THE ACCOUNTING IN THAT ROW ADDS UP, so the 5 are real', () => {
        /*
         *   Every transaction increments exactly one counter. Asserted because
         *   the whole finding rests on those five being a real bucket rather
         *   than a double-count of something already reported elsewhere.
         */
        const { synced, skipped, errors, unhandled, total } = OWNERS_RUN;

        expect(synced + skipped + errors + unhandled).toBe(total);
    });

    it('AND THE WORST CASE IS NO LONGER CALLED "UP TO DATE"', () => {
        /*
         *   Nothing synced, the sweep truncated, forty payments unroutable.
         *   The old expression printed, in green:
         *       ✓ All Paystack transactions are up to date
         */
        const verdict = summarisePaystackSync({
            total: 4000, synced: 0, skipped: 3900, errors: 60, unhandled: 40,
            truncated: true, unhandledReferences: ['ref-a', 'ref-b'],
        });

        expect(verdict.tone).toBe('warning');
        expect(verdict.message).not.toContain('up to date');
        expect(verdict.message).toContain('not every page was read');
    });

    it('AND AN UNROUTABLE PAYMENT ALONE IS ENOUGH TO RAISE IT', () => {
        /*
         *   ONE CONDITION AT A TIME, and this test exists because the sweep
         *   caught its absence: a mutant that made summarisePaystackSync ignore
         *   `unhandled` completely SURVIVED the first version of this suite.
         *
         *   The reason is the trap this audit keeps meeting. The worst-case
         *   fixture above sets truncated AND errors AND unhandled, so the amber
         *   tone was satisfied by either of the other two and the message
         *   assertion matched the truncation line. Forty payments nobody can
         *   fulfil were invisible to the whole suite — and that is the exact
         *   class #531 built this reporting for: "payments a person made that
         *   nothing on this platform knows how to fulfil".
         */
        const verdict = summarisePaystackSync({
            total: 100, synced: 3, skipped: 95, errors: 0, unhandled: 2,
            truncated: false, unhandledReferences: ['ref-x', 'ref-y'],
        });

        expect(verdict.tone).toBe('warning');
        expect(verdict.message).toContain('2 could not be routed');
        expect(verdict.details.join(' ')).toContain('ref-x, ref-y');
        expect(verdict.details.join(' ')).toContain('nothing here knows how to fulfil');
    });

    it('AND SO IS A TRUNCATED SWEEP ALONE', () => {
        //   The same one-at-a-time discipline for the other two conditions.
        const verdict = summarisePaystackSync({
            total: 100, synced: 3, skipped: 97, errors: 0, unhandled: 0, truncated: true,
        });

        expect(verdict.tone).toBe('warning');
        expect(verdict.details.join(' ')).toContain('page ceiling');
    });

    it('AND SO IS A THROWN TRANSACTION ALONE', () => {
        const verdict = summarisePaystackSync({
            total: 100, synced: 3, skipped: 96, errors: 1, unhandled: 0, truncated: false,
        });

        expect(verdict.tone).toBe('warning');
        expect(verdict.message).toContain('1 transaction failed');
    });

    it('CONTROL — a genuinely clean run is still a tick', () => {
        //   The fix must not turn every sync amber. A run with nothing left for
        //   a person is the case the green banner is for.
        const clean = summarisePaystackSync({
            total: 5517, synced: 12, skipped: 5505, errors: 0, unhandled: 0, truncated: false,
        });

        expect(clean.tone).toBe('ok');
        expect(clean.message).toContain('✓');
        expect(clean.details).toEqual([]);
    });

    it('CONTROL — and a run with nothing to do still says so', () => {
        const idle = summarisePaystackSync({
            total: 5517, synced: 0, skipped: 5517, errors: 0, unhandled: 0, truncated: false,
        });

        expect(idle.tone).toBe('ok');
        expect(idle.message).toBe('✓ All Paystack transactions are up to date');
    });

    it('and an absent field is not a failure', () => {
        //   A response shape that predates a field must not read as broken.
        expect(summarisePaystackSync({}).tone).toBe('ok');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#764 — the failures are named, not just counted', () => {
    it('THE ROUTE COLLECTS A REFERENCE FOR EVERY ERROR', () => {
        const src = code(SYNC_ROUTE);

        expect(src).toContain('errorReferences.push(');
        //   Read off `tx`, because the throw may precede every local: the
        //   identity resolution is an await on the third line of the try.
        expect(src).toContain('reference: tx.reference');
    });

    it('AND PUTS THEM IN BOTH THE AUDIT ROW AND THE RESPONSE', () => {
        /*
         *   COUNTED, not matched. The same expression has to appear twice —
         *   once in the recordAdminAction metadata and once in the JSON the
         *   button's own screen reads — and a single occurrence would satisfy
         *   a bare toContain while leaving one of the two silent. That trap has
         *   caught this audit four times.
         */
        const rows = [...code(SYNC_ROUTE).matchAll(/errorReferences: errorReferences\.slice\(0, 50\)/g)];

        expect(rows).toHaveLength(2);
    });

    it('AND THE REASON IS TRUNCATED', () => {
        //   A provider error can carry a whole response body, and a row too big
        //   to write is the same as no row — which is the defect being fixed.
        expect(code(SYNC_ROUTE)).toContain('.slice(0, 200)');
    });

    it('AND NO CUSTOMER EMAIL GOES INTO THE AUDIT ROW', () => {
        /*
         *   #468 — audit metadata renders as raw JSON on a screen all ten admin
         *   roles can open. The cron twin records the payer's email because it
         *   writes to system_health; this writes to the audit log.
         */
        const src = code(SYNC_ROUTE);
        const block = src.slice(src.indexOf('errorReferences.push('));

        expect(block.slice(0, 400)).not.toContain('customer');
        expect(block.slice(0, 400)).not.toContain('email');
    });

    it('and the summary spells them out for the admin', () => {
        const verdict = summarisePaystackSync({
            errors: 2,
            errorReferences: [
                { reference: 'ref-1', reason: 'timeout' },
                { reference: 'ref-2', reason: 'no such user' },
            ],
        });

        expect(verdict.details.join(' ')).toContain('ref-1 (timeout)');
        expect(verdict.details.join(' ')).toContain('ref-2 (no such user)');
        //   And says they will be retried, which is the admin's next question.
        expect(verdict.details.join(' ')).toContain('retry');
    });

    it('and a long list is capped rather than printed whole', () => {
        const verdict = summarisePaystackSync({
            errors: 40,
            errorReferences: Array.from({ length: 40 }, (_, i) => ({ reference: `ref-${i}` })),
        });

        expect(verdict.details.join(' ')).toContain('and 35 more');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#764 — and the screen shows the whole verdict', () => {
    it('THE BANNER NO LONGER DECIDES ITS COLOUR FROM A TICK IN THE TEXT', () => {
        /*
         *   `syncResult.startsWith("✓")` was the whole colour rule, and every
         *   message the page could produce began with one.
         */
        const src = code(FINANCE_PAGE);

        expect(src).not.toContain('syncResult.startsWith("✓")');
        expect(src).toContain('syncResult.tone === "warning"');
    });

    it('AND THE PAGE ASKS THE SHARED FUNCTION RATHER THAN REBUILDING THE TERNARY', () => {
        const src = code(FINANCE_PAGE);

        expect(src).toContain('summarisePaystackSync(data)');
        //   The sentence that was wrong is gone from the component entirely.
        expect(src).not.toContain('`✓ All Paystack transactions are up to date`');
    });

    it('AND THE DETAIL LINES ARE RENDERED, not just carried', () => {
        //   A verdict with details nobody draws is the same defect one layer up.
        expect(code(FINANCE_PAGE)).toContain('syncResult.details.map(');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#764 — every audit row gets a sentence', () => {
    it('THE ROW THE OWNER PASTED NOW READS AS ENGLISH', () => {
        const line = describeAuditEntry({
            action: 'paystack_sync_run',
            targetType: 'paystack_reconciliation',
            metadata: OWNERS_RUN,
        });

        expect(line).toContain('Paystack Sync Run');
        expect(line).toContain('total 5,517');
        expect(line).toContain('errors 5');
        expect(line).toContain('synced 10');
    });

    it('A WRITER\'S OWN SENTENCE ALWAYS WINS', () => {
        /*
         *   A hand-written line knows things this cannot, which is exactly why
         *   it is not replaced. The 40 call sites that supply one are unaffected.
         */
        const written = describeAuditEntry({
            action: 'loan_approved',
            details: 'Approved ₦250,000 for Ada Obi after second review',
            metadata: { amount: 250000 },
        });

        expect(written).toBe('Approved ₦250,000 for Ada Obi after second review');
        expect(hasWrittenDetails({ action: 'x', details: 'y' })).toBe(true);
        expect(hasWrittenDetails({ action: 'x' })).toBe(false);
        expect(hasWrittenDetails({ action: 'x', details: '   ' })).toBe(false);
    });

    it('AND IT NEVER INVENTS — an empty row yields its action and nothing else', () => {
        /*
         *   A plausible-sounding audit entry nobody wrote is worse than a JSON
         *   blob. Every word has to come from a field that is present.
         */
        expect(describeAuditEntry({ action: 'account_unlock' })).toBe('Account Unlock');
        expect(describeAuditEntry({ action: 'account_unlock', metadata: {} })).toBe('Account Unlock');
        expect(describeAuditEntry({})).toBe('Unknown action');
    });

    it('AND IT NEVER RETURNS AN EMPTY STRING, whatever it is handed', () => {
        //   The screen has no second fallback. An empty summary would put the
        //   row back where it started.
        for (const entry of [
            {}, { action: '' }, { metadata: { nothing: 'recognised' } },
            { action: 'x', details: '' }, { action: 'y', metadata: null },
            { targetId: 'abc' },
        ]) {
            expect(describeAuditEntry(entry as any).length).toBeGreaterThan(0);
        }
    });

    it('AND MONEY READS AS MONEY', () => {
        const line = describeAuditEntry({
            action: 'loan_approved', targetType: 'cooperative_loan', targetId: 'LOAN-9',
            metadata: { amount: 250000, decision: 'approve' },
        });

        expect(line).toContain('₦250,000');
        expect(line).toContain('on cooperative loan LOAN-9');
    });

    it('AND A NESTED OBJECT IS LEFT TO THE RAW VIEW', () => {
        /*
         *   Rendering it would put the JSON back in the sentence, which is the
         *   thing being fixed.
         */
        const line = describeAuditEntry({
            action: 'config_updated',
            metadata: { status: 'ok', reason: { nested: true } as any },
        });

        expect(line).toContain('status ok');
        expect(line).not.toContain('nested');
        expect(line).not.toContain('{');
    });

    it('and a long value is cut rather than filling the row', () => {
        const line = describeAuditEntry({
            action: 'x', metadata: { reason: 'z'.repeat(400) },
        });

        expect(line.length).toBeLessThan(200);
        expect(line).toContain('…');
    });

    it('and the action humaniser handles the colon spellings too', () => {
        //   Two call sites use 'content:approve' rather than an underscore.
        expect(humaniseActionName('content:approve')).toBe('Content Approve');
        expect(humaniseActionName(undefined)).toBe('Unknown action');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#764 — and the audit screen uses it', () => {
    it('THE ROW ALWAYS RENDERS A LINE, not only when details exist', () => {
        /*
         *   The old markup was `{log.details && (...)}`, so 112 of 183 write
         *   sites produced a row with no sentence at all.
         */
        const src = code(AUDIT_PAGE);

        expect(src).toContain('describeAuditEntry(log)');
        expect(src).not.toContain('{log.details && (');
    });

    it('AND IT SAYS WHICH IT IS SHOWING', () => {
        /*
         *   A derived summary is a fair description, not a record of what
         *   somebody wrote, and an audit log is the one screen where that
         *   distinction has to be visible.
         */
        expect(code(AUDIT_PAGE)).toContain('hasWrittenDetails(log) ? "Details:" : "Summary:"');
    });

    it('AND THE RAW JSON IS STILL REACHABLE', () => {
        /*
         *   Not deleted — it is what a forensic question actually needs. Moved
         *   behind a click so it stops being the first thing the eye lands on.
         */
        const src = code(AUDIT_PAGE);

        expect(src).toContain('JSON.stringify(log.metadata, null, 2)');
        expect(src).toContain('Show raw metadata');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#764 — the ratchet: the description is the reader\'s job', () => {
    it('details STAYS OPTIONAL, and that is the point', () => {
        /*
         *   Making it required would turn 112 call sites into 112 compile
         *   errors and 112 hurried sentences. The repair is that a row can be
         *   described from what it carries — so this asserts the FIELD is still
         *   optional AND that the reader no longer depends on it.
         */
        const src = code('src/lib/audit-log.ts');

        expect(src).toContain('details?: string;');
        expect(code(AUDIT_PAGE)).toContain('describeAuditEntry(log)');
    });

    it('and the describer reads only fields every row has', () => {
        //   A describer that needed something optional would reintroduce the
        //   defect for rows that lack it.
        const line = describeAuditEntry({ action: 'user_role_change' });

        expect(line).toBe('User Role Change');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by FULL PATH, each mutant proving its edit landed.
 *
 *     MUTANT                                                        RESULT
 *     summarise ignores `errors` (the owner's own run)                KILLED
 *     summarise ignores `truncated`                                   KILLED
 *     summarise ignores `unhandled`                              SURVIVED ‡
 *     every verdict returns tone "ok"                                 KILLED
 *     every verdict returns tone "warning"                            KILLED †
 *     the route stops collecting errorReferences                      KILLED
 *     the references reach the response but not the audit row         KILLED
 *     describeAuditEntry returns details only, as before              KILLED
 *     describeAuditEntry prefers the derived line over `details`       KILLED
 *     the audit screen goes back to {log.details && ...}              KILLED
 *     the error reason is recorded untruncated                        KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this module's opening line                              SURVIVED
 *
 *   † The always-warning mutant is the one worth naming. A fix like this fails
 *     by crying wolf — an amber banner on every clean sync teaches an admin to
 *     dismiss it, which is the same end state as the green tick that started
 *     this. Both CONTROL cases above exist to pin that, and they catch it.
 *
 *   ‡ THE SWEEP FOUND A HOLE IN THIS SUITE, WHICH IS THE WHOLE REASON TO RUN
 *     ONE. Making summarisePaystackSync ignore `unhandled` entirely passed all
 *     28 of the first version's tests. The worst-case fixture set truncated AND
 *     errors AND unhandled together, so the amber tone was satisfied by either
 *     of the other two and the message assertion matched the truncation line —
 *     the same "one fixture, three conditions, assertion satisfied by the wrong
 *     one" trap this audit has now been caught by five times.
 *
 *     Forty payments nobody can fulfil were invisible to the entire suite, and
 *     that is precisely the class #531 built the reporting for. Three
 *     one-condition-at-a-time tests were added — unhandled alone, truncated
 *     alone, a thrown transaction alone — and the mutant is KILLED. Recorded
 *     rather than quietly re-run.
 *
 *     The control mutant was also botched first time: the pattern contained the
 *     ✓ character and the substitution never landed, so the "SURVIVED" it
 *     reported proved nothing. Re-run against a plain-ASCII line, confirmed to
 *     have landed, and it survives for real.
 */
