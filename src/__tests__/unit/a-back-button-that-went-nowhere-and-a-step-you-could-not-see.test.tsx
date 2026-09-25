/**
 * @jest-environment jsdom
 */

/**
 *   #921 TWO NAVIGATION PRIMITIVES NO TEST HAD NAMED, AND BOTH HAD A STATE THAT
 *   DID NOTHING.
 *
 *   components/ui/BackButton is rendered by FOURTEEN screens. components/shared/
 *   StepIndicator draws the marketplace onboarding wizard's progress bar, and
 *   components/onboarding/StepIndicator — a different component of the same name
 *   — draws the export one. None of the three had ever been named by a test.
 *
 * ── THE BACK BUTTON THAT WENT NOWHERE ───────────────────────────────────────
 *
 *       if (typeof window !== 'undefined' && window.history.length > 1) {
 *           router.back();
 *       } else if (fallbackPath) {
 *           router.push(fallbackPath);
 *       }
 *
 *   Nothing after the `else if`, and `fallbackPath` was OPTIONAL. Four of the
 *   fourteen call sites left it out:
 *
 *       app/admin/marketplace/products/page
 *       app/farm-nation/(member)/offers/OffersClient
 *       app/marketplace/seller/quotes/SellerQuotesClient
 *       app/marketplace/buyer/quotes/BuyerQuotesClient
 *
 *   On a tab with one history entry — a bookmark, a link from an email, anything
 *   opened with target=_blank — those four rendered an enabled "Back" button that
 *   did NOTHING when clicked. Measured under jsdom, where `history.length` is 1:
 *   neither `router.back` nor `router.push` was called.
 *
 *   The prop is REQUIRED now, and each of the four was given the path its own
 *   screen sits under. Required rather than defaulted, because one default cannot
 *   be right for all four — an admin moderation tool does not belong at a member
 *   dashboard — and because a required prop makes a fifteenth no-op a compile
 *   error instead of a dead button somebody has to notice. #917's lesson on the
 *   redirect guard, in that file's words: the guard enforces it now instead of
 *   trusting four callers to remember.
 *
 * ── AND THE STEP YOU COULD NOT SEE ──────────────────────────────────────────
 *
 *   shared/StepIndicator chose the circle's colour from a nested ternary whose
 *   first two branches were byte-identical — "bg-green-600 text-white" in both.
 *   Three states written, two drawn. Measured on a three-step wizard at step 2:
 *   the completed circle and the current circle carried the same class string
 *   exactly, and the only thing telling them apart was a tick where the other had
 *   a numeral.
 *
 *   MarketplaceOnboardingClient draws up to six of them, and "which step am I on"
 *   is the only question a progress bar exists to answer. The current circle now
 *   carries the ring its SIBLING component already uses for the same purpose —
 *   adopted, not invented — and `aria-current="step"`, which it had no way to
 *   express at all.
 *
 *   THE TWO COMPONENTS ARE NOT MERGED. Their contracts are genuinely different —
 *   numeric id and numeric cursor here, string id plus a per-step `completed`
 *   flag there — so folding either into the other changes a live wizard's data
 *   shape. Both are pinned below instead, including the thing they disagree about
 *   that a reader would not expect: one is a default export and the other named.
 */

/*
 *   `jest` IS THE GLOBAL HERE, DELIBERATELY, AND THIS SUITE CANNOT WORK OTHERWISE.
 *
 *   #392 established the mechanism: `jest.mock` is hoisted above a module's
 *   imports only when `jest` is the global. Take it from '@jest/globals' in the
 *   same file and the imports run first, so the registration lands too late. It
 *   throws nothing and logs nothing.
 *
 *   Most suites in this repo are unaffected because they import the module under
 *   test DYNAMICALLY, after registration. A render suite cannot: the component
 *   has to be imported statically for JSX. So the first draft of this file took
 *   `jest` from '@jest/globals', and every router assertion below came back with
 *   zero calls — the component was talking to jest.setup.js's own
 *   `next/navigation` mock, which hands out a FRESH `jest.fn()` on every call and
 *   is therefore unobservable from here.
 *
 *   That very nearly produced a false finding. The no-op this file is about also
 *   shows as zero calls, so the broken harness and the defect were
 *   indistinguishable until the fixed component ALSO reported zero. The
 *   measurement was redone with a working mock before anything was claimed.
 *
 *   AND A GAP IN #392's RATCHET, RECORDED WITHOUT A VICTIM. Its detector resolves
 *   `@/x` and relative specifiers and returns null for a bare package name — by
 *   construction, and its own test asserts that. So a late mock of
 *   'next/navigation', 'next-auth/react' or 'resend' is outside what it can see.
 *   Searched for a live instance: the suites that mock the router and import their
 *   component statically all use the global `jest`, and the ones that take it from
 *   '@jest/globals' import their subject dynamically. No instance today. The gap
 *   is named rather than closed, because resolving package reachability is a
 *   change to a shared gate and not this finding's job.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { stripComments } from '@/lib/testing/strip-comments';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';

const back = jest.fn();
const push = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({
        back: (...a: unknown[]) => back(...a),
        push: (...a: unknown[]) => push(...a),
        replace: jest.fn(),
        prefetch: jest.fn(),
    }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '',
}));

import BackButton from '@/components/ui/BackButton';
import SharedStepIndicator from '@/components/shared/StepIndicator';
import { StepIndicator as OnboardingStepIndicator } from '@/components/onboarding/StepIndicator';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.2 });

const BACK_BUTTON = 'src/components/ui/BackButton.tsx';
const SHARED = 'src/components/shared/StepIndicator.tsx';
const ONBOARDING = 'src/components/onboarding/StepIndicator.tsx';

beforeEach(() => {
    jest.clearAllMocks();
});

/** Every `<BackButton …>` in the shipping tree, with its attribute text. */
function backButtonCallSites(): { file: string; attrs: string }[] {
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const sites: { file: string; attrs: string }[] = [];

    const walk = (dir: string): void => {
        for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
            const rel = `${dir}/${entry.name}`;
            if (entry.isDirectory()) {
                if (!['node_modules', '.next', '__tests__'].includes(entry.name)) walk(rel);
                continue;
            }
            if (!entry.name.endsWith('.tsx')) continue;
            const src = readFileSync(join(ROOT, rel), 'utf8');
            for (const m of src.matchAll(/<BackButton\b([^>]*)\/?>/g)) {
                sites.push({ file: rel, attrs: m[1] });
            }
        }
    };
    walk('src');

    return sites;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#921 — BackButton always has somewhere to go', () => {
    it('THE CONTROL: jsdom really does report a single history entry', () => {
        //   Every claim below rests on this. A jsdom that reported 2 would make
        //   the no-op assertions vacuous, and the fix untestable.
        expect(window.history.length).toBe(1);
    });

    it('navigates to the fallback when the browser has no history to pop', () => {
        //   THE defect: this used to be the branch that ran off the end.
        render(<BackButton fallbackPath="/marketplace/seller/dashboard" />);
        fireEvent.click(screen.getByRole('button'));

        expect(push).toHaveBeenCalledWith('/marketplace/seller/dashboard');
        expect(back).not.toHaveBeenCalled();
    });

    it('pops history when there IS history, rather than jumping to the fallback', () => {
        //   The fallback is a last resort, not a preference — a person who has
        //   navigated inside the app expects Back to undo their last step.
        const original = window.history.length;
        Object.defineProperty(window.history, 'length', { value: 4, configurable: true });
        try {
            render(<BackButton fallbackPath="/marketplace/seller/dashboard" />);
            fireEvent.click(screen.getByRole('button'));

            expect(back).toHaveBeenCalledTimes(1);
            expect(push).not.toHaveBeenCalled();
        } finally {
            Object.defineProperty(window.history, 'length', { value: original, configurable: true });
        }
    });

    it('is a real button, not a link that submits the form around it', () => {
        //   type="button" is load-bearing: several of the fourteen screens render
        //   this inside a form, where the HTML default is submit.
        render(<BackButton fallbackPath="/dashboard" />);

        expect(screen.getByRole('button')).toHaveProperty('type', 'button');
    });

    it('and takes a label, because four screens are not all called "Back"', () => {
        render(<BackButton fallbackPath="/dashboard" label="Back to products" />);

        expect(screen.getByRole('button').textContent).toContain('Back to products');
        expect(back).not.toHaveBeenCalled();
    });

    it('THE RATCHET: every call site in the tree supplies a fallback', () => {
        //   TypeScript enforces this now, which is the point — but a required prop
        //   can be made optional again in one keystroke, and the four screens that
        //   were bare would go quietly back to being dead buttons.
        const sites = backButtonCallSites();
        const bare = sites.filter((s) => !/fallbackPath/.test(s.attrs));

        expect(bare).toEqual([]);
        expect(ledgerVerdict(bare.length, 0)).toBe(LEDGER_HELD);
    });

    it('POSITIVE CONTROL: the sweep finds the call sites it is checking', () => {
        //   A `toEqual([])` against a sweep that matched nothing would pass and
        //   mean nothing. Fourteen when this was written; the floor is what
        //   matters, not the exact number, because screens come and go.
        const sites = backButtonCallSites();

        expect(sites.length).toBeGreaterThanOrEqual(14);
        expect(sites.map((s) => s.file))
            .toContain('src/app/marketplace/buyer/quotes/BuyerQuotesClient.tsx');
    });

    it('HAS NO PATH THAT DOES NOTHING, even for a caller who bypasses the type', () => {
        //   THE BEHAVIOURAL KILL for the original shape, and the reason it needs
        //   saying separately: the two tests above both pass a fallbackPath, and
        //   the old `else if (fallbackPath)` pushed perfectly well when it had
        //   one. What it did on the four bare screens — nothing — is only
        //   reproducible by omitting the prop, which TypeScript now forbids.
        //
        //   Reached here through a cast, because the type is not the whole
        //   guarantee: a JS call site, a spread of a loosely typed props object,
        //   or `as any` all get past it, and the handler should still try to go
        //   somewhere rather than sit there. It calls `push(undefined)`, which is
        //   not a good destination and is not meant to be one — the point is that
        //   the silent branch is gone, so a missing path fails visibly instead of
        //   producing a button that looks alive and is not.
        render(<BackButton {...({} as { fallbackPath: string })} />);
        fireEvent.click(screen.getByRole('button'));

        expect(push).toHaveBeenCalledTimes(1);
        expect(back).not.toHaveBeenCalled();
    });

    it('and the prop is declared required in the component', () => {
        const src = code(BACK_BUTTON);

        expect(src).toContain('fallbackPath: string;');
        expect(src).not.toContain('fallbackPath?: string');
        //   The dangling `else if` is gone: the last statement navigates
        //   unconditionally.
        expect(src).not.toContain('else if (fallbackPath)');
        expect(src).toContain('router.push(fallbackPath)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#921 — the current step looks different from a finished one', () => {
    const STEPS = [
        { id: 1, title: 'Account Type', description: 'Choose your role' },
        { id: 2, title: 'Business Profile', description: 'Your information' },
        { id: 3, title: 'Terms', description: 'Accept agreements' },
    ];

    /** The three step circles, in order. */
    function circles(currentStep: number): HTMLElement[] {
        const { container } = render(
            <SharedStepIndicator steps={STEPS} currentStep={currentStep} />);
        return [...container.querySelectorAll<HTMLElement>('div.w-10.h-10')];
    }

    it('THE DEFECT: a completed circle and the current one no longer match', () => {
        const [done, here, todo] = circles(2);

        expect(done.className).not.toBe(here.className);
        expect(here.className).not.toBe(todo.className);
        expect(done.className).not.toBe(todo.className);
    });

    it('all three states are still distinguishable at every position', () => {
        //   Not just at step 2. A wizard's first and last steps are the ones most
        //   likely to collapse into a neighbour's state.
        for (const current of [1, 2, 3]) {
            const classes = circles(current).map((c) => c.className);

            expect(new Set(classes).size).toBe(Math.min(3, new Set([
                ...classes.map((_, i) => Math.sign(current - STEPS[i].id)),
            ]).size));
        }
    });

    it('the current step is the one carrying the ring', () => {
        const [done, here, todo] = circles(2);

        expect(here.className).toContain('ring-4');
        expect(done.className).not.toContain('ring-4');
        expect(todo.className).not.toContain('ring-4');
    });

    it('and says so to a screen reader, which it could not before', () => {
        const [done, here, todo] = circles(2);

        expect(here.getAttribute('aria-current')).toBe('step');
        expect(done.getAttribute('aria-current')).toBeNull();
        expect(todo.getAttribute('aria-current')).toBeNull();
    });

    it('exactly one step is current, at every position', () => {
        for (const current of [1, 2, 3]) {
            const marked = circles(current).filter((c) => c.getAttribute('aria-current') === 'step');

            expect(marked).toHaveLength(1);
        }
    });

    it('THE CONTROL: finished steps still show a tick and the rest their number', () => {
        //   The one cue that DID distinguish them before. Kept, not replaced.
        const [done, here, todo] = circles(2);

        expect(done.textContent).toBe('');
        expect(here.textContent).toBe('2');
        expect(todo.textContent).toBe('3');
    });

    it('and the source no longer holds two identical branches', () => {
        //   Behaviourally covered above; pinned at source because a nested ternary
        //   with equal arms is the shape that hid this, and it reads as deliberate.
        const src = code(SHARED);
        const arms = [...src.matchAll(/"(bg-green-600 text-white[^"]*)"/g)].map((m) => m[1]);

        expect(arms).toHaveLength(2);
        expect(new Set(arms).size).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#921 — two components of one name, and what they disagree about', () => {
    /**
     * Not merged. Recorded, so the next person reaching for "StepIndicator" knows
     * there are two and which one their data fits.
     */
    it('they are exported differently, which is the trap', () => {
        //   `import StepIndicator from` gets the marketplace one;
        //   `import { StepIndicator } from` gets the export one. Neither import
        //   fails against the wrong module in a way that names the problem.
        expect(code(SHARED)).toContain('export default function StepIndicator');
        expect(code(ONBOARDING)).toContain('export function StepIndicator');
        expect(code(ONBOARDING)).not.toContain('export default');
    });

    it('and they take incompatible props, which is what makes merging a rewrite', () => {
        expect(code(SHARED)).toContain('currentStep: number');
        expect(code(ONBOARDING)).toContain('currentStepId: string');
    });

    it('the export one keys completion off a per-step flag, not the cursor', () => {
        //   So a step can be marked done out of order — which is why its contract
        //   cannot simply become a number.
        expect(code(ONBOARDING)).toContain('step.completed');
        expect(code(SHARED)).not.toContain('completed');
    });

    it('and the export one renders nothing for an id it does not have', () => {
        //   RECORDED, NOT FIXED. `findIndex` returns -1, so every circle greys and
        //   the description card is skipped: a progress bar that shows no progress.
        //   #625 already closed the one path that could produce it — the export
        //   client validates a restored draft's step id through `restoredStepId`
        //   before setting it — so this is reachable only by a caller that does
        //   not. Making the component fall back to step 1 would be inventing a
        //   behaviour; naming the state is what is useful.
        const { container } = render(
            <OnboardingStepIndicator
                steps={[
                    { id: 'profile', title: 'Profile', description: 'About you', completed: false },
                    { id: 'terms', title: 'Terms', description: 'Agreements', completed: false },
                ] as any}
                currentStepId="a-step-this-flow-does-not-have"
            />);

        const filled = [...container.querySelectorAll('div.w-10.h-10')]
            .filter((c) => !c.className.includes('bg-slate-200'));

        expect(filled).toHaveLength(0);
        expect(container.textContent).not.toContain('About you');
    });

    it('and #625\'s guard at the caller is still there', () => {
        //   The assertion above describes a state nothing reaches today. That is
        //   only true while this line is.
        const client = code('src/app/export/onboarding/ExportOnboardingClient.tsx');

        expect(client).toContain('restoredStepId(parsed.step');
    });

    it('THE LEDGER — how many step indicators the platform draws', () => {
        //   Two shared components plus seven screens that draw their own circles.
        //   Left alone: each is bound to its own wizard's state shape, and #452's
        //   lesson is that the cost is copies DISAGREEING, not copies existing.
        //   A tenth is worth a look before it is written.
        const { readdirSync } = require('node:fs') as typeof import('node:fs');
        const drawers: string[] = [];

        const walk = (dir: string): void => {
            for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
                const rel = `${dir}/${entry.name}`;
                if (entry.isDirectory()) {
                    if (!['node_modules', '.next', '__tests__'].includes(entry.name)) walk(rel);
                    continue;
                }
                if (!entry.name.endsWith('.tsx')) continue;
                const src = readFileSync(join(ROOT, rel), 'utf8');
                if (/rounded-full flex items-center justify-center/.test(src)
                    && /currentStep\b|currentStepId\b/.test(src)) drawers.push(rel);
            }
        };
        walk('src');

        expect(ledgerVerdict(drawers.length, 9)).toBe(LEDGER_HELD);
        expect(drawers).toContain(SHARED);
        expect(drawers).toContain(ONBOARDING);
    });
});
