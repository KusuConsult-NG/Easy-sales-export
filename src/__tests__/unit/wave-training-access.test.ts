/**
 * @jest-environment node
 */

/**
 * Every signed-in account could read the WAVE programme's meeting links.
 *
 * /api/wave/training-sessions asked for a session and nothing else, then
 * returned the whole document for every training session:
 *
 *     const sessions = docs.map(doc => ({ id: doc.id, ...doc.data(), ... }));
 *
 * A session document carries `roomName` and `customMeetingLink` — the live
 * video room — plus `createdBy`, the user id of the admin who scheduled it.
 *
 * WAVE is a women's programme. src/middleware.ts has enforced that for /wave
 * PAGES since it was written:
 *
 *     const isWaveBlocked = isMale && (isNewMaleUser || !hasWaveAccess);
 *
 * and /api/wave/check-eligibility exists to answer the same question. The API
 * route was reachable regardless — so the accounts the platform turns away at
 * the door were handed the meeting links.
 *
 * THE RULE NOW HAS ONE DEFINITION
 * -------------------------------
 * The status list lived in middleware.ts alone. Writing it a second time in the
 * route is how the two drift, which this audit has found repeatedly, so both
 * read @/lib/wave-access.
 *
 * It is deliberately generous — pending and under_review are in the pipeline,
 * and someone waiting on a decision still attends the training — and it says
 * nothing about gender. That is a separate question the middleware asks
 * alongside it; conflating them would lock a male administrator out of the
 * programme he runs.
 *
 * TWO MORE ON THE SAME RESPONSE
 * -----------------------------
 * `isActive` is set to false by endWaveLiveSession and was read by nothing, so
 * a session an admin had ended stayed in the list with its room name and link
 * intact. Fourth collected-stored-never-consulted flag in this audit.
 *
 * And the spread carried `createdBy`, which no participant needs.
 *
 * The POST on this route was already correct: admin-only, with its required
 * fields checked.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { canReadWaveProgramme, hasWaveAccess, WAVE_ACCESS_STATUSES } from '@/lib/wave-access';

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

const route = source('src/app/api/wave/training-sessions/route.ts');
const middleware = source('src/middleware.ts');

describe('reading the programme requires being in it', () => {
    it('the route checks programme access, not just a session', () => {
        // THE test.
        expect(route).toContain('canReadWaveProgramme({ roles: session.user.roles, waveRegStatus })');
        expect(route).toContain('WAVE programme access required');
    });

    it('the check precedes the query', () => {
        const checkAt = route.indexOf('canReadWaveProgramme(');
        const queryAt = route.indexOf('COLLECTIONS.WAVE_TRAINING_SESSIONS');

        expect(checkAt).toBeGreaterThan(-1);
        expect(queryAt).toBeGreaterThan(checkAt);
    });

    it('a participant is admitted', () => {
        expect(canReadWaveProgramme({ roles: ['wave_participant'] })).toBe(true);
    });

    it('so is someone mid-application', () => {
        // Deliberately generous: a decision pending is still in the pipeline.
        for (const status of WAVE_ACCESS_STATUSES) {
            expect(`${status}: ${canReadWaveProgramme({ roles: [], waveRegStatus: status })}`)
                .toBe(`${status}: true`);
        }
    });

    it('and the people who run it', () => {
        for (const role of ['admin', 'super_admin', 'wave_admin']) {
            expect(`${role}: ${canReadWaveProgramme({ roles: [role] })}`).toBe(`${role}: true`);
        }
    });

    it('an ordinary account is not', () => {
        // Vacuity guard the other way: if this passed, the fix would be
        // decorative.
        expect(canReadWaveProgramme({ roles: ['general_user'] })).toBe(false);
        expect(canReadWaveProgramme({ roles: [] })).toBe(false);
        expect(canReadWaveProgramme({})).toBe(false);
        expect(canReadWaveProgramme({ roles: ['seller'], waveRegStatus: 'rejected' })).toBe(false);
    });

    it('says nothing about gender', () => {
        // That is the middleware's separate question. Folding it in here would
        // lock a male administrator out of the programme he runs.
        const lib = source('src/lib/wave-access.ts');

        expect(codeOnly(lib)).not.toContain('gender');
        expect(hasWaveAccess({ roles: ['wave_participant'] })).toBe(true);
    });
});

describe('one definition, read by both', () => {
    it('the middleware uses the shared helper', () => {
        expect(middleware).toContain('from "@/lib/wave-access"');
        expect(middleware).toContain('hasWaveAccess({ roles: userRoles, waveRegStatus })');
    });

    it('and no longer carries its own status list', () => {
        const code = codeOnly(middleware);

        expect(code).not.toContain('waveRegStatus === "under_review"');
        expect(code).not.toContain('waveRegStatus === "revision_required"');
    });

    it('the gender block still applies to pages', () => {
        // Vacuity guard: the refactor must not have removed the page guard.
        expect(middleware).toContain('const isWaveBlocked = isMale && (isNewMaleUser || !hasWaveAccessNow)');
        expect(middleware).toContain('pathname.startsWith("/wave")');
    });

    it('the status list is the one the middleware enforced', () => {
        expect([...WAVE_ACCESS_STATUSES]).toEqual([
            'approved', 'active', 'pending', 'under_review', 'revision_required',
        ]);
    });
});

describe('the response is bounded and current', () => {
    it('lists only active sessions', () => {
        expect(route).toContain('.where("isActive", "==", true)');
    });

    it('the flag is written by the admin path', () => {
        // Which makes filtering on it honouring an existing intent.
        const admin = source('src/app/actions/wave/_admin.ts');

        expect(admin).toContain('isActive: true');
        expect(admin).toContain('isActive: false');
    });

    it('does not spread the document', () => {
        expect(codeOnly(route)).not.toContain('...doc.data()');
    });

    it('does not return the admin who scheduled it', () => {
        const mapper = route.slice(route.indexOf('const sessions = docs.map'), route.indexOf('const nextCursor'));

        expect(mapper).not.toContain('createdBy');
    });

    it('still returns what a participant needs to attend', () => {
        // Vacuity guard: stripping the meeting link would make the endpoint
        // pointless. It is the payload — the fix is who receives it.
        const mapper = route.slice(route.indexOf('const sessions = docs.map'), route.indexOf('const nextCursor'));

        for (const field of ['title', 'scheduledAt', 'durationMinutes', 'roomName', 'customMeetingLink']) {
            expect(mapper).toContain(field);
        }
    });

    it('pagination is unchanged', () => {
        expect(route).toContain('Math.min(Math.max(rawLimit, 1), 50)');
        expect(route).toContain('limit + 1');
    });
});

describe('the POST, which was already right', () => {
    it('is admin-only', () => {
        const post = route.slice(route.indexOf('export async function POST'));

        expect(post).toContain('session.user.roles?.includes("admin")');
        expect(post).toContain('{ status: 403 }');
    });

    it('requires the fields a session needs', () => {
        const post = route.slice(route.indexOf('export async function POST'));

        expect(post).toContain('!title || !scheduledAt || !durationMinutes');
    });
});
