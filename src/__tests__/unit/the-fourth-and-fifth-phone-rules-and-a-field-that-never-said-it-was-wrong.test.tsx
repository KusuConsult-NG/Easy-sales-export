/**
 * @jest-environment jsdom
 */

/**
 *   #923 THE SHARED FORM PRIMITIVE, AND THREE MORE COPIES OF A RULE #919 THOUGHT
 *   IT HAD SETTLED.
 *
 *   The batch is components/ui/FormField, components/ui/LoadingButton,
 *   components/common/BackToHub and cooperatives/onboarding/steps/NextOfKinStep —
 *   four files no test had named, three of them shared primitives with six, eight
 *   and seven importers.
 *
 * ── A FIELD THAT NEVER SAID IT WAS WRONG ────────────────────────────────────
 *
 *   FormInput, FormSelect and FormTextarea back FIVE onboarding and KYC forms:
 *   KYCForm, the Farm Nation profile step, both cooperative onboarding steps and
 *   the academy application's personal info step. When `error` was set they drew a
 *   red border and wired `aria-describedby` — and never set `aria-invalid`. A
 *   screen reader was told the description and not the state.
 *
 *   MEASURED, AND THIS IS WHY IT IS A DEFECT RATHER THAN A WISH:
 *   `grep -rn aria-invalid src` found exactly ONE occurrence in the whole tree,
 *   components/ui/ComboBox, spelled `aria-invalid={Boolean(error) || undefined}`.
 *   The platform had already decided how to say this. The primitive that five
 *   forms go through was the one place not doing it, and the expression is copied
 *   from ComboBox rather than invented.
 *
 * ── TWO FULL COPIES OF THE FIELD STYLE, AND A TAILWIND TRAP IN THE FOLD ─────
 *
 *   INPUT_BASE and INPUT_EMERALD were five identical lines each, differing only in
 *   `focus:ring-*` / `focus:border-*`. Folded — and the first attempt at the fold
 *   built them with `focus:ring-${colour}`, which compiles, typechecks, renders
 *   the right string, and would have made Tailwind generate NEITHER utility,
 *   because its scanner reads source text for whole class names. The focus ring on
 *   every field in five forms would have vanished with no error anywhere. The
 *   accent classes are whole literals; only the joining is dynamic, and the test
 *   below asserts both exported strings are byte-for-byte what they were.
 *
 * ── AND THE FOURTH AND FIFTH PHONE RULES ────────────────────────────────────
 *
 *   #919 pointed the two functions called isValidNigerianPhone at lib/phone's
 *   isNigerianMobile, whose header explains the stake: "Nigerian mobile prefixes
 *   are 070, 071, 080, 081, 090 and 091 — so `[789][01]` is the real set and
 *   `[789]\d` wrongly admits 072…079, 082…089 and 092…099."
 *
 *   THREE MORE REGEXES SURVIVED IT, found by sweeping for the shapes rather than
 *   the name:
 *
 *     cooperatives NextOfKinStep      /^0\d{10}$/          0 + ANY ten digits
 *     marketplace BusinessProfileStep /^0\d{10}$/          0 + ANY ten digits
 *     wave PersonalDetailsStep        /^0[789][01]\d{8}$/  agreed, restated
 *
 *   The first two are barely phone checks: 01234567890 passed both. One of them is
 *   the SELLER'S BUSINESS PHONE — the number a buyer would ring. All three
 *   delegate now.
 *
 *   RECORDED AND NOT CHANGED: lib/schemas' strictNigerianPhoneSchema is
 *   `/^(\+234|0)[789]\d{9}$/` — the exact `[789]\d` shape #919 measured as wrong.
 *   It is a SERVER gate on the public WAVE briefing registration and on the WAVE
 *   application, so tightening it decides who may register, and refusing a real
 *   person is worse than storing a number no network issues. The disagreeing set
 *   is pinned below so the decision is visible and costed rather than forgotten.
 *
 * ── AND TWO THINGS THAT TURNED OUT FINE ─────────────────────────────────────
 *
 *   LoadingButton never sets `type`, so one inside a <form> defaults to submit —
 *   the classic React double-action. Swept the whole tree: ZERO buttons with an
 *   onClick and no type sit inside a form. Clean, and the sweep is kept, because
 *   that is a one-character regression.
 *
 *   BackToHub is correct and carries one honest caveat, recorded rather than
 *   fixed. See its section.
 *
 *   `jest` is the GLOBAL here, per #392 — see the note in
 *   a-back-button-that-went-nowhere-and-a-step-you-could-not-see.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { stripComments } from '@/lib/testing/strip-comments';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';
import { isNigerianMobile, normalisePhone } from '@/lib/phone';
import { strictNigerianPhoneSchema } from '@/lib/schemas';

jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: mockSession, status: mockSession ? 'authenticated' : 'unauthenticated' }),
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
}));

let mockSession: unknown = null;

import {
    FormInput, FormSelect, FormTextarea, INPUT_BASE, INPUT_EMERALD, INPUT_ERROR,
} from '@/components/ui/FormField';
import LoadingButton from '@/components/ui/LoadingButton';
import BackToHub from '@/components/common/BackToHub';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.2 });

const FORM_FIELD = 'src/components/ui/FormField.tsx';
const COMBOBOX = 'src/components/ui/ComboBox.tsx';

beforeEach(() => {
    jest.clearAllMocks();
    mockSession = null;
});

/** Every .tsx in the shipping tree. */
function shippingTsx(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of readdirSync(join(ROOT, dir))) {
            const rel = `${dir}/${entry}`;
            if (statSync(join(ROOT, rel)).isDirectory()) {
                if (!['node_modules', '.next', '__tests__'].includes(entry)) walk(rel);
                continue;
            }
            if (entry.endsWith('.tsx')) out.push(rel);
        }
    };
    walk('src');
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#923 — a field in error now says so', () => {
    it.each([
        ['FormInput', <FormInput key="i" label="Phone" error="Enter a valid Nigerian mobile number" />],
        ['FormSelect', <FormSelect key="s" label="State" error="Please select a state"><option /></FormSelect>],
        ['FormTextarea', <FormTextarea key="t" label="Address" error="Address is required" />],
    ])('%s sets aria-invalid when it has an error', (_name, element) => {
        render(element as React.ReactElement);
        const field = screen.getByLabelText(/Phone|State|Address/);

        expect(field.getAttribute('aria-invalid')).toBe('true');
    });

    it.each([
        ['FormInput', <FormInput key="i" label="Phone" />],
        ['FormSelect', <FormSelect key="s" label="State"><option /></FormSelect>],
        ['FormTextarea', <FormTextarea key="t" label="Address" />],
    ])('and %s leaves it off when there is none', (_name, element) => {
        //   `|| undefined` rather than `false`: an aria-invalid="false" on every
        //   field in a form is noise a screen reader reads out.
        render(element as React.ReactElement);
        const field = screen.getByLabelText(/Phone|State|Address/);

        expect(field.hasAttribute('aria-invalid')).toBe(false);
    });

    it('THE CONTROL: the description was already wired, and still is', () => {
        //   The half that worked. If this broke, the fix would have traded one
        //   announcement for another.
        render(<FormInput label="Phone" error="Enter a valid Nigerian mobile number" />);
        const field = screen.getByLabelText('Phone');
        const describedBy = field.getAttribute('aria-describedby');

        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy!)?.textContent)
            .toBe('Enter a valid Nigerian mobile number');
    });

    it('a hint is described too, and does not make the field invalid', () => {
        render(<FormInput label="Phone" hint="We will only use this to reach you" />);
        const field = screen.getByLabelText('Phone');

        expect(field.getAttribute('aria-describedby')).toBeTruthy();
        expect(field.hasAttribute('aria-invalid')).toBe(false);
    });

    it('and the expression is ComboBox\'s, not a second way of saying it', () => {
        //   One statement of how this platform marks a field invalid.
        expect(code(COMBOBOX)).toContain('aria-invalid={Boolean(error) || undefined}');
        expect(code(FORM_FIELD)).toContain('aria-invalid={Boolean(error) || undefined}');
    });

    it('THE LEDGER — inputs in the tree that can be in error and never say so', () => {
        //   Both places that take an `error` prop and render a control now set it.
        //   A third that does not is worth finding before it ships.
        const saysIt = [FORM_FIELD, COMBOBOX]
            .filter((rel) => code(rel).includes('aria-invalid'));

        expect(saysIt).toEqual([FORM_FIELD, COMBOBOX]);
        expect(ledgerVerdict(2 - saysIt.length, 0)).toBe(LEDGER_HELD);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#923 — one field style, and the Tailwind trap in folding it', () => {
    //   The exact strings as they were before the fold, written out so this is a
    //   comparison and not a restatement of whatever the file now produces.
    const WAS_BASE =
        'w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white '
        + 'text-slate-900 placeholder-slate-400 '
        + 'focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 '
        + 'transition-colors duration-150 '
        + 'disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed';

    it('the exported values are byte-for-byte unchanged', () => {
        expect(INPUT_BASE).toBe(WAS_BASE);
        expect(INPUT_EMERALD).toBe(WAS_BASE.replace(
            'focus:ring-orange-500 focus:border-orange-500',
            'focus:ring-emerald-600 focus:border-emerald-600',
        ));
    });

    it('and they differ ONLY in the accent, which is the point of the fold', () => {
        const strip = (s: string) => s
            .replace(/focus:ring-(orange-500|emerald-600) focus:border-(orange-500|emerald-600)/, 'ACCENT');

        expect(strip(INPUT_BASE)).toBe(strip(INPUT_EMERALD));
        expect(INPUT_BASE).not.toBe(INPUT_EMERALD);
    });

    it('EVERY accent class appears in the source as a whole literal', () => {
        //   THE TRAP. Tailwind's scanner reads source text, so an interpolated
        //   `focus:ring-${colour}` generates nothing and the ring silently
        //   disappears — no type error, no lint error, no test failure anywhere
        //   else. Asserted on the raw file, comments included, because that is
        //   what the scanner sees.
        const raw = readFileSync(join(ROOT, FORM_FIELD), 'utf8');

        for (const cls of ['focus:ring-orange-500', 'focus:border-orange-500',
            'focus:ring-emerald-600', 'focus:border-emerald-600',
            'focus:ring-red-400', 'focus:border-red-400']) {
            expect(raw).toContain(cls);
        }

        //   AND THE NEGATIVE HALF READS STRIPPED SOURCE, not raw. The first
        //   version of this assertion failed on correct code, because the comment
        //   in FormField that explains the trap QUOTES the interpolated form — so
        //   the sweep found its own explanation. That is the trap this repo has
        //   now recorded several times over, and it caught me again inside the
        //   test written to describe it.
        const withoutProse = code(FORM_FIELD);

        expect(withoutProse).not.toMatch(/focus:ring-\$\{/);
        expect(withoutProse).not.toMatch(/focus:border-\$\{/);
        //   And the stripper left the code behind, or both lines above are vacuous.
        expect(withoutProse).toContain('export const INPUT_BASE');
    });

    it('and the error accent is still its own token', () => {
        expect(INPUT_ERROR).toBe('border-red-400 focus:ring-red-400 focus:border-red-400');
    });

    it('an errored field carries the error accent on top of the base', () => {
        render(<FormInput label="Phone" error="wrong" />);
        const cls = screen.getByLabelText('Phone').className;

        expect(cls).toContain('border-red-400');
        expect(cls).toContain('px-3.5');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#923 — the fourth and fifth statements of the phone rule', () => {
    const DELEGATING = [
        'src/app/cooperatives/onboarding/steps/NextOfKinStep.tsx',
        'src/app/marketplace/onboarding/steps/BusinessProfileStep.tsx',
        'src/app/wave/application/steps/PersonalDetailsStep.tsx',
    ];

    it('all three screens call the shared rule instead of their own regex', () => {
        for (const rel of DELEGATING) {
            const src = code(rel);

            expect(src).toContain('isNigerianMobile(');
            expect(src).not.toMatch(/\/\^0\\d\{10\}\$\//);
            expect(src).not.toMatch(/\/\^0\[789\]\[01\]/);
        }
    });

    it('THE BEHAVIOUR the two loose ones used to allow', () => {
        //   `/^0\d{10}$/` accepted these. No Nigerian network issues any of them.
        for (const notAMobile of ['01234567890', '09912345678', '06012345678', '00000000000']) {
            expect(/^0\d{10}$/.test(notAMobile)).toBe(true);
            expect(isNigerianMobile(notAMobile)).toBe(false);
        }
    });

    it('and the numbers that must still pass, do', () => {
        //   The control. A rule that refused everything would satisfy the test
        //   above and lock five onboarding forms.
        for (const real of ['08031234567', '07011234567', '09012345678', '08112345678',
            '+2348031234567', '8031234567']) {
            expect(isNigerianMobile(real)).toBe(true);
        }
    });

    it('THE LEDGER — Nigerian-phone rules written out in shipping code', () => {
        //   Swept by SHAPE, not by name: #919 folded the two functions and left
        //   three regexes, which a name-based sweep could not see.
        const SHAPES = /\[789\]\[01\]|\[789\]\\d|\^0\\d\{10\}|234\[789\]/;
        const owners: string[] = [];

        const walk = (dir: string): void => {
            for (const entry of readdirSync(join(ROOT, dir))) {
                const rel = `${dir}/${entry}`;
                if (statSync(join(ROOT, rel)).isDirectory()) {
                    if (!['node_modules', '.next', '__tests__'].includes(entry)) walk(rel);
                    continue;
                }
                if (!/\.tsx?$/.test(entry)) continue;
                //   Comments stripped: lib/phone and lib/security both QUOTE the
                //   old regexes in their notes, and a sweep that counts prose is
                //   the trap this repo has recorded more than once.
                //
                //   NO RETENTION FLOOR on a whole-tree walk. The floor is a guard
                //   for a caller reasoning about ONE file; applied to 700 of them
                //   it throws on the heavily-commented ones (_diagnostics.ts is
                //   12 code lines in 64) and the sweep dies rather than reporting.
                //   The control below is what stands in for it here.
                const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'),
                    { label: rel, minRetainedRatio: 0 });
                if (SHAPES.test(src)) owners.push(rel);
            }
        };
        walk('src');

        //   #945 ONE: lib/phone, which defines the rule. lib/schemas asked
        //   isNigerianMobile instead of carrying a fourth copy of the shape, so
        //   there is now exactly one statement of which prefixes exist.
        expect(owners.sort()).toEqual(['src/lib/phone.ts']);
        expect(ledgerVerdict(owners.length, 1)).toBe(LEDGER_HELD);

        //   THE CONTROL for the missing floor: the sweep can still see a rule
        //   where one provably is. A stripper that ate everything would report
        //   zero owners and hold the ledger at… zero, which is not two.
        expect(SHAPES.test(stripComments(
            readFileSync(join(ROOT, 'src/lib/phone.ts'), 'utf8'),
            { label: 'control', minRetainedRatio: 0 },
        ))).toBe(true);
    });

    it('CLOSED by #945: the Zod schema and the rule now agree', () => {
        /*
         *   THIS WAS A DELIBERATE DEFERRAL AND I AM OVERRULING IT, so the grounds
         *   belong here. What it said:
         *
         *       "A server gate on public WAVE briefing registration and on the
         *        WAVE application. Tightening it decides who may register, and
         *        refusing a real person costs more than storing a number no
         *        network issues — so the disagreement is costed here rather than
         *        closed on my own judgement."
         *
         *   That reasoning weighed the schema against nothing. MEASURED on the
         *   pre-change tree, every OTHER phone gate on this platform already
         *   refused all four of those numbers — PhoneInput, BusinessProfileStep,
         *   NextOfKinStep, PersonalDetailsStep and lib/security all ask
         *   isNigerianMobile.
         *
         *   So the schema was the only door admitting them, and admitting them
         *   helped nobody: a woman who registers for a briefing on an 082 number
         *   cannot then complete the WAVE application, marketplace onboarding or
         *   the cooperative next-of-kin step. Letting her through the first door
         *   is the cruelty; the refusal was always coming, two screens later and
         *   with more of her time spent. Tightening it refuses no one who could
         *   otherwise have finished.
         *
         *   AND THE SCHEMA WAS ALSO TOO STRICT, which the deferral did not weigh
         *   either. It judged the literal string, so `0803 123 4567` and
         *   `+234 (0) 803 123 4567` were both refused — the second being the exact
         *   form strictPhoneSchema's own note calls "one ordinary Nigerian number,
         *   written the way a business card writes it". The old rule refused real
         *   people for their punctuation while admitting prefixes no network
         *   issues. Both halves are fixed by asking isNigerianMobile, which strips
         *   non-digits before judging.
         */
        const onceAdmittedByTheSchemaOnly = ['08212345678', '07512345678', '09512345678', '08512345678'];

        for (const number of onceAdmittedByTheSchemaOnly) {
            expect(strictNigerianPhoneSchema.safeParse(number).success).toBe(false);
            expect(isNigerianMobile(number)).toBe(false);
        }

        //   And they still agree about the ones that matter most.
        for (const real of ['08031234567', '+2348031234567']) {
            expect(strictNigerianPhoneSchema.safeParse(real).success).toBe(true);
            expect(isNigerianMobile(real)).toBe(true);
        }
    });

    it('AND PUNCTUATION IS NO LONGER A REFUSAL, on either of them', () => {
        //   The half a registrant feels. Five spellings of one number, all
        //   accepted and all normalising to the same canonical form — which is
        //   what the dedup on that collection is keyed on.
        for (const spelling of [
            '08030001111', '+2348030001111', '0803 000 1111',
            '+234 803 000 1111', '+234 (0) 803 000 1111',
        ]) {
            expect({ spelling, ok: strictNigerianPhoneSchema.safeParse(spelling).success })
                .toEqual({ spelling, ok: true });
            expect({ spelling, canonical: normalisePhone(spelling) })
                .toEqual({ spelling, canonical: '+2348030001111' });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#923 — LoadingButton, which turned out fine', () => {
    it('disables itself while loading and says so to a screen reader', () => {
        render(<LoadingButton loading loadingText="Saving…">Save</LoadingButton>);
        const button = screen.getByRole('button');

        expect(button).toHaveProperty('disabled', true);
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(button.textContent).toContain('Saving…');
    });

    it('shows its children when it is not loading', () => {
        render(<LoadingButton loadingText="Saving…">Save</LoadingButton>);

        expect(screen.getByRole('button').textContent).toContain('Save');
        expect(screen.getByRole('button').textContent).not.toContain('Saving…');
    });

    it('stays disabled when the caller disables it, loading or not', () => {
        render(<LoadingButton disabled>Save</LoadingButton>);

        expect(screen.getByRole('button')).toHaveProperty('disabled', true);
    });

    it('THE SWEEP: no onClick button without a type sits inside a form', () => {
        //   LoadingButton never sets `type`, so one inside a <form> defaults to
        //   SUBMIT — click it and the handler runs and the form submits. Zero
        //   today across the whole tree; kept because it is a one-character
        //   regression and the eight LoadingButton call sites all pass type
        //   explicitly or sit outside a form.
        const offenders: string[] = [];

        for (const rel of shippingTsx()) {
            const src = readFileSync(join(ROOT, rel), 'utf8');
            if (!src.includes('<form')) continue;

            for (const form of src.matchAll(/<form[\s\S]*?<\/form>/g)) {
                for (const button of form[0].matchAll(/<(button|LoadingButton)\b([^>]*)>/g)) {
                    if (/onClick/.test(button[2]) && !/type\s*=/.test(button[2])) {
                        offenders.push(`${rel}  <${button[1]}>`);
                    }
                }
            }
        }

        expect(offenders).toEqual([]);
        expect(ledgerVerdict(offenders.length, 0)).toBe(LEDGER_HELD);
    });

    it('POSITIVE CONTROL: the sweep really reads forms and buttons', () => {
        //   A `toEqual([])` over a sweep that found no forms at all would pass.
        const withForms = shippingTsx().filter((rel) =>
            readFileSync(join(ROOT, rel), 'utf8').includes('<form'));

        expect(withForms.length).toBeGreaterThan(10);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#923 — BackToHub, and the one caveat worth writing down', () => {
    it('sends a signed-in member to their dashboard', () => {
        mockSession = { user: { id: 'u1' } };
        render(<BackToHub />);
        const link = screen.getByRole('link');

        expect(link.getAttribute('href')).toBe('/dashboard');
        expect(link.textContent).toContain('Return to Dashboard');
    });

    it('and an anonymous visitor to the public hub', () => {
        mockSession = null;
        render(<BackToHub />);
        const link = screen.getByRole('link');

        expect(link.getAttribute('href')).toBe('/');
        expect(link.textContent).toContain('Back to Hub');
    });

    it('takes a variant for a dark hero, and both are real classes', () => {
        //   Seven screens place this over a hero image; the wrong variant is
        //   white text on white.
        mockSession = null;
        const { container } = render(<BackToHub variant="dark" />);

        expect(container.querySelector('a')?.className).toContain('bg-slate-900/90');
    });

    it('THE CAVEAT, recorded rather than fixed: during loading it offers the hub', () => {
        //   `useSession()` reports status "loading" before it reports
        //   "authenticated", and this component reads only `data`. So a signed-in
        //   member sees "Back to Hub" pointing at "/" for the first moment of the
        //   page, and a fast click takes them to the public hub instead of their
        //   dashboard.
        //
        //   NOT FIXED, because every available fix is a decision somebody else
        //   should make: hiding the button until the session resolves makes a
        //   floating control flicker in and out, and defaulting to /dashboard
        //   sends a genuinely anonymous visitor to a guarded route. The behaviour
        //   is pinned so the choice is visible.
        mockSession = null;
        render(<BackToHub />);

        expect(screen.getByRole('link').getAttribute('href')).toBe('/');
        expect(code('src/components/common/BackToHub.tsx')).not.toContain('status');
    });
});
