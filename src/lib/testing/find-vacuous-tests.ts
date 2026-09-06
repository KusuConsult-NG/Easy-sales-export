/**
 * Find tests that cannot fail.
 *
 *   #441. A test whose only assertion is `expect(true).toBe(true)` reports green
 *   on any code at all, while its NAME goes on telling a reader that the
 *   behaviour is covered. That is worse than an absent test, because somebody
 *   counts it.
 *
 * This module is the scanner. The suite that uses it is
 * src/__tests__/unit/no-test-can-pass-without-asserting.test.ts.
 *
 * MY FIRST FIVE VERSIONS OF THIS WERE WRONG, AND EACH ONE WOULD HAVE PRODUCED
 * A FALSE REPORT. They are worth naming, because each is a way a scanner like
 * this quietly lies:
 *
 *   1. `it.each([...])('title', fn)` — matching the first parenthesis after the
 *      name grabs the DATA ARRAY, not the callback, so every table-driven test
 *      looked assertion-free. That alone was 20-odd false hits.
 *   2. The word "it" inside a block comment was read as a test declaration.
 *      Comments have to go before anything else is counted.
 *   3. A REGEX LITERAL containing escaped parens — `/\bcatch\s*(?:\([^)]*\))?/`
 *      — unbalances a paren counter, so the body was truncated at the regex and
 *      the assertions after it were invisible. Thirteen more false hits, in the
 *      ratchet suites that use regexes most.
 *   4. A TEMPLATE LITERAL holding a test fixture — `it('x', () => {...})` inside
 *      backticks — was read as a real declaration. This scanner's own controls
 *      are written that way, so the first version of its suite reported three
 *      vacuous tests that are string data. Found by running it, not by
 *      thinking about it.
 *   5. `return /re/.test(x)` — the `n` before the slash is not punctuation, so
 *      the slash read as division and the quotes inside the pattern opened a
 *      string that swallowed the rest of the body. Two real ratchet suites.
 *
 * Corrected, the sweep over 571 suite files returned exactly two, and both were
 * real. That is the number this scanner has to be able to reproduce.
 */

export interface VacuousTest {
    /** Repo-relative path. */
    file: string;
    /** 1-indexed line of the `it(` / `test(` declaration. */
    line: number;
    title: string;
    reason: 'NO ASSERTION AT ALL' | 'ONLY TAUTOLOGICAL ASSERTIONS';
    /** Which tautologies were recognised, when that is the reason. */
    tautologies: string[];
}

/**
 * Assertions that hold for every possible program.
 *
 * `x.length >= 0` is here because a length is never negative — it is the shape a
 * "vacuity guard" takes when somebody wants one without deciding what it should
 * check.
 */
const TAUTOLOGIES: Array<{ name: string; pattern: RegExp }> = [
    { name: 'expect(true).toBe(true)', pattern: /expect\(\s*true\s*\)\.toBe(?:Truthy)?\(\s*(?:true)?\s*\)/g },
    { name: 'expect(false).toBe(false)', pattern: /expect\(\s*false\s*\)\.toBe\(\s*false\s*\)/g },
    { name: 'toBeGreaterThanOrEqual(0)', pattern: /toBeGreaterThanOrEqual\(\s*0\s*\)/g },
    { name: 'toBeLessThanOrEqual(Infinity)', pattern: /toBeLessThanOrEqual\(\s*Infinity\s*\)/g },
    { name: 'expect(N).toBe(same N)', pattern: /expect\(\s*(\d+)\s*\)\.toBe\(\s*\1\s*\)/g },
];

/**
 * Anything that can make a test fail.
 *
 * `expect\w*` deliberately admits helper wrappers — several suites here assert
 * through `expectNotAValidationFailure(result)`, and reading only the literal
 * `expect(` called those tests empty.
 */
const ASSERTION = /\bexpect\w*\s*[(.]|\bassert\w*\s*\(|\bthrow\s+new\b|\.rejects\b|\.resolves\b|toMatchSnapshot|\bfail\s*\(/g;

/** Skip a quoted string starting at `i`; returns the index just past it. */
function skipString(src: string, i: number): number {
    const quote = src[i];
    let j = i + 1;
    while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\') j += 1;
        j += 1;
    }
    return j + 1;
}

/**
 * Blank out comments and regex-literal bodies, preserving offsets and lines.
 *
 * Regex bodies go because their escaped parens and braces break the matcher
 * below — see the header. Their contents are never assertions, so blanking them
 * loses nothing.
 */
export function blankNonCode(src: string): string {
    const out: string[] = [];
    const blank = (text: string) => text.replace(/[^\n]/g, ' ');
    let i = 0;

    /**
     * The last few significant characters emitted, for deciding whether a `/`
     * begins a regex or is division.
     *
     * A rolling tail rather than a scan back through `out`, which would be
     * quadratic over a 900-line suite file.
     */
    let tail = '';
    const remember = (text: string) => {
        const significant = text.replace(/\s+/g, ' ');
        tail = (tail + significant).slice(-24);
    };

    /**
     * True where a `/` cannot be division.
     *
     * THE KEYWORD HALF WAS MISSING AND IT MATTERED. `return /re/.test(x)` has
     * `n` before the slash, so the punctuation test alone called it division —
     * and the quotes inside the pattern then opened a string that swallowed the
     * rest of the body. Two real ratchet suites reported "no assertion at all"
     * because of it, which is bug 5 of a scanner I had already corrected four
     * times.
     */
    const regexCanStartHere = (): boolean => {
        const last = tail.trimEnd().slice(-1);
        if (last === '' || '=(,:[!&|?{};+-*%~^<>'.includes(last)) return true;
        return /(?:^|[^\w$.])(return|typeof|case|in|of|delete|void|instanceof|new|do|else|yield|await)\s*$/.test(tail);
    };

    while (i < src.length) {
        const ch = src[i];
        if (ch === '/' && src[i + 1] === '/') {
            let end = src.indexOf('\n', i);
            if (end < 0) end = src.length;
            out.push(blank(src.slice(i, end)));
            remember(' ');
            i = end;
        } else if (ch === '/' && src[i + 1] === '*') {
            let end = src.indexOf('*/', i + 2);
            end = end < 0 ? src.length : end + 2;
            out.push(blank(src.slice(i, end)));
            remember(' ');
            i = end;
        } else if (ch === '`' || ch === '"' || ch === "'") {
            // A STRING'S CONTENTS ARE DATA, NOT CODE, whichever quote it uses.
            // Test fixtures in this repository hold whole `it(...)`
            // declarations inside strings — including the controls in this
            // scanner's own suite, which is how this was found — and reading
            // those as real tests is a false report of exactly the kind this
            // module exists to avoid.
            //
            // The DELIMITERS stay, so a title is still recognisable as a title;
            // the title text itself is read from the unblanked original, which
            // is what `titleSource` is for.
            const end = skipString(src, i);
            out.push(ch + blank(src.slice(i + 1, end - 1)) + src[end - 1]);
            remember(src[end - 1]);
            i = end;
        } else if (ch === '/' && regexCanStartHere()) {
            // A regex literal: the previous significant character cannot end an
            // expression, so this slash is not division.
            let j = i + 1;
            let inClass = false;
            while (j < src.length) {
                if (src[j] === '\\') { j += 2; continue; }
                if (src[j] === '[') inClass = true;
                else if (src[j] === ']') inClass = false;
                else if (src[j] === '/' && !inClass) break;
                else if (src[j] === '\n') break;
                j += 1;
            }
            out.push(blank(src.slice(i, j + 1)));
            remember(' ');
            i = j + 1;
        } else {
            out.push(ch);
            remember(ch);
            i += 1;
        }
    }
    return out.join('');
}

/** Match a bracketed group starting at `open`; returns the index just past it. */
function matchGroup(src: string, open: number, o: string, c: string): number {
    let depth = 0;
    let j = open;
    while (j < src.length) {
        const ch = src[j];
        if (ch === '`' || ch === '"' || ch === "'") { j = skipString(src, j); continue; }
        if (ch === o) depth += 1;
        else if (ch === c) {
            depth -= 1;
            if (depth === 0) return j + 1;
        }
        j += 1;
    }
    return src.length;
}

/**
 * Every `it(...)` / `test(...)` declaration, with its callback body.
 *
 * `titleSource` is the ORIGINAL text at the same offsets. Blanking preserves
 * length, so a title written as a template literal — 31 tests here do that —
 * can be read back from it even though its blanked copy is whitespace.
 */
export function findTestBlocks(
    code: string,
    titleSource: string = code,
): Array<{ line: number; title: string; body: string }> {
    const blocks: Array<{ line: number; title: string; body: string }> = [];
    const NAME = /(?<![\w.$])(it|test)\b/g;

    for (const match of code.matchAll(NAME)) {
        let j = match.index! + match[0].length;

        // Consume chained modifiers. `.each(...)` and `.each`...`` take an
        // argument of their own that must be skipped before the call itself.
        for (;;) {
            const chained = /^\s*\.\s*(each|only|skip|todo|failing|concurrent)\b/.exec(code.slice(j));
            if (!chained) break;
            j += chained[0].length;
            if (chained[1] === 'each') {
                let w = j;
                while (w < code.length && /\s/.test(code[w])) w += 1;
                if (code[w] === '(') j = matchGroup(code, w, '(', ')');
                else if (code[w] === '`') j = skipString(code, w);
            }
        }

        let w = j;
        while (w < code.length && /\s/.test(code[w])) w += 1;
        if (code[w] !== '(') continue;

        const call = code.slice(w, matchGroup(code, w, '(', ')'));
        const titled = /^\(\s*[`'"]([\s\S]*?)[`'"]\s*,/.exec(call);
        if (!titled) continue;

        const rest = call.slice(titled[0].length);
        const braceAt = rest.indexOf('{');
        // The title's span within the whole file, so it can be sliced out of
        // the unblanked original.
        const titleStart = w + titled[0].indexOf(titled[1]);
        blocks.push({
            line: code.slice(0, match.index!).split('\n').length,
            title: titleSource.slice(titleStart, titleStart + titled[1].length)
                .replace(/\s+/g, ' ').trim().slice(0, 80),
            body: braceAt >= 0 ? rest.slice(braceAt) : '',
        });
    }
    return blocks;
}

/** Every test in `source` that cannot fail. */
export function findVacuousTests(file: string, source: string): VacuousTest[] {
    const code = blankNonCode(source);
    const found: VacuousTest[] = [];

    for (const { line, title, body } of findTestBlocks(code, source)) {
        const assertions = (body.match(ASSERTION) ?? []).length;

        let tautologyCount = 0;
        const tautologies: string[] = [];
        for (const { name, pattern } of TAUTOLOGIES) {
            const hits = (body.match(new RegExp(pattern.source, 'g')) ?? []).length;
            if (hits > 0) { tautologyCount += hits; tautologies.push(name); }
        }

        if (assertions === 0) {
            found.push({ file, line, title, reason: 'NO ASSERTION AT ALL', tautologies: [] });
        } else if (assertions - tautologyCount <= 0) {
            found.push({ file, line, title, reason: 'ONLY TAUTOLOGICAL ASSERTIONS', tautologies });
        }
    }
    return found;
}
