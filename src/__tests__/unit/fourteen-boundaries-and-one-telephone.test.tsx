/**
 * @jest-environment jsdom
 */

/**
 *   #904 FOURTEEN ERROR BOUNDARIES, AND THE ONLY ONE THAT REPORTED WAS THE ONE
 *   NEXT REACHES LAST.
 *
 *   Measured while auditing the files no test had named — five of the fourteen
 *   were on that list. Exactly one, app/global-error.tsx, called
 *   Sentry.captureException and logTelemetryAction. The other thirteen did this:
 *
 *       console.error('[Dashboard Error]', error.message);
 *
 *   or logger.error, or console.error(error), or nothing.
 *
 * ── WHY THAT MEANS NOBODY WAS TOLD ANYTHING ─────────────────────────────────
 *
 *   Next walks up from the crash to the NEAREST error boundary and stops there.
 *   global-error.tsx only sees what no error.tsx caught, which in this
 *   application means an error in the root layout itself. There is an error.tsx
 *   at the app root AND one in every module segment, so a render crash inside
 *   /dashboard, /marketplace, /export, /academy, /wave, /cooperatives,
 *   /farm-nation, /loans, /escrow or /admin was caught by a boundary that wrote
 *   to a browser console nobody reads.
 *
 *   THE PROOF IS THE COMMIT BEFORE THIS ONE. #901 found two screens that threw
 *   on EVERY ROW they were given — the admin land verification queue, and the
 *   public land map. Both live. Both under /land, which has no boundary of its
 *   own, so both landed on app/error.tsx, which logged and moved on. Two
 *   screens could not draw a single row and nothing anywhere said so.
 *
 *   That is what makes this a defect and not tidying: the silence is why an
 *   audit had to find those two by reading, and the next two will be found the
 *   same way until the boundaries speak.
 *
 * ── AND app/error.tsx SHOWED THE MESSAGE TO THE PERSON ──────────────────────
 *
 *   `{error.message || "An unexpected error occurred..."}`, and the same in
 *   admin/error.tsx. Next replaces the message for a SERVER render, so what
 *   leaks is client-side throws — which carry whatever the code said. It is
 *   also useless to the reader: "Cannot read properties of null (reading
 *   'toFixed')" is not something a member can act on. global-error.tsx already
 *   had this right, behind NODE_ENV === 'development'.
 */

import React from 'react';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

/** Every boundary in the app, found rather than listed. */
function boundaries(dir = join(ROOT, 'src/app'), out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) boundaries(full, out);
        else if (entry === 'error.tsx' || entry === 'global-error.tsx') out.push(relative(ROOT, full));
    }
    return out;
}

const ALL = boundaries().sort();

describe('every boundary tells somebody', () => {
    it('THE SWEEP FINDS THE BOUNDARIES (control)', () => {
        //   THE control: every assertion below is "all of them do X", which a
        //   list of one or zero would satisfy.
        expect(ALL.length).toBeGreaterThanOrEqual(14);

        //   The two ends of the hierarchy: the one Next reaches LAST, which was
        //   the only reporter, and the root error.tsx that intercepts almost
        //   everything before it.
        expect(ALL).toContain('src/app/global-error.tsx');
        expect(ALL).toContain('src/app/error.tsx');

        /*
         *   And every segment boundary, named individually. Not decoration: the
         *   assertions below iterate a swept list, and a sweep that silently
         *   stopped finding a directory would report every remaining boundary as
         *   compliant. These are also the five that had NO reporting of any kind
         *   — not Sentry, not telemetry, not even a logger — plus the eight that
         *   only wrote to the console.
         */
        for (const rel of [
            'src/app/academy/error.tsx',
            'src/app/admin/error.tsx',
            'src/app/cooperatives/error.tsx',
            'src/app/cooperatives/onboarding/error.tsx',
            'src/app/dashboard/error.tsx',
            'src/app/escrow/error.tsx',
            'src/app/export/error.tsx',
            'src/app/farm-nation/error.tsx',
            'src/app/farm-nation/map/error.tsx',
            'src/app/loans/error.tsx',
            'src/app/marketplace/error.tsx',
            'src/app/wave/error.tsx',
            'src/app/wave/application/error.tsx',
        ]) {
            expect({ rel, found: ALL.includes(rel) }).toEqual({ rel, found: true });
        }
    });

    it('AND EVERY ONE OF THEM REPORTS', () => {
        /*
         *   THE test. Thirteen of fourteen did not, and the one that did is the
         *   one Next reaches last.
         */
        for (const rel of ALL) {
            expect({ rel, reports: code(rel).includes('useBoundaryReport(error, updating') })
                .toEqual({ rel, reports: true });
        }
    });

    it('AND NONE OF THEM KEEPS ITS OWN COPY OF THE RULE', () => {
        //   #717's argument about the reload half of these same files: nine
        //   copies that had drifted. One copy, so the fourteen cannot.
        for (const rel of ALL) {
            const src = code(rel);
            expect({ rel, ownSentry: src.includes('Sentry.captureException') })
                .toEqual({ rel, ownSentry: false });
            expect({ rel, ownConsole: /console\.error/.test(src) })
                .toEqual({ rel, ownConsole: false });
        }
    });

    it('AND EVERY ONE STILL PAIRS IT WITH THE STALE-DEPLOYMENT VERDICT', () => {
        /*
         *   The half that must not be lost. A ChunkLoadError after a deploy is a
         *   browser holding an old bundle, and #717's hook is already reloading
         *   the page — reporting it would fill the feed with every deploy and
         *   bury exactly the crashes this finding is about.
         */
        for (const rel of ALL) {
            const src = code(rel);
            expect({ rel, recovery: src.includes('useStaleDeploymentRecovery(error)') })
                .toEqual({ rel, recovery: true });
            //   The verdict is what is passed, so the skip cannot be forgotten.
            expect({ rel, passed: src.includes('useBoundaryReport(error, updating') })
                .toEqual({ rel, passed: true });
        }
    });

    it('AND NO BOUNDARY SHOWS A RAW MESSAGE IN PRODUCTION', () => {
        //   app/error.tsx and admin/error.tsx rendered `{error.message || ...}`
        //   unconditionally. Where a message is still rendered it must be
        //   behind the development guard global-error.tsx already used.
        for (const rel of ALL) {
            const src = code(rel);
            if (!src.includes('{error.message}') && !src.includes('error.message ||')) continue;

            expect({ rel, guarded: src.includes("process.env.NODE_ENV === 'development'") })
                .toEqual({ rel, guarded: true });
            expect({ rel, unconditional: src.includes('error.message ||') })
                .toEqual({ rel, unconditional: false });
        }
    });

    it('AND THE DIGEST — the thing support can match — IS STILL SHOWN', () => {
        //   The vacuity guard on the assertion above: deleting every mention of
        //   the error would pass it and leave the person with nothing to quote.
        for (const rel of ['src/app/error.tsx', 'src/app/admin/error.tsx']) {
            expect({ rel, digest: code(rel).includes('error.digest') })
                .toEqual({ rel, digest: true });
        }
    });
});

/*
 *   THE HOOK ITSELF, RUN. The three decisions it carries are behaviour, and a
 *   source assertion about fourteen call sites says nothing about any of them.
 */
const captureException = jest.fn();
jest.mock('@sentry/nextjs', () => ({ captureException: (...a: any[]) => (captureException as any)(...a) }));

const logTelemetryAction = jest.fn(async () => ({ error: null, success: true as const, data: null }));
jest.mock('@/app/actions/telemetry', () => ({
    logTelemetryAction: (...a: any[]) => (logTelemetryAction as any)(...a),
}));

const { useBoundaryReport } = require('@/components/shared/useBoundaryReport');

function Harness({ error, updating }: { error: any; updating: boolean }) {
    useBoundaryReport(error, updating, 'dashboard');
    return <p>rendered</p>;
}

describe('useBoundaryReport', () => {
    beforeEach(() => {
        captureException.mockClear();
        logTelemetryAction.mockClear();
    });

    it('REPORTS TO BOTH DESTINATIONS', () => {
        const error = Object.assign(new Error('boom'), { digest: 'abc123' });

        render(<Harness error={error} updating={false} />);

        expect(captureException).toHaveBeenCalledTimes(1);
        expect(captureException.mock.calls[0][0]).toBe(error);
        expect((captureException.mock.calls[0][1] as any)?.tags?.boundary).toBe('dashboard');

        expect(logTelemetryAction).toHaveBeenCalledTimes(1);
        const [level, message, payload] = logTelemetryAction.mock.calls[0] as any[];
        expect(level).toBe('error');
        expect(message).toContain('dashboard');
        expect(payload.digest).toBe('abc123');
        expect(payload.message).toBe('boom');
        expect(payload.boundary).toBe('dashboard');
    });

    it('AND SAYS NOTHING WHILE A STALE-DEPLOYMENT RELOAD IS IN FLIGHT', () => {
        //   THE test for the half that keeps the feed usable. Every deploy
         //  produces these, and they are not defects.
        render(<Harness error={new Error('ChunkLoadError')} updating={true} />);

        expect(captureException).not.toHaveBeenCalled();
        expect(logTelemetryAction).not.toHaveBeenCalled();
    });

    it('AND ONCE PER ERROR ACROSS RE-RENDERS', () => {
        //   The dep array does this half on its own — see the StrictMode case
        //   below for the half the ref is actually for.
        const error = new Error('boom');
        const { rerender } = render(<Harness error={error} updating={false} />);

        rerender(<Harness error={error} updating={false} />);
        rerender(<Harness error={error} updating={false} />);

        expect(captureException).toHaveBeenCalledTimes(1);
    });

    it('AND ONCE UNDER StrictMode, which is what the ref is for', () => {
        /*
         *   MEASURED, AND THE MUTATION LOG SAYS WHY THIS TEST EXISTS.
         *
         *   The re-render assertion above was written first and SURVIVED
         *   deleting the ref: `useEffect` with `[error, updating, boundary]`
         *   already skips a re-render whose deps have not changed, so that test
         *   agreed with the defect and with the fix alike.
         *
         *   What the ref is for is StrictMode, which mounts, unmounts and
         *   remounts every effect in development. Without it the same crash is
         *   reported twice on every developer's machine — and the whole point of
         *   this finding is that the error feed has to be worth reading.
         *   useStaleDeploymentRecovery carries a `spent` ref for exactly this,
         *   and says so.
         */
        const error = new Error('boom');

        render(
            <React.StrictMode>
                <Harness error={error} updating={false} />
            </React.StrictMode>
        );

        expect(captureException).toHaveBeenCalledTimes(1);
    });

    it('AND A SECOND, DIFFERENT ERROR IS ITS OWN REPORT', () => {
        //   The other side of that guard: a hook that reported once per mount
        //   and never again would drop the second crash on the same screen.
        const { rerender } = render(<Harness error={new Error('first')} updating={false} />);
        rerender(<Harness error={new Error('second')} updating={false} />);

        expect(captureException).toHaveBeenCalledTimes(2);
    });

    it('AND THE BOUNDARY STILL RENDERS WHEN THE REPORT CANNOT BE SENT', () => {
        /*
         *   A boundary that throws replaces the error screen with nothing, and
         *   this one runs inside the boundary. Sentry is the likelier failure —
         *   it is not initialised in every environment.
         */
        captureException.mockImplementationOnce(() => { throw new Error('sentry down'); });

        expect(() => render(<Harness error={new Error('boom')} updating={false} />)).not.toThrow();
    });
});
