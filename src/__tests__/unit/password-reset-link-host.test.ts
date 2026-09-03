/**
 * @jest-environment node
 */

/**
 *   #261 THE PASSWORD-RESET LINK POINTED WHEREVER THE REQUESTER SAID.
 *
 *        sendResetEmailAction picked a safe base URL from configuration —
 *
 *            let baseUrl = process.env.NEXT_PUBLIC_URL
 *                || process.env.NEXTAUTH_URL
 *                || 'https://www.easysalesexport.com';
 *
 *        under the comment "in production use the canonical domain" — and then
 *        immediately overrode it with the REQUEST HEADERS:
 *
 *            const host = headersList.get("x-forwarded-host")
 *                || headersList.get("host") || "";
 *            if (host) baseUrl = `${protocol}://${host}`;
 *
 *        and built the emailed link from it:
 *
 *            const resetUrl = `${baseUrl}/auth/reset-password?token=${token}`;
 *
 *        THE ATTACK IS ACCOUNT TAKEOVER, AND IT NEEDS NOTHING BUT A HEADER.
 *
 *        The attacker POSTs the forgot-password form for somebody else's
 *        address with `Host: attacker.example`. The victim receives a genuine
 *        email, from the real sender, on the real template, containing
 *
 *            https://attacker.example/auth/reset-password?token=<VALID TOKEN>
 *
 *        They click it, the token goes to the attacker, and the attacker resets
 *        their password. The victim did everything right; the only thing wrong
 *        is which host the link names.
 *
 *        A Host header is not a fact about the request. It is a string the
 *        client writes, and the platform routes on TLS/SNI rather than on it —
 *        so a request for our certificate can carry any Host at all.
 *
 *        THE FIX IS THE FUNCTION THAT ALREADY EXISTED. email-notifications.ts
 *        exports its own getBaseUrl(): configuration only, no headers, and it
 *        normalises module domains back to the canonical www host so a link
 *        works wherever the member happened to be. Every other email in the
 *        platform uses it. This one rolled its own and read the header.
 *
 *        Two copies of one rule with the wrong one deciding — the shape this
 *        audit keeps finding — except here the cost is somebody's account.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const RESET = 'src/app/actions/password-reset.ts';

function codeOnly(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#261 — the reset link never comes from the request', () => {
    it('THE ACTION READS NO HOST HEADER AT ALL', () => {
        // The whole defect in one line. A link that is emailed to somebody else
        // must not be steerable by whoever made the request.
        const src = codeOnly(RESET);

        expect(src).not.toContain('x-forwarded-host');
        expect(src).not.toMatch(/headersList\.get\(["']host["']\)/);
    });

    it('and builds the link from the shared, configuration-only base', () => {
        // Not a hand-rolled second copy: email-notifications.ts already owns
        // this, normalises module domains to the canonical host, and is what
        // every other email uses.
        const src = codeOnly(RESET);

        expect(src).toContain('getBaseUrl');
        expect(src).toContain('/auth/reset-password?token=');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#261 — the base URL that emails use', () => {
    const realEnv = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        delete process.env.NEXTAUTH_URL;
        delete process.env.NEXT_PUBLIC_APP_URL;
    });
    afterEach(() => { process.env = { ...realEnv }; });

    const base = async () => {
        const { getBaseUrl } = await import('@/lib/email-notifications');
        return getBaseUrl();
    };

    it('comes from configuration', async () => {
        process.env.NEXTAUTH_URL = 'https://www.easysalesexport.com';
        expect(await base()).toBe('https://www.easysalesexport.com');
    });

    it('IS UNMOVED BY ANY HEADER, BECAUSE IT NEVER LOOKS AT ONE', async () => {
        // The property that makes it safe for an emailed link: it is a pure
        // function of configuration, so there is no request to influence it.
        process.env.NEXTAUTH_URL = 'https://www.easysalesexport.com';

        const first = await base();
        const second = await base();

        expect(first).toBe(second);
        expect(first).not.toContain('attacker');
    });

    it('normalises a module domain back to the canonical host', async () => {
        // Why the shared function rather than "just use the env var": a member
        // resetting from easysalescooperative.com still needs a link that works.
        process.env.NEXTAUTH_URL = 'https://easysalescooperative.com';
        expect(await base()).toContain('easysalesexport.com');
    });

    it('and the apex back to www, which is the host that serves POSTs', async () => {
        // The apex is a redirector: it answers GET with a 301 and POST with 405.
        process.env.NEXTAUTH_URL = 'https://easysalesexport.com';
        expect(await base()).toContain('www.easysalesexport.com');
    });

    it('leaves localhost alone in development', async () => {
        process.env.NEXTAUTH_URL = 'http://localhost:3000';
        expect(await base()).toContain('localhost:3000');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#261 — no other emailed link is steerable either', () => {
    /**
     * A ratchet rather than one pinned file. The password-reset link is the one
     * that costs an account, but any absolute URL built from a request header
     * and then SENT TO SOMEBODY ELSE has the same shape.
     *
     * Reading a host to choose a RELATIVE path is fine and stays allowed —
     * actions/auth.ts does that to pick a post-registration destination from a
     * fixed list, and a forged host there just yields the default.
     */
    const EMAIL_SENDERS = [
        'src/app/actions/password-reset.ts',
        'src/lib/email-notifications.ts',
    ];

    it('finds the files, so the check below is not vacuous', () => {
        for (const f of EMAIL_SENDERS) {
            expect(readFileSync(join(process.cwd(), f), 'utf-8').length).toBeGreaterThan(0);
        }
    });

    it('NONE OF THEM BUILDS A BASE URL OUT OF A REQUEST HEADER', () => {
        const offenders = EMAIL_SENDERS.filter((f) => {
            const src = codeOnly(f);
            return /x-forwarded-host/.test(src) || /\.get\(["']host["']\)/.test(src);
        });

        // Was: ["src/app/actions/password-reset.ts"].
        expect(offenders).toEqual([]);
    });
});
