/**
 * @jest-environment node
 */

/**
 * The stripper 147 test suites use eats real code, and it misled me twice.
 *
 * Nearly every structural test in this repository carries its own copy of:
 *
 *     src.replace(/\/\*[\s\S]*?\*\//g, '')   then drop the `//` lines
 *
 * Both of its failure modes were hit for real during this audit.
 *
 * 1. lib/csp.ts's allow-list holds wildcard hosts like
 *    "https://*.firebaseio.com". The `//*` inside that STRING is `/*` to a regex
 *    that knows nothing about strings, so stripping csp.ts opened a comment
 *    inside a string literal and consumed the rest of the file. code() returned
 *    two dots.
 *
 *    That was caught by luck. The assertion was a toContain, which fails loudly
 *    on a gutted file. A `not.toContain` would have PASSED — reporting a
 *    dangerous pattern absent from a file it had just deleted. That is a silent
 *    false pass in the apparatus every fix in this audit rests on.
 *
 * 2. admin/_legacy.ts opens `/* Original implementation below (deprecated ...`
 *    at line 33 and closes it 120 lines later. A hasAdminPermission call for
 *    "users:create" sits inside, at line 42. Reading the raw file it looks like
 *    the live guard; the live one is at line 180. Here the stripper was RIGHT
 *    and my reading was wrong, which is the argument for asserting against
 *    stripped source rather than raw whenever the question is "does this code do
 *    X".
 *
 * So: one shared implementation that scans code / string / comment states
 * properly, and that THROWS when its output is degenerate instead of handing
 * back a confident empty string.
 *
 * WHY THE 147 COPIES ARE NOT ALL MIGRATED HERE
 * -------------------------------------------
 * Rewriting the helper in 147 suites is a large mechanical change to the very
 * apparatus that guards the audit, and a mistake in it would be invisible for
 * exactly the reason described above. The shared version exists, is proven
 * against both traps, and is what new tests should use. Migrating the existing
 * copies is a separate change that wants its own review — and the copies are not
 * silently wrong: trap 1 only bites on files carrying `//` inside a string,
 * which the sweep below enumerates.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
    stripComments,
    stripCommentsRaw,
    StripperAteTheFileError,
} from '@/lib/testing/strip-comments';

const ROOT = process.cwd();

function source(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf-8');
}

/** The naive stripper, exactly as the 147 suites spell it. */
function naive(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('trap 1 — a comment marker inside a string', () => {
    // The trailing block comment matters: the naive regex is non-greedy, so the
    // false opener inside the string only swallows anything if a real `*/`
    // appears later in the file. csp.ts has several. A fixture without one would
    // make the naive stripper look correct.
    const src = [
        'const CONNECT_HOSTS = [',
        '    "https://*.firebaseio.com",',
        '    "https://api.paystack.co",',
        '];',
        'const KEEP = "kept";',
        '/** a doc comment further down, as every real file has. */',
        'const LAST = 1;',
    ].join('\n');

    it('the naive stripper destroys the file', () => {
        // THE demonstration. Not hypothetical — this is csp.ts's shape.
        expect(naive(src)).not.toContain('api.paystack.co');
    });

    it('and the shared one does not', () => {
        const out = stripCommentsRaw(src);
        expect(out).toContain('"https://*.firebaseio.com"');
        expect(out).toContain('"https://api.paystack.co"');
        expect(out).toContain('const KEEP = "kept";');
    });

    it('on the real file, not a reconstruction of it', () => {
        // Vacuity guard: the shape above must be the shape csp.ts actually has.
        const csp = source('src/lib/csp.ts');
        expect(csp).toContain('"https://*.firebaseio.com"');

        expect(naive(csp)).not.toContain('api.paystack.co');
        expect(stripComments(csp, { label: 'csp.ts' })).toContain('"https://api.paystack.co"');
    });

    it('in single quotes and template literals too', () => {
        for (const q of ["'", '`']) {
            const line = `const u = ${q}https://*.example.com${q}; const after = 1;`;
            expect(stripCommentsRaw(line)).toContain('const after = 1;');
        }
    });

    it('and an escaped quote does not end the string early', () => {
        const line = 'const s = "a \\" /* not a comment */ b"; const after = 1;';
        const out = stripCommentsRaw(line);
        expect(out).toContain('/* not a comment */');
        expect(out).toContain('const after = 1;');
    });
});

describe('trap 2 — real code inside a real comment', () => {
    it('is removed, which is the correct answer', () => {
        const src = [
            'function live() {',
            '    /* Original implementation below (deprecated)',
            '    if (!hasAdminPermission(roles, "users:create")) return;',
            '    */',
            '    return realGuard();',
            '}',
        ].join('\n');

        const out = stripComments(src);
        expect(out).not.toContain('users:create');
        expect(out).toContain('return realGuard();');
    });

    it('and on the real file, the commented-out guard is gone while the live one stays', () => {
        // The mistake this audit actually made: asserting on line 42 believing
        // it was live. It is inside a 120-line block comment; the live check is
        // at line 180.
        const legacy = source('src/app/actions/admin/_legacy.ts');
        const out = stripComments(legacy, { label: '_legacy.ts' });

        expect(legacy).toContain('if (!session?.user || !hasAdminPermission(session.user.roles, "users:create"))');
        expect(out).not.toContain('if (!session?.user || !hasAdminPermission(session.user.roles, "users:create"))');
        //   #749 — the live anchor moved. The action's own permission re-check
        //   was the defect (it read the token) and is gone; the live gate is the
        //   requireAdmin call. The CLAIM is unchanged: the stripper keeps live
        //   code and drops the commented copy above it.
        expect(out).toContain('await requireAdmin("users:create")');
    });

    it('line numbers surviving a multi-line comment', () => {
        // A block comment is replaced by its newlines, so a later indexOf-based
        // ordering assertion still reflects the file.
        const src = 'a\n/* one\ntwo\nthree */\nb';
        expect(stripCommentsRaw(src).split('\n').length).toBe(src.split('\n').length);
    });
});

describe('it refuses to hand back a gutted file', () => {
    /**
     * The guard asks "did the input have statements and the output has none",
     * not "what share of lines survived". That is a CORRECTION, and this
     * suite's first version is what forced it: a 0.2 ratio floor was the only
     * guard, and it threw on legitimately doc-heavy files. This repository is
     * full of them — csv-safe.ts keeps 12 code lines out of 72 — and a guard
     * that fires on good input gets switched off.
     */
    it('throwing when every statement is gone', () => {
        // THE point. A not.toContain against an empty string passes and proves
        // nothing, so the failure has to be loud.
        //
        // The unterminated opener has to come FIRST. My first fixture put it
        // last and correctly did NOT throw — a scanner consuming from `/*` to
        // EOF keeps everything before it, so the statements survive. Getting
        // that wrong is the same class of mistake as writing a mutation the test
        // was never going to catch.
        const eaten = '/*\nconst a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;';
        expect(() => stripComments(eaten, { label: 'fixture.ts' }))
            .toThrow(StripperAteTheFileError);
    });

    it('and NOT throwing when the opener is last, because nothing was lost', () => {
        // The counterpart, so the guard is understood rather than trusted.
        const fine = 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;\n/*';
        expect(() => stripComments(fine, { label: 'fixture.ts' })).not.toThrow();
        expect(stripComments(fine)).toContain('const a = 1;');
    });

    it('naming the file and the numbers, so the failure is diagnosable', () => {
        try {
            stripComments('/*\nconst a=1;const b=2;const c=3;const d=4;const e=5;', { label: 'fixture.ts' });
            throw new Error('expected a throw');
        } catch (e) {
            expect(e).toBeInstanceOf(StripperAteTheFileError);
            expect(String(e)).toContain('fixture.ts');
            expect(String(e)).toContain('not.toContain');
        }
    });

    it('but a genuinely comment-heavy file passes, which the ratio version did not', () => {
        const docHeavy = '/**\n' + ' * words\n'.repeat(40) + ' */\n'
            + 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n'
            + 'export const d = 4;\nexport const e = 5;\n';
        expect(() => stripComments(docHeavy)).not.toThrow();
    });

    it('and the real doc-heavy modules in this repository pass', () => {
        // Named, because they are the false positives that killed the ratio.
        for (const rel of ['src/lib/csv-safe.ts', 'src/lib/land-listing-status.ts', 'src/lib/paystack-host.ts']) {
            expect(() => stripComments(source(rel), { label: rel })).not.toThrow();
        }
    });

    it('a file with no statements at all is not an error, having none to lose', () => {
        expect(() => stripComments('/**\n * only prose\n */\n')).not.toThrow();
        expect(() => stripComments('const a = 1;\n/*')).not.toThrow();
    });

    it('and a caller who wants a ratio can still ask for one', () => {
        const src = '/**\n' + ' * words\n'.repeat(40) + ' */\nconst a = 1;\n';
        expect(() => stripComments(src)).not.toThrow();
        expect(() => stripComments(src, { minRetainedRatio: 0.5 })).toThrow(StripperAteTheFileError);
    });
});

describe('it agrees with the naive version everywhere the naive version is right', () => {
    /**
     * The migration argument. If the two disagree on a file, that file's tests
     * are asserting against different text than they appear to be.
     */
    function walk(dir: string, out: string[] = []): string[] {
        for (const e of readdirSync(dir)) {
            const full = join(dir, e);
            if (statSync(full).isDirectory()) {
                if (e !== 'node_modules') walk(full, out);
            } else if (/\.tsx?$/.test(e)) out.push(full);
        }
        return out;
    }

    /**
     * The files the naive stripper mangles, as measured — #676.
     *
     * Generated from the sweep below rather than believed in advance: the first
     * version of this suite expected `csp.ts` alone and found ten. Pinned as a
     * SET so that a file joining or leaving the list both fail, and the failure
     * names the file instead of a count.
     */
    /*
     *   #827 SIXTEEN OF THESE WERE NOT THE NAIVE STRIPPER'S FAULT.
     *
     *   This list is generated by comparing the naive stripper against the real
     *   one, and it is DESCRIBED as "the files the naive stripper mangles".
     *   That reading assumed the real one was right. For sixteen entries it was
     *   not: a quote inside a regex literal desynced it, so it returned a file
     *   with comments left in, the two outputs differed, and the naive stripper
     *   got the blame. The disagreement was real and the attribution was
     *   backwards.
     *
     *   Removed now that the real stripper handles regex literals:
     *
     *       a-certificate-that-named-a-page-that-was-not-there
     *       a-chat-offered-to-people-who-could-not-use-it
     *       a-decision-is-not-overridden-by-a-role
     *       a-declared-database-is-not-a-running-one
     *       a-record-corrected-and-a-cache-that-kept-the-old-one
     *       admin-permission-gates
     *       an-admin-screen-wearing-the-wrong-chrome
     *       client-reads-the-answer
     *       cooperative-withdrawal-doors
     *       export-window-expiry
     *       npm-scripts-can-actually-run
     *       revalidate-tag-profile-is-real
     *       safe-redirect-path
     *       the-audit-log-had-two-vocabularies
     *       the-export-sweep-only-walked-the-browser
     *       the-spreadsheet-half-of-the-export-rule
     *
     *   THE PER-FILE NOTES BELOW ARE LEFT WHERE THEY ARE, including several
     *   that now explain a file no longer on the list. They are the record of
     *   why each entry was added, several of them written while the
     *   attribution was wrong, and deleting them would erase the evidence that
     *   a list "generated from the measurement rather than believed in advance"
     *   can still inherit a wrong premise from the instrument that generated
     *   it. A note describing an absent file is history, not a claim.
     *
     *   The list shrinking is the fix working. It shrank by exactly sixteen and
     *   gained nothing, which is the direction a correction to the scanner
     *   should move it.
     */
    const KNOWN_AFFECTED: string[] = [
        //   #711 — joined when the finding's header grew. Same mechanism as the
        //   two below: the file holds `'//'` inside a string (its own
        //   comment-skipping filter) and its block comments supply the closing
        //   `*/` the naive regex needs.
        //   #763 — joined on the plainest form of all. That file stubs the
        //   document upload Export onboarding performs, so it holds a URL —
        //   `https://cdn.example/doc.pdf` — inside a string, and its block
        //   comments supply the closing `*/` the naive regex needs. It strips
        //   nothing with the naive regex; the one sweep it runs over source
        //   reads module-access-check.ts RAW, because what it asserts there is
        //   the presence of a call.
        //   #706 — the same mechanism again, and this time deliberately: that
        //   file skips comment lines with `line.startsWith('/*')`, so it holds
        //   the literal '/*' inside a string, and its own block comments supply
        //   the closing `*/`. Written that way on purpose — it is a sweep that
        //   must not read an explanation of `x * 100` as an instance of it —
        //   and recorded here rather than contorted to dodge this list.
        //   #891 — the same mechanism as #706 above, and deliberate for the same
        //   reason. That file sweeps source for `x?.toDate()` and must not read
        //   an EXPLANATION of the idiom as an instance of it, so it skips lines
        //   beginning `//`, `*` and `/*` — which means it holds those three
        //   literals inside strings, and its own block comments supply the
        //   closing `*/` the naive regex needs. Recorded here rather than
        //   contorted to dodge this list.
        'src/__tests__/unit/a-guard-on-the-door-money-leaves-by-only.test.ts',
        'src/__tests__/unit/a-guard-that-guarded-the-wrong-thing.test.ts',
        'src/__tests__/unit/admin-approval-audit.test.ts',
        'src/__tests__/unit/admin-route-authority.test.ts',
        'src/__tests__/unit/broadcast-access.test.ts',
        'src/__tests__/unit/finance-reconcile-permission.test.ts',
        'src/__tests__/unit/harness-covers-adapter.test.ts',
        'src/__tests__/unit/kyc-route-bypass.test.ts',
        'src/__tests__/unit/loan-application-refusal-is-visible.test.ts',
        'src/__tests__/unit/mfa-enforcement-decided.test.ts',
        'src/__tests__/unit/paystack-host-cannot-be-redirected.test.ts',
        'src/__tests__/unit/repair-and-public-catalog.test.ts',
        /*
         *   #849 — joined when a paragraph was added to it, in the SECOND form:
         *   an apostrophe in prose. That file's new note reads "auth.ts's
         *   `loginAction` is a deprecated stub", and the naive regex has no
         *   notion of comments, so it takes the apostrophe as the start of a
         *   string literal and loses its place until the next one.
         *
         *   Registered rather than avoided. Rewording the sentence to dodge an
         *   apostrophe would leave the list saying this file is safe for the
         *   naive stripper, which is not a fact about the file — it is a fact
         *   about how carefully somebody phrased a comment, and the next
         *   paragraph would not know the rule. That file strips with
         *   lib/testing/strip-comments — the good one — and never reads its own
         *   text, which is the condition every entry here is admitted under.
         */
        'src/__tests__/unit/security-settings-claims.test.ts',
        'src/__tests__/unit/sms-sandbox-reporting.test.ts',
        //   #705 — joined when a block comment was added to it, and the
        //   mechanism is the one this module exists for, in its THIRD form.
        //   That file contains the literal '/*' inside a string, at
        //   `!body.startsWith('/*')`. The naive regex opens a block comment
        //   there and runs to the next real `*/` — and until #705 there was no
        //   `*/` after it anywhere in the file, so the regex never matched and
        //   the damage was nil. Adding a /* … */ comment near the foot SUPPLIED
        //   the closing delimiter, and the naive stripper now eats everything
        //   between: 116 non-blank lines became 73.
        //
        //   Nothing reads that file with a naive stripper, so no assertion is
        //   affected. It is here because this list is about which files the
        //   naive stripper mangles, not which are read.
        'src/__tests__/unit/status-vocabulary-drift.test.ts',
        'src/__tests__/unit/storage-backend-single-rule.test.ts',
        'src/__tests__/unit/strip-comments.test.ts',
        //   #790 — joined on the plainest form. That file's route-existence
        //   check shells out to `find … | sed 's|/([^)]*)|/|g; s|//*|/|g'` to
        //   resolve Next route groups, so it holds `//` and `/*` inside a
        //   string, and its own block comments supply the closing `*/` the
        //   naive regex needs.
        //
        //   Raised rather than relaxed, for the usual reason: it strips OTHER
        //   files with lib/testing/strip-comments — the good one — and nothing
        //   strips it, so no assertion in it can be misled by the mangling.
        'src/__tests__/unit/submitted-and-sent-to-a-door-she-could-not-open.test.ts',
        //   #787 — joined by the RATIO, not by newly acquiring the trap, which
        //   is the mechanism this list has now recorded six times. That file's
        //   own codeOnly() has always carried `t.startsWith('//')` and
        //   `t.startsWith('/*')` on one line, so the naive regex has always
        //   opened a block comment at that literal and eaten to the next real
        //   close. What moved was the prose: a paragraph explaining why the
        //   reader's inline projection became a named projectSession pushed the
        //   damage from under the 10% threshold to over it.
        //
        //   Raised rather than relaxed, for the usual reason: that file strips
        //   OTHER files with its own line-based codeOnly(), never the
        //   block-eating regex measured here, and no assertion in it reads its
        //   own text.
        'src/__tests__/unit/wave-training-access.test.ts',
        //   #810 REMOVED src/app/api/id-card/pdf/route.ts — THE FIRST FILE TO
        //   LEAVE THIS LIST, which is the direction #676 said a set records and
        //   a ceiling does not. So it is explained at more length than the
        //   additions, because "it got better" is the claim that deserves the
        //   most suspicion.
        //
        //   MEASURED, both versions, same method:
        //
        //       before   naive 289 / good 347 = 0.833   AFFECTED
        //       after    naive 305 / good 332 = 0.919   not affected
        //
        //   Note the good baseline FELL, 347 → 332, while the naive count
        //   rose. The file gained lines; it did not lose thirty. So the honest
        //   reading is NOT "the watermark made the file bigger and diluted the
        //   damage" — it is that THE SHARED STRIPPER STARTED WORKING BETTER ON
        //   THIS FILE, and the 10% comparison moved underneath it.
        //
        //   THE MECHANISM, and it is worth knowing about:
        //
        //       function esc(s: string) { … .replace(/"/g, "&quot;") }
        //
        //   `/"/g` is a regex literal containing a double quote — the same
        //   shape the csv-safe entry below records. lib/testing/strip-comments
        //   loses its place there and treats the REST OF THE FILE as string,
        //   so it stops stripping comments from that point on. Counted, of 76
        //   comment lines:
        //
        //       before   58 survived stripping
        //       after    27 survived stripping
        //
        //   Both are wrong; the second is less wrong. What changed is where
        //   the stripper re-syncs on a later quote, which the added SVG markup
        //   moved. Nothing about the defect was fixed by this finding, and
        //   nothing about it was caused by it either — it predates the change
        //   and it is recorded here rather than quietly benefited from.
        //
        //   Removed rather than kept "to be safe": this list is a record of
        //   what IS. A file left on it after it stopped qualifying is the same
        //   stale-pin problem in the other direction, and it would mask the
        //   day the route crosses back.
        'src/lib/csp.ts',
    ];

    /** Files where the naive stripper loses code the shared one keeps. */
    const AFFECTED: string[] = [];

    for (const file of walk(join(ROOT, 'src'))) {
        const rel = file.slice(ROOT.length + 1);
        const raw = readFileSync(file, 'utf-8');
        // The trap needs a `//` sequence inside a quoted string.
        if (!/["'`][^"'`\n]*\/\/[^"'`\n]*["'`]/.test(raw)) continue;
        const naiveLines = naive(raw).split('\n').filter((l) => l.trim()).length;
        const goodLines = stripCommentsRaw(raw).split('\n').filter((l) => l.trim()).length;
        if (naiveLines < goodLines * 0.9) AFFECTED.push(rel);
    }

    it('and the files where it does not is a KNOWN list, pinned as a SET', () => {
        // I wrote this expecting csp.ts alone. It is ten files. Recording the
        // measured number rather than the assumed one is the whole point of
        // measuring.
        //
        // Pinned so a new one is noticed. If this list GROWS, some suite is
        // asserting against text it did not expect.
        //
        // NINE became TEN when harness-covers-adapter.test.ts was edited, and the
        // ratchet caught it on the same run — which is the ratchet working, so it
        // is raised rather than relaxed. The mechanism is the one this module
        // exists for, in its second form: that file contains the LITERAL '/*'
        // inside a string, at `!t.startsWith('/*')`, twice. The naive regex opens
        // a block comment there and runs to the next real `*/`, and how much it
        // eats depends on what sits between them — so editing prose in the file
        // changed the damage from under the 10% threshold to well over it.
        //
        // Nothing reads that file with a naive stripper (it strips the harness
        // files, using its own filter, and asserts on its own source nowhere), so
        // no assertion is affected. It is on the list because the list is about
        // which files the naive stripper mangles, not about which are read.
        // TEN became ELEVEN when revalidate-tag-profile-is-real.test.ts was
        // added (#252). Same mechanism in its third form: that file carries a
        // regex containing the literal '/*'-alike sequences and quotes URLs
        // with '//' inside strings, so the naive regex opens a comment it
        // should not and eats to the next real close. Raised rather than
        // relaxed, for the same reason as last time — nothing strips that file,
        // so no assertion in it is affected, and the list is about which files
        // the naive stripper mangles rather than which are read.
        //
        // ELEVEN became TWELVE when export-window-expiry.test.ts was added
        // (#275). Same mechanism in its fourth form: that file's own codeOnly
        // helper carries the literal '/*' inside a regex, and its header quotes
        // `new Date() > new Date(undefined)` and several '//'-bearing strings,
        // so the naive regex opens a block comment it should not. Raised rather
        // than relaxed, for the same reason every time — nothing strips that
        // file, so no assertion in it is affected.
        //
        // TWELVE became THIRTEEN when cooperative-withdrawal-doors.test.ts was
        // added (#276). Same mechanism in its fifth form: that file's own
        // codeOnly helper carries the literal '/*' inside a regex, and its
        // header quotes source lines containing '//'. Raised rather than
        // relaxed, for the same reason every time — nothing strips that file,
        // so no assertion in it is affected.
        //
        // THIRTEEN became FOURTEEN when loan-application-refusal-is-visible.test.ts
        // was added (#287/#288). Same mechanism in its sixth form: that file's
        // own codeOnly helper carries the literal '/*' inside a regex, and its
        // sweep for a refusal message quotes `trimmed.startsWith('//')` — a
        // '//' inside a string, which is the trap in its plainest form. Raised
        // rather than relaxed, for the same reason every time: nothing strips
        // that file, and the two assertions in it that DO read stripped source
        // read other files.
        //
        // FOURTEEN became FIFTEEN when broadcast-access.test.ts grew the #307
        // cases. Seventh form, and this one is worth being precise about
        // because the file did not newly ACQUIRE the trap — it already had it,
        // twice, in its ADMIN_OVERRIDE tests: `!t.startsWith('//')` and
        // `!t.startsWith('/*')` on one line, and `!body.startsWith('//')` on
        // another. The naive regex opens a block comment at that literal '/*'
        // and eats to the next real close, and how much that costs depends on
        // what sits between them. Adding prose moved the damage from under the
        // 10% threshold to over it — exactly what happened to
        // harness-covers-adapter.test.ts, and the reason this is a ratio rather
        // than a flag.
        //
        // Raised rather than relaxed, on the same test as every time: the file
        // strips actions/broadcast.ts with its own line-based filter and reads
        // send/route.ts raw, so no assertion in it reads its own mangled text.
        //
        // FIFTEEN became SIXTEEN when #384 rewrote two assertions in
        // client-reads-the-answer.test.ts. Eighth form, and the SAME mechanism
        // broadcast-access.test.ts demonstrated: the file did not newly acquire
        // the trap — it has carried it since it was written, in its own
        // `t.startsWith('//')` and `s.indexOf('/*')` — the naive regex has
        // always opened a block comment at that literal and eaten to the next
        // real close. What changed is the ratio: adding ten lines of prose about
        // why the pending-payment screen is retired moved the damage from just
        // under the 10% threshold to just over it. Measured: 185/275 raw
        // non-blank lines before, 187/285 after.
        //
        // Raised rather than relaxed, on the same test as every time: that file
        // strips OTHER files with its own line-based helper — the pending-payment
        // page and admin/users — and never reads its own text, so no assertion
        // in it can be misled by the mangling.
        //
        // SIXTEEN became SEVENTEEN when #485 rewrote three assertions in
        // kyc-route-bypass.test.ts. NINTH form, and the same mechanism as the
        // seventh and eighth: the file did not newly acquire the trap. Its
        // codeOnly() helper has always carried `t.startsWith('//')` and
        // `t.startsWith('/*')` on adjacent lines — the naive regex opens a block
        // comment at that literal and eats to the next real close. What changed
        // is the ratio: roughly thirty lines of prose about why the external
        // identity provider is parked moved the damage from under the 10%
        // threshold to over it.
        //
        // Raised rather than relaxed, on the same test as every time: that file
        // strips OTHER files — the two KYC routes and the parked provider
        // module — with its own line-based codeOnly(), and never reads its own
        // text, so no assertion in it can be misled by the mangling.
        //
        // SEVENTEEN became EIGHTEEN when #528 added
        // the-export-sweep-only-walked-the-browser.test.ts. TENTH form, and the
        // plainest one yet: that file's header quotes the two URLs the finding
        // is about — `window.location.href = "/api/admin/export/users"` and the
        // routes under /api/admin/… — so it carries `//` inside quoted strings,
        // which is precisely the trap this whole describe exists to measure.
        //
        // Raised rather than relaxed, on the same test as every time: that file
        // strips OTHER files with lib/testing/strip-comments — the good one —
        // and never reads its own text, so no assertion in it can be misled.
        //
        // EIGHTEEN became NINETEEN when #533 added
        // the-audit-log-had-two-vocabularies.test.ts. ELEVENTH form, same
        // mechanism as the last four: that file's header quotes a source line
        // containing `//` inside a string, and its depth-aware scanner carries
        // the literal '/*' and '*/' characters as bracket cases, so the naive
        // regex opens a block comment it should not.
        //
        // Raised rather than relaxed, on the same test as every time: that file
        // strips OTHER files with lib/testing/strip-comments — the good one —
        // and never reads its own text.
        //
        // NINETEEN became TWENTY when #578/#581 rewrote the catalogue half of
        // repair-and-public-catalog.test.ts. TWELFTH form, and the first one I
        // caused myself: that file's own codeOnly() helper has always carried
        // `t.startsWith('//')` and `t.startsWith('/*')` on adjacent lines — the
        // trap this module exists for — and what moved was the RATIO. The
        // assertions there stopped matching the route's text and started
        // running the reader instead, which traded about forty lines of
        // string-matching code for a dozen of prose explaining why, and pushed
        // the damage from under the 10% threshold to over it.
        //
        // Raised rather than relaxed, on the same test as every time: that file
        // strips OTHER files — the orphaned-user repair, the catalogue reader
        // and its route — with its own line-based codeOnly(), which is not the
        // block-eating regex measured here, and it never reads its own text. No
        // assertion in it can be misled by the mangling.
        //   #617 raised this from 20 to 21, on the same test as every time
        //   before. an-admin-screen-wearing-the-wrong-chrome.test.ts carries its
        //   own line-based `code()` helper — because an assertion about CODE must
        //   not be satisfied by PROSE, which is how its first version failed
        //   against correct code — and that helper is not the block-eating regex
        //   measured here. It never reads its own text, so no assertion in it can
        //   be misled by the mangling.
        //   #636 raised this from 21 to 22, on the same test as every time
        //   before. a-certificate-that-named-a-page-that-was-not-there.test.ts
        //   quotes the printed lines it is about — `easysalesexport.com/verify/`
        //   inside quotes and inside regexes — which is the `//`-in-a-string
        //   trap this describe measures.
        //
        //   Raised rather than relaxed, and with a stronger reason than usual:
        //   that file strips other files with lib/testing/strip-comments — the
        //   good one — BECAUSE of this suite. Its first draft carried the naive
        //   regex and ran a negative sweep with it over all of src, which is the
        //   combination the third test below exists to warn about; it was
        //   changed before it was committed. It never reads its own text.
        //   #637 raised this from 22 to 23. safe-redirect-path.test.ts now
        //   carries the hostile shapes it is about — `//evil.example`,
        //   `/\evil.example` — and the sweep regexes that look for them, so its
        //   own text is full of slashes inside quotes. Same mechanism, same
        //   reason for raising rather than relaxing: that file strips other
        //   files with its own line-based codeOnly(), not the block-eating
        //   regex measured here, and it never reads its own text.
        //   #663 raised this from 23 to 24, on the same test as every time
        //   before. mfa-enforcement-decided.test.ts quotes the file it replaces
        //   — including `expect(source('src/middleware.ts')).not.toMatch(/mfa|MFA/i)`,
        //   a regex literal inside a comment — which is the `/`-in-prose trap
        //   this describe measures.
        //
        //   Raised rather than relaxed, on the same test as every time: that
        //   file strips nothing with the naive regex. It reads raw source on
        //   purpose, because what it asserts about the routes is the presence
        //   of a call, and it never reads its own text.
        //   #676 A NAMED LIST, NOT A CEILING.
        //
        //   This had been raised four times — 21→22→23→24 — each time with a
        //   paragraph explaining why the new file was harmless. A fifth was due
        //   today: sms-sandbox-reporting.test.ts crossed the 10% threshold
        //   because PROSE WAS ADDED TO IT, which is the mechanism the note
        //   about harness-covers-adapter above already describes.
        //
        //   Four bumps in a row is the signal, not the noise. A ceiling only
        //   answers "how many", and every one of those paragraphs exists
        //   because the reader's real question was WHICH — and a ceiling also
        //   says nothing when a file silently drops OFF the list, which is the
        //   direction that would matter if a suite quietly stopped asserting.
        //
        //   #670 settled this shape for the lead-list drift check: replace the
        //   number with the membership. The list is generated from the
        //   measurement, so it is a record of what IS rather than of what
        //   somebody believed; what it adds is that a change in either
        //   direction names the file.
        //
        //   MEMBERSHIP IS ABOUT WHICH FILES THE NAIVE STRIPPER MANGLES, not
        //   about which files are read with it — that distinction is the
        //   existing framing of this whole describe, and the test below is the
        //   one that narrows the actual risk.
        //
        //   MUTATION-TESTED: dropping a file from the list and adding one the
        //   sweep does not find are both KILLED. A third mutant — replacing
        //   this line with `expect(AFFECTED.length).toBeGreaterThan(0)` —
        //   SURVIVED, and is recorded rather than chased: it does not mutate
        //   the subject, it substitutes a weaker assertion for this one, and no
        //   assertion can detect its own replacement. #670 met the same class
        //   and its cure — extract the decision as a named function with
        //   known answers — has nothing to bite on here, where the decision is
        //   "these two lists are equal".
        expect([...AFFECTED].sort()).toEqual(KNOWN_AFFECTED);
    });

        // EIGHTEEN became TWENTY when #691 added
        // a-declared-database-is-not-a-running-one.test.ts and edited
        // npm-scripts-can-actually-run.test.ts. ELEVENTH form, and both are the
        // plainest one: the first quotes the shell line
        // `if [ -n "$PG_URL" ]; then … fi` and the URL spellings
        // `postgres://` and `postgresql://`, and the second gained a paragraph
        // naming `.husky/pre-push`. Each carries `//` inside a quoted string,
        // which is exactly what the naive regex opens a comment at.
        //
        // Raised rather than relaxed, on the same test as every time. The first
        // strips ONE other file — scripts/pg-reachable.js — with
        // lib/testing/strip-comments, the good one, and reads the hook RAW
        // because a shell script has no block comments to confuse anything. The
        // second reads tsconfig.json through the good stripper. Neither reads
        // its own text, so no assertion in either can be misled by the mangling.
        //
        // TWENTY became TWENTY-ONE when #692 added
        // a-record-corrected-and-a-cache-that-kept-the-old-one.test.ts. TWELFTH
        // form, and the most self-referential yet: that file's own strip()
        // helper carries the literal '/*' and '//' — it is a suite ABOUT a
        // comment-stripping sweep, so the naive regex opens a block comment
        // inside the very expression written to keep line numbers honest.
        //
        // Raised rather than relaxed, on the same test as every time: it strips
        // OTHER files with its own line-preserving helper and reads
        // session-guard, cache-invalidation and redis through it, never its own
        // text.
        //
        // TWENTY-ONE became TWENTY-TWO when #740 added
        // the-spreadsheet-half-of-the-export-rule.test.ts. THIRTEENTH form, and
        // it is the CSV-quoting expression itself: that suite quotes
        // `replace(/"/g, '""')` to say what twelve admin screens used to carry,
        // and the `/"` opens a regex the naive stripper reads as division and
        // then loses its bearings in.
        //
        // Raised rather than relaxed, and this one is the exception worth
        // naming: it DOES read its own file — `code('src/lib/csv-safe.ts')` is
        // another file, but the suite also counts occurrences in csv-safe RAW
        // and STRIPPED. Both reads go through lib/testing/strip-comments, the
        // good one; the naive helper appears nowhere in it. The mangling
        // recorded here is what the naive stripper WOULD do to that text, which
        // nothing in the repository asks it to do.

    it('only ONE of them is application source, which is what narrows the risk', () => {
        // The rest are test files: they CARRY the naive helper, and nothing
        // strips them, so their own text being mangled by it is hypothetical.
        //
        // #810 took this from two to one. The ID card route fell below the 10%
        // threshold — see the long note at its removal from KNOWN_AFFECTED —
        // leaving csp.ts as the only application file the naive stripper
        // mangles. The narrower this is, the better; it is down to one.
        const appSource = AFFECTED.filter((f) => !f.includes('__tests__'));

        expect(appSource.sort()).toEqual([
            'src/lib/csp.ts',
        ]);
    });

    it('and neither is the subject of a not.toContain on stripped source', () => {
        // The dangerous combination, checked rather than assumed: stripped text
        // plus a negative assertion. csp.ts is read raw by the one suite that
        // reads it at all (asserted below), and nothing strips the PDF route.
        const suites = walk(join(ROOT, 'src/__tests__'))
            .concat(walk(join(ROOT, 'src/lib/__tests__')));
        const offenders: string[] = [];

        for (const f of suites) {
            const t = readFileSync(f, 'utf-8');
            for (const target of ['src/lib/csp.ts', 'src/app/api/id-card/pdf/route.ts']) {
                if (t.includes(`code('${target}')`) || t.includes(`code("${target}")`)) {
                    offenders.push(`${f.slice(ROOT.length + 1)} strips ${target}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    it('and the suites that strip csp.ts use raw source or the shared helper', () => {
        // The concrete consequence, closed. paystack-host-cannot-be-redirected
        // reads csp.ts with source() rather than code() and says why.
        const t = source('src/__tests__/unit/paystack-host-cannot-be-redirected.test.ts');
        expect(t).toContain("const csp = source('src/lib/csp.ts');");
        expect(t).toContain('comment opener to a regex-based stripper');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#827 — a quote inside a regex is not a string', () => {
    /**
     *   THE THIRD TRAP, AND IT WAS IN THE INSTRUMENT.
     *
     *   The scanner had three states — code, string, comment — and no state for
     *   a REGEX LITERAL. So in
     *
     *       .regex(/^[a-zA-Z\s\-']+$/, "Name can only contain letters…")
     *
     *   the `'` opened a phantom string and every comment from there to the
     *   next apostrophe came back UNSTRIPPED.
     *
     *   IT COST A REAL NUMBER. orphaned-actions-are-triaged pins the count of
     *   unreachable server actions. lib/schemas.ts carries a `@deprecated`
     *   comment naming `submitWaveApplicationAction` as uncalled; that prose
     *   leaked through as an identifier, so the scan counted the action as
     *   CALLED — by the sentence saying nothing calls it. The suite's own note
     *   recorded a hand-rolled stripper disagreeing and concluded "the real
     *   stripper wins". It did not.
     *
     *   Twenty-one production files were affected, including lib/security.ts
     *   and three of this codebase's own scanners.
     *
     * ── MUTATION LOG ────────────────────────────────────────────────────────
     *
     *     the regex-literal branch removed                           KILLED
     *     regexCanStartHere made unconditionally true                KILLED
     *     the JSX `<` rule removed                                   KILLED
     *     the newline resync removed                                 KILLED
     *     the character-class tracking removed                       KILLED
     *     reword a comment                               SURVIVED, intended
     *
     *   THREE OF THOSE SURVIVED THE FIRST RUN and the tests were widened until
     *   they did not. Removing the JSX rule, making regexCanStartHere always
     *   true, and dropping the character-class tracking all left this suite
     *   GREEN — because every case it had put the comment on the LINE AFTER the
     *   damage, where the newline resync cleans up after the fault and hides
     *   it. The cases that detect these put the comment on the SAME line.
     *
     *   That is this audit's most familiar failure, arriving in the tests
     *   written for the instrument that the audit's other tests depend on: a
     *   suite that executes the right code against the right input and only
     *   ever asks the question that was going to pass.
     *
     *   The orphan-count suite is NOT a canary for this any more, and that is
     *   recorded rather than assumed. Removing the regex branch leaves
     *   orphaned-actions-are-triaged green, because the file whose apostrophe
     *   caused the original desync — lib/schemas.ts — no longer holds that
     *   regex. The property lives here, where it is asserted directly.
     */

    /** The exact shape from lib/schemas.ts that started this. */
    const REAL_SHAPE = [
        "export const nameSchema = z.string()",
        "    .regex(/^[a-zA-Z\\s\\-']+$/, \"Name can only contain letters\")",
        "    .min(2);",
        "",
        "/**",
        " * @deprecated used ONLY by platform.ts",
        " * submitWaveApplicationAction (the old single-page form).",
        " */",
        "export const legacy = 1;",
    ].join("\n");

    it('THE COMMENT AFTER A REGEX WITH AN APOSTROPHE IS STRIPPED', () => {
        const out = stripComments(REAL_SHAPE, { label: 'schemas-shape' });
        //   THE assertion. This identifier appears only inside the comment, and
        //   a reachability scan reading it as code is what #827 cost.
        expect(out).not.toContain('submitWaveApplicationAction');
        expect(out).not.toContain('@deprecated');
        //   and the code around it survives
        expect(out).toContain('nameSchema');
        expect(out).toContain('export const legacy = 1;');
    });

    it.each([
        ["an apostrophe in a character class", "const re = /^[a-z\\-']+$/;"],
        ['a double quote in a character class', 'const re = /^[a-z"]+$/;'],
        ['a backtick in a character class', 'const re = /^[a-z`]+$/;'],
        ['an apostrophe outside a class', "const re = /don't/;"],
        ['a quote in a replace call', "s.replace(/[\\u2019']/g, \"-\");"],
    ])('AND THE SAME FOR %s', (_why, line) => {
        const out = stripComments(`${line}\n// SECRET_MARKER\nconst after = 1;\n`, { label: 'x' });
        expect(out).not.toContain('SECRET_MARKER');
        expect(out).toContain('const after = 1;');
    });

    it('CONTROL: the regex itself is kept verbatim — this strips comments, not code', () => {
        //   Or the fix would "pass" by deleting the thing it was meant to
        //   protect, which is the failure mode the gutting guard exists for.
        const out = stripComments("const re = /^[a-zA-Z\\s\\-']+$/;\n", { label: 'x' });
        expect(out).toContain("/^[a-zA-Z\\s\\-']+$/");
    });

    it('CONTROL: DIVISION IS NOT A REGEX', () => {
        /*
         *   The other way to be wrong, and the more dangerous one: treating a
         *   `/` that divides as opening a regex swallows real code until the
         *   next slash. `total / count` must survive untouched.
         */
        const src = 'const rate = total / count;\nconst other = a / b / c;\n// gone\nconst z = 1;\n';
        const out = stripComments(src, { label: 'x' });
        expect(out).toContain('const rate = total / count;');
        expect(out).toContain('const other = a / b / c;');
        expect(out).not.toContain('gone');
    });

    it('CONTROL: JSX CLOSING TAGS ARE NOT REGEXES', () => {
        /*
         *   The first draft of this fix read `</div>` as a regex opening, ate
         *   the tag name and everything to the next slash, and made two .tsx
         *   files WORSE than the bug it was fixing. Found by re-measuring
         *   rather than by reasoning, which is the only reason it is not in the
         *   repository.
         */
        const src = '<div className="a">text</div>\n// gone\nconst z = 1;\n';
        const out = stripComments(src, { label: 'x' });
        expect(out).toContain('</div>');
        expect(out).toContain('const z = 1;');
        expect(out).not.toContain('gone');
    });

    it('AND A TRAILING COMMENT ON THE SAME LINE AS A CLOSING TAG IS STILL STRIPPED', () => {
        /*
         *   THE case that actually detects the damage, and the first draft of
         *   this suite did not have it. Mutation found that: removing the JSX
         *   rule left the tests above GREEN, because reading `</div>` as a
         *   regex swallows `div>` and then stops at the newline — so the tag
         *   still appears in the output and nothing looks wrong.
         *
         *   Put a comment after the tag ON THE SAME LINE and the difference
         *   shows: the phantom regex runs to the first `/` of the `//`, and the
         *   comment survives. A test that cannot see the fault it is named for
         *   is the recurring failure of this audit, met again here.
         */
        const src = '<div>a</div> // gone\nconst z = 1;\n';
        const out = stripComments(src, { label: 'x' });
        expect(out).not.toContain('gone');
        expect(out).toContain('</div>');
        expect(out).toContain('const z = 1;');
    });

    it('AND A `/` INSIDE A CHARACTER CLASS DOES NOT END THE REGEX', () => {
        /*
         *   Also found by mutation: dropping the `inClass` tracking survived
         *   every case above. A regex whose class holds a slash — a path or URL
         *   matcher, of which this codebase has several — ends early without
         *   it, and the remainder of the line is then read as code.
         */
        const src = "const re = /^[a-z/']+$/; // gone\nconst z = 1;\n";
        const out = stripComments(src, { label: 'x' });
        expect(out).not.toContain('gone');
        expect(out).toContain("/^[a-z/']+$/");
        expect(out).toContain('const z = 1;');
    });

    it('AND `return /re/` IS A REGEX WHILE `count /re/` IS NOT', () => {
        //   The one genuinely ambiguous thing in JavaScript's grammar, resolved
        //   on the previous significant token.
        const kw = stripComments("function f() { return /a'b/.test(x); }\n// gone\nconst z = 1;\n", { label: 'x' });
        expect(kw).not.toContain('gone');
        expect(kw).toContain("/a'b/");

        const div = stripComments('const r = count / total;\nconst z = 1;\n', { label: 'x' });
        expect(div).toContain('count / total');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#827 — and a runaway string resyncs at the newline', () => {
    /**
     *   THE BOUND, and the honest half of this finding.
     *
     *   JSX TEXT is a fourth context this scanner does not model:
     *
     *       <p>We don't just export products.</p>
     *
     *   That apostrophe opens a phantom string exactly as the one in a regex
     *   did, and 43 files in this repository contain one. Nothing short of a
     *   real JSX parser can tell it from a quote.
     *
     *   So it is BOUNDED rather than solved. A `'…'` or `"…"` literal cannot
     *   cross a newline, so the scan abandons an unterminated one at the line
     *   break instead of believing it to the end of the file. The blast radius
     *   of every remaining case is the rest of ONE LINE.
     */
    const JSX_PROSE = [
        "<p>We don't just export products.</p>",
        '// this comment is AFTER the runaway line',
        'const after = 1;',
    ].join('\n');

    it('A COMMENT ON A LATER LINE IS STILL STRIPPED', () => {
        //   Before the resync, the phantom string opened by "don't" ran to the
        //   next apostrophe anywhere below — taking every comment with it.
        const out = stripComments(JSX_PROSE, { label: 'jsx' });
        expect(out).not.toContain('this comment is AFTER');
        expect(out).toContain('const after = 1;');
    });

    it('AND THE RUNAWAY IS REPORTED, WITH ITS LINE', () => {
        const diagnostics = { runawayStrings: [] as number[] };
        stripCommentsRaw(JSX_PROSE, diagnostics);
        expect(diagnostics.runawayStrings).toEqual([1]);
    });

    it('AND A CALLER THAT WANTS IT FATAL CAN ASK', () => {
        expect(() => stripComments(JSX_PROSE, { label: 'jsx', failOnRunawayString: true }))
            .toThrow(StripperAteTheFileError);
    });

    it('CONTROL: IT IS OFF BY DEFAULT, because it fires on good input', () => {
        /*
         *   43 of this repository's files are legitimate JSX prose. A guard
         *   that fires on good input gets switched off, and then guards
         *   nothing — the reason already recorded for minRetainedRatio, met a
         *   second time and answered the same way.
         */
        expect(() => stripComments(JSX_PROSE, { label: 'jsx' })).not.toThrow();
    });

    it('CONTROL: A TEMPLATE LITERAL MAY CROSS LINES AND IS NOT A RUNAWAY', () => {
        //   Backticks are excluded from the resync on purpose; CSS-in-JS and
        //   every multi-line template in this codebase depends on it.
        const src = 'const css = `\n  .a { color: red; }\n  /* a CSS comment */\n`;\nconst z = 1;\n';
        const diagnostics = { runawayStrings: [] as number[] };
        const out = stripCommentsRaw(src, diagnostics);
        expect(diagnostics.runawayStrings).toEqual([]);
        expect(out).toContain('/* a CSS comment */');
        expect(out).toContain('const z = 1;');
    });
});
