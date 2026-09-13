/**
 * @jest-environment node
 */

/**
 *   #703 THE RELEASE WORKFLOW CALLED A MUTATION RAILWAY DOES NOT HAVE, AND HAD
 *        NEVER DEPLOYED ANYTHING.
 *
 *   deploy-production.yml POSTed this to Railway's GraphQL API:
 *
 *       mutation { deploymentTrigger(input: { serviceId: ... }) { id } }
 *
 *   Railway answered HTTP 400:
 *
 *       Cannot query field "deploymentTrigger" on type "Mutation".
 *       Did you mean "deploymentCancel", "deploymentRemove",
 *       "deploymentRestart", "deploymentTriggerCreate", ...
 *
 *   There is no such field. Not a credential problem — the credentials check
 *   passed on the run that produced this. The call could never have worked.
 *
 * ── IT WAS INVISIBLE BECAUSE THE STEP BELIEVED ITS OWN EXIT CODE ────────────
 *
 *   The step was once a bare `curl -sS` whose exit status was the only gate. A
 *   GraphQL error comes back as HTTP 200 with an `errors` array, so curl exited
 *   0, the job went green, and the next step printed
 *   "=== PRODUCTION DEPLOYMENT TRIGGERED ===" for a deploy that never happened.
 *   The workflow's own comment records that occurring on 2026-08-09 for v1.2.0
 *   and says it "was caught by polling production by hand, which is not a
 *   control".
 *
 *   Hardening the step to check the body is what finally surfaced the real
 *   fault — a year late, and only because somebody ran it again.
 *
 * ── WHY IT IS A VERIFICATION NOW AND NOT A CORRECTED MUTATION ───────────────
 *
 *   Nothing was lost while it was broken. Railway's GitHub integration deploys
 *   `main` on push, and that is how every release has actually reached
 *   production — including every release this workflow claimed. Adding a
 *   corrected mutation would be a second way to do something that already
 *   happens automatically, and would need a guess at an API this environment
 *   cannot reach to verify.
 *
 *   So the step now asserts the thing the old comment admitted it could not:
 *
 *       "WHAT IT STILL DOES NOT ASSERT: that the build succeeded and the new
 *        revision is serving traffic. Railway accepting a trigger is not the
 *        same as production having changed."
 *
 *   It polls /api/health — which #470 gave the running commit — until
 *   production reports the commit being released, and fails if it never does.
 *   A release is not a request that was accepted; it is a revision that is
 *   answering.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { deploymentFacts } from '@/lib/deployment-facts';

/** A plausible full-length sha, of the shape `github.sha` carries. */
const FULL_SHA = '6e43cda3b1f04c7a9d2e8f5b0c1a7d3e9f4b6c2a';

const ROOT = process.cwd();
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/deploy-production.yml'), 'utf-8');

/** The workflow with its comment lines removed — the part that executes. */
const EXECUTABLE = WORKFLOW
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

/*
 *   The deploy job ALONE, because the file-wide assertions below are weaker
 *   than they look. `toContain('exit 1')` against the whole workflow is
 *   satisfied by the release gate's three `exit 1` lines, so it would hold
 *   even if the poll exited 0 on every timeout — which is precisely the
 *   defect. A check that cannot fail is its own finding in this audit; this
 *   slice is what stops this one becoming one.
 */
const DEPLOY_JOB = (() => {
    const lines = EXECUTABLE.split('\n');
    const start = lines.findIndex((l) => /^ {2}deploy-production:/.test(l));
    if (start < 0) return '';
    //   To the next job key at the same indent, or the end of the file.
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^ {2}\S/.test(l));
    return (end < 0 ? rest : rest.slice(0, end)).join('\n');
})();

describe('#703 — the release job confirms rather than assumes', () => {
    it('THE SWEEP IS READING THE WORKFLOW', () => {
        //   THE control. Every assertion below is about the contents of one
        //   file, and an empty string satisfies most of them.
        expect(WORKFLOW.length).toBeGreaterThan(2000);
        expect(EXECUTABLE).toContain('deploy-production:');
        expect(EXECUTABLE).toContain('workflow_dispatch:');
        //   And the slice found the job, rather than quietly returning ''.
        expect(DEPLOY_JOB.length).toBeGreaterThan(500);
        expect(DEPLOY_JOB).not.toContain('final-validate:');
    });

    it('IT DOES NOT CALL THE MUTATION RAILWAY REJECTED', () => {
        /*
         *   Asserted on the EXECUTABLE text, not the whole file: this finding's
         *   own header quotes the broken mutation four times to explain it, and
         *   a naive `not.toContain` would fail against the explanation rather
         *   than the code. That trap has its own entry in this audit and is met
         *   here by construction.
         */
        expect(EXECUTABLE).not.toContain('deploymentTrigger');
        expect(EXECUTABLE).not.toContain('backboard.railway.app');
    });

    it('AND IT WAITS FOR PRODUCTION TO REPORT THE RELEASED COMMIT', () => {
        //   The positive half. "Does not call Railway" is satisfied by a job
        //   that does nothing at all, which would be a worse workflow than the
        //   broken one — it would at least be honest about failing.
        /*
         *   Anchored on the CURL, not on the string appearing anywhere in the
         *   job. A mutant that pointed the poll at a different path survived a
         *   bare `toContain('/api/health')`, because the step's own failure
         *   message names the endpoint in prose — so the assertion was met by
         *   the explanation of the check rather than by the check.
         */
        expect(DEPLOY_JOB).toMatch(/curl[^\n]*\/api\/health/);
        expect(DEPLOY_JOB).toContain('RELEASE_SHA');
        expect(DEPLOY_JOB).toContain('github.sha');
        //   It compares, rather than merely fetching.
        expect(DEPLOY_JOB).toMatch(/\$serving.*=.*\$RELEASE_SHA|\$RELEASE_SHA.*=.*\$serving/);
    });

    it('AND IT FAILS WHEN PRODUCTION NEVER REPORTS IT', () => {
        /*
         *   THE property that makes this a control and not a log line. A poll
         *   that exits 0 on timeout is exactly the defect being repaired, one
         *   layer along: a step that reports success for a release that did not
         *   land.
         */
        expect(DEPLOY_JOB).toMatch(/PRODUCTION IS STILL SERVING/);
        //   And the message is FOLLOWED by a non-zero exit, not merely printed.
        //   Printing "it did not deploy" and exiting 0 is the same green light
        //   the broken step gave, with better wording.
        expect(DEPLOY_JOB).toMatch(/PRODUCTION IS STILL SERVING[\s\S]*?\n\s*exit 1\b/);
    });

    it('AND THE JOB IS NAMED FOR WHAT IT DOES', () => {
        //   It was called "Deploy to Production" for a year while deploying
        //   nothing. A name that overstates is how a red light reads as green.
        expect(EXECUTABLE).toContain('name: Confirm Production Release');
        expect(EXECUTABLE).not.toContain('name: Deploy to Production');
    });

    it('AND THE FIELD IT READS IS ONE THE HEALTH ROUTE ACTUALLY EMITS', () => {
        /*
         *   The poll pulls `.commit` out of /api/health with jq. Nothing in
         *   either file forces those two names to agree, and a rename on the
         *   route side would not break a single existing test — it would just
         *   make every future release time out after twenty minutes with
         *   "NEVER REPORTED A COMMIT", pointing whoever reads it at Railway
         *   instead of at the rename.
         *
         *   Both halves are asserted: that the workflow reads `.commit`, and
         *   that deploymentFacts() emits a `commit` holding a FULL sha — it
         *   also emits `commitShort`, and comparing a 7-character prefix
         *   against github.sha would never match.
         */
        expect(DEPLOY_JOB).toMatch(/jq[^\n]*\.commit\b/);

        const facts = deploymentFacts({ ...process.env, RAILWAY_GIT_COMMIT_SHA: FULL_SHA });
        expect(facts.commit).toBe(FULL_SHA);
    });

    it('AND THE GATE IN FRONT OF IT STILL RUNS THE FULL SUITE', () => {
        /*
         *   The release's actual safety is final-validate, not the step this
         *   finding rewrote. Pinned so that "the deploy job no longer deploys"
         *   cannot quietly become "the release no longer checks anything".
         */
        expect(EXECUTABLE).toContain('npx tsc --noEmit');
        expect(EXECUTABLE).toContain('npm run lint');
        expect(EXECUTABLE).toContain('npm test');
        expect(EXECUTABLE).toContain('needs: gate');
        expect(EXECUTABLE).toContain('needs: tag-release');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Against a green baseline (7/7). Each mutant had to PROVE its edit landed
 *   with a string found nowhere else in the file before its result was
 *   believed, and the harness restores by copying a snapshot rather than by
 *   `git checkout` — #695's harness used git, could not restore the untracked
 *   file it was mutating, and every result after the first measured wreckage.
 *
 *   M1  put `deploymentTrigger` / backboard.railway.app back    KILLED
 *   M2  poll $PRODUCTION_URL/status instead of /api/health      KILLED
 *   M3  exit 0 instead of 1 when the commit never appeared      KILLED
 *   M4  rename the job "Deploy to Production" again             KILLED
 *   M5  drop `npx tsc --noEmit` from final-validate             KILLED
 *   M6  accept ANY commit production reports, not this one      KILLED
 *   M7  jq `.commitShort` — 7 chars, can never equal github.sha KILLED
 *   M8  deploymentFacts() returns a short sha under `commit`    KILLED
 *   CONTROL  poll every 25s instead of 20s                    SURVIVED
 *
 *   The control is the point: cadence is not a property of this fix, and a
 *   suite that failed on it would be pinning the implementation rather than
 *   the behaviour.
 *
 * ── WHAT THE FIRST SWEEP CAUGHT IN THE TESTS THEMSELVES ─────────────────────
 *
 *   M2 SURVIVED the first run. `toContain('/api/health')` was satisfied by the
 *   step's own failure message, which names the endpoint in prose and is not a
 *   comment line, so the poll could have fetched anything at all. The cure was
 *   to anchor on the `curl`. This is the comment-stripping trap wearing a
 *   different hat — an assertion met by the subject's EXPLANATION of itself
 *   rather than by the subject — and it is why every finding in this audit
 *   gets a mutant before it gets a commit.
 *
 *   Found before that, by asking what M3 would do: `toContain('exit 1')` over
 *   the whole file can never fail, because the release gate contains three of
 *   them. Hence DEPLOY_JOB.
 */
