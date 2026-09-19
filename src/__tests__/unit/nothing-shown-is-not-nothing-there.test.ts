/**
 * @jest-environment node
 */

/**
 *   #886 #887 TWO SCREENS THAT SHOWED A PERSON NOTHING AND EXPLAINED NOTHING.
 *
 * ── #886 "WHEN THEY CLICK ON MY PROPERTIES NOTHING IS SHOWN" ────────────────
 *
 *   THE OWNER'S WORDS. Measured first: the action behind that screen is sound —
 *   `getMyLandListings` returned success with 74 rows against the real local
 *   PostgreSQL. So the screen is not empty because the data is.
 *
 *   TWO DEFECTS IN THE SCREEN, and between them they cover both readings of
 *   "nothing":
 *
 *   1. A FAILED READ WAS RENDERED AS AN EMPTY LIST. The load was
 *
 *          if (result.success && result.data) setProperties(result.data);
 *
 *      with no else. `error`, `setError` and a red failure banner were all
 *      written and wired — and NOTHING EVER CALLED setError, so the banner
 *      guarded a branch that could not run. A refusal fell through to
 *      `properties: []` and the screen said "No Listings Found — Get started by
 *      sharing your first farm land" to a seller with nine parcels.
 *
 *      #588 swept thirty-six screens with this rule and #793 carried it to the
 *      forms. This screen had the banner and not the call — which is worse than
 *      never having had one, because it reads as done.
 *
 *      IT MATTERS MOST HERE BECAUSE OF WHAT THE EMPTY STATE OFFERS: "List Your
 *      Land". A seller who believes it re-lists a parcel that is already there.
 *
 *   2. THE SPINNER HAD NO EXIT. `if (!session?.user?.id) return;` returned
 *      before `setLoading(false)`, and `loading` starts true. The effect calls
 *      it on `status === "authenticated"`, which is not the same as "the
 *      session object carries an id" — auth.ts's session callback sets
 *      `session.user = null` outright for a banned or revoked token.
 *
 * ── #887 AND THE MFA GATE POINTED AT A PARAMETER NOTHING READS ──────────────
 *
 *   MFA_SETUP_PATH was `/profile?setup=mfa`. The profile screen reads exactly
 *   two query parameters — `tab` (#359) and `notice` (#529) — and `setup` is
 *   neither. An administrator bounced out of /admin landed on the GENERAL tab
 *   of an ordinary profile page: no reason given, no mention of MFA, the
 *   enrolment toggle one unlabelled tab away.
 *
 *   #529 IS THAT FINDING, ON THIS SCREEN, FOR THE OTHER GATE: "the member
 *   arrived at an ordinary-looking profile screen with no statement of why
 *   their dashboard had refused them or what to do about it." Learned for one
 *   gate; repeated by the gate added after it.
 *
 *   AND IT HAS A DATE ON IT. Enforcement begins at MFA_ADMIN_ENFORCE_FROM, and
 *   mfa-policy's own header records that NOT ONE ADMINISTRATOR ACCOUNT HAS MFA.
 *   So on that morning every administrator is bounced onto a page that does not
 *   explain itself — which is indistinguishable, from the outside, from "the
 *   admin login is broken".
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    MFA_SETUP_PATH, MFA_ENROL_NOTICE, adminMfaGate, mfaEnrolmentRequired,
} from '@/lib/mfa-policy';

const ROOT = process.cwd();
const MY_PROPERTIES = 'src/app/farm-nation/(member)/my-properties/page.tsx';
const PROFILE = 'src/app/profile/ProfileClient.tsx';

const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

/** An environment with no MFA_ADMIN_GRACE_UNTIL, so the built-in date decides. */
const NO_ENV = {} as NodeJS.ProcessEnv;

// ─────────────────────────────────────────────────────────────────────────────
describe('#886 — a refusal is not an empty list', () => {
    it('THE REPORTED DEFECT: the failed read now reaches setError', () => {
        /*
         *   The dead-code half. `setError` existed and had no caller, so the
         *   banner below it could never render.
         */
        const src = code(MY_PROPERTIES);

        expect(src).toContain('setError(');
        //   And specifically on the unsuccessful branch, not only in a reset.
        expect(src).toMatch(/else\s*\{[\s\S]{0,400}setError\(/);
    });

    it('AND THE SPINNER HAS AN EXIT', () => {
        /*
         *   `if (!session?.user?.id) return;` left `loading` true for ever. The
         *   guard must clear it before returning.
         */
        const src = code(MY_PROPERTIES);
        const at = src.indexOf('if (!session?.user?.id)');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 120)).toContain('setLoading(false)');
    });

    it('AND THE EMPTY STATE DOES NOT SIT UNDER THE FAILURE BANNER', () => {
        /*
         *   Rendering both says "we could not load your listings" directly above
         *   "No Listings Found — list your land", which is the same wrong
         *   invitation the banner exists to prevent.
         */
        expect(code(MY_PROPERTIES)).toContain('error && filteredProperties.length === 0 ? null');
    });

    it('AND THE BANNER OFFERS A WAY OUT', () => {
        //   The complaint was that nothing is shown. A banner with no action is
        //   still nothing she can do.
        const src = code(MY_PROPERTIES);
        const at = src.indexOf('{error && (');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 1000)).toContain('Try again');
    });

    it('AND A FAILED REFRESH DOES NOT BLANK WHAT IS ALREADY ON SCREEN', () => {
        //   `setProperties([])` on the failure branch would turn a transient
        //   refresh error into the very empty screen this finding is about.
        const src = code(MY_PROPERTIES);
        const at = src.indexOf('async function loadProperties');
        const body = src.slice(at, src.indexOf('async function handleDeleteProperty'));

        expect(body).not.toContain('setProperties([])');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#887 — the MFA gate lands somewhere that explains itself', () => {
    it('THE REPORTED SHAPE: the setup path uses parameters the screen reads', () => {
        /*
         *   `?setup=mfa` was read by nothing. `tab` and `notice` are the two the
         *   profile screen implements.
         */
        expect(MFA_SETUP_PATH).toContain('tab=security');
        expect(MFA_SETUP_PATH).toContain(`notice=${MFA_ENROL_NOTICE}`);
        expect(MFA_SETUP_PATH).not.toContain('setup=mfa');
    });

    it('AND THE SCREEN RENDERS THAT NOTICE', () => {
        //   The other half. A path naming a notice nothing renders is the same
        //   defect one layer along.
        const src = code(PROFILE);

        expect(src).toContain('MFA_ENROL_NOTICE');
        expect(src).toContain('notice === MFA_ENROL_NOTICE');
    });

    it('AND THE SCREEN HONOURS tab=security, so the toggle is in view', () => {
        expect(code(PROFILE)).toContain("requestedTab === 'security'");
    });

    it('AND THE GATE STILL NEVER BLOCKS THE PATH IT REDIRECTS TO', () => {
        /*
         *   mfa-policy's own stated invariant, and the one that stops the gate
         *   becoming a loop. Asked of the real constant rather than a literal,
         *   so moving MFA_SETUP_PATH under /admin turns this red.
         */
        const unenrolledAdmin = { roles: ['marketplace_admin'], mfaEnabled: false };
        const path = MFA_SETUP_PATH.split('?')[0];

        expect(adminMfaGate(path, unenrolledAdmin, NO_ENV, Date.parse('2099-01-01'))).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#887 — and enrolment is required of every administrator', () => {
    it('ALL TEN ADMIN ROLES, which is what the policy always said', () => {
        /*
         *   mfa-policy argued for "all ten admin roles, or the rule protects the
         *   accounts that need it least" — and imported the EIGHT-role isAdmin
         *   from role-utils, which omits `moderator` and `support`. Two
         *   functions share the name; the file argued for one and called the
         *   other.
         *
         *   MEASURED: the two roles #353 had to rescue from a hand-written admin
         *   list were once again the two a rule about administrators missed —
         *   and this time it EXEMPTED them from a second factor.
         */
        for (const role of [
            'super_admin', 'admin', 'moderator', 'support',
            'wave_admin', 'cooperative_admin', 'marketplace_admin',
            'export_admin', 'farm_nation_admin', 'academy_admin',
        ]) {
            expect({ role, required: mfaEnrolmentRequired([role]) })
                .toEqual({ role, required: true });
        }
    });

    it('AND A MEMBER IS UNAFFECTED — rule 2 is deliberately narrow', () => {
        for (const role of ['general_user', 'seller', 'buyer', 'cooperative_member', 'field_officer']) {
            expect({ role, required: mfaEnrolmentRequired([role]) })
                .toEqual({ role, required: false });
        }
    });

    it('AND AN ENROLLED ADMINISTRATOR IS NEVER REDIRECTED', () => {
        expect(adminMfaGate('/admin/marketplace',
            { roles: ['marketplace_admin'], mfaEnabled: true }, NO_ENV, Date.parse('2099-01-01')))
            .toBeNull();
    });

    it('AND AN API ROUTE IS REFUSED RATHER THAN REDIRECTED', () => {
        //   Redirecting a fetch to an HTML page turns "you must enrol" into a
        //   JSON parse error at the caller.
        const gate = adminMfaGate('/api/admin/users',
            { roles: ['admin'], mfaEnabled: false }, NO_ENV, Date.parse('2099-01-01'));

        expect(gate?.kind).toBe('deny');
    });
});
