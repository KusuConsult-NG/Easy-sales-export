/**
 * @jest-environment jsdom
 */

/**
 *   #917 THE REDIRECT GUARD TRUSTED ITS OWN SECOND ARGUMENT.
 *
 *   Found auditing src/app/auth/login/page.tsx and src/app/auth/login/admin/page.tsx
 *   — two of the files no test had named. Both are four-line wrappers, and the
 *   thing worth checking was not in them but in what the second one passes down.
 *
 *   safeInternalPath was:
 *
 *       return isSafeInternalPath(value) ? value!.replace(LEADING_STRIPPED, "") : fallback;
 *
 *   The fallback went back to the caller unexamined. The whole point of the
 *   function is that a redirect destination has been through the rule; on the
 *   REFUSAL path — the one that runs when somebody is attacking it — nothing had.
 *
 * ── MEASURED BEFORE CALLING IT LIVE, AND IT IS NOT ──────────────────────────
 *
 *   Four call sites, and every fallback today is a safe literal or the empty
 *   sentinel:
 *
 *       RegisterForm         "/dashboard"
 *       LoginForm            defaultCallbackUrl   ← a PROP
 *       LoginForm            "/"
 *       ModuleRegisterPage   ""                    ← documented sentinel
 *
 *   So there is no open redirect to exploit. What makes it worth fixing rather
 *   than recording is the second one: `defaultCallbackUrl` is a prop, defaulting
 *   to "/dashboard", and /auth/login/admin passes "/admin". A prop is the one
 *   kind of argument a future caller supplies without reading the function, and
 *
 *       <LoginForm defaultCallbackUrl="https://elsewhere.example" />
 *
 *   would have made the guard hand back exactly the value it exists to refuse —
 *   on the login screen, to a person who has just typed their password. The
 *   safety of every redirect rested on four callers each remembering a rule the
 *   guard was perfectly capable of enforcing.
 *
 * ── WHY THE EMPTY STRING IS STILL ALLOWED ───────────────────────────────────
 *
 *   ModuleRegisterPage passes "" and says why: "it is what lets the server action
 *   choose the module's own onboarding page rather than a module root." It is a
 *   documented "no destination" sentinel rather than a path — `isSafeInternalPath("")`
 *   is false for the right reason — and coercing it to "/" would change that
 *   page's behaviour. So it is permitted by name, not by accident, and that is
 *   asserted below so a later tidy-up cannot quietly drop it.
 *
 *   Everything else unsafe fails closed to "/", the one destination that cannot
 *   be an attack because it is this origin's own root.
 *
 *   The existing safe-redirect-path suite — 22 assertions, including the
 *   control-character fixtures that make the file read as binary to grep — still
 *   passes untouched. Its case for this function is called "safeInternalPath
 *   hands back the fallback rather than the hostile value", which is exactly
 *   right about the value and says nothing about the fallback. That is the gap.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { safeInternalPath, isSafeInternalPath } from '@/lib/safe-redirect';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.15 });

/** Suppress and collect the refusal warning. */
function withWarnings<T>(run: () => T): { result: T; warnings: string[] } {
    const warnings: string[] = [];
    const spy = jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
    });
    try {
        return { result: run(), warnings };
    } finally {
        spy.mockRestore();
    }
}

describe('#917 — the guard checks the fallback as well as the value', () => {
    it('THE CONTROL: a safe value still comes straight back', () => {
        //   First, because everything below is about refusal paths and a function
        //   that refused everything would satisfy most of them.
        expect(safeInternalPath('/dashboard', '/')).toBe('/dashboard');
        expect(safeInternalPath('/admin/users?q=1', '/')).toBe('/admin/users?q=1');
    });

    it('REFUSES AN ABSOLUTE FALLBACK AND FAILS CLOSED TO "/"', () => {
        //   The defect. Before the fix each of these returned the attacker's
        //   host, because the value was refused and the fallback was not checked.
        const hostile = [
            'https://elsewhere.example/steal',
            'http://elsewhere.example',
            '//elsewhere.example',
            '/\\elsewhere.example',
            'javascript:alert(1)',
        ];

        for (const fallback of hostile) {
            const { result, warnings } = withWarnings(() => safeInternalPath('//evil.example', fallback));

            expect({ fallback, result }).toEqual({ fallback, result: '/' });
            expect(warnings.some((w) => w.includes('refused an unsafe fallback'))).toBe(true);
        }
    });

    it('and it says which fallback it refused', () => {
        //   A guard that fails closed silently is how the next person spends an
        //   afternoon on "why does login go to the home page".
        const { warnings } = withWarnings(() => safeInternalPath(null, 'https://elsewhere.example'));

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('elsewhere.example');
        expect(warnings[0]).toContain('safeInternalPath');
    });

    it('THE EMPTY SENTINEL SURVIVES, because ModuleRegisterPage depends on it', () => {
        //   Not an oversight and not a path. `""` means "no caller preference",
        //   which lets registerAction choose the module's own onboarding page.
        const { result, warnings } = withWarnings(() => safeInternalPath(null, ''));

        expect(result).toBe('');
        //   And it is not treated as a refusal, so it does not fill the log.
        expect(warnings).toEqual([]);

        //   The sentinel is deliberately NOT a safe path by the module's own rule
        //   — which is why it has to be allowed by name.
        expect(isSafeInternalPath('')).toBe(false);
    });

    it('a safe fallback is returned, with control characters stripped', () => {
        //   The same normalisation the value gets. A fallback carrying a leading
        //   control character would otherwise be handed to a navigation in a form
        //   the browser reads differently from this check.
        expect(safeInternalPath(null, '/dashboard')).toBe('/dashboard');
        expect(safeInternalPath(null, '\u0000/dashboard')).toBe('/dashboard');
        expect(safeInternalPath(null, '  /admin')).toBe('/admin');
    });

    it('POSITIVE CONTROL: the rule itself has not been widened', () => {
        //   The cheap way to make every assertion above pass is to make
        //   isSafeInternalPath accept more. It must not.
        expect(isSafeInternalPath('//elsewhere.example')).toBe(false);
        expect(isSafeInternalPath('/\\elsewhere.example')).toBe(false);
        expect(isSafeInternalPath('https://elsewhere.example')).toBe(false);
        expect(isSafeInternalPath('/dashboard')).toBe(true);
    });
});

describe('#917 — every fallback in the codebase is safe or the sentinel', () => {
    function walk(dir: string, out: string[] = []): string[] {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                if (entry !== 'node_modules') walk(full, out);
            } else if (/\.tsx?$/.test(full)) {
                out.push(full);
            }
        }
        return out;
    }

    /**
     * Each `safeInternalPath(value, fallback)` call and its literal fallback.
     *
     *   A BALANCED SCAN, NOT A REGEX. The first draft was
     *   `/safeInternalPath\(([^;]*?)\)/` and split the capture on commas. It
     *   reported ModuleRegisterPage's fallback as
     *   `searchParams.get("callbackUrl"` — because the non-greedy `\)` matched
     *   the paren closing `get(...)`, not the one closing the call. A nested call
     *   in the first argument is the ordinary case here, so the regex was wrong
     *   about the only file whose fallback is interesting.
     *
     *   Third instrument bug of this audit, same shape each time: the sweep was
     *   narrower than the code it read. Depth-and-quote tracking is a dozen lines
     *   and cannot be fooled by an argument that contains a call.
     */
    function callSites(): { file: string; fallback: string }[] {
        const out: { file: string; fallback: string }[] = [];

        for (const file of walk(join(ROOT, 'src'))) {
            const rel = relative(ROOT, file);
            if (/__tests__|\.test\./.test(rel) || rel === 'src/lib/safe-redirect.ts') continue;

            const src = stripComments(readFileSync(file, 'utf8'), { label: rel });
            const needle = 'safeInternalPath(';
            let from = 0;

            for (;;) {
                const start = src.indexOf(needle, from);
                if (start === -1) break;
                from = start + needle.length;

                let depth = 1;
                let quote: string | null = null;
                const args: string[] = [];
                let current = '';

                for (let i = from; i < src.length && depth > 0; i++) {
                    const ch = src[i];

                    if (quote) {
                        if (ch === quote && src[i - 1] !== '\\') quote = null;
                        current += ch;
                        continue;
                    }
                    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; current += ch; continue; }
                    if (ch === '(') { depth++; current += ch; continue; }
                    if (ch === ')') {
                        depth--;
                        if (depth === 0) { args.push(current); break; }
                        current += ch;
                        continue;
                    }
                    if (ch === ',' && depth === 1) { args.push(current); current = ''; continue; }
                    current += ch;
                }

                out.push({ file: rel, fallback: (args[args.length - 1] ?? '').trim() });
            }
        }

        return out;
    }

    it('POSITIVE CONTROL: the scanner reads an argument that contains a call', () => {
        //   The exact shape the regex got wrong, asserted directly. Without this
        //   the sweep could silently regress to reading truncated arguments and
        //   the allow-list would grow to accommodate them.
        const sites = callSites();
        const moduleRegister = sites.find((s) => s.file === 'src/components/auth/ModuleRegisterPage.tsx');

        expect(moduleRegister).toBeDefined();
        expect(moduleRegister!.fallback).toBe('""');
    });

    it('THE CONTROL: the sweep finds all four call sites', () => {
        const sites = callSites();

        expect(sites.length).toBe(4);
        expect(new Set(sites.map((s) => s.file))).toEqual(new Set([
            'src/components/auth/RegisterForm.tsx',
            'src/components/auth/LoginForm.tsx',
            'src/components/auth/ModuleRegisterPage.tsx',
        ]));
    });

    it('and each fallback is a safe literal, the sentinel, or a checked prop', () => {
        const allowed = new Set([
            '"/dashboard"',
            '"/"',
            '""',
            //   LoginForm's fallback is its prop. The prop is why the guard now
            //   checks the fallback at all, and the next case pins the only value
            //   any caller passes for it.
            'defaultCallbackUrl',
        ]);

        for (const { file, fallback } of callSites()) {
            expect({ file, fallback, allowed: allowed.has(fallback) })
                .toEqual({ file, fallback, allowed: true });
        }
    });
});

describe('#917 — the two login pages, which is where this started', () => {
    const PLAIN = 'src/app/auth/login/page.tsx';
    const ADMIN = 'src/app/auth/login/admin/page.tsx';

    it('the admin door differs only by its destination, and it is a safe literal', () => {
        const admin = code(ADMIN);

        expect(admin).toContain('defaultCallbackUrl="/admin"');
        expect(isSafeInternalPath('/admin')).toBe(true);
        //   It is a DESTINATION, not a privilege. Nothing here grants anything —
        //   worth asserting, because a route called /auth/login/admin reads as
        //   though it might.
        expect(admin).not.toMatch(/role|isAdmin|permission/i);
    });

    it('and the plain door passes no destination at all', () => {
        //   So LoginForm's own default ("/dashboard") applies.
        const plain = code(PLAIN);

        expect(plain).toContain('<LoginForm />');
        expect(plain).not.toContain('defaultCallbackUrl');
    });

    it('BOTH WRAP LoginForm IN Suspense, which is not decoration', () => {
        /*
         *   LoginForm calls useSearchParams(). In the App Router a component that
         *   does so must sit under a Suspense boundary, or the page it is in
         *   bails out of prerendering — and `next build` reports it. Neither the
         *   unit suite nor tsc can see that, which is the same class as #910's
         *   two findings: a build-time constraint no local gate checks.
         *
         *   Pinned on both doors, because the admin one is a copy of the plain
         *   one and a copy is where a boundary gets dropped.
         */
        for (const rel of [PLAIN, ADMIN]) {
            const src = code(rel);

            expect({ rel, suspense: src.includes('<Suspense') }).toEqual({ rel, suspense: true });
            expect({ rel, imported: /from "react"/.test(src) && src.includes('Suspense') })
                .toEqual({ rel, imported: true });
            //   And a fallback to render while it suspends, rather than nothing.
            expect({ rel, hasFallback: src.includes('fallback=') }).toEqual({ rel, hasFallback: true });
        }
    });

    it('and the premise: LoginForm really does read the search params', () => {
        //   If it stopped, the Suspense assertion above would be pinning
        //   ceremony. This is what makes the boundary load-bearing.
        expect(code('src/components/auth/LoginForm.tsx')).toContain('useSearchParams()');
    });
});
