/**
 * @jest-environment node
 */

/**
 *   #829 THE WAVE MEMBER DASHBOARD MADE UP ITS OWN NEWS, AND ITS OWN ACCOUNTS.
 *
 *   The owner listed "3 fabricated announcements hardcoded on the WAVE member
 *   dashboard". There were three, and there was a second panel beside them that
 *   was worse.
 *
 * ── THE ANNOUNCEMENTS ───────────────────────────────────────────────────────
 *
 *   Three literals in the page, shown to every WAVE member as programme news:
 *
 *     "Presidential Mandate — Federal Agripreneur Initiative Alignment …
 *      support 100,000 female agripreneurs … by 2027"
 *     "Bauchi & Kano Fertilizer Distribution — Seed inputs and organic
 *      fertilizer batches are now arriving at regional hubs for WAVE member
 *      collection"
 *     "First Organic Sesame Shipment Booked … heading to the Port of Rotterdam"
 *
 *   The middle one is the one to sit with. It tells a woman that inputs are
 *   waiting for her at a regional hub. Acting on it means a journey she pays
 *   for, to collect something that was never sent.
 *
 *   The platform already HAS an announcements system — actions/cms writes
 *   COLLECTIONS.ANNOUNCEMENTS, /admin/cms publishes, AnnouncementBanner reads.
 *   This panel is the only one that invented its own. It reads the same source
 *   now, and an empty programme says so instead of filling the space.
 *
 * ── AND THE LEDGER, WHICH NAMED REAL INSTITUTIONS ───────────────────────────
 *
 *   Beside it stood "NGO & Sponsor Funding Ledger": ₦80,500,000 under "Total
 *   Program Funding Distributed", a bar at 80%, and a state-by-state breakdown
 *   attributed to the Bill & Melinda Gates Foundation, UN Women / AgDevCo, the
 *   African Development Bank, USAID Agri-Connect and the Federal Ministry of
 *   Agriculture.
 *
 *   Every figure was a literal in the file. Nothing in this codebase reads a
 *   funding record, because there is no funding record to read.
 *
 *   That is not a placeholder. It is a financial statement about money said to
 *   have come from five real named bodies and been distributed to members —
 *   shown to the people who would be its beneficiaries. A member who believes
 *   it is owed something; an institution named in it never agreed to appear.
 *   Removed, not rewired: wiring implies a source, and there is none.
 *
 * ── THE SWEEP IS BY SHAPE, NOT BY THESE FIVE NAMES ──────────────────────────
 *
 *   #824's lesson, which cost an eighth invented acronym expansion: an
 *   enumerated list cannot catch a new invention. So the assertion below is not
 *   "these five strings are gone" — it is that no member-facing screen names a
 *   funder or a donor institution at all, which a sixth one would also trip.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     any one announcement literal restored                          KILLED
 *     the CMS read removed, panel left empty                         KILLED
 *     the funding ledger restored                                    KILLED
 *     a DIFFERENT funder name introduced (shape check)               KILLED
 *     the empty state removed so nothing renders                     KILLED
 *     reword this header                                 SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const DASHBOARD = 'src/app/wave/(member)/dashboard/page.tsx';

/**
 * Stripped, because the comments recording this finding QUOTE every literal
 * they removed — the #741 trap, which this suite would fail on immediately
 * without it. #827 is what makes stripping trustworthy across .tsx.
 */
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#829 — the announcements are the ones somebody published', () => {
    it('THE PANEL READS THE CMS, NOT A LITERAL', () => {
        const src = code(DASHBOARD);

        expect(src).toContain('getActiveAnnouncementsAction');
        expect(src).toMatch(/announcements\.map\(/);

        /*
         *   AND THE FETCHED VALUE IS WHAT LANDS IN STATE.
         *
         *   The first draft asserted only that `setAnnouncements(` appeared,
         *   and mutation killed it: replacing the call with
         *   `setAnnouncements([])` left this suite GREEN. The panel would then
         *   read the CMS on every load, throw the answer away, and render "No
         *   announcements at the moment" forever — which is a worse defect than
         *   the one this finding fixed, because it looks like an empty
         *   programme rather than a bug.
         *
         *   "The file mentions the rule" is the weakest assertion in this
         *   codebase's vocabulary, and this is what it looks like when the rule
         *   is a data flow.
         */
        expect(src).toMatch(/setAnnouncements\(\s*announcementsSettled\.value/);
    });

    it('AND NONE OF THE INVENTED ANNOUNCEMENTS SURVIVES', () => {
        const src = code(DASHBOARD);

        for (const phrase of [
            'Presidential Mandate',
            'Federal Agripreneur Initiative',
            'Fertilizer Distribution',
            'arriving at regional hubs',
            'Organic Sesame Shipment',
            'Port of Rotterdam',
        ]) {
            expect({ phrase, present: src.includes(phrase) }).toEqual({ phrase, present: false });
        }
    });

    it('AND AN EMPTY PROGRAMME SAYS SO RATHER THAN SHOWING NOTHING', () => {
        //   A panel that renders an empty div when there is no news looks
        //   broken, which is how a placeholder gets reintroduced.
        const src = code(DASHBOARD);
        expect(src).toContain('No announcements at the moment');
    });

    it('AND A FAILED READ IS NOT AN EMPTY ONE', () => {
        //   #595's rule, on the panel this finding adds. The other three on
        //   this screen already distinguish them.
        const src = code(DASHBOARD);
        expect(src).toContain('announcementsFailed');
        expect(src).toMatch(/announcementsFailed \?[\s\S]{0,120}ListLoadFailed/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#829 — and no screen states funding this platform cannot account for', () => {
    function memberFacingFiles(): string[] {
        const out: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) {
                    if (entry !== 'node_modules') walk(full);
                } else if (/\.tsx$/.test(full) && !/__tests__|\.test\./.test(full)) {
                    out.push(full);
                }
            }
        };
        walk(join(ROOT, 'src/app'));
        return out;
    }

    /**
     * The SHAPE of a donor or funder attribution, not the five names that were
     * there.
     *
     *   #824 established why: its sweep was an enumerated list of seven invented
     *   acronym expansions, and an EIGHTH was written in three live places that
     *   the list could not see. A list cannot catch a new invention.
     *
     *   So this matches the institutional vocabulary — "Foundation", "UN ",
     *   "USAID", "Development Bank", "Ministry of" — in a rendered string. A
     *   sixth sponsor nobody has thought of yet trips it too.
     */
    const FUNDER_SHAPE =
        /["'`][^"'`]*\b(?:Melinda|Gates Foundation|UN Women|AgDevCo|USAID|Development Bank|Ministry of Agriculture)\b[^"'`]*["'`]/;

    it('NO PAGE ATTRIBUTES MONEY TO A NAMED INSTITUTION', () => {
        const offenders: string[] = [];
        for (const file of memberFacingFiles()) {
            const src = stripComments(readFileSync(file, 'utf-8'), { label: file });
            const hit = src.match(FUNDER_SHAPE);
            if (hit) offenders.push(`${file.slice(ROOT.length + 1)} — ${hit[0].slice(0, 60)}`);
        }

        expect(offenders).toEqual([]);
    });

    it('AND THE LEDGER ITSELF IS GONE FROM THE DASHBOARD', () => {
        const src = code(DASHBOARD);

        expect(src).not.toContain('Total Program Funding Distributed');
        expect(src).not.toContain('Regional Funding Dispersion');
        expect(src).not.toContain('NGO & Sponsor Funding Ledger');
        //   And the figures, which are the part a member would act on.
        for (const amount of ['80,500,000', '24200000', '18500000', '15400000', '12800000', '9600000']) {
            expect({ amount, present: src.includes(amount) }).toEqual({ amount, present: false });
        }
    });

    it('CONTROL: THE SHAPE SWEEP CATCHES A FUNDER NOBODY HAS WRITTEN YET', () => {
        /*
         *   Vacuity guard, and the point of using a shape. If this only tested
         *   the five names removed, a sixth would pass — which is precisely how
         *   #824's eighth expansion reached production past a sweep that had
         *   caught seven.
         */
        expect(FUNDER_SHAPE.test('const s = "Funded by the Rockefeller Development Bank";')).toBe(true);
        expect(FUNDER_SHAPE.test('const s = "Supported by USAID Feed the Future";')).toBe(true);
        //   and it does not fire on ordinary copy
        expect(FUNDER_SHAPE.test('const s = "Your application is being reviewed";')).toBe(false);
    });
});
