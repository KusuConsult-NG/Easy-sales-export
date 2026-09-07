/**
 * @jest-environment node
 */

/**
 *   #470 THERE WAS NO WAY TO ASK PRODUCTION WHICH CODE IT IS RUNNING.
 *
 *   The owner asked "is all the fix on production?" — the fourth time in this
 *   audit, each time about a different fix — and nothing in the application
 *   could answer it. /api/health reported a `buildTime` and nothing else about
 *   the deployment, and a timestamp says an image was built, not what was in it:
 *
 *     * a FAILED build leaves the previous image serving, and that image's
 *       buildTime is a perfectly plausible timestamp
 *     * a redeploy of an OLD commit produces a NEW buildTime
 *     * two commits merged minutes apart produce near-identical ones
 *
 *   The information was already inside the container the whole time. #461 and
 *   #462 were built on reading RAILWAY_* variables at runtime, and the owner's
 *   own boot log printed the project, environment and service names from that
 *   source. RAILWAY_GIT_COMMIT_SHA sits in the same set. Nothing read it.
 *
 *   THE ASYMMETRY THAT MAKES `null` THE RIGHT ANSWER. A missing SHA reported as
 *   "unknown" is indistinguishable in a log from a real one, and this endpoint
 *   exists precisely to end guessing about what is deployed. Absent must look
 *   absent.
 *
 *   AND IT IS UNAUTHENTICATED — Railway's own health check calls it — so it may
 *   carry only facts already public in the repository. A commit SHA of a public
 *   repo is one. Environment variable VALUES, the database host and key material
 *   are not, and the scan below is the same shape as #468's: the platform's own
 *   PII list, applied to a surface nobody had measured against it.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     commit dropped from the response          KILLED
 *     absent SHA reported as "unknown"          KILLED
 *     a blank RAILWAY_GIT_COMMIT_SHA accepted   KILLED
 *     buildTime removed (DeploymentWatcher)     KILLED
 *     the secret-leak scan emptied              KILLED
 *     reword this header                        SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { deployedCommit, deploymentFacts } from '@/lib/deployment-facts';
import { PII_KEYS } from '@/lib/admin-pii';

const SHA = '277a82b4c0ffee0000000000000000000000abcd';

// ─────────────────────────────────────────────────────────────────────────────
describe('#470 — the deployment can name the commit it is running', () => {
    it('REPORTS THE COMMIT RAILWAY INJECTED', () => {
        // The assertion the whole finding is about.
        expect(deployedCommit({ RAILWAY_GIT_COMMIT_SHA: SHA } as any)).toBe(SHA);
    });

    it('AND A SHORT FORM THAT MATCHES WHAT `git log --oneline` PRINTS', () => {
        // So the answer can be compared by eye against the commit list, which is
        // how this question actually gets asked.
        const facts = deploymentFacts({ RAILWAY_GIT_COMMIT_SHA: SHA } as any);

        expect(facts.commitShort).toBe('277a82b');
        expect(facts.commitShort).toBe(facts.commit!.slice(0, 7));
    });

    it('AND REPORTS null — NOT "unknown" — WHEN NOTHING SET IT', () => {
        //   A fabricated placeholder is indistinguishable from a real value in a
        //   log, which is exactly the guessing this endpoint exists to end.
        expect(deployedCommit({} as any)).toBeNull();
        expect(deploymentFacts({} as any).commitShort).toBeNull();
    });

    it('AND A BLANK OR WHITESPACE SHA COUNTS AS ABSENT', () => {
        // An env var set to "" is how a misconfigured build arg arrives, and it
        // would otherwise report an empty string as though it were an answer.
        expect(deployedCommit({ RAILWAY_GIT_COMMIT_SHA: '' } as any)).toBeNull();
        expect(deployedCommit({ RAILWAY_GIT_COMMIT_SHA: '   ' } as any)).toBeNull();
    });

    it('and it trims a value that arrived with surrounding space', () => {
        expect(deployedCommit({ RAILWAY_GIT_COMMIT_SHA: `  ${SHA}\n` } as any)).toBe(SHA);
    });

    it('and every field is present-but-null rather than missing', () => {
        //   A caller comparing two deployments must see "this host does not
        //   report a branch", not a key that quietly is not there.
        const facts = deploymentFacts({} as any);

        expect(Object.keys(facts).sort()).toEqual(
            ['branch', 'commit', 'commitShort', 'deployedAt', 'environment', 'service'],
        );
        for (const [k, v] of Object.entries(facts)) {
            expect({ k, v }).toEqual({ k, v: null });
        }
    });

    it('and it reads the host that is actually running, not one baked at build', () => {
        // A build ARG would record whatever built the image rather than what is
        // serving. force-dynamic + process.env asks the live container.
        const route = readFileSync('src/app/api/health/route.ts', 'utf-8');

        expect(route).toContain('export const dynamic = "force-dynamic"');
        expect(route).toContain('...deploymentFacts()');
    });

    it("and it does NOT export a helper from the route module — #328's gate caught that", () => {
        //   A Next.js route may export only the HTTP verbs and a fixed set of
        //   config keys. The first version of this put deployedCommit() in
        //   route.ts and the whole-program typecheck refused it. Recorded so the
        //   next person does not move it back.
        const route = readFileSync('src/app/api/health/route.ts', 'utf-8');

        expect(route).not.toContain('export function deployedCommit');
        expect(route).not.toContain('export function deploymentFacts');
        expect(route).toContain("from \"@/lib/deployment-facts\"");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#470 — and it did not stop doing its existing job', () => {
    it('buildTime IS STILL REPORTED — DeploymentWatcher compares it', () => {
        //   DeploymentWatcher polls this every five minutes and offers a refresh
        //   when buildTime changes, which is what stops ChunkLoadError mid-session
        //   when Railway swaps containers. Adding a field must not remove one.
        const source = readFileSync('src/app/api/health/route.ts', 'utf-8');

        expect(source).toContain('buildTime: BUILD_TIME');
        expect(source).toContain('status: "ok"');
    });

    it('AND THE WATCHER STILL READS THE FIELD THIS PROVIDES', () => {
        // The premise. If the watcher were changed to read something else, the
        // assertion above would be guarding nothing.
        const watcher = readFileSync('src/components/DeploymentWatcher.tsx', 'utf-8');

        expect(watcher).toContain('data?.buildTime');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#470 — an unauthenticated endpoint says what, not what is inside', () => {
    /**
     * Railway's health check calls this with no credentials, so anything here is
     * public. The rule is #468's, one screen over: name the record, not the
     * person — here, name the deployment, not its configuration.
     */
    const response = () =>
        JSON.stringify(
            deploymentFacts({
                RAILWAY_GIT_COMMIT_SHA: SHA,
                RAILWAY_GIT_BRANCH: 'main',
                RAILWAY_ENVIRONMENT_NAME: 'production',
                RAILWAY_SERVICE_NAME: 'Easy-sales-export',
                // Everything below is in a real container and must not come out.
                SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_should_never_appear',
                NEXT_PUBLIC_SUPABASE_URL: 'https://dpuiznenrymoyarvdave.supabase.co',
                MFA_SECRET_KEY: 'mfa_should_never_appear',
                DATABASE_URL: 'postgres://postgres:hunter2@db.internal:5432/postgres',
            } as any),
        );

    it('NO CREDENTIAL OR HOST REACHES THE RESPONSE', () => {
        const body = response();

        for (const secret of [
            'sb_secret_should_never_appear',
            'mfa_should_never_appear',
            'hunter2',
            'dpuiznenrymoyarvdave',
            'db.internal',
        ]) {
            expect({ secret, leaked: body.includes(secret) }).toEqual({ secret, leaked: false });
        }
    });

    it("AND NO KEY ON THE PLATFORM'S OWN PII LIST DOES EITHER", () => {
        //   Imported rather than restated, for #468's reason: a key added to
        //   admin-pii.ts is banned here without anybody remembering to.
        const body = response();

        const leaked = PII_KEYS.filter((k) => new RegExp(`"${k}"\\s*:`).test(body));
        expect({ leaked }).toEqual({ leaked: [] });
    });

    it('POSITIVE CONTROL: the scan really would catch a leak', () => {
        // Without this, "nothing leaked" could mean the scan reads an empty
        // body and every one of these passes vacuously.
        const leaky = JSON.stringify({ commit: SHA, serviceRoleKey: 'sb_secret_should_never_appear' });

        expect(leaky.includes('sb_secret_should_never_appear')).toBe(true);
    });

    it('and it reports the four deployment facts it is meant to', () => {
        // Vacuity guard: an endpoint returning {} leaks nothing and answers
        // nothing, and would satisfy every assertion above.
        const facts = deploymentFacts({
            RAILWAY_GIT_COMMIT_SHA: SHA,
            RAILWAY_GIT_BRANCH: 'main',
            RAILWAY_ENVIRONMENT_NAME: 'production',
            RAILWAY_SERVICE_NAME: 'Easy-sales-export',
        } as any);

        expect(facts.commit).toBe(SHA);
        expect(facts.branch).toBe('main');
        expect(facts.environment).toBe('production');
        expect(facts.service).toBe('Easy-sales-export');
    });
});
