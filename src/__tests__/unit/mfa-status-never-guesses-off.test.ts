/**
 * @jest-environment node
 */

/**
 *   #313 THE MFA STATUS ENDPOINT REPORTED "NO SECOND FACTOR" WHEN IT FAILED TO
 *        FIND OUT.
 *
 *        /api/auth/mfa/status ended in this catch:
 *
 *            } catch (error: any) {
 *                logger.error("MFA status check error:", error);
 *                return NextResponse.json({
 *                    success: true,          // <- on a DATABASE FAILURE
 *                    enabled: false,         // <- and a definitive "off"
 *                    error: "Failed to check status",
 *                });
 *            }
 *
 *        success:true and enabled:false is not "I could not read your MFA
 *        state". It is "this account has no second factor", asserted, with a
 *        200. #245's shape — a kill switch failing OPEN on a database error —
 *        on the indicator that tells a member whether their account is
 *        protected.
 *
 *        AND IT DEFEATED THE CALLER THAT WAS DOING THE RIGHT THING. /profile
 *        reads `if (mfaData.success)` before believing the answer, which is
 *        exactly the discipline this codebase keeps having to add. Returning
 *        success:true on failure made that check worthless: the profile screen
 *        rendered its 2FA toggle in the OFF position, aria-pressed={false}, for
 *        an account with MFA switched on.
 *
 *        The other caller did not check at all. /settings/security/mfa read
 *        `data.enabled || false` with neither response.ok nor data.success
 *        consulted, so the 401 branch — which carries no `enabled` key — also
 *        landed on "off", and the screen then offered to set MFA up.
 *
 *   WHAT THE MISLED USER HITS NEXT, AND WHY IT IS NOT WORSE THAN IT IS
 *
 *        Following that offer does NOT overwrite an existing secret: the setup
 *        route checks userData.mfaEnabled first and refuses with "MFA is
 *        already enabled". So the damage stops at a member being told their
 *        account is unprotected when it is not, and then being refused with a
 *        message that contradicts the screen they came from. That is worth
 *        fixing on its own, and it is worth being precise that it is not a
 *        second-factor reset.
 *
 * THE FIX
 * -------
 * Not knowing is now its own answer. The route returns success:false with a
 * 500 and no `enabled` key at all, so there is nothing for a caller to
 * misread; both screens treat that as UNKNOWN and say so rather than drawing
 * an "off" state they cannot justify.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const ROUTE = 'src/app/api/auth/mfa/status/route.ts';
const MFA_PAGE = 'src/app/settings/security/mfa/page.tsx';
const PROFILE = 'src/app/profile/page.tsx';

// ─────────────────────────────────────────────────────────────────────────────
describe('#313 — the endpoint, executed', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    /** Load the route with the user lookup doing whatever `impl` does. */
    async function callStatus(impl: () => any) {
        jest.doMock('@/lib/supabase-db', () => ({
            supabaseDb: { collection: () => ({ doc: () => ({ get: impl }) }) },
        }));
        const mod = await import('@/app/api/auth/mfa/status/route');
        const res: any = await (mod.GET as any)(new Request('http://x/api/auth/mfa/status'));
        return { status: res.status, body: await res.json() };
    }

    it('REPORTS NOTHING ABOUT MFA WHEN THE DATABASE THROWS', async () => {
        // THE test. The old body was { success: true, enabled: false }.
        const { status, body } = await callStatus(() => {
            throw new Error('connection refused');
        });

        expect(body.success).toBe(false);
        expect(status).toBe(500);
        // Not `enabled: false` — absent. There is nothing to misread.
        expect('enabled' in body).toBe(false);
    });

    it('and still answers truthfully when the read works', async () => {
        // Vacuity guard: a route that always failed would satisfy the above.
        const { status, body } = await callStatus(() =>
            Promise.resolve({ exists: true, data: () => ({ mfaEnabled: true }) }));

        expect({ status, success: body.success, enabled: body.enabled })
            .toEqual({ status: 200, success: true, enabled: true });
    });

    it('and reports OFF for an account that genuinely has none', async () => {
        const { body } = await callStatus(() =>
            Promise.resolve({ exists: true, data: () => ({ mfaEnabled: false }) }));

        expect({ success: body.success, enabled: body.enabled })
            .toEqual({ success: true, enabled: false });
    });

    it('a missing user row is a real answer, not a failure', async () => {
        // An account with no document has no second factor; that is knowable.
        const { body } = await callStatus(() => Promise.resolve({ exists: false }));

        expect({ success: body.success, enabled: body.enabled })
            .toEqual({ success: true, enabled: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#313 — neither screen draws "off" from a failed read', () => {
    it('the MFA settings page checks response.ok AND success', () => {
        const src = code(MFA_PAGE);

        expect(src).toMatch(/if \(!response\.ok \|\| !data\.success\)/);
        expect(src).toMatch(/setStatusUnknown\(true\)/);
        // The old line, which believed `enabled` unconditionally.
        expect(src).not.toMatch(/setMfaEnabled\(data\.enabled \|\| false\)/);
    });

    it('and renders an unknown state instead of offering setup', () => {
        const src = code(MFA_PAGE);

        expect(src).toMatch(/statusUnknown && step === "setup"/);
        expect(src).toMatch(/could not check your MFA status/i);
    });

    it('the profile page does too, and disables the toggle it cannot justify', () => {
        const src = code(PROFILE);

        expect(src).toMatch(/if \(res\.ok && mfaData\.success\)/);
        expect(src).toMatch(/setMfaStatusUnknown\(true\)/);
        expect(src).toMatch(/disabled=\{isDisablingMfa \|\| mfaStatusUnknown\}/);
    });

    it('and neither one still reads `enabled` without checking first', () => {
        // Stated over both files at once: the defect was a bare read of
        // `enabled`, and a fix on one screen only is this codebase's most
        // repeated failure — #297, #308 and #310 were all exactly that.
        for (const rel of [MFA_PAGE, PROFILE]) {
            const bare = /(?<!res\.ok && mfaData\.success[\s\S]{0,80})setMfaEnabled\([a-zA-Z]+\.enabled \|\| false\)/;
            expect({ rel, bareRead: bare.test(code(rel)) }).toEqual({ rel, bareRead: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#313 — the limit of the harm, stated precisely', () => {
    it('setup REFUSES an account that already has MFA, so no secret is reset', () => {
        // Why the write-up says "misled and then refused" rather than
        // "second factor overwritten". If this guard ever goes, the severity
        // of #313 changes and this failing is how that gets noticed.
        const src = code('src/app/api/auth/mfa/setup/route.ts');

        expect(src).toMatch(/if \(userData\?\.mfaEnabled\)/);
        expect(src).toMatch(/MFA is already enabled/);
    });
});
