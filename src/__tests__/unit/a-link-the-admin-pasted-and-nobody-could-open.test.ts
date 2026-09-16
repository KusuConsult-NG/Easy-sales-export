/**
 * @jest-environment node
 */

/**
 *   #819 THE ADMIN'S LIVE SESSION WORKED AND EVERY MEMBER GOT A 404.
 *
 *   Reported by the owner: "the live session works for admin but the users live
 *   video is returning 404."
 *
 *   Go Live asks the admin to paste a link:
 *
 *       prompt("Please PASTE the Google Meet, Zoom, or Teams link URL below")
 *       const customMeetingLink = mode.trim();
 *
 *   and stored it verbatim. The member's screen renders it straight into an
 *   href. A URL WITHOUT A SCHEME IS A RELATIVE PATH — and `meet.google.com/abc`
 *   is exactly how Google displays a Meet link, so it is exactly what gets
 *   pasted:
 *
 *       https://wave.easysalesexport.com/meet.google.com/abc-defg-hij   -> 404
 *
 *   WHY THE ADMIN NEVER SAW IT, which is the whole shape of the report. Go Live
 *   sends the admin to /admin/wave/training/live/<eventId>, which opens the
 *   built-in classroom and NEVER READS meetingLink. The one person able to
 *   notice was on the only path that does not use the broken value.
 *
 * ── AND IT WOULD HAVE RUN A javascript: URL ─────────────────────────────────
 *
 *   The stored string went into an href untouched. `javascript:…` typed into
 *   that prompt is script execution for every member who clicks Join Now. An
 *   admin-only input is not a property of the href, and an admin account is
 *   what gets phished.
 *
 * ── BOTH MODULES, AND BOTH DIRECTIONS ───────────────────────────────────────
 *
 *   Academy's Go Live has the same prompt, the same store and the same render,
 *   so it took the same fix — fixing WAVE alone is the partial-fix shape this
 *   audit keeps finding.
 *
 *   And the READ paths are guarded too, because rows started before this
 *   finding still hold whatever was pasted. Normalising new writes would have
 *   left every existing broken session broken.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the https:// prefix dropped for bare hosts (the defect)          KILLED
 *     the hostname check removed                                       KILLED
 *     isSafeMeetingHref parsing WITH a base again                      KILLED
 *     app-relative paths refused (hides the Jitsi Join button)         KILLED
 *     the guard removed from the WAVE meetingLink href                 KILLED
 *     the guard removed from the WAVE videoUrl href                    KILLED
 *     the guard removed from the academy live class                    KILLED
 *     reword this header                                   SURVIVED, intended
 *
 *     the scheme check deleted                       SURVIVED the first draft
 *                                      → then, one case:               KILLED
 *     the guard removed from the WAVE screen         SURVIVED the first draft
 *                                      → then, by field name:          KILLED
 *
 * ── THE TWO SURVIVORS ARE THE USEFUL PART OF THIS LOG ───────────────────────
 *
 *   DELETING THE SCHEME CHECK LEFT THE SUITE GREEN. Every `javascript:` URL
 *   this suite tried had no host, so the hostname guard below refused them all
 *   and the scheme check looked redundant. It is not: measured,
 *
 *       new URL("javascript://evil.example.com/%0aalert(1)").hostname
 *         === "evil.example.com"
 *
 *   so that spelling passes the hostname guard, and the newline makes the rest
 *   script. The case is in the table above now.
 *
 *   AND REMOVING THE GUARD FROM `event.meetingLink` ALSO SURVIVED, because the
 *   assertion was `toContain('isSafeMeetingHref(')` and the same file still
 *   guards `event.videoUrl` — satisfied by the wrong occurrence, which is the
 *   trap this audit has met ten times, inside the test written to prevent this
 *   finding recurring. Each guarded field is named individually now.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { normaliseMeetingLink, isSafeMeetingHref } from '@/lib/meeting-link';

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

// ─────────────────────────────────────────────────────────────────────────────
describe('#819 — a pasted meeting link becomes an absolute URL', () => {
    it.each([
        //   THE case the owner hit: how Google actually displays a Meet link.
        ['a bare Google Meet link', 'meet.google.com/abc-defg-hij', 'https://meet.google.com/abc-defg-hij'],
        ['a bare Zoom link', 'zoom.us/j/1234567890', 'https://zoom.us/j/1234567890'],
        ['a bare Teams link', 'teams.microsoft.com/l/meetup-join/xyz', 'https://teams.microsoft.com/l/meetup-join/xyz'],
        ['www. with no scheme', 'www.meet.google.com/abc', 'https://www.meet.google.com/abc'],
        ['a scheme-relative URL', '//meet.google.com/abc', 'https://meet.google.com/abc'],
        ['surrounding whitespace', '  https://meet.google.com/abc  ', 'https://meet.google.com/abc'],
    ])('REPAIRS %s', (_label, pasted, expected) => {
        const result = normaliseMeetingLink(pasted);
        expect(result).toEqual({ kind: 'ok', url: expected });
    });

    it.each([
        ['an https link', 'https://meet.google.com/abc-defg-hij'],
        ['an http link', 'http://meet.example.com/x'],
    ])('LEAVES %s alone', (_label, pasted) => {
        //   Or the repair would be mangling links that already worked.
        const result = normaliseMeetingLink(pasted);
        expect(result.kind).toBe('ok');
        expect((result as any).url).toContain(new URL(pasted).host);
    });

    it.each([
        ['javascript:', 'javascript:alert(document.cookie)'],
        ['JavaScript with odd casing', 'JaVaScRiPt:alert(1)'],
        ['a data URL', 'data:text/html,<script>alert(1)</script>'],
        ['a file URL', 'file:///etc/passwd'],
        /*
         *   THE ONE THE HOSTNAME CHECK CANNOT CATCH, found by mutation.
         *   Deleting the scheme check SURVIVED the first draft of this
         *   suite, because every javascript: URL it tried had no host and
         *   was refused by the later hostname guard instead.
         *
         *   `javascript://host/%0aalert(1)` HAS a hostname — measured:
         *   new URL(...).hostname === 'evil.example.com' — so it sails past
         *   that guard, and the newline makes the rest of it script. Only
         *   the scheme check stops this one.
         */
        ['javascript: WITH a hostname', 'javascript://evil.example.com/%0aalert(document.cookie)'],
    ])('REFUSES %s', (_label, pasted) => {
        /*
         *   Refused while the scheme is still VISIBLE. Prefixing https:// onto
         *   `javascript:alert(1)` produces a string that parses as a URL, so the
         *   order of these two steps is the whole guard.
         */
        expect(normaliseMeetingLink(pasted).kind).toBe('invalid');
    });

    it.each([
        ['nothing', ''],
        ['only whitespace', '   '],
        ['a non-string', null],
    ])('TREATS %s as "use the built-in classroom"', (_label, pasted) => {
        //   Not an error: leaving it blank is the documented way to get Jitsi.
        expect(normaliseMeetingLink(pasted as any).kind).toBe('empty');
    });

    it('REFUSES something with no website address in it', () => {
        expect(normaliseMeetingLink('just some words').kind).toBe('invalid');
        expect(normaliseMeetingLink('https:///nohost').kind).toBe('invalid');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#819 — and a stored link is checked before it is linked', () => {
    it.each([
        ['an absolute https URL', 'https://meet.google.com/abc', true],
        ['an absolute http URL', 'http://meet.example.com/abc', true],
        //   THE defect, as it sits in rows written before this finding.
        ['a scheme-less host', 'meet.google.com/abc', false],
        //   ALLOWED, and this is the case a stricter guard would have broken:
        //   a blank prompt stores the built-in classroom's own path, and
        //   refusing it hides Join Now for every Jitsi session.
        ['this app\'s own classroom path', '/wave/live-training', true],
        //   but protocol-relative leaves the origin and is not an app path
        ['a protocol-relative URL', '//meet.google.com/abc', false],
        ['a javascript URL', 'javascript:alert(1)', false],
        ['an empty string', '', false],
        ['null', null, false],
    ])('%s -> safe to put in an href: %s', (_label, value, expected) => {
        expect(isSafeMeetingHref(value)).toBe(expected);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#819 — both writers normalise, and every reader guards', () => {
    it.each([
        ['WAVE Go Live', 'src/app/actions/wave/_wv_admin_live.ts'],
        ['Academy Go Live', 'src/app/actions/academy/_ac_live.ts'],
    ])('%s NORMALISES BEFORE STORING', (_name, file) => {
        const src = read(file);
        expect(src).toContain('normaliseMeetingLink(');
        //   And ACTS on the verdict — a call whose result is ignored is the
        //   #741 trap this audit has met repeatedly.
        expect(src).toMatch(/pasted\.kind === "invalid"/);
        //   The raw paste must not reach storage alongside the clean one.
        expect(src).not.toMatch(/customMeetingLink:\s*customMeetingLink\s*\|\|\s*null/);
    });

    it.each([
        ['the WAVE training list', 'src/app/wave/(member)/training/WaveTrainingClient.tsx',
            ['event.meetingLink', 'event.videoUrl']],
        ['the WAVE live-training screen', 'src/app/wave/(member)/live-training/LiveTrainingClient.tsx',
            ['activeSession.customMeetingLink']],
        ['the academy live class', 'src/app/academy/live/[courseId]/AcademyLiveClassClient.tsx',
            ['liveSession?.customMeetingLink']],
    ])('%s GUARDS THE HREF', (_name, file, guarded) => {
        /*
         *   The read half. Normalising new writes alone would have left every
         *   session started before this finding pointing at a 404 for good.
         *
         *   EACH GUARDED FIELD BY NAME. Asserting only that the file mentions
         *   isSafeMeetingHref SURVIVED a mutation that removed the guard from
         *   `event.meetingLink` — because the same file still guards
         *   `event.videoUrl`, and the assertion was satisfied by the wrong
         *   occurrence. That is the trap this audit has met ten times, and it
         *   was in the test written to prevent this finding recurring.
         */
        const src = read(file);
        for (const field of guarded as string[]) {
            expect({ file, field, guarded: src.includes(`isSafeMeetingHref(${field})`) })
                .toEqual({ file, field, guarded: true });
        }
    });

    it('CONTROL: the built-in classroom fallback is still what a blank paste gives', () => {
        //   Or "refuse bad links" could pass by refusing the empty case too,
        //   which would take the Jitsi fallback away from every admin who
        //   leaves the prompt blank — the documented way to use it.
        const wave = read('src/app/actions/wave/_wv_admin_live.ts');
        expect(wave).toContain('/wave/live-training');
        const academy = read('src/app/actions/academy/_ac_live.ts');
        expect(academy).toContain('/academy/live/');
    });
});
