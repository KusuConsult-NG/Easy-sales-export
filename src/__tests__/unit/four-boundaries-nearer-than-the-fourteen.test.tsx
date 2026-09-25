/**
 * @jest-environment jsdom
 */

/**
 *   #907 #904 WIRED FOURTEEN BOUNDARIES AND REACHED ALMOST NONE OF THEM.
 *
 *   #904 was right that only app/global-error.tsx reported, and right that
 *   global-error is the one Next reaches last. It then wired the fourteen
 *   `error.tsx` files and stopped — without asking what sits INSIDE them.
 *
 *   React stops at the NEAREST boundary. Four CLASS boundaries sit inside every
 *   route boundary on this platform, and `<ErrorBoundary>` wraps the member
 *   layout of every module:
 *
 *       components/admin/AdminShell          all of /admin
 *       farm-nation/(member)/layout          Farm Nation
 *       marketplace/seller/layout            the seller portal
 *       marketplace/buyer/layout             the buyer portal
 *       export/(app)/layout                  Export
 *       wave/(member)/layout                 WAVE
 *       academy/(learner)/layout             Academy
 *
 *   plus MarketplaceErrorBoundary, GlobalResilienceBoundary and
 *   CooperativeErrorBoundary inside those. So for a signed-in member ANYWHERE in
 *   the application, a class boundary catches the crash and the route boundary
 *   #904 fixed never sees it. All four ended in `console.error`.
 *
 *   AND ErrorBoundary'S SCREEN SAID SO OUT LOUD: "We encountered an unexpected
 *   error. Our team has been notified and is working on a fix." Nothing had been
 *   notified. A promise to the person that the code did not keep.
 *
 *   ONE COPY OF THE RULE. reportBoundaryError is the hook's own body, exported —
 *   the arrangement these same files already use for the reload half, in their
 *   own words: "A class component cannot use the hook the route boundaries use,
 *   so it calls the same budget directly. The RULE is shared; only the plumbing
 *   differs." (#717, in ErrorBoundary.)
 */

import React from 'react';
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

const captureException = jest.fn();
jest.mock('@sentry/nextjs', () => ({ captureException: (...a: any[]) => (captureException as any)(...a) }));

const logTelemetryAction = jest.fn(async () => ({ error: null, success: true as const, data: null }));
jest.mock('@/app/actions/telemetry', () => ({
    logTelemetryAction: (...a: any[]) => (logTelemetryAction as any)(...a),
}));

/** The reload budget, so a stale-deployment case does not actually reload jsdom. */
const consumeReloadBudget = jest.fn(() => false);
const isStaleDeploymentError = jest.fn((e: any) => /ChunkLoadError/.test(String(e?.message ?? '')));
jest.mock('@/lib/stale-deployment-recovery', () => ({
    isStaleDeploymentError: (...a: any[]) => (isStaleDeploymentError as any)(...a),
    canAutoReload: () => false,
    consumeReloadBudget: (...a: any[]) => (consumeReloadBudget as any)(...a),
}));

const { ErrorBoundary } = require('@/components/ErrorBoundary');
const { CooperativeErrorBoundary } = require('@/components/errors/CooperativeErrorBoundary');
const { MarketplaceErrorBoundary } = require('@/components/marketplace/MarketplaceErrorBoundary');
const { GlobalResilienceBoundary } = require('@/components/shared/GlobalResilienceBoundary');

/** Every class boundary, and the file it lives in. */
const BOUNDARIES: Array<[string, any, string]> = [
    ['ErrorBoundary', ErrorBoundary, 'src/components/ErrorBoundary.tsx'],
    ['CooperativeErrorBoundary', CooperativeErrorBoundary, 'src/components/errors/CooperativeErrorBoundary.tsx'],
    ['MarketplaceErrorBoundary', MarketplaceErrorBoundary, 'src/components/marketplace/MarketplaceErrorBoundary.tsx'],
    ['GlobalResilienceBoundary', GlobalResilienceBoundary, 'src/components/shared/GlobalResilienceBoundary.tsx'],
];

function Boom({ message }: { message: string }): React.ReactElement {
    throw Object.assign(new Error(message), { digest: 'dig-1' });
}

/** React logs a caught error to console.error; silence it so the run is readable. */
let consoleError: any;
beforeEach(() => {
    captureException.mockClear();
    logTelemetryAction.mockClear();
    consumeReloadBudget.mockClear();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => { });
    jest.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => {
    consoleError?.mockRestore?.();
    jest.restoreAllMocks();
});

describe('every class boundary tells somebody', () => {
    it.each(BOUNDARIES.map(([name]) => [name]))(
        '%s REPORTS THE CRASH IT CATCHES',
        (name) => {
            /*
             *   THE test. Each of these caught a crash and wrote to a browser
             *   console — and each is NEARER than the route boundary #904 wired,
             *   so for a signed-in member it was the only thing that ran.
             */
            const [, Boundary] = BOUNDARIES.find(([n]) => n === name)!;

            render(<Boundary><Boom message="boom" /></Boundary>);

            expect(captureException).toHaveBeenCalledTimes(1);
            expect((captureException.mock.calls[0][1] as any)?.tags?.boundary)
                .toContain('component/');
            expect(logTelemetryAction).toHaveBeenCalledTimes(1);

            const payload = (logTelemetryAction.mock.calls[0] as any[])[2];
            expect(payload.message).toBe('boom');
            expect(payload.digest).toBe('dig-1');
        },
    );

    it.each(BOUNDARIES.map(([name]) => [name]))(
        'AND %s STILL SHOWS ITS ERROR SCREEN (control)',
        (name) => {
            //   THE control: "it reported" is satisfied by a boundary that
            //   reports and then renders nothing, which is worse than the defect.
            const [, Boundary] = BOUNDARIES.find(([n]) => n === name)!;

            const { container } = render(<Boundary><Boom message="boom" /></Boundary>);

            expect(container.textContent?.trim().length).toBeGreaterThan(20);
        },
    );

    it.each(BOUNDARIES.map(([name]) => [name]))(
        'AND %s REPORTS NOTHING FOR A NEXT_REDIRECT',
        (name) => {
            /*
             *   Next throws NEXT_REDIRECT to move the router. It is not an error,
             *   every one of these boundaries already declined to LOG it, and a
             *   report would put a routine navigation in the error feed.
             */
            const [, Boundary] = BOUNDARIES.find(([n]) => n === name)!;

            //   render() re-throws it on purpose, so the throw is expected here.
            try {
                render(<Boundary><Boom message="NEXT_REDIRECT;replace;/login" /></Boundary>);
            } catch { /* the re-throw — that is the designed behaviour */ }

            expect(captureException).not.toHaveBeenCalled();
            expect(logTelemetryAction).not.toHaveBeenCalled();
        },
    );

    it.each(BOUNDARIES.map(([name]) => [name]))(
        'AND %s REPORTS NOTHING FOR A STALE DEPLOYMENT',
        (name) => {
            /*
             *   A ChunkLoadError after a deploy is a browser holding an old
             *   bundle. #717 already reloads once for it; reporting it would fill
             *   the feed with every deploy and bury the real crashes — which is
             *   the whole point of this finding.
             *
             *   The budget is exhausted in this fixture, which is the harder
             *   case: the boundary falls through to its error screen and must
             *   STILL not report.
             */
            const [, Boundary] = BOUNDARIES.find(([n]) => n === name)!;
            consumeReloadBudget.mockReturnValue(false);

            render(<Boundary><Boom message="ChunkLoadError: Loading chunk 42 failed" /></Boundary>);

            expect(captureException).not.toHaveBeenCalled();
            expect(logTelemetryAction).not.toHaveBeenCalled();
        },
    );

    it('AND A BOUNDARY STILL RENDERS WHEN THE REPORT CANNOT BE SENT', () => {
        //   The boundary must never become the failure. Sentry is not
        //   initialised in every environment.
        captureException.mockImplementationOnce(() => { throw new Error('sentry down'); });

        expect(() => render(<ErrorBoundary><Boom message="boom" /></ErrorBoundary>)).not.toThrow();
    });

    it('AND ErrorBoundary\'S PROMISE TO THE PERSON IS NOW TRUE', () => {
        /*
         *   Its screen says "Our team has been notified and is working on a
         *   fix." Nothing had been notified. Asserted together — the sentence
         *   and the call — because either alone is the defect: the claim without
         *   the report is a lie, and removing the claim would have been the
         *   cheaper, worse fix.
         */
        render(<ErrorBoundary><Boom message="boom" /></ErrorBoundary>);

        expect(screen.getByText(/team has been notified/i)).toBeTruthy();
        expect(captureException).toHaveBeenCalledTimes(1);
    });
});

describe('one copy of the rule, and no boundary left out', () => {
    it('NO CLASS BOUNDARY KEEPS ITS OWN REPORTING', () => {
        for (const [, , rel] of BOUNDARIES) {
            const src = code(rel);
            expect({ rel, ownSentry: src.includes('Sentry.captureException') })
                .toEqual({ rel, ownSentry: false });
            expect({ rel, shared: src.includes('reportBoundaryError(error,') })
                .toEqual({ rel, shared: true });
        }
    });

    it('AND THE ROUTE BOUNDARIES GO THROUGH THE SAME FUNCTION', () => {
        //   #904's fix is not replaced, it is completed: the hook now calls the
        //   function the classes call, so there is one body rather than two.
        const hook = code('src/components/shared/useBoundaryReport.ts');

        expect(hook).toContain('export function reportBoundaryError');
        expect(hook).toContain('reportBoundaryError(error, boundary);');
        expect((hook.match(/Sentry\.captureException/g) || []).length).toBe(1);
    });

    it('AND THE SWEEP FINDS NO CLASS BOUNDARY THAT WAS MISSED', () => {
        /*
         *   THE ratchet, and the reason this finding exists at all: #904 fixed a
         *   list it had written by hand and the list was of the wrong thing. Any
         *   componentDidCatch anywhere under src/ must report.
         */
        function walk(dir: string, out: string[] = []): string[] {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) walk(full, out);
                else if (/\.tsx?$/.test(entry) && !/__tests__|\.test\./.test(full)) out.push(full);
            }
            return out;
        }

        const catchers = walk(join(ROOT, 'src'))
            .map((f) => ({ rel: relative(ROOT, f), src: readFileSync(f, 'utf8') }))
            .filter(({ src }) => src.includes('componentDidCatch'));

        //   Control: the sweep has to be finding them.
        expect(catchers.length).toBeGreaterThanOrEqual(4);

        expect(catchers
            .filter(({ src }) => !stripComments(src).includes('reportBoundaryError'))
            .map(({ rel }) => rel))
            .toEqual([]);
    });
});

describe('and every class boundary hands a redirect back to the router', () => {
    /*
     *   FOUND BY THE SUITE ABOVE, NOT BY EYE. CooperativeErrorBoundary had no
     *   NEXT_REDIRECT handling of any kind — neither the log skip the other
     *   three had in componentDidCatch nor the re-throw they had in render — so
     *   the first thing #907's reporting did on it was send a routine navigation
     *   to Sentry.
     *
     *   LATENT, NOT LIVE, and worth saying so: its one subtree
     *   (cooperatives/onboarding/OnboardingClient) is a client component that
     *   navigates with `router.replace`, which does not throw. A server-side
     *   `redirect()` does, and on that day the boundary would have rendered
     *   "Something went wrong" instead of navigating.
     */
    it.each(BOUNDARIES.map(([name]) => [name]))('%s RE-THROWS IT', (name) => {
        const [, Boundary] = BOUNDARIES.find(([n]) => n === name)!;
        let rethrown: unknown = null;

        try {
            render(<Boundary><Boom message="NEXT_REDIRECT;replace;/login" /></Boundary>);
        } catch (e) {
            rethrown = e;
        }

        expect(String((rethrown as any)?.message ?? '')).toContain('NEXT_REDIRECT');
    });

    it('AND AN ORDINARY ERROR IS NOT RE-THROWN (control)', () => {
        //   The control on that assertion: a boundary that re-threw everything
        //   would satisfy it and catch nothing at all.
        expect(() => render(<ErrorBoundary><Boom message="boom" /></ErrorBoundary>)).not.toThrow();
    });
});
