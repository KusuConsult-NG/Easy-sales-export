/**
 * @jest-environment node
 */

/**
 * A GPT-4 endpoint with no limit, writing audit entries that said "login".
 *
 * ai-actions.ts itself is clean: all three exports require a session, validate
 * with Zod, and delegate to infrastructure/chatbot/service.ts passing the
 * session's own id and roles — the system prompt is built from verified roles
 * rather than anything the caller sends. The defects are in what it delegates
 * to.
 *
 * NO RATE LIMIT ON A BILLED ENDPOINT
 * ----------------------------------
 * sendSecureAIMessage calls OpenAI on every invocation — gpt-4, max_tokens 500,
 * billed per token — and nothing throttled it. Requiring a session and capping
 * the message at 2,000 characters means it is not open to the world; it does not
 * stop one authenticated account looping it as fast as the network allows.
 *
 * The platform already throttles KYC lookups for exactly this reason, and its
 * rate limiter is Redis-backed and distributed. The tool was there and unused.
 *
 * Keyed on the USER rather than the IP: the endpoint is authenticated, the
 * account is what gets billed for, and rate-limits.config.ts already explains at
 * length why an IP key punishes everyone behind a Nigerian carrier NAT.
 *
 * THE AUDIT ENTRY SAID SOMETHING THAT DID NOT HAPPEN
 * --------------------------------------------------
 *     action: 'user_login', // Map to general action for audit log tracking schema
 *
 * So every AI message wrote an audit entry recording that the user had logged
 * in. That is not a cosmetic mislabel:
 *
 *   getAuditStatsAction counts by action and reports the top ten, so chat volume
 *   was inflating login figures on the admin dashboard;
 *
 *   anyone reading the audit trail during an investigation would find logins
 *   that never happened, at times the person was not signing in.
 *
 * An audit log that records the wrong verb is worse than one that records
 * nothing, because it is believed. The comment suggests the mapping was a
 * workaround for the AuditAction union having no suitable member; adding one
 * costs nothing.
 *
 * AN UNBOUNDED HISTORY READ
 * -------------------------
 * getAIChatHistory(maxMessages) passed the caller's number straight into
 * .limit(), so a request for a million read a million. The same shape as the
 * audit statistics window bounded in #150.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

const service = source('src/infrastructure/chatbot/service.ts');

describe('the model call is throttled', () => {
    it('checks a rate limit before calling OpenAI', () => {
        // THE test. Ordering matters: a limiter consulted after the call has
        // already been billed for is decoration.
        const limitAt = service.indexOf('aiChatLimiter.check(userId)');
        const openAiAt = service.indexOf('https://api.openai.com');

        expect(limitAt).toBeGreaterThan(-1);
        expect(openAiAt).toBeGreaterThan(limitAt);
    });

    it('keys the limit on the user, not an IP', () => {
        // The endpoint is authenticated, so the account is the billable thing —
        // and rate-limits.config.ts explains why an IP key punishes everyone
        // behind a carrier NAT.
        expect(service).toContain('aiChatLimiter.check(userId)');
    });

    it('refuses rather than falling through when the limit is reached', () => {
        // A limiter whose result is ignored is the same as no limiter.
        const guarded = service.slice(service.indexOf('const limit = await aiChatLimiter.check'));

        expect(guarded.slice(0, 600)).toContain('if (!limit.success)');
        expect(guarded.slice(0, 600)).toMatch(/return\s*\{\s*success: false/);
    });

    it('uses a configured limit rather than a number inline', () => {
        const config = source('src/lib/rate-limits.config.ts');

        expect(service).toContain('rateLimit(rateLimitConfig.aiChat)');
        expect(config).toMatch(/aiChat:\s*\{[\s\S]{0,200}maxRequests:\s*\d+/);
    });

    it('the limit is loose enough for a real conversation', () => {
        // Guard against fixing cost by breaking the feature. A person typing to
        // a support bot manages two or three messages a minute at most.
        const { rateLimitConfig } = require('@/lib/rate-limits.config');
        const perMinute = rateLimitConfig.aiChat.maxRequests / (rateLimitConfig.aiChat.interval / 60_000);

        expect(perMinute).toBeGreaterThanOrEqual(3);
        // And tight enough to matter — an unthrottled loop is orders of
        // magnitude above this.
        expect(perMinute).toBeLessThan(20);
    });
});

describe('the audit entry says what happened', () => {
    it('no longer records an AI message as a login', () => {
        // THE second finding. Comment lines stripped: the explanation quotes the
        // old value.
        // The CALL, not the import at the top of the file — indexOf finds that
        // first and the first version of this assertion read it.
        const code = codeOnly(service);
        const chatAudit = code.slice(code.indexOf('await createAdminAuditLog({'));

        expect(chatAudit.slice(0, 400)).not.toContain("action: 'user_login'");
        expect(chatAudit.slice(0, 400)).toContain("action: 'ai_chat_message'");
    });

    it('the action exists in the union it is checked against', () => {
        // The comment said the mapping was for "audit log tracking schema", so
        // the type is presumably why. Adding a member costs nothing.
        expect(source('src/lib/audit-log.ts')).toContain("| 'ai_chat_message'");
    });

    it('user_login is still used where a login actually happens', () => {
        // Vacuity guard: removing the value from the union entirely would
        // satisfy the assertion above and break real login auditing.
        const { execSync } = require('child_process') as typeof import('child_process');
        // Comment lines excluded. The fix's own comment quotes the old value to
        // explain what was wrong with it, and the first version of this
        // assertion matched that prose — the same trap as #151 and #153.
        const uses = execSync(`grep -rn "'user_login'" src || true`, { encoding: 'utf-8', cwd: process.cwd() })
            .split('\n')
            .filter((l) => l.trim() && !l.includes('__tests__'))
            .filter((l) => {
                const body = l.slice(l.indexOf(':', l.indexOf(':') + 1) + 1).trim();
                return !body.startsWith('//') && !body.startsWith('*') && !body.startsWith('/*');
            });

        expect(uses.length).toBeGreaterThan(0);
        expect(uses.some((l) => l.includes('chatbot'))).toBe(false);
    });
});

describe('the history read is bounded', () => {
    it('clamps the caller-supplied count', () => {
        expect(service).toContain('MAX_CHAT_HISTORY');
        expect(service).toContain('.limit(boundedMax)');
    });

    it('no longer passes the raw parameter to limit()', () => {
        expect(codeOnly(service)).not.toContain('.limit(maxMessages)');
    });

    it('still honours a smaller request', () => {
        // A clamp that ignored the caller entirely would break the caller that
        // asks for twenty.
        const clamp = service.slice(service.indexOf('const boundedMax'));

        expect(clamp.slice(0, 300)).toContain('Math.min(MAX_CHAT_HISTORY');
        expect(clamp.slice(0, 300)).toContain('Math.max(1');
    });
});

describe('what the action layer was already doing right', () => {
    const actions = source('src/app/actions/ai-actions.ts');

    it('takes the user and roles from the session, not the request', () => {
        // The system prompt is built from these, and a caller-supplied role
        // would let anyone ask the assistant to behave as an admin.
        expect(actions).toContain('session.user.id');
        expect(actions).toContain('session.user.roles || []');
    });

    it('bounds the message length before it reaches the model', () => {
        expect(actions).toContain('max(2000, "Message too long")');
    });

    it('all three exports require a session', () => {
        const guards = actions.match(/const sessionResult = await requireSession\(\);/g) ?? [];

        expect(guards.length).toBe(3);
    });
});
