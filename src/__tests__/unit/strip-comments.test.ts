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
        expect(out).toContain('if (!hasAdminPermission(roles, "users:create")) {');
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
    const KNOWN_AFFECTED: string[] = [
        'src/__tests__/unit/a-certificate-that-named-a-page-that-was-not-there.test.ts',
        'src/__tests__/unit/a-declared-database-is-not-a-running-one.test.ts',
        'src/__tests__/unit/admin-approval-audit.test.ts',
        'src/__tests__/unit/admin-permission-gates.test.ts',
        'src/__tests__/unit/admin-route-authority.test.ts',
        'src/__tests__/unit/an-admin-screen-wearing-the-wrong-chrome.test.ts',
        'src/__tests__/unit/broadcast-access.test.ts',
        'src/__tests__/unit/client-reads-the-answer.test.ts',
        'src/__tests__/unit/cooperative-withdrawal-doors.test.ts',
        'src/__tests__/unit/export-window-expiry.test.ts',
        'src/__tests__/unit/finance-reconcile-permission.test.ts',
        'src/__tests__/unit/harness-covers-adapter.test.ts',
        'src/__tests__/unit/kyc-route-bypass.test.ts',
        'src/__tests__/unit/loan-application-refusal-is-visible.test.ts',
        'src/__tests__/unit/mfa-enforcement-decided.test.ts',
        'src/__tests__/unit/npm-scripts-can-actually-run.test.ts',
        'src/__tests__/unit/paystack-host-cannot-be-redirected.test.ts',
        'src/__tests__/unit/repair-and-public-catalog.test.ts',
        'src/__tests__/unit/revalidate-tag-profile-is-real.test.ts',
        'src/__tests__/unit/safe-redirect-path.test.ts',
        'src/__tests__/unit/sms-sandbox-reporting.test.ts',
        'src/__tests__/unit/storage-backend-single-rule.test.ts',
        'src/__tests__/unit/strip-comments.test.ts',
        'src/__tests__/unit/the-audit-log-had-two-vocabularies.test.ts',
        'src/__tests__/unit/the-export-sweep-only-walked-the-browser.test.ts',
        'src/app/api/id-card/pdf/route.ts',
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

    it('and the files where it does not is a KNOWN list — eleven, not one', () => {
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

    it('only two of them are application source, which is what narrows the risk', () => {
        // The other seven are test files: they CARRY the naive helper, and
        // nothing strips them, so their own text being mangled by it is
        // hypothetical. These two are stripped by real suites.
        const appSource = AFFECTED.filter((f) => !f.includes('__tests__'));

        expect(appSource.sort()).toEqual([
            'src/app/api/id-card/pdf/route.ts',
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
