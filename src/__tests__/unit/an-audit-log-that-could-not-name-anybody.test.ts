/**
 * @jest-environment node
 */

/**
 *   #770 THE AUDIT LOG COULD NOT SAY WHO DID ANYTHING, AND #771 A SEVERITY
 *        THAT EXPIRES IN ELEVEN DAYS.
 *
 * ── #770, FROM A PHOTOGRAPH OF /admin/audit-logs ────────────────────────────
 *
 *   Every visible row reads, in the User column:
 *
 *       Unknown
 *       2d02d66c…
 *
 *   `userEmail` is declared on AuditLogEntry and written by NOTHING in
 *   lib/audit-log.ts. Counted across every audit write in the repository:
 *
 *       audit writes                189
 *       carrying a userEmail         10
 *
 *   So 179 of 189 produce a row whose actor is an id prefix, and the reader —
 *   `log.userEmail || "Unknown"` — is honestly reporting that it does not know.
 *   An audit log that cannot name the actor does not answer the question it
 *   exists for.
 *
 *   FIXED AT THE READER, which is where #474 already fixed the sibling problem
 *   in the same function, and for the stronger half of its reasoning: writers
 *   only help rows created after they ship, and the owner is looking at months
 *   of history. #474's ruling stands — "An audit log that can be edited
 *   afterwards is not an audit log" — so no stored row is touched; the email is
 *   resolved from the id the row already carries, one query per page.
 *
 *   AND THE SUMMARY DROPPED THE ROW'S ONLY FACT. The photographed row's whole
 *   metadata is `{"action": "application_resubmitted"}`, and #764's FACT_KEYS
 *   did not include `action` — so the sentence would have named the row's
 *   target and omitted the one thing that distinguishes it from every other
 *   User Update in the log.
 *
 * ── #771, FROM THE E2E RUN'S STARTUP LOG ────────────────────────────────────
 *
 *   `MFA_SECRET_KEY` is filed under the tier the validator prints as "break one
 *   feature each, BUT STILL SERVE", described as "multi-factor enrolment and
 *   verification fail". True today. False from 2026-09-26, and the true version
 *   is much worse — see the test below for the chain.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { describeAuditEntry } from '@/lib/audit-entry-description';
import { attachActorEmails } from '@/lib/audit-actor';

/** The row shape the reader passes; spelled out so inference keeps both fields. */
type Row = { userId?: string; userEmail?: string };

/** An empty environment, typed as one — the helpers take a full ProcessEnv. */
const NO_ENV = {} as NodeJS.ProcessEnv;
const envWith = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
import { whatBreaks } from '@/lib/env-validator';
import { MFA_ADMIN_ENFORCE_FROM, adminMfaVerdict } from '@/lib/mfa-policy';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

/** A stand-in for the adapter: records the ids asked for, returns the rows. */
function fakeUsers(rows: Record<string, { email?: string }>) {
    const asked: string[][] = [];
    return {
        asked,
        db: {
            collection: () => ({
                where: (_f: unknown, _op: string, ids: string[]) => {
                    asked.push(ids);
                    return {
                        get: async () => ({
                            docs: ids
                                .filter((id) => rows[id])
                                .map((id) => ({ id, data: () => rows[id] })),
                        }),
                    };
                },
            }),
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#770 — the audit log names the actor', () => {
    it('A ROW WITH ONLY AN ID GETS ITS EMAIL', async () => {
        //   THE test, and the exact row in the photograph.
        const { db } = fakeUsers({ '2d02d66c': { email: 'ada@easysalesexport.com' } });

        const [row] = await attachActorEmails(
            [{ userId: '2d02d66c' }] as Row[], db as never,
        );

        expect(row.userEmail).toBe('ada@easysalesexport.com');
    });

    it('AND A STORED EMAIL IS NOT OVERWRITTEN', async () => {
        /*
         *   A stored value is what the actor was called AT THE TIME. The
         *   current profile may since have been renamed, or erased by #735's
         *   scrub — replacing the recorded address with today's would quietly
         *   rewrite history, which is the one thing an audit log may not do.
         */
        /*
         *   TWO ROWS BY THE SAME ACTOR, one carrying a stored address and one
         *   not — which is the ordinary shape of a page, since only 10 of 189
         *   writes record an email.
         *
         *   The first draft of this test used ONE row that already had an
         *   email, and the mutant that overwrites stored addresses SURVIVED it:
         *   with nothing missing, the function returns before it ever builds
         *   the lookup, so the line under test never ran. It proved only that
         *   an early return is an early return.
         */
        const { db } = fakeUsers({ u1: { email: 'new@e.com' } });

        const rows = await attachActorEmails(
            [{ userId: 'u1', userEmail: 'as-recorded@e.com' }, { userId: 'u1' }] as Row[],
            db as never,
        );

        //   The recorded address survives...
        expect(rows[0].userEmail).toBe('as-recorded@e.com');
        //   ...and the row that had none is filled in from the same lookup, so
        //   the resolution demonstrably ran.
        expect(rows[1].userEmail).toBe('new@e.com');
    });

    it('AND IT COSTS ONE QUERY PER PAGE, NOT ONE PER ROW', async () => {
        /*
         *   Twenty rows by three distinct actors is ONE lookup for three ids.
         *   A per-row resolve would be twenty reads on a screen that already
         *   does one — the shape #766 was about.
         */
        const { db, asked } = fakeUsers({ a: { email: 'a@e.com' }, b: { email: 'b@e.com' }, c: { email: 'c@e.com' } });
        const rows: Row[] = Array.from({ length: 20 }, (_, i) => ({ userId: ['a', 'b', 'c'][i % 3] }));

        const out = await attachActorEmails(rows, db as never);

        expect(asked).toHaveLength(1);
        expect([...asked[0]].sort()).toEqual(['a', 'b', 'c']);
        expect(out.every((r) => !!r.userEmail)).toBe(true);
    });

    it('AND A FAILED LOOKUP LEAVES THE PAGE EXACTLY AS IT WAS', async () => {
        /*
         *   Fail OPEN. An audit page that will not render because a convenience
         *   lookup threw is a worse defect than the one being fixed — #492's
         *   rule, applied to a screen rather than to money.
         */
        const db = { collection: () => ({ where: () => ({ get: async () => { throw new Error('down'); } }) }) };

        const rows: Row[] = [{ userId: 'u1' }];
        const out = await attachActorEmails(rows, db as never);

        expect(out).toEqual([{ userId: 'u1' }]);
    });

    it('AND AN ACTOR WITH NO PROFILE STAYS UNKNOWN RATHER THAN BLANK', async () => {
        //   A deleted or never-created account resolves to nothing, and the
        //   screen's own `|| "Unknown"` is the right answer for it.
        const { db } = fakeUsers({});

        const [row] = await attachActorEmails([{ userId: 'gone' }] as Row[], db as never);

        expect(row.userEmail).toBeUndefined();
    });

    it('and it asks nothing at all when every row already has one', async () => {
        const { db, asked } = fakeUsers({ u1: { email: 'x@e.com' } });

        await attachActorEmails([{ userId: 'u1', userEmail: 'x@e.com' }] as Row[], db as never);

        expect(asked).toEqual([]);
    });

    it('AND THE READER USES IT, AFTER THE REDACTION', () => {
        /*
         *   Order matters: running before redactAuditEntries could reintroduce
         *   a field #468 and #474 took out. And the CSV export pages through
         *   this same function, so it inherits both rather than needing a copy.
         */
        /*
         *   ASSERTED ON THE DATA FLOW, not on which line comes first. A first
         *   draft compared the two indexOf positions, and the mutant that
         *   bypassed the call entirely — leaving `const logs = redacted` and a
         *   throwaway `attachActorEmails([], db)` below it — SURVIVED, because
         *   the ordering it checked was still true.
         *
         *   What matters is that the redacted rows are the ones resolved, and
         *   that the result is what the action returns.
         */
        const src = code('src/app/actions/audit-log-actions.ts');

        expect(src).toContain('const redacted = redactAuditEntries(');
        expect(src).toContain('const logs = await attachActorEmails(redacted, db);');
        //   And nothing else is assigned to `logs` in that function, which is
        //   how the bypass got in.
        const body = src.slice(src.indexOf('export async function getAuditLogsAction'),
                               src.indexOf('export async function exportAuditLogsCSV'));
        expect([...body.matchAll(/const logs =/g)]).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#770 — and the summary keeps the row\'s only fact', () => {
    it('THE PHOTOGRAPHED ROW READS AS ENGLISH', () => {
        const line = describeAuditEntry({
            action: 'user_update',
            targetType: 'wave_application',
            targetId: 'WAVE-1789416719051-W0JBEH0H7',
            metadata: { action: 'application_resubmitted' },
        });

        expect(line).toContain('User Update');
        expect(line).toContain('wave application');
        //   The fact that was being dropped.
        expect(line).toContain('action application_resubmitted');
    });

    it('AND THE OTHER MEASURED KEYS ARE CARRIED TOO', () => {
        //   Counted across all 189 audit writes; these were the descriptive
        //   keys that occur and were absent from FACT_KEYS.
        for (const [key, value] of Object.entries({
            notes: 'checked the papers', title: 'Rice 50kg', purpose: 'refund',
            approved: true, tier: 'gold', phase: 'two',
        })) {
            const line = describeAuditEntry({ action: 'x', metadata: { [key]: value } });
            expect({ key, carried: line.includes(String(value === true ? 'yes' : value)) })
                .toEqual({ key, carried: true });
        }
    });

    it('and opaque identifiers are still left out', () => {
        /*
         *   The row already prints its Target ID. A sentence made of ids reads
         *   like the JSON blob this function replaced.
         */
        const line = describeAuditEntry({
            action: 'x', metadata: { sellerUserId: 'abc123', buyerId: 'def456' },
        });

        expect(line).not.toContain('abc123');
        expect(line).not.toContain('def456');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#771 — the MFA severity stops expiring', () => {
    const BEFORE = Date.parse(MFA_ADMIN_ENFORCE_FROM) - 86_400_000;
    const AFTER = Date.parse(MFA_ADMIN_ENFORCE_FROM) + 86_400_000;

    it('THE CHAIN IS REAL: after the date an unenrolled admin is sent to enrol', () => {
        /*
         *   The premise, asserted rather than assumed. mfa-policy's own note
         *   says "NOT ONE ADMINISTRATOR ACCOUNT HAS MFA TODAY", so this is
         *   every administrator.
         */
        const account = { roles: ['admin'], mfaEnabled: false };

        expect(adminMfaVerdict(account, NO_ENV, BEFORE).outcome).toBe('warn');
        expect(adminMfaVerdict(account, NO_ENV, AFTER).outcome).toBe('enrol');
    });

    it('AND ENROLMENT CANNOT SUCCEED WITHOUT THE KEY', () => {
        //   The other end of the chain: the setup route refuses outright.
        const route = code('src/app/api/auth/mfa/setup/route.ts');

        expect(route).toContain('const secretKey = process.env.MFA_SECRET_KEY;');
        expect(route).toContain('if (!secretKey)');
        expect(route).toContain('{ status: 500 }');
    });

    it('SO THE DESCRIPTION CHANGES WHEN THE DEADLINE PASSES', () => {
        /*
         *   THE test. Before the date it is one feature; after it, it is every
         *   administrator locked out of /admin with no way to fix it from
         *   inside the product — and the validator says which.
         */
        expect(whatBreaks('MFA_SECRET_KEY', NO_ENV, BEFORE))
            .toBe('multi-factor enrolment and verification fail');
        expect(whatBreaks('MFA_SECRET_KEY', NO_ENV, AFTER))
            .toContain('EVERY ADMINISTRATOR IS LOCKED OUT');
    });

    it('AND THE GRACE OVERRIDE MOVES IT, so the valve is usable', () => {
        //   An operator who needs more time sets MFA_ADMIN_GRACE_UNTIL, and the
        //   message must follow that rather than the built-in date.
        const extended = envWith({ MFA_ADMIN_GRACE_UNTIL: new Date(AFTER + 86_400_000).toISOString() });

        expect(whatBreaks('MFA_SECRET_KEY', extended, AFTER))
            .toBe('multi-factor enrolment and verification fail');
    });

    it('CONTROL — every other key keeps its fixed description', () => {
        //   A fix that made all of them date-dependent would be a different
        //   defect. Only the one whose cost actually changes.
        for (const key of ['RESEND_API_KEY', 'PAYSTACK_SECRET_KEY', 'CLOUDINARY_API_KEY']) {
            expect({ key, same: whatBreaks(key, NO_ENV, BEFORE) === whatBreaks(key, NO_ENV, AFTER) })
                .toEqual({ key, same: true });
        }
        expect(whatBreaks('SOMETHING_NOBODY_LISTED')).toBe('the feature that reads it');
    });

    it('AND IT IS STILL NOT FATAL', () => {
        /*
         *   Deliberate, and worth pinning: refusing to boot would take the
         *   whole platform down — every member, every module — because a key
         *   the ADMIN area needs is absent. That trades a bad outcome for a
         *   worse one.
         */
        const src = code('src/lib/env-validator.ts');
        const fatal = src.slice(src.indexOf('const FATAL_ENV_VARS'), src.indexOf('const REQUIRED_ENV_VARS'));

        expect(fatal).not.toContain('MFA_SECRET_KEY');
    });

    it('and the startup log says it where it cannot be scrolled past', () => {
        const src = code('src/lib/env-validator.ts');

        expect(src).toContain("degrades.includes('MFA_SECRET_KEY')");
        expect(src).toContain('MFA_ADMIN_GRACE_UNTIL');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by FULL PATH.
 *
 *     MUTANT                                                        RESULT
 *     attachActorEmails returns its input unchanged                  KILLED
 *     it overwrites a stored email with the current one         SURVIVED †
 *     it resolves one id per row instead of batching                 KILLED
 *     a thrown lookup propagates instead of failing open             KILLED
 *     the reader's attach call is bypassed                      SURVIVED ‡
 *     `action` removed from FACT_KEYS again                          KILLED
 *     whatBreaks ignores the date                                    KILLED
 *     whatBreaks ignores MFA_ADMIN_GRACE_UNTIL                       KILLED
 *     MFA_SECRET_KEY made fatal                                      KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED
 *
 *   TWO SURVIVED FIRST TIME, and both were faults in the TESTS rather than in
 *   the code. Recorded rather than quietly re-run, because each is a shape
 *   worth recognising.
 *
 *   † "A STORED EMAIL IS NOT OVERWRITTEN" passed a single row that already had
 *     an email. With nothing missing, attachActorEmails returns before it
 *     builds the lookup at all — so the line the mutant changed never ran, and
 *     the test proved only that an early return is an early return. It now
 *     passes TWO rows by the same actor, one with a stored address and one
 *     without, which is the ordinary shape of a real page: the lookup happens,
 *     the recorded address survives, and the empty one is filled from it.
 *
 *   ‡ "THE READER USES IT, AFTER THE REDACTION" compared the two indexOf
 *     positions. The mutant left `const logs = redacted` with a throwaway
 *     `attachActorEmails([], db)` underneath — so the ORDER it asserted was
 *     still true while the resolution had been bypassed entirely. Asserted on
 *     the data flow now: the redacted rows are the argument, the result is what
 *     the action returns, and `logs` is assigned exactly once in that function.
 *     Position is not connection.
 */
