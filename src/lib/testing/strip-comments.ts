/**
 * Strip comments from TypeScript source, for the structural tests that read it.
 *
 * 147 test suites carry their own copy of this:
 *
 *     src.replace(/\/\*[\s\S]*?\*\//g, '')   then drop the `//` lines
 *
 * It has two traps, and BOTH were hit for real during this audit.
 *
 * TRAP 1 — A URL IS A BLOCK COMMENT OPENER
 * ----------------------------------------
 * lib/csp.ts's allow-list contains wildcard hosts:
 *
 *     "https://*.firebaseio.com",
 *
 * The `//*` in that string is `/*` to a regex that does not know about strings.
 * So stripping csp.ts opened a comment inside a string literal and consumed
 * everything up to the next `*​/` — the naive stripper returned essentially an
 * empty file.
 *
 * That was caught, but only by luck: the assertion was a toContain, which fails
 * loudly on a gutted file. A `not.toContain` would have PASSED, for entirely the
 * wrong reason, and reported that a dangerous pattern was absent from a file it
 * had just deleted.
 *
 * TRAP 2 — CODE INSIDE A REAL COMMENT LOOKS LIVE
 * ----------------------------------------------
 * admin/_legacy.ts opens a block comment at line 33 —
 * `/* Original implementation below (deprecated ...` — that closes 120 lines
 * later. A `hasAdminPermission(..., "users:create")` call sits at line 42,
 * inside it. Reading the raw file, that call looks like the live guard. It is
 * not; the live one is at line 180.
 *
 * The stripper was RIGHT and the reading was wrong, which is the useful lesson:
 * assert against stripped source, not raw, whenever the question is "does this
 * code do X".
 *
 * WHAT THIS DOES DIFFERENTLY
 * --------------------------
 * It scans character by character with three states — code, string, comment —
 * so a `/*` inside a string is a `/*` inside a string. Then it FAILS LOUD if the
 * result is degenerate, because the failure mode that matters is not a wrong
 * answer, it is a confident empty one feeding a `not.toContain`.
 */

/** Thrown when stripping destroyed the file rather than its comments. */
export class StripperAteTheFileError extends Error {}

export interface StripOptions {
    /** Named in the error, so a failure says which file. */
    label?: string;
    /**
     * Also refuse a result that kept less than this share of the input's
     * non-blank lines.
     *
     * OFF by default, and that is a correction. The first version of this module
     * used a 0.2 ratio as the only guard, and its own test caught the problem: a
     * legitimately doc-heavy file trips it. This repository is full of them —
     * land-listing-status.ts keeps 80 code lines out of 309, csv-safe.ts keeps
     * 12 out of 72, and several modules written during this audit are more prose
     * than code by design. A guard that fires on good input gets switched off,
     * and then guards nothing.
     *
     * The default guard below needs no ratio: it asks whether the input
     * contained statements and the output contains none, which a doc-only file
     * never satisfies.
     */
    minRetainedRatio?: number;
}

/**
 * Remove line and block comments, leaving string literals untouched.
 *
 * Handles: '…', "…", `…` (including ${…} nesting one level, which is all this
 * codebase's template literals need), escapes, and comment markers inside any
 * of them.
 */
export function stripCommentsRaw(src: string): string {
    let out = "";
    let i = 0;
    const n = src.length;

    while (i < n) {
        const c = src[i];
        const next = src[i + 1];

        // ── string literals: copied verbatim ────────────────────────────────
        if (c === '"' || c === "'" || c === "`") {
            const quote = c;
            out += c;
            i++;
            while (i < n) {
                if (src[i] === "\\") {           // escape: take both characters
                    out += src[i] + (src[i + 1] ?? "");
                    i += 2;
                    continue;
                }
                if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
                    // A template hole holds CODE, so comments inside it are real
                    // comments. Depth-counted rather than regexed.
                    out += "${";
                    i += 2;
                    let depth = 1;
                    let hole = "";
                    while (i < n && depth > 0) {
                        if (src[i] === "{") depth++;
                        else if (src[i] === "}") { depth--; if (depth === 0) break; }
                        hole += src[i];
                        i++;
                    }
                    out += stripCommentsRaw(hole) + "}";
                    i++;                          // the closing brace
                    continue;
                }
                out += src[i];
                if (src[i] === quote) { i++; break; }
                i++;
            }
            continue;
        }

        // ── comments: dropped, newlines kept so line numbers survive ────────
        if (c === "/" && next === "/") {
            while (i < n && src[i] !== "\n") i++;
            continue;
        }
        if (c === "/" && next === "*") {
            i += 2;
            while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
                if (src[i] === "\n") out += "\n";
                i++;
            }
            i += 2;
            continue;
        }

        out += c;
        i++;
    }

    return out;
}

const nonBlank = (s: string): number => s.split("\n").filter((l) => l.trim().length > 0).length;
const statements = (s: string): number => (s.match(/;/g) ?? []).length;

/** Below this many semicolons, the input is prose and there is nothing to lose. */
const CODE_EVIDENCE = 5;

/**
 * stripCommentsRaw, plus a refusal to hand back a gutted file.
 *
 * This is what a test should call. The throw is the point: a structural
 * assertion against an accidentally-empty string is a silent false pass, and
 * this audit's whole method rests on those assertions meaning something.
 *
 * THE GUARD IS "HAD STATEMENTS, HAS NONE", NOT A RATIO
 * ----------------------------------------------------
 * The dangerous outcome is total destruction — the naive stripper turned
 * lib/csp.ts into two dots — and that shows up as an input full of semicolons
 * producing an output with none. A doc-only file never satisfies it, because a
 * file with no statements had none to lose. See minRetainedRatio for why the
 * ratio it replaces was the wrong instrument.
 */
export function stripComments(src: string, options: StripOptions = {}): string {
    const { minRetainedRatio = 0, label } = options;

    const result = stripCommentsRaw(src);

    const had = statements(src);
    const has = statements(result);
    if (had >= CODE_EVIDENCE && has === 0) {
        throw new StripperAteTheFileError(
            `Stripping ${label ?? "the source"} removed every statement: the input had ${had} `
            + `semicolon(s) and the result has none. That is a stripper failure, not a `
            + `comment-heavy file. An assertion against this string would pass or fail for the `
            + `wrong reason — most dangerously a not.toContain, which would report a pattern `
            + `absent from a file that had been deleted.`,
        );
    }

    if (minRetainedRatio > 0) {
        const before = nonBlank(src);
        const after = nonBlank(result);
        if (before > 0 && after / before < minRetainedRatio) {
            throw new StripperAteTheFileError(
                `Stripping ${label ?? "the source"} left ${after} of ${before} non-blank line(s), `
                + `below the ${(minRetainedRatio * 100).toFixed(0)}% floor this caller asked for.`,
            );
        }
    }

    return result;
}
