/**
 * What the running container can say about which code it is running.
 *
 *   #470 THERE WAS NO WAY TO ASK PRODUCTION WHICH CODE IT IS RUNNING.
 *
 *   The owner asked "is all the fix on production?" — the fourth time in this
 *   audit, each time about a different fix — and nothing in the application
 *   could answer it. /api/health reported a `buildTime` and nothing else about
 *   the deployment, and a timestamp says an image was BUILT, not what was in it:
 *
 *     * a FAILED build leaves the previous image serving, and that image's
 *       buildTime is a perfectly plausible timestamp
 *     * a redeploy of an OLD commit produces a NEW buildTime
 *     * two commits merged minutes apart produce near-identical ones
 *
 *   So the only way to answer was to read the Railway dashboard and trust it
 *   matched. The information was inside the container the whole time: #461 and
 *   #462 were built on reading RAILWAY_* variables at runtime, and the owner's
 *   own boot log printed the project, environment and service names from that
 *   source. RAILWAY_GIT_COMMIT_SHA sits in the same set. Nothing read it.
 *
 *   READ AT RUNTIME, NOT BAKED AT BUILD TIME. A build ARG would have to be
 *   plumbed through the Dockerfile and — worse — would record whatever BUILT the
 *   image rather than what is serving. Reading process.env from a force-dynamic
 *   route asks the live container.
 *
 *   THIS LIVES HERE RATHER THAN IN THE ROUTE because a Next.js route module may
 *   export only the HTTP verbs and a fixed set of config keys; exporting a
 *   helper from it fails the typecheck that #328 put over the whole program.
 *   That gate caught it.
 */

/**
 * The commit this container is running, as far as the container can tell.
 *
 * `null` rather than a guess when nothing set it: running locally, or on a host
 * that is not Railway. A fabricated "unknown" is indistinguishable from a real
 * value in a log, which is exactly the guessing this exists to end.
 */
export function deployedCommit(env: NodeJS.ProcessEnv = process.env): string | null {
    const sha =
        env.RAILWAY_GIT_COMMIT_SHA ||
        env.VERCEL_GIT_COMMIT_SHA ||
        env.GIT_COMMIT_SHA ||
        env.SOURCE_COMMIT;

    return typeof sha === "string" && sha.trim().length > 0 ? sha.trim() : null;
}

/**
 * What the deployment says about itself.
 *
 * Every field is null when absent rather than omitted, so a caller comparing
 * two deployments sees "this host does not report a branch" instead of a key
 * that quietly is not there.
 *
 * WHAT IS DELIBERATELY NOT HERE. No environment variable values, no database
 * host, no key material. /api/health is UNAUTHENTICATED — Railway's own health
 * check calls it — so it may carry only facts already public in the repository.
 * A commit SHA of a public repo is one; the shape of the deployment is not.
 * #468's rule, one screen over: name the record, not what is inside it.
 */
export function deploymentFacts(env: NodeJS.ProcessEnv = process.env) {
    const commit = deployedCommit(env);

    return {
        commit,
        commitShort: commit ? commit.slice(0, 7) : null,
        branch: env.RAILWAY_GIT_BRANCH || env.VERCEL_GIT_COMMIT_REF || null,
        environment: env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT || null,
        service: env.RAILWAY_SERVICE_NAME || null,
        deployedAt: env.RAILWAY_DEPLOYMENT_CREATED_AT || null,
    };
}
