/**
 * @jest-environment node
 */

/**
 *   #671 THE FORENSIC SCAN THE OWNER READS WAS COMMITTING THE DEFECT THIS AUDIT
 *   FILES MOST OFTEN, IN THREE OF ITS OWN CHECKS.
 *
 *   The owner ran the scan against production and sent the output. Read as a
 *   whole, the report says the platform is in a far worse state than it is:
 *
 *     Cooperative Financial Reconciliation            Fail
 *       "Sampled 20 members … 0 mismatch(es), 2 member(s) with no membership
 *        record."
 *       Every number on the line says the reconciliation succeeded.
 *
 *     Farm Nation Approval Drift                      Fail
 *       "Scanned 50 accounts holding the farmer role; compared 1 against their
 *        authoritative application record. Found 45 whose user registration and
 *        application disagree."
 *       It compared ONE and found FORTY-FIVE. All 45 read "no application
 *        record" — absent, not disagreeing.
 *
 *     Duplicate Profiles                              Warning
 *       "ann***@gmail.com — 2 profiles: yD9fEmmYzdMPuoczXYzh1Xqx8zv2,
 *        yD9fEmmYzdMPuoczXYzh1Xqx8zv2"
 *       ONE id, listed twice, counted as two people.
 *
 *   Three separate mechanisms, one consequence: an operator who learns that
 *   this report cries wolf will scroll past the entry that matters.
 *
 * ── AND THE FIRST DIAGNOSIS OF IT WAS HALF WRONG ────────────────────────────
 *
 *   Recorded because it is the more useful half of this finding.
 *
 *   The obvious reading of that report is that all three are the same defect:
 *   the scan calling a GAP IN THE RECORDS a FAULT IN THE RECORDS, which is this
 *   audit's signature class and which #475 had already fixed for WAVE alone.
 *   On that reading the cure is to downgrade absent records to `inconclusive`
 *   everywhere, and that is what the first version of this change did.
 *
 *   FOUR EXISTING TESTS FAILED WITHIN ONE RUN, AND ALL FOUR WERE RIGHT. #475
 *   had already considered the cooperative case explicitly — "a
 *   cooperative_member with no membership row is a defect somebody must fix,
 *   not a record that could not be read" — and #486 the Farm Nation one. They
 *   are correct: unlike an unrecorded gender, an absent membership row or an
 *   absent application is not a fact nobody collected. Somebody granted that
 *   role. Somebody approved that farmer. The record should exist.
 *
 *   THE VERDICTS WERE NEVER THE DEFECT. Two of the three were the NUMBERS:
 *
 *     · Farm Nation's 45 were an INSTRUMENT FAULT — the applications existed,
 *       under keys this one check did not try. That is the whole finding, and
 *       it is fixed by widening the lookup, not by softening the verdict.
 *     · The duplicate row was a PAGING FAULT — one document read twice.
 *
 *   and the third was the SENTENCE: "0 mismatch(es) … Fail" is a correct
 *   verdict a reader cannot predict from the line above it.
 *
 *   Believing the report's own framing would have switched off two working
 *   checks and left the defect that produced the alarming number in place.
 *   Ninety per cent of a sample failing identically is a statement about the
 *   instrument — which is the rule this audit opened with, and the rule that
 *   separated the 45 that were not findings from the 1 that was.
 *
 * ── WHAT WAS A REAL FINDING, AND IS LEFT ALONE ──────────────────────────────
 *
 *   WAVE Eligibility reported Fail on 1 ineligible participant with a stored
 *   gender of "male" in a female-only programme (#464). That verdict is
 *   correct, its 186 unrecorded genders were ALREADY separated into
 *   notCheckedIds and excluded from the verdict, and this file asserts that it
 *   stays that way rather than changing it.
 *
 *   Profiles With No Email Address (48) is also real, and is data rather than
 *   measurement — see lib/missing-email-backfill.ts.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { stripComments } from '@/lib/testing/strip-comments';
import { findFarmNationApplications } from '@/lib/farm-nation-application-lookup';
import { backfillDecision, isBlankEmail, maskAddress } from '@/lib/missing-email-backfill';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const code = (rel: string) => stripComments(read(rel), { label: rel });

const FORENSICS = 'src/app/actions/forensics.ts';

/**
 * The body of ONE check, so an assertion about one cannot be satisfied by
 * another.
 *
 *   The first version searched FORWARD from the check's name for the next
 *   `results.push({` — and every check's name appears in its own success push,
 *   so "forward" landed in the CATCH BLOCK one statement later. Eleven
 *   assertions were then made against
 *
 *       { status: "inconclusive", details: `Could not complete this scan: …` }
 *
 *   which is the same file, the same check, and none of the code under test.
 *   The sweep has to be anchored on both sides: from the `try {` that opens
 *   this check to the `} catch` that closes it.
 */
const checkBody = (source: string, marker: string): string => {
    const at = source.indexOf(marker);
    expect(`${marker} present: ${at >= 0}`).toBe(`${marker} present: true`);

    const start = source.lastIndexOf('try {', at);
    const end = source.indexOf('} catch', at);
    expect(`${marker} bounded: ${start >= 0 && end > start}`).toBe(`${marker} bounded: true`);

    return source.slice(start, end);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#671 — a Farm Nation application is looked for everywhere the product looks', () => {
    /**
     * A stand-in collection. Each key is one lookup the real collection
     * supports; a door not listed answers empty, which is how the tests below
     * isolate ONE key at a time.
     */
    const collection = (rows: {
        byUserId?: any[];
        docs?: Record<string, any>;
        byUserEmail?: any[];
        byProfileEmail?: any[];
    }) => {
        const snap = (docs: any[]) => ({ empty: docs.length === 0, docs });
        const doc = (id: string) => ({
            get: async () => {
                const found = rows.docs?.[id];
                return found
                    ? { exists: true, id, data: () => found }
                    : { exists: false, id, data: () => undefined };
            },
        });
        const query = (docs: any[]) => ({
            limit: () => query(docs),
            get: async () => snap(docs),
        });
        return {
            doc,
            where: (field: string, _op: string, value: any) => {
                if (field === 'userId') return query(rows.byUserId ?? []);
                if (field === 'userEmail') return query(rows.byUserEmail ?? []);
                if (field === 'profile.email') return query(rows.byProfileEmail ?? []);
                return query([]);
            },
        };
    };

    const row = (id: string, data: Record<string, any>) => ({ id, data: () => data });

    it('THE KEY IT ALREADY USED STILL WORKS, AND RETURNS EVERY ROW', async () => {
        /*
         *   The positive control for the whole module. A "widen the lookup"
         *   change that broke the key it started with would report the same 45
         *   with a different story, and every assertion about the new keys
         *   would still pass.
         *
         *   Every row, not one: the caller decides which application is
         *   current, and a member may hold an older rejected one beside a newer
         *   approved one.
         */
        const found = await findFarmNationApplications(
            collection({ byUserId: [row('a', { status: 'rejected' }), row('b', { status: 'approved' })] }),
            { userId: 'u1' },
        );

        expect(found.map((f) => f.data.status)).toEqual(['rejected', 'approved']);
        expect(found[0].via).toBe('userId');
    });

    it.each([
        [
            'THE ID THE USER RECORD ITSELF POINTS AT',
            { docs: { 'app-7': { status: 'approved' } } },
            { userId: 'u1', applicationId: 'app-7' },
            'applicationId',
        ],
        [
            'THE DOCUMENT ID THE LEGACY IMPORTER WRITES',
            { docs: { legacy_u1: { status: 'approved' } } },
            { userId: 'u1' },
            'legacyDocId',
        ],
        [
            'THE ADDRESS THE ACCOUNT SIGNED UP WITH',
            { byUserEmail: [row('c', { status: 'approved' })] },
            { userId: 'u1', email: 'Ada@Example.COM ' },
            'userEmail',
        ],
        [
            'AND THE ADDRESS ON THE APPLICATION ITSELF, WHICH module-access-check GRANTS ON',
            { byProfileEmail: [row('d', { status: 'approved' })] },
            { userId: 'u1', email: 'ada@example.com' },
            'profileEmail',
        ],
    ])('%s', async (_name, rows, keys, via) => {
        /*
         *   THE defect, one door at a time. The scan asked `userId` and nothing
         *   else, so a row reachable only by one of these four looked to it
         *   like no application at all — and the readers BACKFILL `userId` when
         *   they match, so the rows that still lack it are precisely the ones
         *   no reader has been through.
         */
        const found = await findFarmNationApplications(collection(rows as any), keys as any);

        expect(found.length).toBe(1);
        expect(found[0].via).toBe(via);
        expect(found[0].data.status).toBe('approved');
    });

    it('AND AN ADDRESS MATCH THAT BELONGS TO SOMEBODY ELSE IS NOT EVIDENCE ABOUT THIS USER', async () => {
        /*
         *   #36's rule, applied to a read. Reading is not claiming — but a row
         *   already owned by another account says nothing about this one, and
         *   counting it would clear an approval on the strength of a stranger's
         *   application.
         */
        const found = await findFarmNationApplications(
            collection({ byUserEmail: [row('c', { status: 'approved', userId: 'SOMEBODY-ELSE' })] }),
            { userId: 'u1', email: 'ada@example.com' },
        );

        expect(found).toEqual([]);
    });

    it('AND NOTHING ANYWHERE IS THE ONLY STATE THAT MEANS "no application record"', async () => {
        expect(await findFarmNationApplications(collection({}), { userId: 'u1', email: 'ada@example.com' }))
            .toEqual([]);
    });

    it('AND IT WRITES NOTHING, BECAUSE A SCAN THAT REPAIRS WHAT IT MEASURES CANNOT BE RUN TWICE', () => {
        /*
         *   Both real readers `update({ userId })` on the row they match. That
         *   is right for them and fatal here: the second run of the forensic
         *   would report a healthier platform because the first run edited it.
         *
         *   Asserted against the source rather than by counting calls on a
         *   double — a double only proves the doors the test happened to build.
         */
        const source = code('src/lib/farm-nation-application-lookup.ts');
        expect(source).not.toMatch(/\.(update|set|delete|create)\s*\(/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#671 — and the scan asks the wide question', () => {
    const source = code(FORENSICS);

    it('THE DRIFT CHECK NO LONGER HAS A userId QUERY OF ITS OWN', () => {
        //   THE defect. Anchored on the narrow query being GONE from this
        //   file's Farm Nation check, not on the helper being imported —
        //   importing it and then not calling it is how a fix reaches nothing.
        expect(source).toContain('findFarmNationApplications(');
        const body = checkBody(source, 'Approval Drift');
        expect(body).not.toContain('.where("userId", "==", doc.id)');
        expect(body).toContain('findFarmNationApplications(');
    });

    it('AND THE TWO NUMBERS IN THE SENTENCE DESCRIBE THE POPULATIONS THEY NAME', () => {
        /*
         *   "compared 1 … found 45" was internally impossible: the total
         *   counted rows the comparison had never run on. Drift and absence are
         *   counted separately now, each against what it actually describes.
         */
        const body = checkBody(source, 'Approval Drift');
        expect(body).toContain('Compared ${compared}');
        expect(body).toContain('A further ${noApplicationIds.length}');
    });

    it('AND BOTH ARE STILL FAILURES, WHICH IS WHERE MY FIRST ATTEMPT WAS WRONG', () => {
        /*
         *   RECORDED BECAUSE IT IS THE MORE USEFUL HALF OF THIS FINDING.
         *
         *   The first version of this change read the production report —
         *   "found 45 … no application record" — and downgraded an absent
         *   application to a GAP, status inconclusive, on the reasoning that
         *   the scan could not perform its comparison.
         *
         *   #486's own suite failed immediately, and it was right. An approval
         *   with nothing behind it is not a fact nobody collected; it is a
         *   record that should exist. Somebody approved that farmer. The
         *   application should be there.
         *
         *   WHAT WAS ACTUALLY WRONG IN PRODUCTION WAS THE LOOKUP, NOT THE
         *   VERDICT — 45 of those 45 had an application all along, under a key
         *   this check did not try. Believing the report's framing ("these are
         *   gaps") instead of asking why 90% of a sample failed identically
         *   would have switched off a working check and left the real defect in
         *   place.
         *
         *   This assertion exists so the next person tidying "checks that
         *   report gaps as failures" does not make the same move.
         */
        const body = checkBody(source, 'Approval Drift');
        expect(body).toContain('(driftIds.length > 0 || noApplicationIds.length > 0) ? "fail" : "pass"');
        expect(body).toContain('affectedIds: [...driftIds, ...noApplicationIds]');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#671 — and the reconciliation says what it found before it says what it did not', () => {
    const source = code(FORENSICS);
    const body = checkBody(source, 'Financial Reconciliation');

    it('THE LINE LEADS WITH THE NUMBER THAT DRIVES THE VERDICT', () => {
        /*
         *   THE defect, as the owner read it:
         *
         *       "Sampled 20 members … 0 mismatch(es), 2 member(s) with no
         *        membership record."                                   Fail
         *
         *   Left to right: zero problems, then Fail. The verdict was correct
         *   and the sentence made it look arbitrary, which is how an operator
         *   learns to distrust a report — and then scrolls past the entry that
         *   matters.
         */
        expect(body).toContain('Found ${balanceMismatches.length + unreadableMembers.length} problem(s)');
    });

    it('AND A MISSING MEMBERSHIP ROW IS STILL A FINDING, NOT A GAP', () => {
        /*
         *   THE control, and the correction to my first attempt — which made
         *   this "inconclusive" and was caught by #475, #488 and the
         *   reconciliation suite within one test run.
         *
         *   #475 settled it in one line and the line is right: unlike an
         *   unrecorded gender, this is not a fact nobody collected. The role
         *   was granted. The row should exist. Somebody has to make it exist,
         *   so it belongs where somebody will act on it.
         */
        expect(body).toContain('(balanceMismatches.length > 0 || unreadableMembers.length > 0) ? "fail" : "pass"');
        expect(body).toContain('...unreadableMembers.map((id) => `${id} (no membership record)`)');
    });

    it('AND MONEY THAT DOES NOT ADD UP IS STILL A FAILURE', () => {
        //   This check exists to find money unaccounted for, and nothing above
        //   should be satisfiable by a check that stopped looking for it.
        expect(body).toContain('Math.abs(calculatedBalance - heldBalance) > 1.0');
        expect(body).toContain('balanceMismatches.push(');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#671 — and one profile is not counted as two', () => {
    const source = code(FORENSICS);
    const body = checkBody(source, 'One Address, Several Accounts');

    it('THE IDS FOR AN ADDRESS ARE A SET', () => {
        /*
         *   THE defect, as it reached the owner:
         *
         *     ann***@gmail.com — 2 profiles: yD9fEmm…zv2, yD9fEmm…zv2
         *
         *   A document id identifies a document. A collection of them that can
         *   hold the same id twice is modelling something that cannot happen —
         *   and an operator acting on that row goes looking for a second
         *   account that does not exist.
         */
        expect(source).toContain('const byEmail = new Map<string, Set<string>>()');
        expect(body).toContain('idSet.size > 1');
    });

    it('AND THE PAGING THAT CAUSED IT ORDERS BY SOMETHING UNIQUE', () => {
        /*
         *   The cause, not the symptom. `.orderBy("createdAt","desc").offset(n)`
         *   pages over a NON-UNIQUE key: bulk imports write whole batches on one
         *   timestamp, so two rows sharing a value may come back in either
         *   order, and one that swaps across a page boundary is read twice while
         *   its neighbour is skipped.
         *
         *   De-duplicating alone would have hidden the double-read and left the
         *   SKIP — the quieter half, which loses real duplicates. Hence both.
         */
        expect(body).not.toContain('.orderBy("createdAt", "desc")');
        expect(body).toContain('.orderBy("__name__", "asc")');
    });

    it('AND THE SCANNED COUNT CANNOT BE INFLATED BY A RE-READ EITHER', () => {
        //   `scanned += snap.docs.length` counted a re-read row twice, so the
        //   report overstated its own coverage — the number an operator uses to
        //   decide whether a clean result means anything.
        expect(body).toContain('scannedIds.add(d.id)');
        expect(body).toContain('const scanned = scannedIds.size');
    });

    it('AND A REAL DUPLICATE IS STILL REPORTED', () => {
        //   The control: a Set of one element per address would satisfy every
        //   line above and report nothing, for ever.
        expect(body).toContain('duplicateEmails.push(');
        expect(body).toContain('duplicateEmails.length > 0 ? "warning" : "pass"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#671 — the document id means the document id, in an order as well as a filter', () => {
    it('THE SHIM MAPS __name__ TO THE PRIMARY KEY WHEN ORDERING', () => {
        /*
         *   `where('__name__', ...)` has mapped to `id` since this shim was
         *   written. `orderBy` had no such branch, so the name fell through to
         *   the JSONB fallback and became `raw_data->>"__name__"` — NULL on
         *   every row of every table.
         *
         *   Postgres accepts that and sorts by it, so the query SUCCEEDS and
         *   returns rows in no defined order: the caller asks for the one
         *   ordering guaranteed to be total and gets the one guaranteed to be
         *   arbitrary. Silent, and with `.offset()` on top, exactly the
         *   re-read above.
         */
        const shim = code('src/lib/supabase-db.ts');
        const start = shim.indexOf('for (const ob of this._orderBy)');
        expect(`orderBy loop found: ${start >= 0}`).toBe('orderBy loop found: true');
        const loop = shim.slice(start, start + 1200);

        expect(loop).toContain("ob.field === '__name__'");
        expect(loop).toContain("colName = 'id'");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#671 — and the 48 profiles with no address get their address back', () => {
    it('A BLANK IS null, EMPTY OR WHITESPACE — NOT JUST FALSY', () => {
        //   #479's rule. `|| ''` treats "   " as an address.
        expect([null, undefined, '', '   ', '\t', 42].map(isBlankEmail))
            .toEqual([true, true, true, true, true, true]);
        expect(isBlankEmail('ada@example.com')).toBe(false);
    });

    it('IT FILLS A BLANK ROW FROM THE ADDRESS AUTH HAS VERIFIED', () => {
        //   THE repair, normalised the way every other lookup in this codebase
        //   normalises an address (#478).
        expect(backfillDecision('', '  Ada@Example.COM ')).toEqual({ write: true, value: 'ada@example.com' });
        expect(backfillDecision(null, 'ada@example.com')).toEqual({ write: true, value: 'ada@example.com' });
    });

    it('AND NEVER OVERWRITES AN ADDRESS THAT IS ALREADY THERE', () => {
        /*
         *   THE control, and the whole safety of this action. A profile whose
         *   address DIFFERS from the authenticated one is a finding, not
         *   something to quietly reconcile — overwriting it destroys the
         *   evidence. #479 wrote that rule for the login; this is the same rule
         *   for the bulk run, re-checked at the moment of the write rather than
         *   trusted from the query that selected the row.
         */
        expect(backfillDecision('existing@example.com', 'different@example.com'))
            .toEqual({ write: false, result: 'already-had-one' });
    });

    it('AND WRITES NOTHING WHEN THERE IS NOTHING TO COPY', () => {
        //   An account that is gone, and a phone-only signup with no address of
        //   its own. Inventing one would be worse than the gap.
        expect(backfillDecision('', null)).toEqual({ write: false, result: 'no-auth-account' });
        expect(backfillDecision('', undefined)).toEqual({ write: false, result: 'no-auth-account' });
        expect(backfillDecision('', '')).toEqual({ write: false, result: 'auth-has-no-email' });
        expect(backfillDecision('', '   ')).toEqual({ write: false, result: 'auth-has-no-email' });
    });

    it('AND THE ADDRESS IS MASKED WHEREVER IT IS REPORTED', () => {
        //   #490. A repair log is as likely to be screenshotted as a report.
        expect(maskAddress('annabel@gmail.com')).toBe('ann***@gmail.com');
        expect(maskAddress('ann@gmail.com')).toBe('ann@gmail.com');
        expect(maskAddress('not-an-address')).toBe('***');
    });

    it('AND THE SELECTION BEHIND THE PREVIEW IS THE SELECTION BEHIND THE WRITE', () => {
        /*
         *   Two hand-maintained copies of one contract is this audit's
         *   fourth-most-common finding, and a preview that disagrees with the
         *   button beside it is the worst place for it. GET and POST call the
         *   same selector.
         */
        const route = code('src/app/api/admin/backfill-missing-emails/route.ts');
        expect(route).toContain('profilesWithNoEmail(LIMIT)');
        expect(route).toContain('backfillMissingEmails(LIMIT)');
        //   And the same gate the scan uses — super_admin and admin, not the
        //   ten roles the admin layout admits (#382).
        expect((route.match(/isPlatformAdmin\(session\?\.user\?\.roles\)/g) ?? []).length).toBe(2);
    });

    it('AND BOTH SHAPES OF BLANK ARE SELECTED, BECAUSE A DATABASE TREATS THEM AS DIFFERENT ROWS', () => {
        //   The forensic check has always queried "" and null separately. A
        //   backfill that repaired one of them would report success and leave
        //   half the population behind.
        const lib = code('src/lib/missing-email-backfill.ts');
        expect(lib).toContain('for (const value of ["", null])');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#671 — and the check that was right is left alone', () => {
    const source = code(FORENSICS);

    it('WAVE STILL FAILS ON A PARTICIPANT IT ACTUALLY EVALUATED', () => {
        /*
         *   The production report's WAVE verdict is CORRECT and this file
         *   changes nothing about it. One participant with a stored gender of
         *   "male" in a female-only programme (#464) is a real finding; the 186
         *   unrecorded genders were already in notCheckedIds and already
         *   excluded from the verdict by #475.
         *
         *   Asserted so that a later pass through this file, tidying "all these
         *   checks report gaps as failures", does not switch off the one that
         *   was doing it right.
         */
        const body = checkBody(source, 'Eligibility Paradox');
        expect(body).toContain('ineligibleIds.length > 0');
        expect(body).toContain('? "fail"');
        expect(body).toContain('affectedIds: ineligibleIds');
        expect(body).toContain('notCheckedIds: [...unknownGenderIds, ...undatedIds]');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *   Run across all six suites that touch these checks, not just this one —
 *   four of them had standing claims about this code and two of those claims
 *   are what corrected the fix (see below).
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the drift check goes back to the userId query       KILLED
 *     the lookup stops trying the applicationId door                  KILLED
 *     the lookup stops trying legacy_<uid>                            KILLED
 *     the lookup stops trying userEmail                               KILLED
 *     the lookup stops trying profile.email                           KILLED
 *     the lookup adopts a row owned by another account                KILLED
 *     the lookup heals the row it matched                             KILLED
 *     the lookup returns only the first row for a userId match        KILLED
 *     the lookup stops being keyed on the scanned user                KILLED
 *     an absent application is dropped from the findings              KILLED
 *     the drift check stops failing altogether                        KILLED
 *     the sentence stops separating compared from absent              KILLED
 *     the reconciliation drops the missing membership                 KILLED
 *     the reconciliation stops failing                                KILLED
 *     the reconciliation stops leading with the total                 KILLED
 *     the reconciliation stops comparing the balances                 KILLED
 *     the duplicate ids go back to an array                           KILLED
 *     the paging goes back to createdAt                               KILLED
 *     the scanned count goes back to += docs.length                   KILLED
 *     the shim's __name__ order branch is removed                     KILLED
 *     the backfill overwrites an existing address                     KILLED
 *     the backfill writes when Auth has no address                    KILLED
 *     the backfill treats "   " as an address                         KILLED
 *     the backfill stops normalising case                             KILLED
 *     the backfill selects only the "" shape                          KILLED
 *     the preview and the write use different selections              KILLED
 *     the route drops the admin gate from POST                        KILLED
 *       — SURVIVED on the first run, and the mutant was the fault: it
 *         ADDED a second check rather than removing the gate, so the
 *         gate was still there and the assertion was right to pass. Re-run
 *         with the `if (!isPlatformAdmin…)` block actually deleted: killed.
 *         A surviving mutant is a question about the tests first, and the
 *         answer is sometimes that the mutant did not mutate.
 *     WAVE stops failing on an evaluated participant                  KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   The four findings came from the owner's own run of the production forensic
 *   scan, not from a sweep of this repository. Each was then traced back to the
 *   line that produced it: the Farm Nation one by reading every other reader of
 *   farm_nation_applications (four of them, and all four walk a chain of keys
 *   the scan did not); the duplicate one by reading the paging; the other two
 *   by reading the verdict expressions against their own reported numbers.
 *
 *   Ninety per cent of a sample failing identically is a statement about the
 *   instrument. That is the rule this audit opened with, and it is what
 *   separated the 45 that were not findings from the 1 that was.
 */
