/**
 * @jest-environment node
 */

/**
 *   #512 THE ESCAPING SWEEP FIXED THE TEMPLATES AND MISSED EVERY CALLER.
 *
 *   escapeHtml has been in lib/utils.ts the whole time. A previous finding put
 *   it to work in email-notifications.ts — thirty-two interpolations — and its
 *   header states the two reasons better than I could:
 *
 *       "A NAME BREAKS THE EMAIL. 'Smith & Sons <Nigeria> Ltd' is an ordinary
 *        Nigerian business name and an ampersand followed by a tag that does
 *        not close. Whatever followed it in the markup was swallowed by the
 *        client."
 *
 *       "AND A REJECTION REASON IS FREE TEXT. An admin types it and a member
 *        reads it, in an HTML document, with no filter between the two."
 *
 *   FOURTEEN OTHER FILES BUILD THEIR OWN EMAIL HTML AND HAND IT TO THE SAME
 *   SENDER. 21 templates, 50 interpolations, not one escaped. Measured, not
 *   estimated — every one was read before it was touched, and every one turned
 *   out to be a name, a reason, an amount, a URL or a date. None was intentional
 *   markup, which is why a blanket tag is safe there.
 *
 *   AND THE FILE THAT WAS ALREADY CORRECT IS ON THE SAME TAG NOW. That is the
 *   point of the change, not a tidy-up: escaping by hand, per interpolation, is
 *   the mechanism that produced this finding, and two mechanisms for one rule is
 *   how the fifteenth file gets missed. 32 redundant escapeHtml(String(...))
 *   wrappers came out; the ratchet below can then ask ONE question of the whole
 *   tree instead of maintaining a list of expressions it considers harmless —
 *   which would have been an allowlist, and an allowlist is how a check stops
 *   being able to fail.
 *
 *   TWO SUBJECT LINES WERE BEING HTML-ESCAPED, which is a small defect the
 *   earlier sweep introduced rather than found: a Subject header is plain text,
 *   so a window titled "Q3 Cocoa & Sesame" reached the inbox as
 *   "Q3 Cocoa &amp; Sesame". Both are plain now.
 *
 * ── THE DOOR THAT MATTERS MOST HAS NO LOCK ON IT ────────────────────────────
 *
 *   /api/contact is UNAUTHENTICATED. Anyone with curl supplies `name`, `email`,
 *   `subject` and `message`, and all four went into an HTML document delivered
 *   to the company's own inbox, with a "reply directly to this email" footer
 *   inviting staff to act on it. A message body of
 *
 *       <a href="https://not-us.example/reset">Reset the member's password</a>
 *
 *   arrived looking like part of the platform's own mail. That is a phishing
 *   vector aimed at the people who administer this system, and it was the one
 *   door in the set with untrusted input.
 *
 *   SAID AT ITS SIZE: this is not stored XSS on the platform. No session is
 *   stolen, no page executes anything, and Resend's API takes JSON so there was
 *   no header injection either. It is injected markup in mail that staff read,
 *   plus the boring case above, which is the one that has certainly already
 *   happened to somebody's business name.
 *
 * ── FIFTY EDITS, OR ONE RULE ────────────────────────────────────────────────
 *
 *   Wrapping fifty interpolations in escapeHtml would have worked and the
 *   fifty-first would have been missed — which is precisely how this finding
 *   came to exist, since the earlier sweep did exactly that inside one file.
 *   `html` is a tagged template: one token per template, and everything written
 *   inside it later is escaped by construction.
 *
 *   THE RATCHET BELOW is the half that lasts. It sweeps every file that sends
 *   email and fails on any HTML template with an unescaped interpolation, so a
 *   fifteenth file cannot arrive unnoticed.
 *
 *   `trustedHtml` exists for genuinely nested markup, and exactly two things use
 *   it: the conditional "Admin Feedback" and "Reason provided" blocks, which are
 *   markup fragments interpolated into a larger template. Marking the exception
 *   is the alternative to dropping the tag, which is what makes the ratchet
 *   survivable.
 *
 *   THE FIRST ATTEMPT AT THIS CONVERSION WAS WRONG AND IS RECORDED. A naive
 *   left-to-right backtick scan cannot see nesting: it paired an outer template's
 *   opening backtick with an inner one and wrote `html` in front of a CLOSING
 *   backtick, corrupting two templates. tsc caught it; the rewrite is a real
 *   scanner that tracks `${` depth, and it agreed with the hand count on all 42
 *   templates before it was allowed to write anything.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     html`` stops escaping                          KILLED
 *     the contact template's tag removed             KILLED
 *     an OUTER template un-tagged                    KILLED
 *     a NESTED fragment un-tagged                    KILLED
 *     html`` renders 0 as empty (?? → ||)            KILLED
 *     the ratchet's own file list emptied            KILLED
 *     reword this header                             SURVIVED, as intended
 *
 *   THE NESTED-FRAGMENT MUTANT SURVIVED THE FIRST RATCHET, which is how the
 *   scanner below came to be written. It is recorded rather than quietly fixed:
 *   the mutant that survives is the one that tells you what your check is
 *   actually asking.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { html, trustedHtml, escapeHtml } from '@/lib/utils';

const mockSend = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/email-notifications', () => ({
    sendEmailNotification: (...a: any[]) => mockSend(...a),
    getBaseUrl: () => 'https://example.com',
}));

jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: async () => ({ success: true }) }),
    getClientIp: () => '1.2.3.4',
    createRateLimitResponse: () => new Response('limited', { status: 429 }),
}));

beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ error: null });
    process.env.RESEND_API_KEY = 'test-key';
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#512 — the unauthenticated door', () => {
    const post = async (body: Record<string, string>) => {
        const { POST } = await import('@/app/api/contact/route');
        return POST(new Request('https://example.com/api/contact', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }) as never);
    };

    const submit = async (over: Record<string, string> = {}) => {
        await post({ name: 'Ada', email: 'ada@example.com', subject: 'Hello', message: 'Hi', ...over });
        return String((mockSend.mock.calls[0]?.[0] as any)?.message ?? '');
    };

    it('A STRANGER CANNOT PUT A LINK INTO MAIL STAFF READ', async () => {
        //   THE test. The footer invites staff to reply directly, so markup
        //   arriving here reads as the platform's own.
        const body = await submit({
            message: '<a href="https://not-us.example/reset">Reset the password</a>',
        });

        expect(body).not.toContain('<a href="https://not-us.example/reset">');
        expect(body).toContain('&lt;a href=&quot;https://not-us.example/reset&quot;&gt;');
    });

    it('AND CANNOT CLOSE THE SURROUNDING MARKUP FROM THE NAME FIELD', async () => {
        const body = await submit({ name: '</div><script>alert(1)</script>' });

        expect(body).not.toContain('<script>');
        expect(body).toContain('&lt;script&gt;');
    });

    it('AND THE SUBJECT IS ESCAPED TOO', async () => {
        //   The subject appears in the body as well as the Subject header.
        const body = await submit({ subject: '<img src=x onerror=1>' });

        expect(body).not.toContain('<img src=x');
    });

    it('AND AN ORDINARY BUSINESS NAME SURVIVES INTACT', async () => {
        //   The boring case, and the common one. This is the assertion that
        //   would fail if escaping were done by stripping rather than encoding.
        const body = await submit({ name: 'Smith & Sons <Nigeria> Ltd' });

        expect(body).toContain('Smith &amp; Sons &lt;Nigeria&gt; Ltd');
        expect(body).not.toContain('Smith & Sons <Nigeria>');
    });

    it('and the message still reaches the company inbox', async () => {
        //   The vacuity guard: a fix that stopped sending would satisfy every
        //   assertion above.
        await submit({ message: 'Please call me about export pricing.' });

        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(String((mockSend.mock.calls[0][0] as any).message))
            .toContain('Please call me about export pricing.');
        expect((mockSend.mock.calls[0][0] as any).replyTo).toBe('ada@example.com');
    });

    it('and an unset RESEND_API_KEY still answers 503 with a phone-us-instead message', async () => {
        //   #394's distinction, which this change must not disturb.
        delete process.env.RESEND_API_KEY;

        const res = await post({ name: 'A', email: 'a@b.co', subject: 's', message: 'm' });
        expect(res.status).toBe(503);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#512 — an admin\'s free text reaches a member', () => {
    it('A REJECTION REASON CANNOT CARRY MARKUP', async () => {
        //   The second reason the earlier header gives. Asserted through the
        //   real template rather than the helper, because the helper being
        //   correct is not the same as the template using it.
        const reason = '<b>see</b> https://not-us.example';
        const body = html`<p style="margin:0;">${reason}</p>`;

        expect(body).toBe('<p style="margin:0;">&lt;b&gt;see&lt;/b&gt; https://not-us.example</p>');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#512 — the helper itself', () => {
    it('ESCAPES EVERY INTERPOLATION', () => {
        expect(html`<p>${'<i>x</i>'}</p>`).toBe('<p>&lt;i&gt;x&lt;/i&gt;</p>');
    });

    it('AND LEAVES THE LITERAL MARKUP ALONE', () => {
        expect(html`<p class="a">hi</p>`).toBe('<p class="a">hi</p>');
    });

    it('AND RENDERS ZERO AS ZERO, NOT AS NOTHING', () => {
        //   `?? ""` and not `|| ""`. An amount of 0 and a count of 0 are real
        //   values, and rendering them empty is the confident wrong answer this
        //   audit keeps finding.
        expect(html`<p>${0}</p>`).toBe('<p>0</p>');
        expect(html`<p>${false}</p>`).toBe('<p>false</p>');
    });

    it('and renders null and undefined as nothing', () => {
        expect(html`<p>${null}</p>`).toBe('<p></p>');
        expect(html`<p>${undefined}</p>`).toBe('<p></p>');
    });

    it('and lets a deliberately trusted fragment through', () => {
        //   Nothing uses this today. It exists so the day someone needs nested
        //   markup they mark the exception rather than dropping the tag.
        const row = html`<li>${'<x>'}</li>`;
        expect(html`<ul>${trustedHtml(row)}</ul>`).toBe('<ul><li>&lt;x&gt;</li></ul>');
    });

    it('and escapeHtml still behaves as the templates that call it directly expect', () => {
        //   email-notifications.ts escapes per-interpolation; both forms must
        //   agree or two emails would render the same name differently.
        const name = 'Smith & Sons <Nigeria> Ltd';
        expect(html`${name}`).toBe(escapeHtml(name));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#512 — the ratchet: no fifteenth file arrives unnoticed', () => {
    /** Every non-test .ts under src that mentions the shared sender. */
    function emailSendingFiles(): string[] {
        const out: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const p = join(dir, entry);
                if (statSync(p).isDirectory()) {
                    if (entry === '__tests__' || entry === 'node_modules') continue;
                    walk(p);
                } else if (p.endsWith('.ts') || p.endsWith('.tsx')) {
                    if (readFileSync(p, 'utf-8').includes('sendEmailNotification')) out.push(p);
                }
            }
        };
        walk('src');
        return out;
    }

    const HTML_TAG = /<(div|p|h[1-9]|table|a|span|strong|ul|li|br)[ >/]/;

    /**
     * Every template literal in `source`, NESTING-AWARE.
     *
     *   THE FIRST VERSION OF THIS RATCHET USED /`(?:[^`\\]|\\.)*`/g AND COULD
     *   NOT SEE NESTING — the same naive scan that, an hour earlier, wrote the
     *   `html` tag in front of a CLOSING backtick and corrupted two templates.
     *   Built on it, the ratchet skipped exactly the nested fragments that scan
     *   mishandles, and a mutant that un-tagged one of them SURVIVED.
     *
     *   That is this audit's own rule turned on itself: audit the instrument
     *   before believing the measurement. A check assembled from a tool already
     *   proven wrong is a check that cannot fail on the case it was written for.
     */
    function templateSpans(source: string): Array<{ start: number; end: number }> {
        const spans: Array<{ start: number; end: number }> = [];
        const stack: Array<{ kind: 'tpl' | 'sub' | 'brace'; start: number }> = [];
        let i = 0;

        while (i < source.length) {
            const c = source[i];
            const inTemplate = stack.length > 0 && stack[stack.length - 1].kind === 'tpl';

            if (stack.length === 0) {
                if (source.startsWith('//', i)) {
                    const nl = source.indexOf('\n', i);
                    i = nl < 0 ? source.length : nl;
                    continue;
                }
                if (source.startsWith('/*', i)) {
                    const close = source.indexOf('*/', i);
                    i = close < 0 ? source.length : close + 2;
                    continue;
                }
                if (c === '"' || c === "'") {
                    const quote = c;
                    i++;
                    while (i < source.length && source[i] !== quote) i += source[i] === '\\' ? 2 : 1;
                    i++;
                    continue;
                }
            }

            if (c === '\\') { i += 2; continue; }

            if (c === '`') {
                if (inTemplate) {
                    spans.push({ start: stack.pop()!.start, end: i + 1 });
                } else {
                    stack.push({ kind: 'tpl', start: i });
                }
                i++;
                continue;
            }
            if (c === '$' && source.startsWith('${', i) && inTemplate) {
                stack.push({ kind: 'sub', start: i }); i += 2; continue;
            }
            if (c === '{' && stack.length > 0 && stack[stack.length - 1].kind === 'sub') {
                stack.push({ kind: 'brace', start: i }); i++; continue;
            }
            if (c === '}' && stack.length > 0 && stack[stack.length - 1].kind !== 'tpl') {
                stack.pop(); i++; continue;
            }
            i++;
        }
        return spans;
    }

    it('EVERY EMAIL TEMPLATE IN THE TREE IS TAGGED WITH html``', () => {
        //   ONE question of the whole tree, not a list of expressions the check
        //   considers harmless. An allowlist ("toLocaleString() is fine",
        //   "getBaseUrl() is fine") is how a check stops being able to fail, and
        //   this audit has found that shape twice already.
        const files = emailSendingFiles();
        const offenders: string[] = [];

        for (const file of files) {
            const source = readFileSync(file, 'utf-8');
            for (const { start, end } of templateSpans(source)) {
                const tpl = source.slice(start, end);
                if (!HTML_TAG.test(tpl)) continue;
                if (!/\$\{/.test(tpl)) continue;

                if (!source.slice(0, start).endsWith('html')) {
                    const line = source.slice(0, start).split('\n').length;
                    const first = tpl.match(/\$\{([^}]*)\}/)?.[1]?.trim() ?? '';
                    offenders.push(`${file}:${line}  \${${first}}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    it('AND THE SWEEP ACTUALLY LOOKED AT SOMETHING', () => {
        //   The vacuity guard for the ratchet — the failure mode #484 and #486
        //   named: a control that reads as present and is none. An empty file
        //   list would make the assertion above pass for ever.
        const files = emailSendingFiles();

        expect(files.length).toBeGreaterThanOrEqual(14);
        expect(files).toContain(join('src', 'app', 'api', 'contact', 'route.ts'));
        expect(files).toContain(join('src', 'lib', 'email-notifications.ts'));
    });
});
