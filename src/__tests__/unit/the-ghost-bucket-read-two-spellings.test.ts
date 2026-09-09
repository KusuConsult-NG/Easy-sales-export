/**
 * @jest-environment node
 */

/**
 *   #536 THE GHOST BUCKET READ TWO SPELLINGS OF ADDRESS AND TWO OF BANK. THE
 *        PLATFORM WRITES SEVEN AND FOUR.
 *
 *   Reported by the owner, who opened /admin and saw
 *
 *       Ghost   19,853 (47.1%)   Incomplete registrations / minimal data
 *
 *   and asked "why do we have this showing in the UI? this means data is not in
 *   sync with DB".
 *
 *   IT IS NOT A SYNC FAULT, and saying so precisely is half the finding.
 *   categorizeUser is what the dashboard means by Ghost, and it read
 *
 *       verificationProfile.address.state   |   address.state
 *       verificationProfile.bankDetails.bankName | bankDetails.bankName
 *
 *   and nothing else. Measured against the platform's OWN WRITERS:
 *
 *     _wv_applications writes onto the USER row  stateOfOrigin, residentialState,
 *                                                lga, residentialAddress
 *     admin/_legacy (the importer)               stateOfOrigin, lga,
 *                                                residentialAddress, address.state
 *     bank-account.ts                            bankAccountNumber, bankName,
 *                                                bankCode, bankAccountName and
 *                                                the nested bankDetails block
 *
 *   So a member carrying `stateOfOrigin: "Kano"` and a verified
 *   `bankAccountNumber` — everything a payout needs — counted as "minimal data",
 *   because the two keys the reader happened to check were not the two the
 *   writer happened to use. Reader narrower than writer, on a number the owner
 *   reads as a health metric.
 *
 * ── WHAT THIS DOES NOT CLAIM ────────────────────────────────────────────────
 *
 *   IT DOES NOT CLAIM THE 19,853 WILL DROP. Whether any of those rows carry the
 *   newly-read spellings is a question about production data, and this audit has
 *   no query against it. What is provable from the code is that the reader was
 *   narrower than the writers; what it moves is unknown until the dashboard is
 *   reloaded. Asserting a number here would be inventing one.
 *
 *   WAVE APPLICANTS WERE NEVER IN THIS BUCKET. _wv_applications sets
 *   `serviceRegistrations.wave.status = "pending"` on the same write, so they
 *   classify as PENDING. I checked before writing the header, because the
 *   obvious story — "the WAVE applicants you were notified about are counted as
 *   ghosts" — is wrong.
 *
 *   PHONE AND NAME ARE STILL NOT DATA HERE, deliberately. The SMS screen
 *   describes this audience as "zero activity on the platform"; a phone number
 *   is not activity. Counting it would empty the bucket by redefining it rather
 *   than by correcting what it reads.
 *
 * ── AND THE PLACEHOLDER RULE NOW APPLIES TO ALL OF THEM ─────────────────────
 *
 *   The original excluded the literal "N/A" from the two verificationProfile
 *   branches and not from the two top-level ones. #473's migration reproduced
 *   that asymmetry on purpose, because it was MOVING the rule rather than
 *   changing it. Widening the reads without widening the placeholder rule would
 *   have counted "N/A" as an address — and the importer writes that string — so
 *   one rule now covers all of them.
 *
 * ── THE SQL HALF, AND WHAT IS NOT VERIFIED HERE ─────────────────────────────
 *
 *   The dashboard reads count_user_segments(), a SQL function that mirrors this
 *   one; migration 030 widens it identically. The parity suite that holds the
 *   two together needs a local PostgreSQL and SKIPS LOUDLY without one, so on
 *   this machine the SQL is checked by review and by the assertions below that
 *   read it as text. That is weaker than executing it and is said rather than
 *   implied.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     a widened address spelling removed              KILLED
 *     a widened bank spelling removed                 KILLED
 *     the placeholder rule dropped                    KILLED
 *     the precedence changed                          KILLED
 *     the SQL left un-widened                         KILLED
 *     the labels reverted                             KILLED
 *     reword this header                              SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { categorizeUser } from '@/lib/broadcast-logic';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: p });
const raw = (p: string) => readFileSync(join(ROOT, p), 'utf-8');

//   034, not 030 — the number was taken.
//
//   The first version of this file was written as 030 without looking, and
//   030_find_users_by_normalised_email.sql has existed since #476. Two files
//   sharing a number is how a deploy applies one of them; the build script's own
//   manifest is what caught it.
const MIGRATION = 'supabase/migrations/034_user_segment_counts_widened.sql';
const CHART = 'src/components/admin/UserSegmentsChart.tsx';

// ─────────────────────────────────────────────────────────────────────────────
describe('#536 — a row with an address is not a ghost', () => {
    it('stateOfOrigin COUNTS — the WAVE form and the importer both write it', () => {
        //   THE test. This is the field _wv_applications puts on the user row.
        expect(categorizeUser({ stateOfOrigin: 'Kano' })).toBe('stalled_users');
    });

    it('AND SO DO THE OTHER SPELLINGS THE PLATFORM WRITES', () => {
        for (const row of [
            { residentialState: 'Lagos' },
            { residentialAddress: '12 Awolowo Road' },
            { lga: 'Ikeja' },
            { state: 'Sokoto' },
            { address: { state: 'Kaduna' } },
            { verificationProfile: { address: { state: 'Borno' } } },
        ]) {
            expect({ row, seg: categorizeUser(row) }).toEqual({ row, seg: 'stalled_users' });
        }
    });

    it('AND EVERY BANK SPELLING COUNTS', () => {
        for (const row of [
            { bankAccountNumber: '0123456789' },
            { bankName: 'GTBank' },
            { bankDetails: { accountNumber: '0123456789' } },
            { bankDetails: { bankName: 'GTBank' } },
            { verificationProfile: { bankDetails: { bankName: 'GTBank' } } },
        ]) {
            expect({ row, seg: categorizeUser(row) }).toEqual({ row, seg: 'stalled_users' });
        }
    });

    it('AND A ROW WITH GENUINELY NOTHING IS STILL A GHOST', () => {
        //   The vacuity guard. A classifier that called everything "stalled"
        //   would satisfy every assertion above and empty the bucket by
        //   accident rather than by measurement.
        expect(categorizeUser({})).toBe('ghost_users');
        expect(categorizeUser({ serviceRegistrations: {} })).toBe('ghost_users');
        expect(categorizeUser({ firstName: 'Ada', phone: '08030000001' })).toBe('ghost_users');
    });

    it('and a phone number alone is still not activity, deliberately', () => {
        //   The SMS screen calls this audience "zero activity on the platform".
        //   Counting a phone would redefine the bucket rather than correct it.
        expect(categorizeUser({ phone: '08030000001', fullName: 'Ada Obi' })).toBe('ghost_users');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#536 — a placeholder is not an address', () => {
    it('"N/A" DOES NOT COUNT, IN ANY OF THE SEVEN', () => {
        //   The original excluded it from two branches and not the other two.
        //   Widening the reads without widening this would have made the
        //   importer's placeholder look like data.
        for (const row of [
            { state: 'N/A' },
            { stateOfOrigin: 'n/a' },
            { residentialAddress: '  ' },
            { lga: '-' },
            { address: { state: 'N/A' } },
            { verificationProfile: { address: { state: 'N/A' } } },
            { bankAccountNumber: 'none' },
        ]) {
            expect({ row, seg: categorizeUser(row) }).toEqual({ row, seg: 'ghost_users' });
        }
    });

    it('AND A REAL VALUE THAT MERELY LOOKS ODD STILL DOES', () => {
        //   The counterpart guard: an over-eager placeholder list would start
        //   discarding real Nigerian place names.
        expect(categorizeUser({ lga: 'Nassarawa' })).toBe('stalled_users');
        expect(categorizeUser({ state: 'FCT' })).toBe('stalled_users');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#536 — the order and the neighbours are untouched', () => {
    it('AN APPROVED REGISTRATION IS STILL ACTIVE, WHATEVER ELSE IS ON THE ROW', () => {
        expect(categorizeUser({
            serviceRegistrations: { wave: { status: 'approved' } },
            stateOfOrigin: 'Kano',
        })).toBe('active_users');
    });

    it('AND A PENDING ONE IS STILL PENDING — which is where WAVE applicants are', () => {
        //   _wv_applications sets serviceRegistrations.wave.status = "pending"
        //   on the same write that sets stateOfOrigin, so those applicants were
        //   never in the ghost bucket. Checked before the header claimed it.
        expect(categorizeUser({
            serviceRegistrations: { wave: { status: 'pending' } },
            stateOfOrigin: 'Kano',
        })).toBe('pending_users');
    });

    it('AND "suspended" STILL FALLS THROUGH TO STALLED', () => {
        //   Named as an oddity by #473 and preserved by it; preserved here too.
        expect(categorizeUser({
            serviceRegistrations: { wave: { status: 'suspended' } },
        })).toBe('stalled_users');
    });

    it('and "not_started" is still not a start', () => {
        expect(categorizeUser({
            serviceRegistrations: { wave: { status: 'not_started' } },
        })).toBe('ghost_users');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#536 — the SQL moved with it', () => {
    it('THE MIGRATION WIDENS THE SAME SEVEN AND FOUR', () => {
        //   The dashboard reads count_user_segments(), not this JavaScript. A
        //   fix to one half only would leave the number exactly as it was.
        const sql = raw(MIGRATION);

        for (const key of ['stateOfOrigin', 'residentialState', 'residentialAddress', 'lga']) {
            expect({ key, present: sql.includes(`->'${key}'`) }).toEqual({ key, present: true });
        }
        for (const key of ['bankAccountNumber', 'bankName']) {
            expect({ key, present: sql.includes(`->'${key}'`) }).toEqual({ key, present: true });
        }
    });

    it('AND APPLIES THE PLACEHOLDER RULE THROUGH ONE FUNCTION', () => {
        const sql = raw(MIGRATION);

        expect(sql).toContain('CREATE OR REPLACE FUNCTION jsonb_present');
        expect(sql).toContain("'n/a'");
        //   Every read goes through it — the asymmetry 029 preserved is gone.
        expect(sql).not.toContain("IS DISTINCT FROM 'N/A'");
    });

    it('AND IT IS A NEW FILE, NOT AN EDIT TO THE APPLIED ONE', () => {
        //   029 has been applied. Editing it would leave the file and the
        //   database disagreeing on every cluster that already ran it.
        const old = raw('supabase/migrations/029_user_segment_counts.sql');

        expect(old).toContain("IS DISTINCT FROM 'N/A'");
        expect(old).not.toContain('stateOfOrigin');
    });

    it('and it reloads the PostgREST schema cache, as 029 had to', () => {
        //   029's own note records a fix that silently fell back to the slow
        //   path because the cache had not been reloaded.
        expect(raw(MIGRATION)).toContain("NOTIFY pgrst, 'reload schema'");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#536 — the labels say what is measured', () => {
    it('GHOST NO LONGER CALLS ITSELF AN INCOMPLETE REGISTRATION', () => {
        //   That phrasing is what the owner read as a sync fault. A row is here
        //   because three fields are empty, not because a sign-up broke.
        const src = code(CHART);

        expect(src).not.toContain('Incomplete registrations / minimal data');
        expect(src).toContain('No application, bank details or address on record');
    });

    it('AND STALLED NO LONGER CLAIMS A COMPLETE PROFILE', () => {
        //   The classifier never looks at profileComplete, which is decided by
        //   an entirely different rule.
        const src = code(CHART);

        expect(src).not.toContain('Profile complete but no module application');
        expect(src).toContain('Some details on file, no live application');
    });

    it('AND THE BROADCAST SCREENS AGREE WITH THE DASHBOARD', () => {
        //   Three screens describe this audience. One saying "zero platform
        //   data" while the dashboard says something else is how a number comes
        //   to mean two things.
        expect(code('src/app/admin/communications/broadcast/page.tsx'))
            .not.toContain('Zero platform data');
        expect(code('src/app/admin/communications/sms/page.tsx'))
            .toContain('No application, bank details or address on record');
    });

    it('and the four segments still render', () => {
        //   #484's shape — the assertions above are about text in a file that
        //   has to still be the chart.
        const src = code(CHART);
        for (const label of ['Active', 'Pending', 'Stalled', 'Ghost']) {
            expect(src).toContain(`label: "${label}"`);
        }
    });
});
