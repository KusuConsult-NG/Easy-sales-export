/**
 * @jest-environment node
 */

/**
 *   #920 TWO DOORS WRITE THE SAME APPLICATION ROW. ONE CHECKED ITS INPUT.
 *
 *   The batch is the academy application wizard — PersonalInfoStep,
 *   EducationStep, InterestsStep, ReviewStep and the retired success page, five
 *   files no test had named. The checkable question was whether the steps
 *   collect exactly the fields AcademyApplicationInputSchema declares. They do,
 *   field for field, and that agreement is pinned below because it is the kind
 *   of thing a new field breaks silently — Zod strips what it does not declare.
 *
 *   What the comparison turned up was one layer further in.
 *
 * ── #912 PUT THE RULE ON A BOUNDARY THE DOOR NEVER CROSSED ──────────────────
 *
 *   validations/shared's header, written by that fix, ends:
 *
 *       "So: normalise at the parse boundary, where every caller of the schema
 *        gets it, and have the submit door use the same function rather than its
 *        own two lines."
 *
 *   _resubmitAcademyApplicationAction is a caller of the schema — its first
 *   statement is `AcademyApplicationInputSchema.safeParse(data)`.
 *   _submitAcademyApplicationAction was NOT. It took `AcademyApplicationData`,
 *   a TypeScript interface that exists only at compile time, and
 *   withFlexibleSafeAction — the only thing wrapping it — is a try/catch with no
 *   schema in it. So "every caller of the schema" excluded the door almost every
 *   learner uses, and the two doors #912 made agree about the SPELLING of an
 *   address still disagreed about whether it was an address.
 *
 * ── MEASURED, BOTH DOORS, THE SAME PAYLOAD ──────────────────────────────────
 *
 *                                 submit (before)      resubmit
 *     email "not-an-email"        WRITTEN verbatim     refused
 *     email ""                    written as null      refused
 *     an invented extra key       lands in the row     stripped
 *     every required field blank  accepted             accepted
 *
 *   `personalInfo.email` is the field the dedup guard queries and the field two
 *   recovery lookups fall back to. And `normaliseEmail("")` is falsy, so the
 *   guard sits behind `if (normalisedEmail)` — on a blank address the "one
 *   application per address" rule was not failed, it was not asked.
 *
 *   The extra key is not hypothetical. `_version: 99` from the caller reached
 *   the row, and components/admin/DynamicDetailModal prints `v{_version}.0` in
 *   the raw-details panel: an operator shown a version nobody wrote.
 *
 *   THE FOURTH ROW IS NOT FIXED, and this file says so rather than implying the
 *   parse closed it. The schema declares every string as `z.string()` with no
 *   `.min(1)`, so both doors accept a blank in a field the form marks required,
 *   and the submit door writes those blanks straight onto the learner's own user
 *   row. Tightening it would refuse resubmission of historical rows that the
 *   edit form loads back into itself, and how many of those carry a blank is not
 *   measurable from here. Pinned with the exact list instead.
 *
 * ── AND A NINTH SPELLING OF THE NAME RULE ───────────────────────────────────
 *
 *   #452 settled how a full name joins — `[first, other, last]`, in
 *   lib/person-name, "A middle name is ordinary in Nigeria" — after three
 *   disagreeing copies duplicated people's middle names once per profile save.
 *
 *   AcademyApplicationClient built `personalInfo.fullName` as
 *   `${firstName} ${lastName}`.trim(). PersonalInfoStep collects otherName and
 *   the submit action writes the USER row as [firstName, otherName, lastName],
 *   so one submission produced two names for one person: the admin users screen
 *   showed "Ada Chidinma Obi", and the admin academy applications screen — which
 *   prints `app.personalInfo.fullName` as its heading, sorts on it and exports
 *   it to CSV — showed "Ada Obi". Its search reads fullName, firstName and
 *   lastName, so the middle name the applicant typed matched nothing.
 *
 *   lib/firestore-serialize's serializeUser carried the same two-part rule and
 *   OVERWROTE a stored three-part name with it. That one has no callers, so
 *   nothing loses a middle name to it today; it is corrected rather than left,
 *   for the reason #919 recorded about lib/security's dead phone validator.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { stripComments } from '@/lib/testing/strip-comments';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';
import { COLLECTIONS } from '@/lib/types/firestore';
import { AcademyApplicationInputSchema } from '@/lib/validations/academy';
import { joinFullName, namePartsOf } from '@/lib/person-name';

jest.mock('resend', () => ({
    Resend: class { emails = { send: async () => ({ data: { id: 'e1' }, error: null }) }; },
}));

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('@/lib/auth', () => ({
    auth: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {},
}));

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.3 });

/**
 * Every shipping source file that joins a full name inline rather than calling
 * joinFullName — a bracketed list holding a middle-name field, joined through
 * filter(Boolean).
 *
 * Case-insensitive on the middle token: four call sites prefix it
 * (newOtherName, profileOtherName, resolvedOtherName), and a case-sensitive
 * sweep reported them as already folded in.
 */
function inlineJoins(): { hits: string[]; files: number; occurrences: number } {
    const INLINE = /\[[^\]]*[Oo]ther(?:Name|Names)\b[^\]]*\]\s*\.?\s*filter\(Boolean\)/g;
    const hits: string[] = [];
    let occurrences = 0;

    const walk = (dir: string): void => {
        for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
            const rel = `${dir}/${entry.name}`;
            if (entry.isDirectory()) {
                if (entry.name !== '__tests__') walk(rel);
                continue;
            }
            if (!/\.tsx?$/.test(entry.name)) continue;
            const found = [...readFileSync(join(ROOT, rel), 'utf8').matchAll(INLINE)].length;
            if (found) { hits.push(rel); occurrences += found; }
        }
    };
    walk('src');

    return { hits: hits.sort(), files: hits.length, occurrences };
}

const STEPS = {
    personalInfo: 'src/app/academy/application/steps/PersonalInfoStep.tsx',
    education: 'src/app/academy/application/steps/EducationStep.tsx',
    interests: 'src/app/academy/application/steps/InterestsStep.tsx',
} as const;
const CLIENT = 'src/app/academy/application/AcademyApplicationClient.tsx';
const REVIEW = 'src/app/academy/application/ReviewStep.tsx';
const SUCCESS = 'src/app/academy/application/success/page.tsx';
const ACTION = 'src/app/actions/academy/_ac_applications.ts';

const LEARNER = 'learner-1';
const APPS = COLLECTIONS.ACADEMY_APPLICATIONS;

let store: FakeDbHandle;

function actAs(id: string | null): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, roles: ['user'], email: 'ada@example.com', name: 'Ada Obi' } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(LEARNER);
});

const actions = () => import('@/app/actions/academy/_ac_applications');

/** A complete, valid application — exactly what the wizard sends. */
function form(overrides: Record<string, unknown> = {}): any {
    const { personalInfo, education, interests, ...rest } = overrides as any;
    return {
        personalInfo: {
            firstName: 'Ada',
            lastName: 'Obi',
            otherName: '',
            fullName: 'Ada Obi',
            email: 'ada@example.com',
            phone: '08012345678',
            dateOfBirth: '1994-05-10',
            gender: 'female',
            state: 'Plateau',
            lga: 'Jos North',
            occupation: 'Trader',
            ...(personalInfo ?? {}),
        },
        education: {
            educationLevel: 'tertiary',
            fieldOfStudy: 'Agriculture',
            yearsExperience: 3,
            currentRole: 'Trader',
            ...(education ?? {}),
        },
        interests: {
            learningPaths: ['export'],
            topics: 'Grains',
            goals: 'Export rice',
            ...(interests ?? {}),
        },
        ...rest,
    };
}

/** A learner who has paid, so the submit gate lets them through. */
function seedUser(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, LEARNER, {
        email: 'ada@example.com',
        fullName: 'Ada Obi',
        roles: ['user'],
        serviceRegistrations: { academy: { paymentStatus: 'completed' } },
        ...extra,
    });
}

/** A learner whose application is open for resubmission. */
function seedResubmittable(): void {
    seedUser({ serviceRegistrations: { academy: { status: 'revision_required', applicationId: 'app-1' } } });
    store.seed(APPS, 'app-1', {
        userId: LEARNER,
        status: 'revision_required',
        createdAt: '2026-01-01T00:00:00.000Z',
        personalInfo: { firstName: 'Ada', lastName: 'Obi' },
    });
}

const onlyApp = () => store.all(APPS)[0]?.[1] as Record<string, any> | undefined;
const readUser = () => store.get(COLLECTIONS.USERS, LEARNER) as Record<string, any>;

// ─────────────────────────────────────────────────────────────────────────────
describe('#920 — the submit door now crosses the parse boundary', () => {
    it('THE CONTROL: a complete application still succeeds', async () => {
        //   First, because every refusal below would also "pass" against a door
        //   that had started refusing everything.
        seedUser();
        const { submitAcademyApplicationAction } = await actions();

        expect(await submitAcademyApplicationAction(form())).toMatchObject({ success: true });
        expect(store.size(APPS)).toBe(1);
        expect(onlyApp()).toMatchObject({ userId: LEARNER, status: 'pending' });
    });

    it('refuses an address that is not an address, and writes nothing', async () => {
        //   THE defect. It used to be stored verbatim in the field the dedup
        //   guard queries.
        seedUser();
        const { submitAcademyApplicationAction } = await actions();
        const res: any = await submitAcademyApplicationAction(
            form({ personalInfo: { email: 'not-an-email' } }));

        expect(res.success).toBe(false);
        expect(store.size(APPS)).toBe(0);
    });

    it('refuses a BLANK address — the case that skipped the duplicate check', async () => {
        //   `normaliseEmail("") === ""`, which is falsy, so the guard below it
        //   never ran. The row was written with `personalInfo.email: null`.
        seedUser();
        const { submitAcademyApplicationAction } = await actions();
        const res: any = await submitAcademyApplicationAction(
            form({ personalInfo: { email: '' } }));

        expect(res.success).toBe(false);
        expect(store.size(APPS)).toBe(0);
    });

    it('does not leave the learner\'s profile touched by a refused submission', async () => {
        //   The user row is written in the same transaction. A refusal that had
        //   got as far as the profile sync would blank a real name.
        seedUser();
        const { submitAcademyApplicationAction } = await actions();
        await submitAcademyApplicationAction(form({ personalInfo: { email: 'not-an-email' } }));

        expect(readUser().fullName).toBe('Ada Obi');
        expect(readUser().firstName).toBeUndefined();
    });

    it('strips a key the schema does not declare instead of spreading it into the row', async () => {
        //   `t.set(appRef, { ...applicationData, … })`. Measured before the fix:
        //   `invented` landed, and so did `_version: 99` — which the admin
        //   raw-details modal prints as "v99.0".
        seedUser();
        const { submitAcademyApplicationAction } = await actions();

        expect(await submitAcademyApplicationAction(form({ invented: 'yes', _version: 99 })))
            .toMatchObject({ success: true });

        const app = onlyApp()!;
        expect(app.invented).toBeUndefined();
        expect(app._version).not.toBe(99);
    });

    it('still pins the fields it always pinned after the spread', async () => {
        //   status, reviewedBy and userId were already written after the spread,
        //   so they were never injectable. Asserted so the parse is not credited
        //   with a guarantee that predates it.
        seedUser();
        const { submitAcademyApplicationAction } = await actions();
        await submitAcademyApplicationAction(
            form({ status: 'approved', reviewedBy: 'nobody', userId: 'somebody-else' }));

        expect(onlyApp()).toMatchObject({ status: 'pending', reviewedBy: null, userId: LEARNER });
    });

    it('parses BEFORE it reads the session, at both doors', async () => {
        //   The resubmit door's own test pins this ordering as a decision: a
        //   malformed body gets a validation error, not "Unauthorized". Both
        //   doors answer alike now.
        actAs(null);
        const { submitAcademyApplicationAction, resubmitAcademyApplicationAction } = await actions();
        const bad = form({ personalInfo: { email: 'not-an-email' } });

        for (const door of [submitAcademyApplicationAction, resubmitAcademyApplicationAction]) {
            const res: any = await door(bad);
            expect(res.success).toBe(false);
            expect(res.error).not.toBe('Unauthorized');
        }
    });

    it('and a VALID body still reaches the session check', async () => {
        //   Otherwise the assertion above would hold for a door that refused
        //   every payload before looking at anything.
        actAs(null);
        const { submitAcademyApplicationAction } = await actions();

        expect(await submitAcademyApplicationAction(form()))
            .toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('THE PARITY: the two doors now answer the same way about the same body', async () => {
        const { submitAcademyApplicationAction, resubmitAcademyApplicationAction } = await actions();

        for (const email of ['not-an-email', '', 'ada@@example.com', 'ada example@x.co']) {
            store = installFakeDb();
            seedUser();
            const submitted: any = await submitAcademyApplicationAction(
                form({ personalInfo: { email } }));

            store = installFakeDb();
            seedResubmittable();
            const resubmitted: any = await resubmitAcademyApplicationAction(
                form({ personalInfo: { email } }));

            expect({ email, submit: submitted.success, resubmit: resubmitted.success })
                .toEqual({ email, submit: false, resubmit: false });
        }
    });

    it('normalises the stored address through the schema, not a second rule', async () => {
        seedUser();
        const { submitAcademyApplicationAction } = await actions();
        await submitAcademyApplicationAction(
            form({ personalInfo: { email: '  Ada@Example.COM ' } }));

        expect(onlyApp()!.personalInfo.email).toBe('ada@example.com');
    });

    it('and the door names the schema in its source', () => {
        //   Behaviour can be reproduced by a hand-rolled check; this pins that
        //   the door reaches the SHARED boundary rather than restating it.
        const src = code(ACTION);
        const submitBody = src.slice(
            src.indexOf('async function _submitAcademyApplicationAction'),
            src.indexOf('export const submitAcademyApplicationAction'),
        );

        expect(submitBody).toContain('AcademyApplicationInputSchema.safeParse');
        expect(submitBody.length).toBeGreaterThan(5_000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#920 — what the parse does NOT fix, stated rather than implied', () => {
    /**
     * The schema requires the PRESENCE of each field and nothing about its
     * content. `z.string()` accepts "". So a blank in a field the wizard marks
     * required passes both doors — and the submit door copies seven of those
     * blanks onto the learner's own user row.
     *
     * The wizard's own validateStep is the only thing that requires them, and it
     * runs in the browser.
     */
    const REQUIRED_BY_THE_FORM = [
        'firstName', 'lastName', 'email', 'phone', 'dateOfBirth',
        'gender', 'state', 'lga', 'occupation',
    ];

    it('the form requires these nine personal fields', () => {
        //   Read off validateStep so the list cannot drift from the screen.
        const client = code(CLIENT);

        for (const field of REQUIRED_BY_THE_FORM) {
            expect(client).toContain(`newErrors.${field} =`);
        }
    });

    it('and the schema requires none of them to be non-empty', () => {
        const blank = form({
            personalInfo: Object.fromEntries(
                REQUIRED_BY_THE_FORM.filter((f) => f !== 'email').map((f) => [f, '']),
            ),
            interests: { learningPaths: [], goals: '' },
        });

        //   email is the exception, and it is the exception BECAUSE #912 gave it
        //   a real field type. The rest are bare z.string().
        expect(AcademyApplicationInputSchema.safeParse(blank).success).toBe(true);

        //   And blanking the address is what the schema does refuse.
        expect(AcademyApplicationInputSchema.safeParse(
            form({ personalInfo: { email: '' } })).success).toBe(false);
    });

    it('THE LEDGER — how many of the nine the schema constrains', () => {
        const shape: Record<string, any> =
            (AcademyApplicationInputSchema as any).shape.personalInfo.shape;
        const constrained = REQUIRED_BY_THE_FORM.filter((field) => {
            const at = shape[field];
            return at ? !at.safeParse('').success : false;
        });

        //   One: email. Raise this and record which field gained a floor and
        //   what was measured about the rows already stored.
        expect(constrained).toEqual(['email']);
        expect(ledgerVerdict(constrained.length, 1)).toBe(LEDGER_HELD);
    });

    it('so a blank submission still reaches the learner\'s user row', async () => {
        //   Recorded as live, not fixed. The seven fields the submit action
        //   syncs onto users are overwritten with whatever arrives.
        seedUser();
        const { submitAcademyApplicationAction } = await actions();
        await submitAcademyApplicationAction(form({
            personalInfo: {
                firstName: '', lastName: '', otherName: '', fullName: '',
                phone: '', gender: '', state: '', lga: '', occupation: '',
                dateOfBirth: '',
            },
        }));

        expect(readUser()).toMatchObject({
            firstName: '', lastName: '', fullName: '',
            phone: '', gender: '', stateOfOrigin: '', lga: '',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#920 — the wizard collects exactly what the schema declares', () => {
    /**
     * A step that collects a field the schema omits loses it silently, because
     * Zod strips rather than complains — and now that the submit door parses,
     * that stripping is live on both doors. A schema field no step collects is a
     * form that cannot be completed.
     */
    const SET_CALL = /(?:set|handleChange)\("([A-Za-z]+)"/g;

    /** The field names a step passes to its own updater. */
    function collected(rel: string): string[] {
        const src = code(rel);
        const names = new Set<string>();
        for (const m of src.matchAll(SET_CALL)) names.add(m[1]);
        return [...names].sort();
    }

    function declared(group: 'personalInfo' | 'education' | 'interests'): string[] {
        return Object.keys((AcademyApplicationInputSchema as any).shape[group].shape).sort();
    }

    it('PersonalInfoStep collects the personalInfo group, less the derived fullName', () => {
        //   fullName is not typed by anybody: the wizard joins the parts on
        //   submit and the schema marks it optional.
        expect(collected(STEPS.personalInfo))
            .toEqual(declared('personalInfo').filter((f) => f !== 'fullName'));
    });

    it('EducationStep collects the education group exactly', () => {
        expect(collected(STEPS.education)).toEqual(declared('education'));
    });

    it('InterestsStep collects the interests group exactly', () => {
        //   learningPaths is toggled rather than set, so it is added to what the
        //   updater sweep finds — asserted separately below.
        expect([...new Set([...collected(STEPS.interests), 'learningPaths'])].sort())
            .toEqual(declared('interests'));
    });

    it('and learningPaths really is written by the toggle, not by a set call', () => {
        //   Without this the union above could be hiding a field nothing writes.
        const src = code(STEPS.interests);

        expect(src).toContain('learningPaths: updatedPaths');
        expect(collected(STEPS.interests)).not.toContain('learningPaths');
    });

    it('POSITIVE CONTROL: the sweep finds something in every step', () => {
        //   Three `toEqual`s against a declared list would all fail loudly on an
        //   empty sweep — but the union in the interests case would not, so the
        //   control is explicit.
        for (const rel of Object.values(STEPS)) {
            expect(collected(rel).length).toBeGreaterThan(0);
        }
    });

    it('and the schema still declares the three groups the wizard has steps for', () => {
        expect(Object.keys((AcademyApplicationInputSchema as any).shape).sort())
            .toEqual(['education', 'interests', 'personalInfo']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#920 — one rule for joining a name', () => {
    it('the wizard no longer spells out a two-part join', () => {
        const client = code(CLIENT);

        expect(client).toContain('joinFullName(namePartsOf(personalInfo))');
        expect(client).not.toContain('${personalInfo?.lastName || ""}`.trim()');
    });

    it('and serializeUser no longer drops the middle name either', () => {
        const src = code('src/lib/firestore-serialize.ts');

        expect(src).toContain('joinFullName(namePartsOf(validated))');
        expect(src).not.toContain('[validated.firstName, validated.lastName]');
    });

    it('POSITIVE CONTROL: both files were read, not silently empty', () => {
        expect(code(CLIENT).length).toBeGreaterThan(10_000);
        expect(code('src/lib/firestore-serialize.ts')).toContain('export function serializeUser');
    });

    it('THE BEHAVIOUR: the row and the profile now carry the same name', async () => {
        //   The two writes the disagreement lived between, with the shared rule
        //   supplying the name — which is what the wizard now does. This does not
        //   exercise the wizard itself (it is a client component; its expression
        //   is pinned at source above). What it does establish is the other half:
        //   the action preserves a three-part name in the ROW and independently
        //   rebuilds the same one for the USER row, so the two agree once the
        //   caller stops handing them different answers.
        seedUser();
        const { submitAcademyApplicationAction } = await actions();
        const personalInfo = { firstName: 'Ada', otherName: 'Chidinma', lastName: 'Obi' };

        await submitAcademyApplicationAction(form({
            personalInfo: { ...personalInfo, fullName: joinFullName(namePartsOf(personalInfo)) },
        }));

        expect(onlyApp()!.personalInfo.fullName).toBe('Ada Chidinma Obi');
        expect(readUser().fullName).toBe('Ada Chidinma Obi');
        expect(onlyApp()!.personalInfo.fullName).toBe(readUser().fullName);
    });

    it('and the two-part join would NOT have agreed', () => {
        //   The control on the assertion above: it only means something if the
        //   old expression produced a different answer for this name.
        const twoPart = `${'Ada'} ${'Obi'}`.trim();

        expect(twoPart).not.toBe('Ada Chidinma Obi');
    });

    it('THE LEDGER — the tree still spells this join out inline', () => {
        //   SWEPT, NOT LISTED. The first draft of this was a hand-written list of
        //   fourteen files, built from a grep that was case-sensitive on the
        //   middle-name token — so it missed newOtherName, profileOtherName and
        //   resolvedOtherName, and would have reported a ledger of fourteen
        //   against a real twenty. A ledger assembled by hand can only ever be a
        //   claim about what its author remembered to look at.
        //
        //   Every one of the remaining sites agrees with joinFullName today,
        //   which is why this is a ledger and not a rewrite. The WAVE and
        //   shipment copies use a different field vocabulary (`otherNames`,
        //   `surname`), so folding them in is a mapping change of its own rather
        //   than a substitution — and #452's cost was three copies DISAGREEING,
        //   not three copies existing. The twenty-first is how the next
        //   disagreement starts.
        const { files, occurrences } = inlineJoins();

        expect(ledgerVerdict(files, 20)).toBe(LEDGER_HELD);
        expect(ledgerVerdict(occurrences, 33)).toBe(LEDGER_HELD);
    });

    it('and neither file this fix touched is on it any more', () => {
        //   The sweep's own control: a ledger that counted nothing would also
        //   hold. Both doors of the action used to spell the join out — two of
        //   the thirty-five occurrences the first sweep found.
        const { hits } = inlineJoins();

        expect(hits).not.toContain(ACTION);
        expect(hits).not.toContain(CLIENT);
        expect(hits).not.toContain('src/lib/firestore-serialize.ts');
        expect(hits.length).toBeGreaterThan(0);
    });

    it('POSITIVE CONTROL: the sweep really can see an inline join', () => {
        //   Asserted against a file the ledger names, so a sweep broken into
        //   matching nothing cannot pass the count above by accident.
        expect(inlineJoins().hits).toContain('src/app/actions/wave/_wv_applications.ts');
    });

    it('and lib/person-name is the one place that DEFINES it', () => {
        //   A LOWER RETENTION FLOOR for this one file: three quarters of it is
        //   the explanation of why the rule is stated once, which is the point of
        //   the file. The stripper's default floor is a guard against a stripper
        //   that ate the source, and the two `toContain`s below serve that here.
        const rule = stripComments(readFileSync(join(ROOT, 'src/lib/person-name.ts'), 'utf8'),
            { label: 'src/lib/person-name.ts', minRetainedRatio: 0.2 });

        expect(rule).toContain('export function joinFullName');
        expect(rule).toContain('export function namePartsOf');
        expect(joinFullName({ first: 'Ada', other: 'Chidinma', last: 'Obi' }))
            .toBe('Ada Chidinma Obi');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#920 — the two wizard files with nothing to fix', () => {
    it('the success page is a retired redirect, and says so', () => {
        //   #384 retired it because the wizard ends at /academy/dashboard.
        //   Recorded rather than left silent: a 20-line page that only redirects
        //   reads like an unfinished screen.
        //
        //   NO RETENTION FLOOR for this one file, deliberately. Fourteen of its
        //   eighteen non-blank lines ARE the retirement note, so the stripper's
        //   default floor refuses it — correctly, as a guard against a stripper
        //   that ate a file. The positive control below is the substitute.
        const src = stripComments(readFileSync(join(ROOT, SUCCESS), 'utf8'),
            { label: SUCCESS, minRetainedRatio: 0 });

        expect(src).toContain('redirect("/academy/dashboard")');
        expect(src).toContain('export default function');
        expect(src).not.toMatch(/congratulat/i);
    });

    it('and ReviewStep renders every field it is given a slot for', () => {
        //   The screen's own behaviour is asserted where it can be rendered, in
        //   a-summary-that-omitted-two-of-its-answers. Here: the prop type and
        //   the markup agree, so a field added to one and not the other fails.
        const src = code(REVIEW);
        const propShape = src.slice(src.indexOf('personalInfo: {'), src.indexOf('};'));

        for (const field of ['fullName', 'email', 'phone', 'dateOfBirth', 'gender', 'state', 'lga', 'occupation']) {
            expect(propShape).toContain(`${field}: string;`);
            expect(src).toContain(`personalInfo?.${field} || ""`);
        }
    });
});
