/**
 * @jest-environment node
 */

/**
 *   #698 THE LOGIN FORM PUT THE PASSWORD IN THE QUERY STRING.
 *
 *   Found by accident, and that is worth saying plainly: it surfaced while
 *   verifying a PERFORMANCE script, when a scripted login against a real render
 *   of this application left the browser sitting at
 *
 *       /auth/login?redirectTo=%2Fdashboard&email=probe%40example.test
 *                  &password=not-a-real-password
 *
 *   A `<form>` with no `method` attribute submits GET. The login form is
 *
 *       <form onSubmit={handleSubmit} className="...">
 *
 *   — no `method`, no `action` — so the ONLY thing standing between a password
 *   and the address bar is `handleSubmit` calling preventDefault. That handler
 *   exists once React has hydrated. Before then the markup is already on screen,
 *   the inputs already accept text and the button is already clickable, because
 *   they are ordinary DOM.
 *
 *   SO THE WINDOW IS REAL, and it is not only the fast typist:
 *
 *     - between first paint and hydration on a slow phone or a slow network,
 *       which is seconds, not milliseconds;
 *     - if the JS bundle fails to arrive at all — a CDN hiccup, a blocked
 *       script, an extension;
 *     - if ANY error is thrown during hydration, which detaches the handler for
 *       the whole page and leaves the form looking perfectly normal.
 *
 *   In every one of those the password goes into the URL, and the URL goes into
 *   browser history, the server's access log, any proxy or CDN log in front of
 *   it, and the `Referer` header of every external resource the resulting page
 *   loads.
 *
 * ── MEASURED, FROM THE HTML THE APPLICATION ACTUALLY SERVES ─────────────────
 *
 *   Not inferred from the source. `curl` against a running instance:
 *
 *       /auth/login     <form class="space-y-5 md:space-y-6">
 *       /auth/register  <form class="space-y-6" action="" method="POST" ...>
 *
 *   THE PLATFORM ALREADY GETS THIS RIGHT WHERE IT USES A SERVER ACTION.
 *   `<form action={formAction}>` is rendered by React with `method="POST"` and
 *   works without JavaScript at all — that is the whole point of the
 *   progressive-enhancement form. RegisterForm, ModuleRegisterPage and
 *   reset-password all use it and were never exposed.
 *
 *   The four that used `onSubmit` alone were:
 *
 *     components/auth/LoginForm                 email + password
 *     app/auth/reset-legacy-password            the new password
 *     app/profile/ProfileClient (change pw)     current, new and confirm
 *     app/profile/ProfileClient (disable MFA)   a live TOTP code
 *
 *   The same correct rule reaching some of the doors that need it, which is by
 *   now the most common shape in this audit.
 *
 * ── WHY `method="post"` IS THE WHOLE FIX ────────────────────────────────────
 *
 *   After hydration nothing changes at all: handleSubmit still calls
 *   preventDefault and the fetch goes out exactly as before. The attribute only
 *   governs the NATIVE submit, and it moves those fields from the query string
 *   into the request body. A POST to a page route with no POST handler answers
 *   405 — a visible failure the person can retry, which is strictly better than
 *   a silent credential leak that looks like a successful page load.
 *
 *   NOT DONE, and recorded rather than quietly skipped: the submit button is
 *   still clickable before hydration, so a pre-hydration submit now produces a
 *   405 instead of working. Disabling it until mounted would be better UX and is
 *   a change to six components' render paths; it is not what stops the leak, and
 *   the leak is what this finding is about.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();

/** Every component the application renders. */
function sources(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            if (entry === 'node_modules' || entry === '__tests__' || entry === '.next') continue;
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) { walk(full); continue; }
            if (/\.tsx$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
        }
    };
    walk(join(ROOT, 'src'));
    return out;
}

const FILES = sources();

/** The opening tag of one `<form ...>`, from `<` to the matching `>`. */
function formTagAt(src: string, at: number): { tag: string; end: number } {
    let depth = 0;
    for (let i = at; i < src.length; i++) {
        const c = src[i];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        //   A `>` inside a JSX expression — an arrow function, a comparison — is
        //   not the end of the tag. Only one at brace depth zero is.
        else if (c === '>' && depth === 0) return { tag: src.slice(at, i + 1), end: i + 1 };
    }
    return { tag: src.slice(at), end: src.length };
}

/**
 * Does this form carry a credential?
 *
 * Scoped to the form's OWN body — from its opening tag to its `</form>` — rather
 * than to the file, because ProfileClient holds seven forms and only two of them
 * take a password. A file-level test would have called the other five a finding.
 *
 *   THE DETECTOR WAS WRONG FIRST, AND IT FOUND ONLY TWO OF THE FOUR. It asked
 *   for `type="password"`, which misses both of the shapes this codebase
 *   actually writes:
 *
 *     type={showNew ? "text" : "password"}   the show/hide toggle, in
 *                                            reset-legacy-password, three times
 *     type="text" value={mfaToken}           the MFA form — a live second
 *                                            factor, and not a password at all
 *
 *   A sweep that reads one spelling of a field is the same defect as a reader
 *   narrower than its writers, committed inside the test for it. It matches the
 *   literal `"password"` anywhere in the form body — which covers the ternary —
 *   and any value bound to a name that means a secret.
 *
 *   AND IT WAS STILL WRONG ON THE THIRD PASS, by one form. `\btoken` cannot
 *   match inside `mfaToken`: there is no word boundary in the middle of a
 *   camelCase identifier. The boundary is dropped, and `code` is dropped with it
 *   — it is too generic to sit in an unanchored match (`barcode`, `postcode`,
 *   `countryCode`), and the MFA field is caught by `token` anyway. Narrowing a
 *   detector to avoid a false positive is how the first version got it wrong;
 *   the answer is a name that means a secret in any spelling, not a looser one.
 */
const CREDENTIAL_INPUT = /["']password["']|value=\{[^}]*(password|secret|otp|totp|mfa|token)/i;

interface FormSite { where: string; line: number; tag: string; carriesCredential: boolean }

function formSites(): FormSite[] {
    const sites: FormSite[] = [];
    for (const file of FILES) {
        const src = readFileSync(file, 'utf8');
        let at = src.indexOf('<form');
        while (at !== -1) {
            const { tag, end } = formTagAt(src, at);
            const close = src.indexOf('</form>', end);
            const body = src.slice(end, close < 0 ? end + 4000 : close);
            sites.push({
                where: relative(ROOT, file),
                line: src.slice(0, at).split('\n').length,
                tag,
                carriesCredential: CREDENTIAL_INPUT.test(body),
            });
            at = src.indexOf('<form', end);
        }
    }
    return sites;
}

/**
 * A form is safe when a NATIVE submit cannot put its fields in the URL.
 *
 * Two ways, both real: an explicit `method="post"`, or `action={someAction}` —
 * a React server action, which is rendered with method="POST" and is the reason
 * the register form was never exposed.
 */
const submitsSafely = (tag: string): boolean =>
    /\bmethod=["']post["']/i.test(tag) || /\baction=\{/.test(tag);

// ─────────────────────────────────────────────────────────────────────────────
describe('#698 — no form may submit a credential in the query string', () => {
    it('THE SWEEP IS READING THE APPLICATION', () => {
        //   THE control. Every assertion below is about a list of forms, and an
        //   empty list agrees with any expectation about it.
        const sites = formSites();
        expect(FILES.length).toBeGreaterThan(200);
        expect(sites.length).toBeGreaterThan(10);
        expect(sites.some((s) => s.carriesCredential)).toBe(true);
    });

    it('AND EVERY FORM CARRYING ONE DECLARES HOW IT SUBMITS', () => {
        /*
         *   FAILS IN BOTH DIRECTIONS ON PURPOSE. A new credential form without
         *   `method="post"` fails here; so does removing it from one that has
         *   it. Named rather than counted, so a failure says which form.
         */
        const exposed = formSites()
            .filter((s) => s.carriesCredential && !submitsSafely(s.tag))
            .map((s) => `${s.where}:${s.line}`)
            .sort();

        expect({ exposed }).toEqual({ exposed: [] });
    });

    it('AND THE FOUR THIS FINDING REPAIRED STILL DECLARE IT', () => {
        /*
         *   The sweep above is a rule; this is the evidence behind it. Pinned by
         *   name so that a refactor which drops the attribute fails with the
         *   finding's own file list rather than with an anonymous count.
         */
        const byFile = new Map(formSites().filter((s) => s.carriesCredential)
            .map((s) => [`${s.where}:${s.line}`, s.tag]));

        const repaired = [...byFile.entries()]
            .filter(([k]) => /LoginForm|reset-legacy-password|ProfileClient/.test(k));

        expect(repaired.length).toBeGreaterThanOrEqual(4);
        for (const [where, tag] of repaired) {
            expect({ where, post: /\bmethod=["']post["']/i.test(tag) })
                .toEqual({ where, post: true });
        }
    });

    it('AND A SERVER-ACTION FORM IS ACCEPTED WITHOUT AN EXPLICIT method', () => {
        /*
         *   The other half of the rule, and the reason it is not "every form
         *   must say method". React renders `action={fn}` with method="POST" —
         *   measured against the served HTML of /auth/register, which came back
         *   `<form class="space-y-6" action="" encType="multipart/form-data"
         *   method="POST">`. Demanding the literal attribute there would have
         *   been a false finding on three forms that were always safe.
         */
        expect(submitsSafely('<form action={formAction} className="space-y-6">')).toBe(true);
        expect(submitsSafely('<form method="post" onSubmit={h}>')).toBe(true);
        expect(submitsSafely('<form onSubmit={h} className="x">')).toBe(false);
        //   A string action is NOT a server action and does not imply POST.
        expect(submitsSafely('<form action="/search" onSubmit={h}>')).toBe(false);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     the login form loses method=post again                          KILLED
 *     submitsSafely says every form is safe                           KILLED
 *     the detector stops finding any credential form                  KILLED
 *     a plain string action counts as safe                            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword the header                                            SURVIVED ✓
 *
 *   THE DETECTOR ITSELF WAS THE HARD PART, and it was wrong twice before it was
 *   right — first missing the show/hide ternary, then missing `mfaToken` because
 *   `\b` does not exist inside a camelCase identifier. Both were found by
 *   printing what the sweep actually matched and comparing it against the four
 *   forms known to need repair, rather than by trusting a green test: the second
 *   version passed the exposure assertion perfectly well while being blind to
 *   one of the four forms this finding is about.
 */
