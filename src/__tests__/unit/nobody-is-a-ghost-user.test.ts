/**
 * @jest-environment node
 */

/**
 *   #805 "GHOST USERS" WAS THE PLATFORM'S OWN WORD FOR ITS QUIETEST MEMBERS.
 *
 *   The owner asked for them to stop being shown as ghosts, and — on the second
 *   message — to still be SHOWN. Both halves are the requirement: the number is
 *   real and worth reading, the word is not one to put on nearly half a
 *   register of real people. Two screens printed it as "👻 Ghost Users".
 *
 *   The classifier is untouched. `categorizeUser` still returns `ghost_users`,
 *   sms-broadcast still switches on it, the counts are identical. Only the
 *   words a person reads have moved.
 *
 * ── THE KEY DOES NOT MOVE ───────────────────────────────────────────────────
 *
 *   `ghost_users` is a STORED TARGETING VALUE. Renaming it to fix a label is
 *   how a cosmetic change becomes an outage on a platform whose owner's whole
 *   complaint is that it keeps breaking. The test below pins the key as hard as
 *   it pins the label.
 *
 * ── AND IT WAS WRITTEN IN FOUR PLACES ───────────────────────────────────────
 *
 *   The segmentation chart, the SMS audience picker, the broadcast audience
 *   picker, and the broadcast HISTORY map. I found three, fixed them, and the
 *   fourth only surfaced because a grep after the fact still hit an emoji —
 *   which is the argument for lib/user-segments rather than a fourth edit.
 *
 *   This audit's most repeated finding is a correct rule applied to some of the
 *   places it names. It applies to copy exactly as it applies to guards.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the chart's label restored to "Ghost"                            KILLED
 *     the SMS picker spelled out its own label again                   KILLED
 *     the broadcast picker restored "👻 Ghost Users"                    KILLED
 *     the history map restored "👻 Ghost Users"                         KILLED
 *     the stored key renamed to "not_started_users"                    KILLED
 *     the Ghost ICON put back on the chart                             KILLED
 *     reword this header                                   SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { USER_SEGMENT_LABELS, BROADCAST_SEGMENT_LABELS } from '@/lib/user-segments';
import { categorizeUser } from '@/lib/broadcast-logic';

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

/** Every screen that puts a segment name in front of a person. */
const DISPLAY_SITES: ReadonlyArray<{ name: string; file: string }> = [
    { name: 'segmentation chart', file: 'src/components/admin/UserSegmentsChart.tsx' },
    { name: 'SMS audience picker', file: 'src/app/admin/communications/sms/page.tsx' },
    { name: 'broadcast audience picker', file: 'src/app/admin/communications/broadcast/page.tsx' },
    { name: 'broadcast history', file: 'src/app/admin/communications/history/page.tsx' },
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#805 — nobody is shown as a ghost', () => {
    it('THE LABEL SAYS WHERE THEY GOT TO, not what they are', () => {
        expect(USER_SEGMENT_LABELS.ghost.label).toBe('Not Started');
        expect(USER_SEGMENT_LABELS.ghost.label.toLowerCase()).not.toContain('ghost');
    });

    it.each(DISPLAY_SITES)('$name SHOWS NO GHOST, and no ghost emoji', ({ name, file }) => {
        /*
         *   THE test. Checked per site rather than once, because four separate
         *   files spelled this out and the fourth is the one I missed.
         *
         *   IT POLICES STRING LITERALS, NOT IDENTIFIERS, and that distinction
         *   is the finding in miniature. `segments.ghost` and `ghost_users` are
         *   stored shapes — the property the analytics service produces and the
         *   targeting key broadcasts switch on. Renaming either to satisfy a
         *   copy change is how a label fix becomes an outage.
         *
         *   The first draft of this assertion stripped `ghost_users` and then
         *   failed on `segments.ghost`, which would have pushed me toward
         *   exactly that rename. What must not say "ghost" is the text a person
         *   reads.
         */
        const src = read(file);
        const literals = src.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? [];
        const offenders = literals.filter(l => /ghost/i.test(l) && !/ghost_users/.test(l));

        expect({ name, offenders }).toEqual({ name, offenders: [] });
        expect({ name, emoji: src.includes('👻') }).toEqual({ name, emoji: false });
    });

    it.each(DISPLAY_SITES)('$name READS THE SHARED WORDING rather than its own', ({ name, file }) => {
        //   A site that happens not to say "ghost" today but still types its own
        //   copy is the next drift, not a fix.
        const src = read(file);
        const shared = src.includes('USER_SEGMENT_LABELS') || src.includes('BROADCAST_SEGMENT_LABELS');

        expect({ name, shared }).toEqual({ name, shared: true });
    });

    it('AND THE CHART NO LONGER DRAWS A GHOST', () => {
        //   The icon said it as loudly as the word did.
        const src = read('src/components/admin/UserSegmentsChart.tsx');
        expect(src).not.toMatch(/\bGhost\b/);
        expect(src).toMatch(/CircleDashed/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#805 — and the segment itself is unchanged', () => {
    it('THE STORED KEY IS STILL ghost_users', () => {
        /*
         *   The half that must NOT move. This key is switched on by
         *   sms-broadcast, returned by broadcast-logic and named in a
         *   supabase-db query comment. Renaming it would retarget or silently
         *   empty every broadcast aimed at this audience.
         */
        expect(BROADCAST_SEGMENT_LABELS.ghost_users).toBeDefined();
        expect(read('src/lib/broadcast-logic.ts')).toContain('return "ghost_users"');
    });

    it('EXECUTED: an account with no activity is still categorised the same way', () => {
        //   The owner asked for it to still be REFLECTED. A relabel that
        //   quietly stopped counting people would be the opposite of the ask.
        expect(categorizeUser({})).toBe('ghost_users');
        expect(categorizeUser({ serviceRegistrations: {} })).toBe('ghost_users');
    });

    it('CONTROL: the other three buckets still classify as they did', () => {
        //   Or this change would have "fixed" the label by moving people
        //   between segments, which is a data change wearing a copy change.
        expect(categorizeUser({ serviceRegistrations: { wave: { status: 'approved' } } }))
            .toBe('active_users');
        expect(categorizeUser({ serviceRegistrations: { wave: { status: 'pending' } } }))
            .toBe('pending_users');
        expect(categorizeUser({ bankDetails: { bankName: 'Zenith' } }))
            .toBe('stalled_users');
    });

    it('CONTROL: the descriptions still say what is MEASURED (#536)', () => {
        /*
         *   #536 corrected these from wording the owner read as a sync fault.
         *   Moving them into a shared module must not have quietly restored the
         *   inference-inviting version.
         */
        expect(USER_SEGMENT_LABELS.ghost.description)
            .toBe('No application, bank details or address on record');
        expect(USER_SEGMENT_LABELS.stalled.description)
            .toBe('Some details on file, no live application');
    });
});
