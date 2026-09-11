/**
 * @jest-environment jsdom
 */

/**
 *   #630 THE SELLER VERIFICATION FORM LET YOU THROUGH EVERY STEP EMPTY, THEN
 *        REFUSED THE WHOLE THING WITHOUT SAYING WHY.
 *
 *   The fourth interaction-path test, and the last of the multi-step flows.
 *
 *   /marketplace/seller-verification collects four steps and posts them to
 *   /api/marketplace/submit-verification, which requires ELEVEN text fields and
 *   THREE documents. The client required none of them:
 *
 *     handleNext        `if (currentStep < 4) setCurrentStep(currentStep + 1)`
 *                       — no validation of any kind.
 *     handleSubmit      checked ONE thing: a product sample image, which the
 *                       server does not even require.
 *
 *   So a seller filled four steps, uploaded their CAC certificate, their ID and
 *   a proof of address, pressed Submit, and got back:
 *
 *       "Missing required fields"
 *
 *   naming none of them, on a form whose other three steps are no longer on
 *   screen. The only way to act on that is to walk back through every step
 *   guessing which of eleven boxes is empty.
 *
 *   THE `required` ATTRIBUTES DID NOT HELP. The inputs carry them, but Next is a
 *   plain button that never submits a form, so the browser's own validation
 *   never ran either — the markup looked validated and was not.
 *
 * ── WHY THE LISTS ARE PINNED TO EACH OTHER ──────────────────────────────────
 *
 *   The client's required set is now the server's, split by the step that
 *   collects each field, and this file asserts the two match. Both directions
 *   are defects and only one of them is obvious:
 *
 *     client asks for LESS   the seller gets "Missing required fields" at the
 *                            end — the bug being fixed.
 *     client asks for MORE   the form refuses a seller the server would have
 *                            accepted, and nothing on the server will ever
 *                            disagree loudly enough to reveal it.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Comment-stripped — a field named in prose is not a field that is checked. */
const code = (rel: string) => read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

const SCREEN = 'src/app/marketplace/seller-verification/page.tsx';
const ROUTE = 'src/app/api/marketplace/submit-verification/route.ts';

/**
 * The text fields the SERVER refuses a submission without.
 *
 * Read out of the route's own guard rather than retyped, so this cannot drift
 * from what the server actually does — #612's lesson about a test keeping its
 * own copy of the thing under test.
 */
function serverRequiredFields(): string[] {
    const src = code(ROUTE);
    const guard = /if \(!businessName \|\|([\s\S]*?)\) \{/.exec(src);
    if (!guard) throw new Error('the server guard has moved — this test is measuring nothing');
    return ['businessName', ...[...guard[1].matchAll(/!(\w+)/g)].map(m => m[1])];
}

/** The documents it refuses a submission without. */
function serverRequiredDocuments(): string[] {
    const src = code(ROUTE);
    const guard = /if \(!businessDoc \|\|([\s\S]*?)\) \{/.exec(src);
    if (!guard) throw new Error('the document guard has moved');
    return ['businessDoc', ...[...guard[1].matchAll(/!(\w+)/g)].map(m => m[1])];
}

/**
 * The required table, split into one entry per step.
 *
 * A structure rather than a fixed-width window: each step's body runs from its
 * own `N: [` to the matching `],`, so an empty step cannot borrow the next
 * one's checks.
 */
function requiredByStepBlocks(): Record<string, string> {
    const src = code(SCREEN);
    const table = src.slice(src.indexOf('REQUIRED_BY_STEP'), src.indexOf('function missingOnStep'));

    const out: Record<string, string> = {};
    const keys = [...table.matchAll(/^\s*(\d+): \[/gm)];
    keys.forEach((key, i) => {
        const from = key.index! + key[0].length;
        const to = i + 1 < keys.length ? keys[i + 1].index! : table.length;
        out[key[1]] = table.slice(from, to);
    });
    return out;
}

/** Every field the CLIENT now requires, across its four steps. */
function clientRequiredExpressions(): string[] {
    const src = code(SCREEN);
    const block = src.slice(src.indexOf('REQUIRED_BY_STEP'), src.indexOf('function missingOnStep'));
    return [...block.matchAll(/(?:formData|documents)\.(\w+)/g)].map(m => m[1]);
}

describe('#630 — the two lists agree, so the end of the form holds no surprises', () => {
    it('THE SERVER GUARD IS STILL THERE AND STILL NAMES ELEVEN FIELDS', () => {
        //   The premise. If the route stopped requiring these, this whole file
        //   would be pinning the client to nothing.
        const fields = serverRequiredFields();
        expect(fields).toHaveLength(11);
        expect(fields).toContain('businessName');
        expect(fields).toContain('accountName');

        expect(serverRequiredDocuments()).toEqual(['businessDoc', 'idDoc', 'addressProof']);
    });

    it('AND THE CLIENT REQUIRES EXACTLY WHAT THE SERVER REQUIRES', () => {
        //   Both directions are defects: asking for less produces "Missing
        //   required fields" at the end, asking for more refuses a seller the
        //   server would have taken.
        const client = new Set(clientRequiredExpressions());
        const server = [...serverRequiredFields(), ...serverRequiredDocuments()];

        expect([...server].filter(f => !client.has(f))).toEqual([]);
        expect([...client].filter(f => !server.includes(f))).toEqual([]);
    });

    it('AND THE READERS CAN FAIL — a positive control on each', () => {
        //   Without this, both readers returning nothing would make the
        //   comparison above pass while measuring no fields at all.
        expect(clientRequiredExpressions().length).toBeGreaterThan(10);
        expect(() => serverRequiredFields()).not.toThrow();

        //   And the client reader really is bounded to the required table, not
        //   the whole file — which mentions every field many times over.
        expect(clientRequiredExpressions()).not.toContain('productSample2');
    });
});

describe('#630 — and the gate actually refuses', () => {
    it('handleNext NO LONGER ADVANCES WITHOUT CHECKING', () => {
        const src = code(SCREEN);
        //   The line this finding is about.
        expect(src).not.toMatch(/function handleNext\(\) \{\s*if \(currentStep < 4\) \{/);
        expect(src).toContain('const missing = missingOnStep(currentStep);');
        expect(src).toContain('if (missing.length > 0)');
    });

    it('AND IT NAMES THE FIELDS, rather than saying something is missing', () => {
        /*
         *   The difference between an error a seller can act on and one they
         *   cannot. "Missing required fields" is true, useless, and arrives
         *   after four steps; this arrives on the step that is short, naming it.
         */
        const src = code(SCREEN);
        expect(src).toContain('`Please complete: ${missing.join(", ")}`');
        expect(src).toContain('`Still needed: ${incomplete.join(", ")}`');
    });

    it('AND SUBMIT CHECKS EVERY STEP, not only the one on screen', () => {
        //   A seller can reach step 4 by pressing Back and forward, so the last
        //   step re-checks all four. Otherwise the server's blank refusal is
        //   still reachable.
        const src = code(SCREEN);
        expect(src).toMatch(/\[1, 2, 3, 4\] as VerificationStep\[\]\)\s*\.flatMap\(step => missingOnStep\(step\)\)/);
    });

    it('AND EVERY STEP HAS SOMETHING REQUIRED ON IT', () => {
        /*
         *   A step with an empty required list is a step the gate waves through
         *   — the original defect, with extra steps.
         *
         *   BOUNDED TO EACH STEP'S OWN BLOCK, because the first version read a
         *   fixed 400 characters from each key and a mutant that emptied step 2
         *   while moving its fields to a step `99` survived: the window ran past
         *   the empty block into the next one and found its `filled:`. Reading a
         *   window rather than a structure is how a check measures its
         *   neighbour.
         */
        const steps = requiredByStepBlocks();

        //   Exactly the four steps this form has — no more, and none missing.
        expect(Object.keys(steps).sort()).toEqual(['1', '2', '3', '4']);

        for (const [step, body] of Object.entries(steps)) {
            expect({ step, checks: (body.match(/filled:/g) ?? []).length > 0 })
                .toEqual({ step, checks: true });
        }
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: handleNext advances without checking again         KILLED
 *     the client drops a field the server requires                   KILLED
 *     the client requires a field the server does not                KILLED
 *     a whole step's required list is emptied                        KILLED
 *     submit stops re-checking the earlier steps                     KILLED
 *     the error stops naming the fields                              KILLED
 *     the server quietly stops requiring a field                     KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   The third is the one that would look like better validation and be a new
 *   defect: a client asking for more than the server refuses a seller the server
 *   would have accepted, and nothing on the server ever disagrees loudly enough
 *   to reveal it.
 *
 * ── AND ONE SURVIVED FIRST, FOR A REASON WORTH KEEPING ──────────────────────
 *
 *   "A whole step's required list is emptied" survived, because the check read a
 *   FIXED WINDOW of 400 characters from each step's key. The mutant emptied step
 *   2 and moved its fields to a step `99`, so the window ran straight past the
 *   empty block into the next one and found its `filled:` there.
 *
 *   A check that reads a window rather than a structure measures its neighbour.
 *   Each step's body is now bounded by its own brackets, and the table's keys are
 *   asserted to be exactly 1-4.
 *
 * ── THE OTHER FOUR FLOWS WERE CHECKED AND ARE SOUND ─────────────────────────
 *
 *   Recorded so the absence of a finding is a measurement rather than a gap:
 *
 *     cooperatives onboarding   all three steps guard before onNext; the draft
 *                               stores data per section and no step, so #625's
 *                               lockout cannot happen here.
 *     academy application       validateStep before advancing, and the step is
 *                               clamped with Math.min/Math.max.
 *     LoanWizard                `if (isValid && currentStep < STEPS.length)`.
 *     OnboardingTour            bounded both ways and collects nothing.
 */
