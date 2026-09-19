/**
 * @jest-environment node
 */

/**
 *   #888 #889 WHAT THE OWNER'S OWN PRODUCTION QUERY SHOWED.
 *
 *   Asked to run one query over admin accounts, the owner returned eleven rows.
 *   Two facts in it are defects, and neither was visible from the repository.
 *
 * ── #888 TWO ROWS, ONE PERSON, AND THE SMALLER ONE IS SIGNED IN ─────────────
 *
 *       c9fe1d32…  easysalescooperative@gmail.com
 *                  ["cooperative_admin"]                        auth row: yes
 *       fiIid9Vl…  easysalescooperative@gmail.com
 *                  ["cooperative_admin","admin","general_user"] auth row: no
 *
 *       74e6132d…  steviekusu@gmail.com  ["super_admin"]        auth row: yes
 *       G7tQGmdl…  steviekusu@gmail.com  ["super_admin"]        auth row: no
 *
 *   The second id in each pair is a 28-character Firebase uid — the legacy row,
 *   left behind by the migration. Supabase authenticates the cooperative admin
 *   as c9fe1d32, auth.ts's PRIORITY 1 finds that row by id, and the session is
 *   built from it. They sign in holding `cooperative_admin` and NOT `admin`: a
 *   global administrator reduced to one module's silo, on every login, silently.
 *
 *   PRIORITY 2 ALREADY REPORTS THIS EXACT CONDITION — chooseProfileForAuthAccount
 *   counts the candidates and logs "these rows need reconciling" (#477). It is
 *   reached only when the direct lookup MISSES, which is the case where the
 *   account is not split this way. The loud case was the unreported one.
 *
 *   NOTHING ABOUT WHO IS SIGNED IN CHANGES HERE. Unioning roles across a
 *   person's rows would grant whatever their most privileged duplicate holds —
 *   a privilege decision taken unattended, which _duplicate_profiles.ts refuses
 *   to make and explains why. A person reconciles the rows at
 *   /admin/forensics/duplicates; this makes the condition visible so they know
 *   there is something to reconcile.
 *
 * ── #889 A ROLE THE CODEBASE SAYS NOTHING WRITES, ON A LIVE ACCOUNT ─────────
 *
 *       easysalesfarmnation@gmail.com
 *         ["farm_nation_admin","farmnation_admin","admin","farm_admin",
 *          "general_user"]
 *
 *   admin-permissions' note on ADMIN_ROLES says: "every copy contained
 *   'farmnation_admin' — a role that does not exist. The role is
 *   `farm_nation_admin`, and nothing anywhere writes the other spelling."
 *
 *   #96 fixed the code that READ the misspelling and nobody looked at the data,
 *   so "nothing writes it" described the repository rather than the platform.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { canonicalRole, canonicalRoles } from '@/lib/role-aliases';
import {
    isAdmin, adminLandingPath, canAccessAdminRoute, adminSiloRedirect,
} from '@/lib/admin-permissions';
import { mfaEnrolmentRequired } from '@/lib/mfa-policy';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

/** The live account, spelled exactly as production holds it. */
const FARM_NATION_ADMIN_LIVE = [
    'farm_nation_admin', 'farmnation_admin', 'admin', 'farm_admin', 'general_user',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#889 — the misspelling resolves to the role it plainly means', () => {
    it('THE REPORTED SPELLING: farmnation_admin IS farm_nation_admin', () => {
        expect(canonicalRole('farmnation_admin')).toBe('farm_nation_admin');
    });

    it('AND AN ACCOUNT HOLDING ONLY IT IS AN ADMINISTRATOR EVERYWHERE', () => {
        /*
         *   The case that is one hand-edit away and would be invisible. Every
         *   predicate that decides what an administrator may do, asked about the
         *   misspelling alone.
         */
        const roles = ['farmnation_admin'];

        expect(isAdmin(roles)).toBe(true);
        expect(adminLandingPath(roles)).toBe('/admin/farm-nation');
        expect(canAccessAdminRoute(roles, '/admin/farm-nation')).toBe(true);
        expect(adminSiloRedirect(roles, '/admin/farm-nation')).toBeNull();
        expect(mfaEnrolmentRequired(roles)).toBe(true);
    });

    it('AND THE SILO STILL HOLDS — it is that role, not a wider one', () => {
        //   Resolving a spelling must not widen what the role reaches.
        const roles = ['farmnation_admin'];

        expect(canAccessAdminRoute(roles, '/admin/cooperatives')).toBe(false);
        expect(canAccessAdminRoute(roles, '/admin/audit-logs')).toBe(false);
    });

    it('AND `farm_admin` IS DELIBERATELY NOT RESOLVED', () => {
        /*
         *   role-aliases' own rule: "a guessed spelling is a guessed grant."
         *   `farmnation_admin` is the same two words missing an underscore.
         *   `farm_admin` is a different word, and reading it as Farm Nation
         *   authority would hand a module admin's powers to a guess.
         */
        expect(canonicalRole('farm_admin')).toBe('farm_admin');
        expect(isAdmin(['farm_admin'])).toBe(false);
        expect(adminLandingPath(['farm_admin'])).toBeNull();
    });

    it('AND THE LIVE ACCOUNT IS UNCHANGED BY ANY OF IT — the control', () => {
        /*
         *   That account already holds `farm_nation_admin` and `admin`, so this
         *   grants it nothing it did not have. If this ever fails, the alias
         *   changed somebody's access rather than repairing a spelling.
         */
        expect(isAdmin(FARM_NATION_ADMIN_LIVE)).toBe(true);
        //   `admin` is global, so the landing page is the main dashboard, not a
        //   silo — which is what it was before the alias existed.
        expect(adminLandingPath(FARM_NATION_ADMIN_LIVE)).toBe('/admin');
        expect(canAccessAdminRoute(FARM_NATION_ADMIN_LIVE, '/admin/audit-logs')).toBe(true);
    });

    it('AND THE CANONICAL FORM DROPS NOTHING', () => {
        //   canonicalRoles resolves, it does not filter. A role it does not know
        //   passes through rather than disappearing.
        const out = canonicalRoles(FARM_NATION_ADMIN_LIVE);

        expect(out).toHaveLength(FARM_NATION_ADMIN_LIVE.length);
        expect(out).toContain('farm_admin');
        expect(out.filter((r) => r === 'farm_nation_admin')).toHaveLength(2);
    });

    it('AND EVERY OTHER ADMIN ROLE STILL MEANS ITSELF', () => {
        for (const role of [
            'super_admin', 'admin', 'moderator', 'support', 'wave_admin',
            'cooperative_admin', 'marketplace_admin', 'export_admin',
            'farm_nation_admin', 'academy_admin',
        ]) {
            expect({ role, canonical: canonicalRole(role) }).toEqual({ role, canonical: role });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#888 — the login says so when a person has more than one row', () => {
    /*
     *   A SOURCE PROPERTY, AND SAID TO BE ONE. authorize() is four hundred lines
     *   behind Supabase Auth, the rate limiter, the user cache and the profile
     *   resolver; the pg suite exercises the resolution itself
     *   (login-finds-the-profile-it-already-has). What is asserted here is that
     *   the direct-match branch CONSULTS the duplicate question at all — which
     *   is the whole of the defect, because it previously did not ask.
     */
    const src = code('src/lib/auth.ts');

    it('THE DEFECT: the direct-id branch now looks for other rows', () => {
        const at = src.indexOf('Direct Profile ID Match');
        expect(at).toBeGreaterThan(-1);

        const branch = src.slice(at, at + 1400);
        expect(branch).toContain('findProfilesByEmail(email)');
        expect(branch).toContain('rows.length > 1');
    });

    it('AND IT NAMES THE ROWS AND WHERE TO RECONCILE THEM', () => {
        //   A warning that does not name the other ids leaves the owner the same
        //   query to write again.
        const at = src.indexOf('SPLIT ACCOUNT');
        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 700)).toContain('/admin/forensics/duplicates');
    });

    it('AND THE CHECK CANNOT FAIL A LOGIN', () => {
        /*
         *   THE PROPERTY THAT MATTERS MOST. This is a diagnostic added to the
         *   one path every person on the platform walks. A diagnostic that can
         *   throw is a worse defect than the one it reports.
         */
        //   RAW source, not the comment-stripped copy: the reason this is
        //   wrapped is written in the comment, and stripComments removes it.
        const raw = readFileSync(join(process.cwd(), 'src/lib/auth.ts'), 'utf8');
        const at = raw.indexOf('const { rows } = await findProfilesByEmail(email);');

        expect(at).toBeGreaterThan(-1);
        //   The `try {` immediately precedes it, and the catch follows within
        //   the same block.
        expect(raw.slice(at - 120, at)).toContain('try {');
        expect(raw.slice(at, at + 1200)).toContain('} catch (dupErr) {');
        expect(raw.slice(at, at + 1200)).toContain('non-fatal');
    });

    it('AND IT DOES NOT CHANGE WHO IS SIGNED IN', () => {
        /*
         *   The session id is still whatever the direct match resolved. If a
         *   future change starts choosing a different row here, or unioning
         *   roles across rows, that is a privilege decision and this fails.
         */
        const at = src.indexOf('Direct Profile ID Match');
        const branch = src.slice(at - 300, at + 1400);

        expect(branch).toContain('uid = directData._migratedTo || sbData.user.id');
        expect(branch).not.toMatch(/uid\s*=\s*rows\[/);
        expect(branch).not.toContain('roles: [...');
    });
});
