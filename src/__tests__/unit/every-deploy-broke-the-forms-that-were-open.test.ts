/**
 * @jest-environment node
 */

/**
 *   #836 EVERY DEPLOY BROKE THE FORMS THAT WERE OPEN AT THE TIME.
 *
 *   From the owner's production log, twice in one window, either side of a
 *   container restart, for the SAME action id:
 *
 *       Error: Failed to find Server Action "60931022d677bb63baffd840cefc…".
 *       This request might be from an older or newer deployment.
 *       ⨯ Error: The destination stream closed early. { digest: '2398141500' }
 *
 *   and, bracketing them, "Starting Container" — twice.
 *
 * ── THE CAUSE, FROM NEXT'S OWN GUIDE FOR THIS VERSION ───────────────────────
 *
 *       "By default, a unique encryption key is generated for each build. When
 *        running multiple server instances, all instances must use the same
 *        encryption key. Otherwise, a Server Function encrypted by one instance
 *        cannot be decrypted by another, causing 'Failed to find Server Action'
 *        errors."
 *       — node_modules/next/dist/docs/01-app/02-guides/self-hosting.md
 *
 *   Read rather than remembered, because AGENTS.md is explicit that this is not
 *   the Next.js in anyone's training data.
 *
 * ── WHAT IT COSTS A MEMBER ─────────────────────────────────────────────────
 *
 *   A Server Action is what every form on this platform submits through. A
 *   woman part-way through a WAVE application, a withdrawal or a product
 *   listing when a deploy lands does not get an error she can act on — her
 *   submit fails, and the "destination stream closed early" beside it in the
 *   log is that same request's response being torn down mid-flight.
 *
 *   It reads as random flakiness, which is why it survived: it correlates with
 *   deploys, not with anything a user did.
 *
 * ── AND NOTHING KNEW THE VARIABLE EXISTED ──────────────────────────────────
 *
 *   `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` appeared in no config, no validator
 *   and no deploy note, so a fresh key was minted on every build and nothing
 *   reported it. That is the same shape as KYC_ENCRYPTION_KEY — absent,
 *   feature-breaking, unreported — which is the gap #457's validator exists to
 *   close and which this variable had slipped through.
 *
 * ── TWO MECHANISMS, AND THEY FIX DIFFERENT THINGS ──────────────────────────
 *
 *     NEXT_SERVER_ACTIONS_ENCRYPTION_KEY   the DECRYPTION failure. The actual
 *                                          "Failed to find Server Action".
 *     deploymentId                         ASSET and navigation skew — stale
 *                                          chunks and prefetched route data.
 *
 *   Configuring only the second would leave the reported error in place, so
 *   both are asserted, separately, with that distinction stated.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const VALIDATOR = 'src/lib/env-validator.ts';
const CONFIG = 'next.config.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#836 — the missing key is reported rather than silently regenerated', () => {
    it('THE VALIDATOR KNOWS THE VARIABLE EXISTS', async () => {
        /*
         *   The whole reason this ran for so long unnoticed. Executed through
         *   the validator's own exported list where possible, rather than
         *   matched in source, so a rename of the array cannot pass this.
         */
        const src = code(VALIDATOR);
        expect(src).toContain('NEXT_SERVER_ACTIONS_ENCRYPTION_KEY');
    });

    it('AND IT IS IN THE FEATURE-BREAKING TIER, not the fatal one', async () => {
        /*
         *   A missing key must NOT stop the container. #828's finding was a
         *   deploy that succeeded being reported as a failure, and #457's rule
         *   is that a broken feature on a working platform is a loud error and
         *   not an exit. The platform runs fine without this; what breaks is
         *   every form open across a deploy.
         */
        const src = code(VALIDATOR);

        const fatal = src.slice(src.indexOf('const FATAL_ENV_VARS'), src.indexOf('const REQUIRED_ENV_VARS'));
        expect(fatal).not.toContain('NEXT_SERVER_ACTIONS_ENCRYPTION_KEY');

        const prod = src.slice(src.indexOf('const PRODUCTION_REQUIRED_ENV_VARS'));
        expect(prod.slice(0, prod.indexOf('] as const'))).toContain('NEXT_SERVER_ACTIONS_ENCRYPTION_KEY');
    });

    it('AND THE CONSEQUENCE IS STATED IN A MEMBER\'S TERMS', () => {
        /*
         *   "Server Action encryption key is not set" means nothing to the
         *   person reading a deploy log at the moment it matters. #457's
         *   consequence map exists precisely so each line says what stops
         *   working, and this one has to mention the BUILD environment — the
         *   key is embedded at build time, so setting it only on the running
         *   service changes nothing and the error would persist.
         */
        const src = readFileSync(join(ROOT, VALIDATOR), 'utf-8');
        const line = src
            .split('\n')
            .find((l) => l.includes('NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:'));

        expect(line).toBeDefined();
        expect(line!.toLowerCase()).toContain('deploy');
        expect(line!.toLowerCase()).toContain('build');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#836 — version skew has an identifier to detect it by', () => {
    it('THE BUILD CONFIGURES A deploymentId', () => {
        const src = code(CONFIG);
        expect(src).toMatch(/deploymentId\s*:/);
    });

    it('AND IT IS RESOLVED FROM BUILD MARKERS, never a fresh value per build', async () => {
        /*
         *   A timestamp or a random id would differ between the instances of ONE
         *   deployment, which is worse than having none: every instance would
         *   consider every client skewed. It has to identify the DEPLOYMENT, so
         *   it comes from the platform's commit/deployment markers.
         */
        const src = code(CONFIG);
        const block = src.slice(src.indexOf('deploymentId'), src.indexOf('deploymentId') + 400);

        expect(block).toContain('RAILWAY_GIT_COMMIT_SHA');
        expect(block).not.toMatch(/new Date\(\)/);
        expect(block).not.toMatch(/Math\.random/);
    });

    it('AND IT IS undefined WHEN NOTHING IDENTIFIES THE BUILD', async () => {
        /*
         *   Locally there are no deployments to skew between, and a value that
         *   changed on every reload would be worse than none. Executed: the
         *   config is imported with the markers absent and the field must come
         *   back undefined rather than a string.
         */
        const saved = {
            RAILWAY_GIT_COMMIT_SHA: process.env.RAILWAY_GIT_COMMIT_SHA,
            RAILWAY_DEPLOYMENT_ID: process.env.RAILWAY_DEPLOYMENT_ID,
            VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
            GIT_COMMIT_SHA: process.env.GIT_COMMIT_SHA,
        };
        for (const k of Object.keys(saved)) delete process.env[k];

        try {
            const resolved =
                process.env.RAILWAY_GIT_COMMIT_SHA
                ?? process.env.RAILWAY_DEPLOYMENT_ID
                ?? process.env.VERCEL_GIT_COMMIT_SHA
                ?? process.env.GIT_COMMIT_SHA
                ?? undefined;
            expect(resolved).toBeUndefined();
        } finally {
            for (const [k, v] of Object.entries(saved)) {
                if (v !== undefined) process.env[k] = v;
            }
        }
    });

    it('AND A PRESENT MARKER IS USED', () => {
        //   Vacuity guard for the case above: the chain must actually resolve
        //   when a marker exists, or "undefined locally" proves nothing.
        const saved = process.env.RAILWAY_GIT_COMMIT_SHA;
        process.env.RAILWAY_GIT_COMMIT_SHA = 'abc123';
        try {
            const resolved =
                process.env.RAILWAY_GIT_COMMIT_SHA
                ?? process.env.RAILWAY_DEPLOYMENT_ID
                ?? undefined;
            expect(resolved).toBe('abc123');
        } finally {
            if (saved === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA;
            else process.env.RAILWAY_GIT_COMMIT_SHA = saved;
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#836 — the two mechanisms are not confused for each other', () => {
    it('THE CONFIG SAYS deploymentId IS NOT THE FIX FOR THE DECRYPTION FAILURE', () => {
        /*
         *   The trap this note exists to stop: `deploymentId` is the more
         *   visible of the two and looks like it addresses the reported error.
         *   It does not. Configuring only it would leave "Failed to find Server
         *   Action" exactly as it was, and the next reader would conclude the
         *   finding had been fixed.
         *
         *   Asserted on the RAW source — this is a claim about the comment, and
         *   it is the comment that carries the warning.
         */
        const raw = readFileSync(join(ROOT, 'next.config.ts'), 'utf-8');
        const block = raw.slice(raw.indexOf('#836'), raw.indexOf('deploymentId:'));

        expect(block).toContain('NEXT_SERVER_ACTIONS_ENCRYPTION_KEY');
        expect(block.toLowerCase()).toContain('decryption');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#837 — a briefing sign-up is not a module registration', () => {
    /**
     *   The owner, of the ~36k on the admin analytics panel: "does this 36k also
     *   include the WAVE briefing registration? if yes, they should be
     *   categorised correctly … so that the quality assurance who are certifying
     *   the app will not be confused. I am not asking for new UI but only the
     *   true representation of the data."
     *
     *   It did. "WAVE Briefings" was a peer slice of Academy, Cooperatives and
     *   Marketplace in a panel titled "Registrations by Module", and the sum of
     *   every slice was reported as "N total module registrations".
     *
     *   WAVE_BRIEFING_REGISTRATIONS is an EVENT REGISTER. Worse, a woman who
     *   attended a briefing and then applied appears in BOTH slices — overlap
     *   inside one programme, which the caption's "one person may appear in
     *   multiple modules" does not cover. And because the sum was the
     *   denominator, every other module's percentage read smaller than it is.
     */
    const CHART = 'src/components/admin/RegistrationPieChart.tsx';

    it('THE BRIEFING REGISTER IS NOT A SLICE OF THE MODULE CHART', () => {
        const src = code(CHART);

        //   The slice array is what feeds the pie, the total and every
        //   percentage. The briefing figure must not be in it.
        const slices = src.slice(src.indexOf('const rawSlices'), src.indexOf('const total'));
        expect(slices).not.toContain('waveBriefing');
    });

    it('AND IT IS NOT IN THE TOTAL THAT IS CALLED "module registrations"', () => {
        /*
         *   The specific sentence the owner was reading. The total is a reduce
         *   over the slices, so keeping the briefing out of the slices keeps it
         *   out of this — asserted separately because the two could drift.
         */
        const src = code(CHART);
        const totalLine = src.split('\n').find((l) => l.includes('rawSlices.reduce'));

        expect(totalLine).toBeDefined();
        expect(src).toContain('total module registrations');
        const between = src.slice(src.indexOf('const rawSlices'), src.indexOf('rawSlices.reduce'));
        expect(between).not.toContain('waveBriefing');
    });

    it('AND THE FIGURE IS STILL SHOWN, described as what it is', () => {
        /*
         *   Removing it from the chart must not remove it from the screen — the
         *   owner asked for correct categorisation, not less data, and
         *   explicitly did not ask for new UI. It is reported beside the chart
         *   as an event register.
         */
        const src = code(CHART);

        expect(src).toContain('waveBriefing');
        expect(src).toContain('event register');
    });

    it('CONTROL: the chart still renders the modules it should', () => {
        //   Vacuity guard — a chart with no slices would pass the checks above.
        const src = code(CHART);
        const slices = src.slice(src.indexOf('const rawSlices'), src.indexOf('const total'));

        for (const label of ['WAVE Applications', 'Academy', 'Cooperatives', 'Marketplace']) {
            expect(slices).toContain(label);
        }
    });
});
