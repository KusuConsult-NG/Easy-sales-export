/**
 * @jest-environment node
 */

/**
 *   #678 THE PLATFORM COLLECTS ANSWERS NOBODY READS.
 *
 *   #677 found `system_health/paystack_reconciliation`: a payment
 *   reconciliation writing its verdict — including "more than three payments
 *   are missing" — into a document read by no screen, no action and no route.
 *   That prompted the obvious question: what ELSE is written and never read?
 *
 *   THREE MORE, EACH VERIFIED BY READING EVERY MENTION IN THE REPOSITORY.
 *
 *     africastalking_delivery_logs   THE ONE THAT MATTERS. Africa's Talking
 *                                    posts a delivery report for every SMS —
 *                                    delivered, failed, rejected — and the
 *                                    webhook stores each one, keyed by the
 *                                    message id. Nothing reads them.
 *
 *                                    Meanwhile `sendSMS` RETURNS that message
 *                                    id and the broadcast throws it away,
 *                                    counting only what the API ACCEPTED. So
 *                                    the platform holds both halves of "did
 *                                    this message arrive" and never joins
 *                                    them: an admin is told "Sent 500, Failed
 *                                    0" while the evidence that 500 bounced
 *                                    sits in a collection nobody opens.
 *
 *     system_metadata/export_stats   Four counters — pending, approved,
 *                                    rejected, resubmitted — maintained with
 *                                    FieldValue.increment by three writers,
 *                                    one carrying a comment about awaiting the
 *                                    write to preserve "data integrity during
 *                                    process recycles". No reader. Worse than
 *                                    idle: the writer swallows its own errors
 *                                    into logger.error and nothing has ever
 *                                    reconciled them against the applications
 *                                    they count, so they drift silently and
 *                                    will look authoritative to whoever reads
 *                                    them first.
 *
 *     wave_resource_downloads        Written, by its own comment, "for access
 *                                    auditing". An audit nobody performs.
 *
 * ── AND AN INSTRUMENT THAT WAS BUILT, TESTED AND THROWN AWAY ────────────────
 *
 *   This file was going to carry a SWEEP — every collection written and never
 *   read, pinned as a judged list so a new one could not arrive unnoticed. It
 *   is not here, and the reason is worth more than the sweep would have been.
 *
 *   Validated against known answers before being trusted, it failed twice:
 *
 *     audit_logs             reported write-only. It is read everywhere,
 *                            through COLLECTIONS.AUDIT_LOGS. Fixed by
 *                            resolving the constants.
 *
 *     academy_enrollments    reported write-only. userMetrics.service.ts reads
 *                            it with `fetchAllDocs(db.collection(...))` — THE
 *                            `.get()` IS INSIDE THE HELPER. A collection
 *                            reference handed to a function can be used in ways
 *                            no amount of reading the call site reveals, and
 *                            that class cannot be fixed by a better regex.
 *
 *   A ratchet with an irreducible false-positive rate teaches people to add
 *   entries to a list to silence it, which is worse than no ratchet. Ninety per
 *   cent of a sample failing identically is a statement about the instrument —
 *   #671's rule — and so is one clean false positive on a collection the
 *   platform plainly reads.
 *
 *   What survives is what was checked BY HAND: every mention of these three
 *   names, read. That is narrow and it is sound, and the assertions below are
 *   about facts, not about a sweep's opinion.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();

/** Every application source file — not the tests, which name these in prose. */
const sources = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            if (entry === 'node_modules' || entry === '__tests__' || entry === '.next') continue;
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) { walk(full); continue; }
            if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
        }
    };
    for (const top of ['src', 'packages']) {
        try { walk(join(ROOT, top)); } catch { /* an absent tree is not a finding */ }
    }
    return out;
};

const FILES = sources();

/** Which files mention this collection name at all, comments stripped. */
const filesMentioning = (name: string): string[] =>
    FILES
        .filter((f) => stripComments(readFileSync(f, 'utf8'), { label: relative(ROOT, f) }).includes(name))
        .map((f) => relative(ROOT, f))
        .sort();

/**
 * Every statement that opens this collection and then READS it.
 *
 *   ADDED BECAUSE A MUTANT SURVIVED AND WAS RIGHT TO. "Only one file mentions
 *   this name" does not say that file never reads it — a `.where(...).get()`
 *   added three lines above the write leaves the filename list identical, and
 *   the claim in the test's own title ("mentioned only where it is WRITTEN")
 *   would have become false silently.
 *
 *   Scoped to the statement, not a fixed window: a window long enough to catch
 *   a chained read is also long enough to catch an unrelated one, which is the
 *   mistake that made this file's discarded sweep unusable.
 */
const readsOf = (name: string): string[] => {
    const found: string[] = [];
    for (const file of FILES) {
        const src = stripComments(readFileSync(file, 'utf8'), { label: relative(ROOT, file) });
        const pattern = new RegExp(`\\.collection\\(\\s*["'\`]${name}["'\`]\\s*\\)`, 'g');
        for (const m of src.matchAll(pattern)) {
            const at = m.index ?? 0;
            const end = src.indexOf(';', at);
            const statement = src.slice(at, end < 0 ? at + 300 : end);
            if (/\.(get|where|orderBy|limit|select|count)\s*\(/.test(statement)) {
                found.push(`${relative(ROOT, file)}: ${statement.slice(0, 80)}`);
            }
        }
    }
    return found;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#678 — the three collections nothing reads, as measured', () => {
    it('THE SWEEP IS READING THE APPLICATION', () => {
        //   THE control. Every assertion below is about which files mention a
        //   name, and an empty file list agrees with any expectation.
        expect(FILES.length).toBeGreaterThan(500);
    });

    it.each([
        ['africastalking_delivery_logs', ['src/app/api/webhooks/africastalking/route.ts']],
        ['wave_resource_downloads', ['src/app/actions/wave/_member.ts']],
    ])('%s IS MENTIONED ONLY WHERE IT IS WRITTEN', (name, expected) => {
        /*
         *   The finding, as a fact rather than an opinion: the whole
         *   application names this collection in exactly one place, and that
         *   place writes to it.
         *
         *   THIS FAILS IN BOTH DIRECTIONS ON PURPOSE. A reader appearing is
         *   good news and still changes what this file claims — whoever adds
         *   one should delete the entry and say so. A second WRITER appearing
         *   is the thing to look at twice.
         */
        expect(filesMentioning(name)).toEqual(expected);
        //   And that file does not read it either — see readsOf's note. Named,
        //   not counted, so a failure shows the statement that appeared.
        expect({ reads: readsOf(name) }).toEqual({ reads: [] });
    });

    it('AND export_stats IS WRITTEN BY THREE AND READ BY NONE', () => {
        /*
         *   Listed separately because `system_metadata` is the collection and
         *   `export_stats` the document — the counters live under one id, so
         *   the name to follow is the document's.
         */
        expect(filesMentioning('export_stats')).toEqual([
            'src/app/actions/admin/_exports.ts',
            'src/app/actions/export/_ex_onboarding.ts',
        ]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#678 — and the SMS join stays possible, which is the part that can rot', () => {
    it('sendSMS RETURNS THE MESSAGE ID', () => {
        /*
         *   The gap above is about a join nobody performs. These two assertions
         *   are about it remaining performable: if either half stopped carrying
         *   the message id, the gap would quietly become permanent rather than
         *   open, and the data already collected would be orphaned.
         */
        const at = stripComments(readFileSync(join(ROOT, 'src/lib/africastalking.ts'), 'utf8'),
            { label: 'africastalking.ts' });

        expect(at).toContain('messageId: recipient.messageId');
    });

    it('AND THE DELIVERY WEBHOOK KEYS ITS RECORD ON THE SAME ID', () => {
        const hook = stripComments(
            readFileSync(join(ROOT, 'src/app/api/webhooks/africastalking/route.ts'), 'utf8'),
            { label: 'africastalking webhook' },
        );

        expect(hook).toContain('.doc(String(id))');
        expect(hook).toContain('messageId: id');
    });

    it('AND THE BROADCAST STILL COUNTS ACCEPTANCES, WHICH IS WHAT IT CAN HONESTLY COUNT', () => {
        /*
         *   THE control, and the reason this finding is not "the sent count is
         *   a lie". `sent` is an honest count of what the API accepted; the
         *   sandbox work already made the screen say so when nothing could have
         *   been delivered. What is missing is the second number, and inventing
         *   one from the first would be worse than not having it.
         */
        const sms = stripComments(readFileSync(join(ROOT, 'src/app/actions/sms-broadcast.ts'), 'utf8'),
            { label: 'sms-broadcast.ts' });

        //   Anchored on the EXPRESSION, not on the word. The first version
        //   asked `toContain('sandboxMode')`, and that file names the flag in
        //   the log row, the return value and the audit metadata — so a mutant
        //   that renamed the declaration and broke the computation SURVIVED on
        //   the strength of the other three mentions. #665 and #667 were both
        //   that shape; this is the third.
        expect(sms).toContain('const sandboxMode = atUsername.toLowerCase() === "sandbox"');
        expect(sms).toContain('sent++');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     a second file starts mentioning the delivery logs               KILLED
 *     the wave download log gains a reader                            KILLED
 *       — SURVIVED, and was RIGHT TO. The mutant added a read in the
 *         same file that already writes it, so the list of filenames
 *         was unchanged and the assertion passed while the claim in the
 *         title — "mentioned only where it is WRITTEN" — had become
 *         false. `readsOf` was added for that, scoped to the statement.
 *     export_stats gains a fourth toucher                             KILLED
 *     the broadcast stops reporting sandbox mode                      KILLED
 *       — SURVIVED first: the assertion asked for the WORD, and that
 *         file names the flag in the log row, the return value and the
 *         audit metadata, so renaming the declaration left three
 *         mentions standing. Anchored on the expression instead.
 *     the delivery webhook stops keying on the message id             KILLED
 *     sendSMS stops returning the message id                          KILLED
 *     the broadcast stops reporting sandbox mode                      KILLED
 *     the file sweep is narrowed to nothing                           KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT IS RECORDED AND NOT FIXED, AND WHY ─────────────────────────────────
 *
 *   READING THE DELIVERY LOGS IS A FEATURE, NOT A REPAIR. Joining them to a
 *   broadcast needs somewhere to keep one message id per recipient — tens of
 *   thousands of rows per send — or a reconciliation over a time window. Both
 *   are real design decisions with an operational cost, and neither is
 *   repairing something that is broken: the webhook works, the ids are
 *   correct, and nothing is being lost that was not always being lost.
 *
 *   The same is true of export_stats, where the honest options are to build the
 *   screen those counters were meant for or to stop keeping them — and a
 *   counter that has drifted for months should not be shown to anybody until
 *   somebody has reconciled it once.
 *
 *   Both are named here so the next person meets them as decisions rather than
 *   as surprises.
 */
