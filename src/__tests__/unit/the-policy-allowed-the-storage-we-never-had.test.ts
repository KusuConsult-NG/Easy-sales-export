/**
 * @jest-environment node
 */

/**
 *   THE CONTENT-SECURITY-POLICY ALLOW-LISTED A STORAGE BACKEND THIS PROJECT
 *   HAS NEVER HAD, AND FORBADE THE ONLY ONE IT USES.
 *
 *   media-src read, in full:
 *
 *       media-src 'self' https://firebasestorage.googleapis.com
 *                        https://storage.googleapis.com blob:
 *
 *   Both are Firebase Storage. api/upload/route.ts says of itself, in its own
 *   header: "Firebase Storage bucket doesn't exist on this project. Using
 *   Cloudinary instead." Every file this platform has ever taken is served from
 *   res.cloudinary.com — and res.cloudinary.com was not on the list.
 *
 *   So NO UPLOADED VIDEO COULD PLAY. Not an Academy lesson recording, not a
 *   marketplace product demo. The browser refuses the load and the <video>
 *   element sits there empty, with nothing on the page to say why.
 *
 * ── WHY ONLY VIDEO, AND WHY IT SURVIVED SO LONG ─────────────────────────────
 *
 *   The neighbouring directive is `img-src 'self' data: https: blob:` — ANY
 *   https host. Images from Cloudinary were always fine, and images are most of
 *   what gets uploaded, so the policy looked correct every single day until
 *   somebody uploaded a video.
 *
 *   And connect-src DOES carry `https://api.cloudinary.com`. That is the
 *   UPLOAD API — the half of Cloudinary you add while making uploading work.
 *   res.cloudinary.com is the half you only need when something plays it back,
 *   which is a different day and often a different person.
 *
 *   ASSERTED BY BUILDING THE POLICY, not by grepping the source for a
 *   hostname: the thing that has to be true is what the header SAYS, and a
 *   host listed in the wrong directive would satisfy any spelling check while
 *   changing nothing.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { buildCsp } from '@/lib/csp';

/** The directives of a built policy, as a lookup. */
function directives(policy: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of policy.split(';')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const space = trimmed.indexOf(' ');
        if (space === -1) { out[trimmed] = ''; continue; }
        out[trimmed.slice(0, space)] = trimmed.slice(space + 1);
    }
    return out;
}

/** Where uploads are actually served from. api/upload returns `secure_url`. */
const DELIVERY_HOST = 'https://res.cloudinary.com';

// ─────────────────────────────────────────────────────────────────────────────
describe('uploaded video can be played', () => {
    it('MEDIA-SRC ALLOWS THE HOST UPLOADS ARE SERVED FROM — the defect', () => {
        //   THE test. Before this, media-src named two Firebase hosts and the
        //   platform stores nothing on either.
        const media = directives(buildCsp({ nonce: 'n' }))['media-src'];

        expect(media).toContain(DELIVERY_HOST);
    });

    it('AND IT IS media-src THAT ALLOWS IT, not some other directive', () => {
        //   A host in connect-src does not let a <video> load. connect-src has
        //   carried api.cloudinary.com the whole time and no video ever played,
        //   which is precisely the confusion this pins.
        const d = directives(buildCsp({ nonce: 'n' }));

        expect(d['media-src']).toContain(DELIVERY_HOST);
        expect(d['media-src']).not.toBe(d['connect-src']);
    });

    it('in development too, because that is where it would be caught', () => {
        expect(directives(buildCsp({ isDev: true }))['media-src']).toContain(DELIVERY_HOST);
    });

    it('and with no nonce — the static fallback serves the same policy', () => {
        //   next.config.ts calls buildCsp() with no nonce for its header. A fix
        //   that reached only the middleware would leave the statically served
        //   routes blocked.
        expect(directives(buildCsp())['media-src']).toContain(DELIVERY_HOST);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the lesson page can show the rest of its materials', () => {
    it('FRAME-SRC ALLOWS THE COURSE DOCUMENT, which is a Cloudinary PDF', () => {
        //   LessonClient embeds `currentLesson.documentUrl` in an iframe, and
        //   that url is whatever api/upload returned — Cloudinary. Same defect
        //   as the video, one directive along.
        expect(directives(buildCsp({ nonce: 'n' }))['frame-src']).toContain(DELIVERY_HOST);
    });

    it('AND THE SPREADSHEET, which goes through Office’s viewer', () => {
        expect(directives(buildCsp({ nonce: 'n' }))['frame-src'])
            .toContain('https://view.officeapps.live.com');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and nothing was loosened to achieve it', () => {
    /**
     * The direction that must not move. "Fixing" a CSP by widening it to
     * `https:` would pass every assertion above and remove the control.
     */
    it('POSITIVE CONTROL: media-src IS STILL AN ALLOW-LIST, not a wildcard', () => {
        const media = directives(buildCsp({ nonce: 'n' }))['media-src'];

        expect(media.split(' ')).not.toContain('https:');
        expect(media.split(' ')).not.toContain('*');
    });

    it('POSITIVE CONTROL: frame-src is still an allow-list', () => {
        const frame = directives(buildCsp({ nonce: 'n' }))['frame-src'];

        expect(frame.split(' ')).not.toContain('https:');
        expect(frame.split(' ')).not.toContain('*');
    });

    it('POSITIVE CONTROL: the policy still has the directives that matter', () => {
        //   Vacuity guard. `directives()` returning {} would make every
        //   `not.toContain` above pass against nothing at all.
        const d = directives(buildCsp({ nonce: 'n' }));

        for (const key of ['default-src', 'script-src', 'media-src', 'frame-src', 'object-src']) {
            expect(Object.keys(d)).toContain(key);
        }
        expect(d['object-src']).toBe("'none'");
    });

    it('and script-src did not acquire the delivery host along the way', () => {
        //   Cloudinary serves whatever was uploaded. It must never be a source
        //   of executable script.
        expect(directives(buildCsp({ nonce: 'n' }))['script-src']).not.toContain(DELIVERY_HOST);
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to src/lib/csp.ts, this suite re-run each time.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   drop res.cloudinary.com from MEDIA_HOSTS    4   "MEDIA-SRC ALLOWS THE HOST
 *   — the defect                                    UPLOADS ARE SERVED FROM"
 *
 *   move res.cloudinary.com to connect-src       4   same
 *   instead of media-src
 *
 *   drop res.cloudinary.com from FRAME_HOSTS     1   "FRAME-SRC ALLOWS THE
 *                                                    COURSE DOCUMENT"
 *
 *   drop view.officeapps.live.com                1   "AND THE SPREADSHEET"
 *
 *   media-src becomes `'self' https: blob:`      1   "POSITIVE CONTROL:
 *   (the lazy fix)                                   media-src IS STILL AN
 *                                                    ALLOW-LIST"
 *
 *   MEDIA_HOSTS spread into script-src too       1   "script-src did not
 *                                                    acquire the delivery host"
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword the comment above MEDIA_HOSTS         0   SURVIVED ✓
 *   keep the two Firebase hosts in MEDIA_HOSTS   0   SURVIVED ✓ — they are
 *                                                    deliberately retained
 */
