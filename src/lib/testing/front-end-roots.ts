/**
 * Where the front end lives, for the sweeps that scan it.
 *
 *   #741 THREE RATCHETS EACH SAID "THE COUNT IS ZERO, EXACTLY", AND EACH
 *        COUNTED ONLY THE HALF OF THE FRONT END UNDER src/app.
 *
 *   #597 (hand-written date formatters), #598 (`.toLocaleString()` on a stored
 *   field) and #599 (hand-written humanisers) are three of this audit's better
 *   instruments: each states a CLASS rather than a list, sweeps for it, and
 *   asserts the count is exactly zero.
 *
 *   All three walked `src/app`. React components live in `src/components` —
 *   109 `.tsx` files at the time of writing — and that directory was outside
 *   every one of the three walks. They found, between them, 22 live sites there.
 *
 * ── WHY THE VACUITY GUARDS DID NOT CATCH IT ─────────────────────────────────
 *
 *   Each scan already carried the right instinct. #597's says it outright:
 *
 *       "At zero, a scan pointed at the wrong directory is indistinguishable
 *        from a fixed codebase, so the walk has to have read something."
 *
 *   — and then checks `lastSeen > 100`. `src/app` alone holds 426 `.tsx` files,
 *   so the guard is satisfied with `src/components` entirely missing. A guard
 *   against reading NOTHING is not a guard against reading only SOME.
 *
 *   So the roots are named here once, and `walkedRoots` reports what a scan
 *   actually opened, so a sweep can assert it reached each of them by name
 *   instead of counting files.
 *
 * ── WHAT THIS IS AND IS NOT ─────────────────────────────────────────────────
 *
 *   The front end that RENDERS: pages, layouts and the components they mount.
 *   Not `src/lib`, `src/services` or `src/app/api` — those do not produce JSX,
 *   and a rule about what a render throws on does not apply to them. A sweep
 *   that wants those walks its own root, deliberately.
 *
 *   `src/contexts` and `src/hooks` were probed when this was written and hold
 *   no JSX rendering of stored fields. They are NOT in the list, because a root
 *   nobody has checked is how `src/components` came to be missing from three
 *   sweeps at once — the list names what has been looked at.
 */

import { readdirSync, statSync } from "fs";
import { join } from "path";

/** Every directory that produces rendered output, relative to the repo root. */
export const FRONT_END_ROOTS: readonly string[] = ["src/app", "src/components"];

export interface FrontEndFile {
    /** Repo-relative path, forward-slashed. */
    rel: string;
    /** Absolute path, for reading. */
    full: string;
    /** Which entry of FRONT_END_ROOTS this file came from. */
    root: string;
}

/**
 * Every `.tsx` file under every front-end root.
 *
 * One walk for all of them, so widening the front end is one edit rather than
 * one edit per sweep — which is the state that produced this finding.
 */
export function frontEndFiles(repoRoot: string): FrontEndFile[] {
    const out: FrontEndFile[] = [];
    for (const root of FRONT_END_ROOTS) {
        const base = join(repoRoot, root);
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) {
                    if (entry === "__tests__" || entry === "node_modules") continue;
                    walk(full);
                } else if (entry.endsWith(".tsx")) {
                    out.push({ rel: full.slice(repoRoot.length + 1).split("\\").join("/"), full, root });
                }
            }
        };
        walk(base);
    }
    return out;
}

/**
 * The roots a scan actually reached, derived from the files it read.
 *
 * This is the assertion that would have failed in 2024: a sweep checks that
 * every root in FRONT_END_ROOTS appears here, which a file COUNT cannot tell
 * it, because one large root drowns out a missing small one.
 */
export function walkedRoots(files: readonly FrontEndFile[]): string[] {
    return [...new Set(files.map((f) => f.root))].sort();
}
