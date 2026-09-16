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
 * TRAP 3 — AN APOSTROPHE INSIDE A REGEX IS NOT A STRING
 * -----------------------------------------------------
 *   #827, AND IT WAS IN THIS FILE, WHICH IS THE PART THAT MATTERS.
 *
 * The three states below were code, string and comment. There was no state for
 * a REGEX LITERAL — so in
 *
 *     .regex(/^[a-zA-Z\s\-']+$/, "Name can only contain letters…")
 *
 * the `'` inside the character class opened a phantom string, and every comment
 * from there to the next apostrophe in the file came back UNSTRIPPED. Measured:
 * `'`, `"` and `` ` `` inside a regex all do it; a `/*` inside a regex does
 * not, and neither does division.
 *
 * TWENTY-ONE production files were affected, including lib/security.ts,
 * lib/utils.ts, lib/sms-utils.ts — and three of this codebase's own scanners,
 * find-vacuous-tests, paystack-checkout-scan and route-link-scan. Every
 * structural assertion reading one of them had been reading its prose as code.
 *
 * IT COST A REAL NUMBER. orphaned-actions-are-triaged pins the count of
 * unreachable server actions, and a `@deprecated` comment in lib/schemas.ts
 * naming `submitWaveApplicationAction` leaked through as an identifier — so
 * that action counted as CALLED, by a comment saying nothing calls it. The
 * suite's own note records a hand-rolled stripper disagreeing and says "the
 * real stripper wins". The hand-rolled one was right.
 *
 * AND THE GUARD COULD NOT HAVE CAUGHT IT, because it only asks whether the
 * result is EMPTY. This failure leaves too MUCH, not too little — a file longer
 * than it should be, full of prose presented as code, and perfectly plausible.
 *
 * AND THE SAME DESYNC HAS A SECOND SOURCE, found while fixing the first: JSX
 * TEXT. `<p>We don't just export products.</p>` is English, and the apostrophe
 * in it opens a phantom string exactly as the one in the regex did. Forty-three
 * files in this repository contain one. That cannot be resolved by a scanner
 * without a real JSX parser, so it is BOUNDED instead — see the resync below.
 *
 * WHAT THIS DOES DIFFERENTLY
 * --------------------------
 * It scans character by character with four states — code, string, regex,
 * comment — so a `/*` inside a string is a `/*` inside a string and a `'`
 * inside a regex is a `'` inside a regex.
 *
 * And it RESYNCS. A `'…'` or `"…"` literal cannot cross a newline, so when the
 * scan finds itself inside one at a line break it abandons the string rather
 * than believing it to the end of the file. That is what turns "one apostrophe
 * compromised everything below it" into "one apostrophe compromised the rest of
 * its own line", and it is the half of this fix that applies to the JSX case
 * too. The failure is reported through StripDiagnostics; failOnRunawayString
 * says why raising it is opt-in.
 */

/** Thrown when stripping destroyed the file rather than its comments. */
export class StripperAteTheFileError extends Error {}

/**
 * The same discipline for YAML, which the workflow tests need.
 *
 * #651 found a mutant surviving because the PROSE ABOVE a CI step satisfied an
 * assertion about the step — `expect(CI).toContain('npm run test:pg')` passed
 * after the step was replaced, because the paragraph explaining why the step
 * had never existed says `npm run test:pg` in English. #656 then read the same
 * workflow for a different step and would have been the second occurrence.
 *
 * Lives here rather than in each suite because that is the OTHER defect this
 * audit keeps finding: two hand-maintained copies of one contract.
 *
 * Whole-line comments only. A `#` inside a quoted value is not a comment, and
 * dropping only lines whose first non-blank character is `#` never touches one.
 */
export function stripYamlComments(src: string): string {
    return src.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
}

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
    /**
     * Throw when a `'` or `"` string is still open at a line break — the
     * signature of a desynced scan (#827).
     *
     * OFF by default, and the reason is the same one recorded for
     * minRetainedRatio, measured the same way. It fires on 43 of this
     * repository's files and almost every one is a FALSE POSITIVE: JSX TEXT.
     *
     *     <p>We don&apos;t just export products.</p>   ← written with a real '
     *     Didn't receive it? Check your spam folder.
     *
     * JSX text is a fourth context this scanner does not model, and an
     * apostrophe in English prose is indistinguishable from an opening quote
     * without a real JSX parser. A guard that fires on good input gets switched
     * off, and then guards nothing.
     *
     * WHAT MAKES THAT ACCEPTABLE is the RESYNC. The scan now abandons an
     * unterminated `'…'` or `"…"` at the newline instead of running it to the
     * end of the file, so the blast radius of every remaining case — JSX prose
     * included — is the REST OF ONE LINE rather than everything below it. That
     * is the structural half of this fix and it applies always; this option is
     * for a caller reading .ts files, where there is no JSX and a runaway
     * string is unambiguously a fault.
     */
    failOnRunawayString?: boolean;
}

/**
 * The keywords a regex literal may follow.
 *
 * `return /x/` is a regex; `total /x/` is two divisions. Telling them apart is
 * the one genuinely ambiguous thing in JavaScript's grammar, and this is the
 * standard resolution: look at the previous significant token.
 */
const REGEX_MAY_FOLLOW = new Set([
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "throw", "case", "do", "else", "yield", "await",
]);

/**
 * Could a `/` here START a regex literal, given what came before it?
 *
 * Conservative in the direction that matters. When it is wrong about a `/`
 * being division, the `/` is copied as an ordinary character and nothing is
 * mis-stripped; when it is wrong the other way it would swallow code. So the
 * closers — `)`, `]`, an identifier, a string — all say DIVISION, which is what
 * they almost always are (`(a + b) / c`, `xs[0] / n`, `total / count`).
 */
function regexCanStartHere(before: string): boolean {
    //   Walk back over whitespace to the last significant character.
    let j = before.length - 1;
    while (j >= 0 && /\s/.test(before[j])) j--;
    if (j < 0) return true;                       // start of input

    const c = before[j];

    //   A closer or a value means the `/` divides it.
    if (c === ")" || c === "]" || c === '"' || c === "'" || c === "`") return false;

    /*
     *   JSX. `</div>` is a closing tag, not a regex — and reading it as one
     *   swallowed the tag name and everything after it up to the next slash,
     *   which is how the first draft of this fix made two .tsx files WORSE
     *   than the bug it was fixing. `a < /re/.test(b)` is the expression this
     *   gives up on, and nobody writes it.
     */
    if (c === "<") return false;

    if (/[\w$]/.test(c)) {
        //   An identifier or number — unless it is one of the keywords a regex
        //   is allowed to follow.
        let k = j;
        while (k >= 0 && /[\w$]/.test(before[k])) k--;
        const word = before.slice(k + 1, j + 1);
        if (/^\d/.test(word)) return false;       // a number: division
        return REGEX_MAY_FOLLOW.has(word);
    }

    //   An operator, a comma, an opening bracket, a semicolon, a block end.
    return true;
}

/**
 * A quoted string that ran off the end of its line.
 *
 * THE DESYNC ITSELF, rather than a symptom of it — which is what the first
 * draft of this guard tested, and it false-positived immediately on the CSS
 * inside a `<style jsx>` template literal, where a `/* … *​/` survives
 * stripping entirely correctly.
 *
 * A `'` or `"` literal cannot span a newline in JavaScript. So if the scanner
 * believes it is inside one when it reaches a line break, it is wrong about
 * where the string began — which is exactly what #827 was: the `'` inside
 * `/^[a-zA-Z\s\-']+$/` opening a string that has no end.
 */
export interface StripDiagnostics {
    /** 1-based lines where a `'` or `"` string was still open at the newline. */
    runawayStrings: number[];
}

/**
 * Remove line and block comments, leaving string and regex literals untouched.
 *
 * Handles: '…', "…", `…` (including ${…} nesting one level, which is all this
 * codebase's template literals need), /…/flags, escapes, and comment markers
 * inside any of them.
 */
export function stripCommentsRaw(src: string, diagnostics?: StripDiagnostics): string {
    let out = "";
    let i = 0;
    const n = src.length;
    //   Line of the most recent newline consumed, for the diagnostic above.
    let line = 1;

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
                /*
                 *   #827 — a `'` or `"` literal cannot cross a line. Reaching
                 *   a newline inside one means the opening quote was not an
                 *   opening quote, and everything since has been mis-read. Say
                 *   so and RESYNC at the line break rather than running the
                 *   mistake to the end of the file, which is what turned one
                 *   apostrophe into every comment below it surviving.
                 */
                if (src[i] === "\n" && quote !== "`") {
                    diagnostics?.runawayStrings.push(line);
                    break;
                }
                if (src[i] === "\n") line++;
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
                if (src[i] === "\n") { out += "\n"; line++; }
                i++;
            }
            i += 2;
            continue;
        }

        // ── regex literals: copied verbatim, like strings ───────────────────
        //
        //   #827. Without this, the `'` in /^[a-zA-Z\s\-']+$/ opened a phantom
        //   string and every comment up to the next apostrophe survived
        //   stripping. Twenty-one production files, and a pinned count that
        //   had been wrong since it was written.
        if (c === "/" && regexCanStartHere(out)) {
            out += c;
            i++;
            let inClass = false;
            while (i < n) {
                const r = src[i];
                if (r === "\\") {                 // escape: take both characters
                    out += r + (src[i + 1] ?? "");
                    i += 2;
                    continue;
                }
                //   A newline cannot appear in a regex literal. Reaching one
                //   means this `/` was division after all — the copied text is
                //   unchanged either way, so nothing is lost by stopping here
                //   rather than running to the end of the file.
                if (r === "\n") break;
                out += r;
                i++;
                if (r === "[") inClass = true;
                else if (r === "]") inClass = false;
                //   Inside a character class a `/` is an ordinary character.
                else if (r === "/" && !inClass) break;
            }
            //   Trailing flags, so `gi` is not re-read as an identifier.
            while (i < n && /[a-z]/.test(src[i])) { out += src[i]; i++; }
            continue;
        }

        if (c === "\n") line++;
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
    const { minRetainedRatio = 0, label, failOnRunawayString = false } = options;

    const diagnostics: StripDiagnostics = { runawayStrings: [] };
    const result = stripCommentsRaw(src, diagnostics);

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

    /*
     *   THE OTHER DIRECTION — #827.
     *
     *   The guard above asks whether stripping left too LITTLE. A desync leaves
     *   too MUCH: a file longer than it should be, full of prose presented as
     *   code, and perfectly plausible. That guard is structurally unable to see
     *   it.
     *
     *   IT TESTS THE DESYNC AND NOT ITS SYMPTOM, which is a correction. The
     *   first draft looked for a line still opening a comment, and false-fired
     *   at once on `<style jsx>` blocks — CSS inside a template literal has
     *   `/* … *​/` comments that survive stripping entirely correctly, and the
     *   scanner cannot tell "in a string" from "wrongly believes it is in a
     *   string" by looking at its own output.
     *
     *   A `'` or `"` literal cannot cross a newline. If the scanner is inside
     *   one at a line break, the opening quote was not an opening quote — which
     *   is precisely what the apostrophe in a regex character class did. That
     *   is checkable, it is the actual fault, and it does not fire on CSS.
     */
    if (failOnRunawayString && diagnostics.runawayStrings.length > 0) {
        const at = diagnostics.runawayStrings.slice(0, 5).join(", ");
        throw new StripperAteTheFileError(
            `Stripping ${label ?? "the source"} ran a quoted string past the end of its line `
            + `(line${diagnostics.runawayStrings.length > 1 ? "s" : ""} ${at}`
            + `${diagnostics.runawayStrings.length > 5 ? ", …" : ""}). A '…' or "…" literal cannot `
            + `cross a newline, so the scanner lost sync and everything after that point was `
            + `read as string content — including comments, which came back UNSTRIPPED. A quote `
            + `inside a regex literal is the known cause (#827). An assertion against this `
            + `string would read prose as an implementation, which is how a reachability scan `
            + `once counted an action as called by the comment saying nothing calls it.`,
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
