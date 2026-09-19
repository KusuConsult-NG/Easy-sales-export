/**
 * Run a repository script from a test, and survive a failure to START it.
 *
 *   #894 A FLAKY GATE REJECTED GOOD WORK, AND THE GATE IS A PUSH.
 *
 *   Three suites build or inspect the deploy SQL by spawning
 *   `node scripts/…`, two of them in `beforeAll` — so when the spawn fails the
 *   WHOLE FILE fails. Measured across full runs of the suite on an unchanged
 *   tree:
 *
 *       run 1   deploy-sql-carries-what-the-code-calls   17 tests failed
 *       run 2   the same suite, in isolation             12 tests passed
 *       run 3   the full suite again                     all 881 files passed
 *
 *   Nothing about the tree changed between them. Jest runs many workers, each
 *   spawning Node; under that load a spawn intermittently fails to start, and
 *   `execFileSync` throws before the script has run a line.
 *
 *   WHY IT IS WORTH FIXING RATHER THAN RE-RUNNING. `.husky/pre-push` runs this
 *   suite, so a spawn that fails to start REJECTS A PUSH of work that is
 *   correct — which happened to this audit's own #888/#889 commit, and cost a
 *   round trip to notice. On a platform whose owner's standing complaint is
 *   "every time we fix it, it breaks", a gate that goes red at random is worse
 *   than no gate: it teaches everybody to push past red.
 *
 * ── WHAT IS RETRIED, AND WHAT IS EMPHATICALLY NOT ───────────────────────────
 *
 *   ONLY a failure to start the process. A NON-ZERO EXIT IS RETURNED AS-IS,
 *   because in the suites that call this it is an assertion:
 *
 *       "Building it IS the first assertion: the script exits non-zero rather
 *        than emitting a file that omits a migration nobody accounted for."
 *
 *   Retrying that would turn a real refusal into three real refusals and then
 *   report it anyway — slower, and no less red. Worse, widening the retry to
 *   "any error" would hide exactly the defect the suite exists to catch. So the
 *   two cases are separated by the one signal that distinguishes them: a
 *   process that ran and exited has a numeric `status`; a process that never
 *   started does not.
 */

import { execFileSync } from "child_process";

/** How many times to try, in total. Two retries is plenty for a spawn storm. */
const ATTEMPTS = 3;

/** Grows between attempts so a busy moment has time to pass. */
const BACKOFF_MS = [150, 400];

/**
 * True when the error means "the process never ran", as distinct from "the
 * process ran and exited non-zero".
 *
 * `execFileSync` attaches a numeric `status` when the child exited on its own.
 * A spawn failure has no status and carries an errno code instead — EAGAIN and
 * ENOMEM are the ones a worker storm produces.
 */
function failedToStart(err: unknown): boolean {
    const e = err as { status?: unknown; code?: unknown } | null;
    if (!e || typeof e !== "object") return false;
    if (typeof e.status === "number") return false;

    return e.code === "EAGAIN"
        || e.code === "ENOMEM"
        || e.code === "ETXTBSY"
        || e.code === "UNKNOWN"
        || e.status === null;
}

/** Busy-wait, because the callers are synchronous by design (`beforeAll`). */
function pause(ms: number): void {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* deliberate */ }
}

export interface RunNodeScriptOptions {
    cwd: string;
    /** Default 64 MiB — the deploy SQL is large. */
    maxBuffer?: number;
}

/**
 * Run `node <script> [...args]` and return its stdout.
 *
 * Throws whatever `execFileSync` threw once the attempts are spent, so a
 * genuine failure still reports its own error rather than one invented here.
 */
export function runNodeScript(
    script: string,
    args: readonly string[],
    { cwd, maxBuffer = 64 * 1024 * 1024 }: RunNodeScriptOptions,
): string {
    let lastError: unknown;

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        try {
            return execFileSync("node", [script, ...args], {
                cwd,
                encoding: "utf-8",
                maxBuffer,
            });
        } catch (err) {
            lastError = err;
            if (!failedToStart(err)) throw err;
            if (attempt < ATTEMPTS - 1) pause(BACKOFF_MS[attempt] ?? 400);
        }
    }

    throw lastError;
}
