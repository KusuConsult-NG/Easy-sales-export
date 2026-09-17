/**
 * @jest-environment node
 */

/**
 *   #851 THE KEY WAS SET, IN THE ONE PLACE THE BUILD COULD NOT SEE IT.
 *
 *   #836 diagnosed the production `Failed to find Server Action` failures and
 *   named the cure exactly right, in lib/env-validator:
 *
 *       "Must be set in the BUILD environment, not just on the running service"
 *
 *   The owner then said: "the encription key was set which i told you earlier."
 *   It was — as a Railway SERVICE variable, which is precisely where a runtime
 *   variable belongs. And the failure continued, through four more production
 *   logs, with a different action id each time:
 *
 *       10:22  Failed to find Server Action "7f222333500f9fe2…"
 *              Failed to find Server Action "7f183577e1306597…"   (x5)
 *       08:20  Failed to find Server Action "7f147de79a907ca8…"  (x18)
 *
 * ── WHY SETTING IT CHANGED NOTHING ──────────────────────────────────────────
 *
 *   A DOCKER BUILD DOES NOT INHERIT THE SERVICE ENVIRONMENT. Only a declared
 *   `ARG` is passed in — and the Dockerfile says so itself, above the block
 *   where twenty-six variables are declared under exactly that rule:
 *
 *       "Declare as ARG (Railway passes these from the service's environment
 *        variables during the Docker build), then export as ENV so the
 *        `next build` process can read them."
 *
 *   `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` was not one of the twenty-six. Neither
 *   was `RAILWAY_GIT_COMMIT_SHA`, which next.config's `deploymentId` resolves
 *   from — so #836's OTHER half was inert too: no `?dpl=` on assets, no
 *   `x-deployment-id` on navigations, for the whole time it was believed fixed.
 *
 *   Absent at build time, Next generates a RANDOM encryption key per build. A
 *   browser holding a page from the previous build sends a payload the running
 *   server cannot read, so every deploy breaks every open form — a member
 *   mid-application, mid-withdrawal or mid-listing, on submit.
 *
 * ── AND THE CHECK THAT EXISTED COULD NOT HAVE CAUGHT IT ─────────────────────
 *
 *   env-validator tests `process.env` at BOOT. At boot the variable is present,
 *   because the owner set it on the service. So the check passed on every
 *   container start while the build went on baking a throwaway key, and the
 *   sentence telling everyone where it really had to go sat three lines away
 *   from the test that could not enforce it.
 *
 *   A build-time requirement verified at runtime is not a weak check, it is the
 *   wrong process — the same shape as #741's assertion answered by the wrong
 *   occurrence, one layer out. The build now says so in the build log, and
 *   stamps what it saw so the boot log can say it too.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const raw = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');
const code = (rel: string) => stripComments(raw(rel), { label: rel });

/** A Dockerfile is not JavaScript — strip `#` comments, keep directives. */
const dockerfile = (): string[] =>
    raw('Dockerfile')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));

// ─────────────────────────────────────────────────────────────────────────────
describe('#851 — the build receives the variables the build needs', () => {
    const KEY = 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY';

    it('THE REPORTED CASE: the encryption key is a build ARG', () => {
        expect(dockerfile()).toContain(`ARG ${KEY}`);
    });

    it('AND IT IS EXPORTED AS ENV, or the ARG reaches nothing', () => {
        /*
         *   An ARG is visible to the Dockerfile's own instructions, NOT to a
         *   process those instructions start. `next build` reads process.env, so
         *   without the ENV line the ARG is declared, passed, and ignored — a
         *   fix that looks complete in a diff and changes nothing.
         */
        expect(dockerfile()).toContain(`ENV ${KEY}=$${KEY}`);
    });

    it('AND BOTH COME BEFORE `npm run build`, which is the only order that works', () => {
        /*
         *   Anchored on position because a variable exported after the build has
         *   run is a variable the build did not have. The Dockerfile is read top
         *   to bottom and nothing here is subtle — which is exactly why it is
         *   worth an assertion rather than an assumption.
         */
        const lines = dockerfile();
        const env = lines.indexOf(`ENV ${KEY}=$${KEY}`);
        const build = lines.findIndex((l) => l.startsWith('RUN npm run build'));

        expect(env).toBeGreaterThan(-1);
        expect(build).toBeGreaterThan(-1);
        expect(env).toBeLessThan(build);
    });

    it('AND deploymentId\'s SOURCE REACHES THE BUILD TOO — #836\'s other half', () => {
        /*
         *   next.config resolves `deploymentId` from RAILWAY_GIT_COMMIT_SHA,
         *   falling back to RAILWAY_DEPLOYMENT_ID. Neither was declared, so it
         *   evaluated to `undefined` in every build since #836 and the asset and
         *   navigation skew protection was never switched on.
         *
         *   Both are asserted, because the fallback chain is only a chain if the
         *   second link can also resolve.
         */
        const lines = dockerfile();

        for (const v of ['RAILWAY_GIT_COMMIT_SHA', 'RAILWAY_DEPLOYMENT_ID']) {
            expect({ v, arg: lines.includes(`ARG ${v}`), env: lines.includes(`ENV ${v}=$${v}`) })
                .toEqual({ v, arg: true, env: true });
        }
    });

    it('AND next.config STILL READS THE VARIABLE IT IS NOW GIVEN', () => {
        /*
         *   The half that makes the Dockerfile change meaningful. Plumbing a
         *   variable to a build that no longer consults it would satisfy every
         *   case above — this audit's most repeated false positive is a fix that
         *   reads a field nobody writes, and this is its mirror.
         */
        const cfg = code('next.config.ts');

        expect(cfg).toContain('process.env.RAILWAY_GIT_COMMIT_SHA');
        expect(cfg).toContain('process.env.RAILWAY_DEPLOYMENT_ID');
        expect(cfg).toContain(`process.env.${KEY}`);
    });

    it('AND THE RUNNER STAGE DOES NOT BAKE THE KEY INTO THE IMAGE', () => {
        /*
         *   The server needs the key at RUNTIME too, and it already has it from
         *   the platform's service variables. Copying it into the runner stage
         *   would put key material in a published image layer for no gain.
         *
         *   Asserted by position: everything after `FROM node:22-alpine AS
         *   runner` is the shipped image.
         */
        const lines = dockerfile();
        const runner = lines.findIndex((l) => /^FROM .* AS runner$/.test(l));

        expect(runner).toBeGreaterThan(-1);
        expect(lines.slice(runner).filter((l) => l.includes(KEY))).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#851 — and a build without it says so, in both logs', () => {
    it('THE BUILD LOG WARNS, from next.config, which runs during the build', () => {
        /*
         *   The only place the mistake can be corrected before an image ships.
         *   env-validator's warning reaches whoever reads a container's output,
         *   which is after the fact.
         */
        const cfg = code('next.config.ts');
        const at = cfg.indexOf('NEXT_SERVER_ACTIONS_ENCRYPTION_KEY IS NOT SET');

        expect(at).toBeGreaterThan(-1);
        expect(cfg.slice(0, at)).toContain('console.error');
    });

    it('AND IT WARNS RATHER THAN THROWS — stated, because it is a judgement', () => {
        /*
         *   Failing the build is the better failure in principle and this
         *   codebase argues so repeatedly. It is not chosen here because it
         *   cannot be tested against Railway's build environment from this
         *   sandbox, and a build that refuses where the previous one shipped a
         *   flaw would replace a broken feature with no deploys at all.
         *
         *   Pinned so that a later change to throw is a decision somebody makes,
         *   not a line somebody edits.
         */
        const cfg = code('next.config.ts');
        const block = cfg.slice(
            cfg.indexOf('if (process.env.NODE_ENV === "production"'),
            cfg.indexOf('const nextConfig'),
        );

        expect(block).toContain('console.error');
        expect(block).not.toContain('throw ');
        expect(block).not.toContain('process.exit');
    });

    it('AND THE BUILD STAMPS WHAT IT SAW, so the boot log can report it', () => {
        /*
         *   The fact the runtime cannot discover for itself. At boot the
         *   variable IS set — that is the whole trap — so only a value carried
         *   over from the build can tell the two apart.
         */
        const cfg = code('next.config.ts');

        expect(cfg).toContain('ACTIONS_KEY_AT_BUILD');
        expect(cfg).toMatch(/ACTIONS_KEY_AT_BUILD[\s\S]{0,160}"absent"/);
    });

    it('AND THE STAMP CARRIES NO KEY MATERIAL, only two words', () => {
        //   The value is inlined into the bundle at build time. "present" or
        //   "absent" is all the boot log needs and all it may safely hold.
        const cfg = code('next.config.ts');
        const at = cfg.indexOf('ACTIONS_KEY_AT_BUILD');
        const decl = cfg.slice(at, at + 200);

        expect(decl).toContain('? "present" : "absent"');
    });

    it('AND THE BOOT LOG READS THE STAMP, not process.env', () => {
        /*
         *   THE POINT OF THE WHOLE FINDING. env-validator's existing checks all
         *   test `process.env[key]`, and for this variable that answers a
         *   different question than the one its own advice asks. The new branch
         *   must read the build's stamp or it repeats the defect inside its fix
         *   — which is a thing this audit has done more than once.
         */
        const src = code('src/lib/env-validator.ts');
        const at = src.indexOf('ACTIONS_KEY_AT_BUILD');

        expect(at).toBeGreaterThan(-1);
        const branch = src.slice(at - 200, at + 900);
        expect(branch).toContain("=== 'absent'");
        expect(branch).toContain('console.error');
        //   Production only: a local `next dev` build has no deployments to skew
        //   between, and warning there would train the reader to ignore it.
        expect(branch).toContain("NODE_ENV === 'production'");
    });

    it('AND IT IS NOT ON /api/health, which is unauthenticated', () => {
        /*
         *   lib/deployment-facts states the rule that route lives by: it may
         *   carry "only facts already public in the repository". "The action
         *   payloads on this deployment are encrypted with a throwaway key" is
         *   not one of those, and /api/health is what Railway's own health check
         *   calls — it is reachable by anybody.
         */
        for (const rel of ['src/app/api/health/route.ts', 'src/lib/deployment-facts.ts']) {
            expect(code(rel)).not.toContain('ACTIONS_KEY_AT_BUILD');
        }
    });
});
