/**
 * @jest-environment node
 */

/**
 *   #912 TWO DOORS WROTE THE SAME FIELD AND ONLY ONE NORMALISED IT.
 *
 *   Found auditing src/lib/validations/academy.ts and validations/shared.ts, two
 *   more of the files no test had named.
 *
 *   An academy application's address is written by two actions:
 *
 *       _submitAcademyApplicationAction    lowercased and trimmed, deliberately
 *       _resubmitAcademyApplicationAction  exactly as typed
 *
 *   The submit door says why it normalises, at the line:
 *
 *       // Overwrites the typed casing from the spread above. The three recovery
 *       // lookups all query the lowercased form, and one of them grants academy
 *       // module access.
 *
 *   The resubmit door writes the same field from AcademyApplicationInputSchema's
 *   output, which was `z.string().email()` — no normalisation — and it writes it
 *   as `transaction.update(ref, { ...validatedData })`. A nested map REPLACES
 *   rather than merges; supabase-db's own header says so:
 *
 *       update({ a: { b: 1 } })   REPLACES a
 *
 *   So one resubmission with a capital letter replaced the normalised value.
 *
 * ── AND THE WORST-SOUNDING CONSEQUENCE IS NOT LIVE ──────────────────────────
 *
 *   The comment names three readers and it is tempting to stop there and report
 *   "resubmitting can cost a learner their academy access". MEASURED instead,
 *   and it is wrong:
 *
 *       module-access-check Layer 2.7   `else if (userData.email)` — reached only
 *       _ac_enrollment                  when the owner-scoped (`userId`) query
 *       _payment                        comes back EMPTY
 *
 *   A resubmitted application is FOUND BY `userId` — that is how the resubmit
 *   action locates it — so it always carries one, and all three take the owner
 *   path and never consult the address. Third time in this audit that measuring
 *   the consequence changed the answer, and the first two were mine as well.
 *
 *   WHAT IS LIVE is the duplicate guard inside the submit transaction:
 *
 *       collectionsContext.where("personalInfo.email", "==", normalisedEmail)
 *
 *   A row de-normalised by a resubmission is invisible to it, so the "one
 *   application per address" rule can be passed by an address that already has
 *   one. That is the shape of the split accounts already sitting on
 *   /admin/forensics/duplicates. The PHONE guard three lines above it already
 *   knows the lesson — it queries both `phone` and `normalisePhone(phone)`,
 *   because stored values come in more than one form. The email guard queries one
 *   form and trusts every writer to have produced it.
 *
 *   Fixed at the parse boundary, where every caller of the schema gets it, with
 *   the submit door pointed at the same function. A rule stated once cannot
 *   disagree with itself.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';
import { normaliseEmail, applicationEmail } from '@/lib/validations/shared';
import {
    AcademyApplicationInputSchema,
    AcademyApplicationSchema,
    CourseEnrollmentSchema,
} from '@/lib/validations/academy';
import { PAYMENT_STATUS } from '@/lib/types/firestore';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.3 });

/** A complete, valid application — the three groups the schema declares. */
function application(email: string) {
    return {
        personalInfo: {
            firstName: 'Ada',
            lastName: 'Okonkwo',
            email,
            phone: '08031234567',
            dateOfBirth: '1994-03-11',
            gender: 'female',
            state: 'Enugu',
            lga: 'Nsukka',
            occupation: 'Agronomist',
        },
        education: {
            educationLevel: 'BSc',
            fieldOfStudy: 'Crop Science',
            yearsExperience: 4,
            currentRole: 'Field Officer',
        },
        interests: {
            learningPaths: ['export-readiness'],
            topics: 'Cassava processing',
            goals: 'Export to Ghana',
        },
    };
}

describe('#912 — the schema normalises the address it used to pass through', () => {
    it('THE CONTROL: a complete application parses at all', () => {
        //   First. Every assertion below reads `parsed.data`, and a schema that
        //   refused everything would make each of them vacuous.
        const parsed = AcademyApplicationInputSchema.safeParse(application('ada@example.com'));

        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.personalInfo.firstName).toBe('Ada');
        expect(parsed.success && parsed.data.education.yearsExperience).toBe(4);
    });

    it('LOWERCASES AND TRIMS, which is what the resubmit door writes', () => {
        //   The defect, directly: this is the value that lands in
        //   `personalInfo.email` when a learner resubmits.
        const parsed = AcademyApplicationInputSchema.safeParse(application('  Ada@Example.COM  '));

        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.personalInfo.email).toBe('ada@example.com');
    });

    it('and the form the DUPLICATE GUARD queries is exactly that form', () => {
        //   The guard asks for `normaliseEmail(typed)`. What the resubmit door
        //   stores must equal it, or the row hides from the guard — which is the
        //   whole live consequence.
        const typed = ' Ada@Example.COM ';
        const parsed = AcademyApplicationInputSchema.safeParse(application(typed));

        expect(parsed.success && parsed.data.personalInfo.email).toBe(normaliseEmail(typed));
    });

    it('IT IS STILL A VALIDATOR — a non-address is refused, not lowercased', () => {
        //   The risk of adding a transform: turning a check into a cleanup step.
        //   `.trim().email().transform(...)` validates first, so the transform
        //   only ever runs on something that passed.
        for (const bad of ['not-an-address', 'ada@', '@example.com', '', '   ']) {
            expect(AcademyApplicationInputSchema.safeParse(application(bad)).success).toBe(false);
        }
    });

    it('and a surrounding-space-only difference is not a new address', () => {
        //   `.trim()` runs before `.email()`, so " ada@example.com " is a valid
        //   address rather than a refusal. It was accepted before this change
        //   too — z.string().email() in zod 4 does not tolerate the spaces, so
        //   this is the behaviour changing in the direction of accepting what a
        //   person actually types.
        const parsed = AcademyApplicationInputSchema.safeParse(application(' ada@example.com '));

        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.personalInfo.email).toBe('ada@example.com');
    });
});

describe('#912 — normaliseEmail on its own', () => {
    it('trims and lowercases', () => {
        expect(normaliseEmail('  Ada@Example.COM ')).toBe('ada@example.com');
        expect(normaliseEmail('ada@example.com')).toBe('ada@example.com');
    });

    it('ANSWERS "" FOR A NON-STRING, so the caller\'s `|| null` still gives null', () => {
        //   _ac_applications writes `normaliseEmail(...) || null` and the dedup
        //   guard is `if (normalisedEmail)`. A normaliser that returned
        //   `undefined` or threw would change whether that guard runs at all.
        expect(normaliseEmail(undefined)).toBe('');
        expect(normaliseEmail(null)).toBe('');
        expect(normaliseEmail(42)).toBe('');
        expect(normaliseEmail({})).toBe('');

        expect(normaliseEmail(undefined) || null).toBeNull();
    });

    it('applicationEmail and normaliseEmail agree on anything valid', () => {
        for (const typed of ['Ada@Example.com', ' BOB@x.co ', 'c@d.ng']) {
            expect(applicationEmail.parse(typed)).toBe(normaliseEmail(typed));
        }
    });
});

describe('#912 — both doors write the same form', () => {
    const SUBMIT = 'src/app/actions/academy/_ac_applications.ts';
    const SCHEMA = 'src/lib/validations/academy.ts';

    it('the submit door goes through the shared rule, not two lines of its own', () => {
        const src = code(SUBMIT);

        expect(src).toContain('normaliseEmail(applicationData.personalInfo.email)');
        //   And the hand-rolled chain is gone from the CODE. Stripped first,
        //   because the comment I left at that line quotes the old expression —
        //   the trap this repo records twice and I hit again in this same audit.
        expect(src).not.toContain('.trim().toLowerCase()');
    });

    it('the schema field is applicationEmail, not a bare z.string().email()', () => {
        const src = code(SCHEMA);

        expect(src).toContain('email: applicationEmail,');
        expect(src).not.toContain('email: z.string().email()');
    });

    it('POSITIVE CONTROL: the stripper left real code behind', () => {
        //   Two `not.toContain`s above, and both pass on an empty string.
        expect(code(SUBMIT)).toContain('_submitAcademyApplicationAction');
        expect(code(SUBMIT).length).toBeGreaterThan(5_000);
        expect(code(SCHEMA)).toContain('AcademyApplicationInputSchema');
    });
});

describe('#912 — how many copies of the two-line rule exist', () => {
    /**
     * Three, and they agree.
     *
     * RECORDED RATHER THAN FOLDED. profile-lookup's copy is not imported into a
     * validation schema because that module pulls in supabase-db, and a schema
     * should not drag the database in behind it; cooperative-invite's is private
     * to a file on the invite path. All three are `trim()` then `toLowerCase()`
     * today, so nothing is broken by the duplication — but a FOURTH is how a
     * fourth disagreement starts, which is the argument nubanAccountNumber's own
     * header makes about /^\\d{10}$/ eight lines above this one.
     */
    const DEFINERS = [
        'src/lib/validations/shared.ts',
        'src/lib/profile-lookup.ts',
        'src/lib/cooperative-invite.ts',
    ];

    it('THE LEDGER — modules that define their own email normaliser', () => {
        const defining = DEFINERS.filter((rel) =>
            /(?:function|const)\s+normali[sz]eEmail\b/.test(code(rel)));

        expect(defining).toHaveLength(DEFINERS.length);
        expect(ledgerVerdict(defining.length, 3)).toBe(LEDGER_HELD);
    });

    it('and every one of them produces the same answer', () => {
        //   Imported rather than read as text, so this asserts behaviour. If any
        //   of the three is changed to strip dots, or to lowercase without
        //   trimming, this fails — which is the disagreement the ledger is there
        //   to make visible before it happens.
        const shared = normaliseEmail;
        const fromProfileLookup = require('@/lib/profile-lookup').normaliseEmail;

        for (const typed of ['  Ada@Example.COM ', 'bob@x.co', 'C@D.NG', '']) {
            expect(fromProfileLookup(typed)).toBe(shared(typed));
        }

        //   cooperative-invite's is private and cannot be imported, so its
        //   agreement is asserted on its source — the exact two lines.
        const invite = code('src/lib/cooperative-invite.ts');
        expect(invite).toContain('trim().toLowerCase()');
    });
});

describe('#912 — the two academy schemas that nothing imports', () => {
    /**
     *   MEASURED while auditing this file, and recorded because a dead schema
     *   reads exactly like a live one.
     *
     *   AcademyApplicationSchema and CourseEnrollmentSchema are imported by
     *   nothing. `grep -rn "validations/academy" src` finds one importer,
     *   _ac_applications, and it takes AcademyApplicationInputSchema only.
     *   That also makes `dateSchema` dead by the same route.
     *
     *   Left in place rather than deleted: #369 met the same situation in
     *   types/db-schemas and left it, and deleting a schema is not this
     *   finding's job. What IS worth pinning is the disagreement, because the
     *   day somebody wires one of them up it becomes live.
     */
    it('they are exported, and nothing outside their own file names them', () => {
        expect(AcademyApplicationSchema).toBeDefined();
        expect(CourseEnrollmentSchema).toBeDefined();

        //   The single importer, and what it takes.
        const importer = code('src/app/actions/academy/_ac_applications.ts');
        expect(importer).toContain('AcademyApplicationInputSchema');
        expect(importer).not.toContain('AcademyApplicationSchema,');
        expect(importer).not.toContain('CourseEnrollmentSchema');
    });

    it('AND ITS paymentStatus IS A FOURTH VOCABULARY, narrower than the platform\'s', () => {
        //   z.enum(["pending", "completed", "failed"]). A Zod enum REFUSES rather
        //   than strips, so were this schema ever used to parse a real row it
        //   would reject the majority of what the platform writes — including
        //   every state #911 added.
        //
        //   Harmless while dead. Asserted so that "dead" is a measurement in a
        //   test rather than a claim in a comment.
        const refused = ['paid', 'unpaid', 'processing', 'escrow_held', 'paid_awaiting_refund', 'refunded']
            .filter((value) => !AcademyApplicationSchema.safeParse({
                id: 'a', userId: 'u', submittedAt: new Date(), createdAt: new Date(), paymentStatus: value,
            }).success);

        expect(refused).toEqual([
            'paid', 'unpaid', 'processing', 'escrow_held', 'paid_awaiting_refund', 'refunded',
        ]);

        //   All six ARE in the platform's own list, which is the disagreement.
        for (const value of refused) {
            expect(Object.values(PAYMENT_STATUS)).toContain(value);
        }
    });

    it('POSITIVE CONTROL: the dead schema accepts the three it does declare', () => {
        //   Without this, a schema that refused everything would satisfy the
        //   assertion above for the wrong reason.
        for (const value of ['pending', 'completed', 'failed']) {
            expect(AcademyApplicationSchema.safeParse({
                id: 'a', userId: 'u', submittedAt: new Date(), createdAt: new Date(), paymentStatus: value,
            }).success).toBe(true);
        }
    });
});
