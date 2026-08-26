/**
 * @jest-environment node
 */

/**
 *   #282 TWO LAND DECISION PATHS RECORDED WHICHEVER ADMIN THE CALLER NAMED.
 *
 *        _verifyLandListingAction and _rejectLandListingAction both take an
 *        `adminId` parameter, and both wrote it as `verifiedBy` on the listing
 *        AND passed it to logAdminAction as the acting admin — while the
 *        permission guard immediately above had already established who the
 *        caller actually is.
 *
 *        So one land admin could record a decision against another's name, and
 *        the audit entry would corroborate it. That is #129's finding ("the
 *        dispute audit row named whichever admin the caller passed") and the
 *        export-window `adminId` fix, in a module neither of them touched.
 *
 *        THREE OF THE FIVE LAND DECISION PATHS ALREADY DID IT RIGHT:
 *
 *          api/admin/farm-nation/approve-land   session.user.id   ✓
 *          admin/_land.ts                       session.user.id   ✓
 *          _deleteLandListingAction             session.user.id   ✓
 *          _verifyLandListingAction             adminId parameter ✗
 *          _rejectLandListingAction             adminId parameter ✗
 *
 *        _deleteLandListingAction is THREE FUNCTIONS DOWN IN THE SAME FILE. It
 *        takes the identical unused `adminId` parameter and logs
 *        session.user.id. The correct pattern was sitting beside the defect.
 *
 * LATENT, NOT LIVE — SAID PLAINLY
 * -------------------------------
 * Nothing in the app calls either function today: a search across src for both
 * names returns only their own definitions. So this is not a hole somebody is
 * walking through; it is two exported doors that would hand the next caller a
 * forgeable audit trail.
 *
 * That is the same judgement as #279, where an unreferenced enrolment action
 * was removed rather than left to be found. These are not removed, because
 * unlike that one they do not duplicate a wired action — the land module needs
 * a verify and a reject — so they are corrected instead.
 *
 * The `adminId` parameter is kept so the signature does not change, and is
 * deliberately ignored. That treatment already has precedent in this codebase:
 * farm-nation-payment.ts keeps an `amount` it refuses to trust, and
 * _submitForVerificationAction keeps an `ownerId` it compares the session
 * against rather than believing.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

const LAND = 'src/app/actions/land-listings.ts';

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (full.endsWith('.ts')) out.push(full);
    }
    return out;
}

function codeOnly(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/** The body of one function, from its declaration to the next one. */
function bodyOf(rel: string, fnName: string): string {
    const src = codeOnly(rel);
    const start = src.indexOf(`function ${fnName}`);
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start + 10);
    const nextDecl = rest.search(/\n(?:export )?(?:async )?function /);
    return rest.slice(0, nextDecl > 0 ? nextDecl : rest.length);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#282 — a land decision records the caller, not the caller\'s claim', () => {
    for (const fn of ['_verifyLandListingAction', '_rejectLandListingAction']) {
        describe(fn, () => {
            const body = bodyOf(LAND, fn);

            it('TAKES THE ACTING ADMIN FROM THE SESSION', () => {
                expect(body).toContain('const actingAdminId = session.user.id');
            });

            it('STAMPS verifiedBy WITH IT, NOT WITH THE PARAMETER', () => {
                // Was: `verifiedBy: adminId`.
                expect(body).toContain('verifiedBy: actingAdminId');
                expect(body).not.toMatch(/verifiedBy:\s*adminId/);
            });

            it('and the audit entry names the same person', () => {
                // The half that makes the forgery self-corroborating: a record
                // attributed to somebody else, with a log agreeing.
                expect(body).not.toMatch(/^\s+adminId,\s*$/m);
                expect(body).toMatch(/actingAdminId,/);
            });

            it('still refuses a caller without the land permission', () => {
                // Vacuity guard: attribution only matters once authorisation
                // holds, and the guard has to still be there.
                expect(body).toContain('land:verify_listings');
            });
        });
    }

    it('and the delete path that always did this correctly still does', () => {
        // The reference implementation, in the same file. If somebody
        // "harmonises" the three by copying the wrong one, this says so.
        const body = bodyOf(LAND, '_deleteLandListingAction');

        expect(body).toContain('session.user.id');
        expect(body).not.toMatch(/^\s+adminId,\s*$/m);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#282 — the class, derived rather than listed', () => {
    /**
     * Every session-guarded action that ALSO takes a parameter naming the actor
     * is a place this defect can live. The list is computed, not written down,
     * because a hand-written one is how #276 missed two doors.
     *
     * Being on this list is not a defect — most of these keep the parameter for
     * signature compatibility and ignore it. Writing it into a record or an
     * audit entry is the defect, and that is what the assertion checks.
     */
    const ACTOR_PARAM = /\b(adminId|actorId|performedBy|initiatedBy|approvedBy|reviewedBy)\b\s*[:?]/;

    const files = walk(join(process.cwd(), 'src/app'))
        .map((f) => f.slice(process.cwd().length + 1))
        .filter((f) => !f.includes('__tests__'));

    it('finds the actions it is meant to cover, so this is not vacuous', () => {
        const withActorParam = files.filter((f) => {
            const src = codeOnly(f);
            return ACTOR_PARAM.test(src) && /requireSession|requireAdmin/.test(src);
        });

        expect(withActorParam.length).toBeGreaterThan(3);
        expect(withActorParam).toContain(LAND);
    });

    it('NO SESSION-GUARDED ACTION STAMPS AN ACTOR FIELD FROM A PARAMETER', () => {
        /**
         * PROVENANCE, NOT THE NAME — AND THE FIRST VERSION GOT THIS WRONG.
         *
         * It matched `verifiedBy: adminId` and reported NINE offenders across
         * seven files. Every one of them was correct code: `adminId` there is a
         * local, `const adminId = session.user.id`, and naming a
         * session-derived value after the thing it identifies is not a defect.
         * The regex was testing the identifier's SPELLING.
         *
         * It also reported the wrong lines, because it counted them on
         * comment-stripped text while the reader would look at the file. Both
         * are fixed here: offenders are located in the RAW source, and an
         * identifier is only suspect if the file never derives it from the
         * session.
         *
         * What is left is the real question — is the value written into an
         * actor field something the server established, or something the caller
         * said?
         */
        const offenders: string[] = [];

        for (const f of files) {
            const raw = readFileSync(join(process.cwd(), f), 'utf-8');
            if (!/requireSession|requireAdmin/.test(raw)) continue;

            const lines = raw.split('\n');

            lines.forEach((line, i) => {
                if (/^\s*(\*|\/\/)/.test(line)) return;

                const m = /(verifiedBy|reviewedBy|approvedBy|rejectedBy|performedBy|resolvedBy|createdBy)\s*:\s*([A-Za-z_$][\w$]*)\s*[,}]/.exec(line);
                if (!m) return;

                const value = m[2];

                // Derived from the session somewhere in this file? Then the
                // name it was given does not matter.
                const derived = new RegExp(
                    `(?:const|let)\\s+${value}\\s*(?::[^=]+)?=\\s*(?:[^;\\n]*\\b(?:session\\.user\\.id|sessionResult|adminCheck|authCheck|userId)\\b)`,
                );
                if (derived.test(raw)) return;

                // A literal or an obviously non-identity value is not an actor.
                if (/^(null|undefined|true|false)$/.test(value)) return;

                offenders.push(`${f}:${i + 1}  ${line.trim()}`);
            });
        }

        // Was: land-listings.ts, `verifiedBy: adminId` in the verify and in the
        // reject — the two functions whose `adminId` is a PARAMETER and is
        // never assigned from the session anywhere in that file.
        expect(offenders).toEqual([]);
    });
});
