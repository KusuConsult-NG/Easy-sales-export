/**
 * @jest-environment node
 */

/**
 *   #486 FARM NATION APPROVAL GATED NOTHING, AND THE CHECK MEANT TO CATCH THAT
 *        ASKED ABOUT A FLAG THIRTEEN UNRELATED PATHS WRITE.
 *
 *   Found by following the owner's forensic report. It said "Verification Fraud
 *   (Badge vs Approval): 2 affected". Two seemed like a data problem. It is not.
 *
 * ── HALF ONE: THE CHECK WAS ASKING ABOUT THE WRONG FLAG ─────────────────────
 *
 *   The check read:
 *
 *       users where isVerified == true AND roles array-contains "farmer"
 *         → fail if serviceRegistrations.farmNation.status !== "approved"
 *
 *   and its header calls `isVerified` "the badge this was written to police …
 *   set by _approveFarmerAction when a farmer is approved". That was true of the
 *   one line it looked at, and false of the flag. Swept, `isVerified: true` is
 *   written by THIRTEEN paths across every module in the platform:
 *
 *       admin/_users.ts            the admin Verify/Unverify toggle
 *       admin/_legacy.ts           every legacy record imported
 *       admin/_exports.ts          export approval
 *       admin/_marketplace.ts      seller approval
 *       farm-nation/_fn_admin.ts   farmer approval — the one it assumed
 *       cooperative/…              four sites: membership, registration, admin
 *       wave/_wv_admin_…           two sites: WAVE application approval
 *       academy/_ac_admin_review   two sites: academy review
 *       payments/service.ts        TWO SITES IN PAYMENT FULFILMENT
 *
 *   So the flag means "some module, somewhere, approved this account — or they
 *   paid for something". A farmer who joined the cooperative, or bought an
 *   academy course, carries it. The check then reported them as VERIFICATION
 *   FRAUD for the entirely ordinary state of having a Farm Nation application
 *   still pending. Both of the owner's two findings are that.
 *
 *   #331 already repaired this check once — it used to query
 *   `farmNationProfile.isVerified`, a field no writer sets, so it could never
 *   fail. The repair moved it from a field that does not exist to a field that
 *   means something else. A check that cannot fail became a check that cannot
 *   be right, and both look like a working check from outside.
 *
 * ── HALF TWO: AND THE THING IT WAS LOOKING FOR IS REAL ──────────────────────
 *
 *   Chasing what the check SHOULD have asked found the defect underneath it.
 *
 *   _submitFarmNationOnboardingAction — the applicant's own form — writes, in
 *   one transaction:
 *
 *       roles: FieldValue.arrayUnion("farmer")
 *       "serviceRegistrations.farmNation.status": "pending"
 *
 *   and `farmer` is exactly the role ROLE_APP_ACCESS maps to `farm-nation`. So
 *   MODULE ACCESS IS GRANTED BY SUBMITTING THE FORM. _approveFarmerAction then
 *   sets the same role again and flips the status. The approval step adds no
 *   capability the applicant did not already have — it is a word on an admin's
 *   screen, which is the exact shape module-grant-roles.ts records for the
 *   cooperative suspend path: "an admin pressing Suspend achieved nothing
 *   except a different word on the admin's own screen."
 *
 *   AND UNDERNEATH THAT, THE LISTING DOORS HAD NO GATE AT ALL. THREE ways to
 *   create a land listing —
 *
 *       actions/land-listings.ts        _createLandListingAction
 *       actions/land-listings.ts        _submitLandListingAction  (the live one)
 *       api/farm-nation/create-listing  the route the wizard posts to
 *
 *   required a session and nothing else. Not an approval, not the farmer role,
 *   not any relationship to Farm Nation whatsoever. Any signed-in account on the
 *   platform — an academy student, a marketplace buyer — could create land
 *   listings. NONE of the three had it, so this is not #83's "the fix reached
 *   one of N doors": the gate was never written for any of them.
 *
 *   I then reproduced #83 while fixing it. The first attempt anchored on a
 *   `const { session } = sessionResult` and gated _createLandListingAction,
 *   leaving _submitLandListingAction — the one whose own comment says
 *   "/land/submit and farm-nation/list-land both call it" — wide open. The test
 *   below asserts per function, which is what caught it. Counting the doors
 *   before patching one is not a habit; it has to be an assertion.
 *
 *   WHAT IT COSTS TODAY IS BOUNDED, AND THAT IS NOT A REASON TO LEAVE IT.
 *   A listing is not publicly visible until an admin verifies it
 *   (verificationStatus), so this is not an open door to buyers' money. It is an
 *   open door to the queue an admin works, from accounts with no connection to
 *   the module.
 *
 * ── WHAT IS FIXED, AND WHAT IS DELIBERATELY NOT ─────────────────────────────
 *
 *   THE GATE IS `hasAppAccess(roles, "farm-nation")`, NOT APPROVAL. Requiring
 *   approval would be the stricter reading and it would stop the owner's live
 *   flow: every pending applicant would lose the ability to list, today, with no
 *   warning. The module's own access rule is what the navigation already assumes
 *   and what every other Farm Nation screen enforces, so applying it here breaks
 *   nobody who is already using the module and closes the door to everybody who
 *   is not. Raising it to approval is a separate decision with a migration
 *   behind it.
 *
 *   THE ROLE GRANT AT APPLICATION TIME IS RECORDED, NOT REMOVED. Taking `farmer`
 *   away until approval is the "correct" fix and it would lock every pending
 *   applicant out of the pending screen that tells them they are pending. That
 *   needs a separate capability for "may see this module's waiting room", which
 *   is a design change, not a repair.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     both action gates removed                      KILLED
 *     the API route's gate removed                   KILLED
 *     the check reading isVerified again             KILLED
 *     the check comparing users to users             KILLED
 *     the shield claiming an identity check          KILLED
 *     the route refusing with a success code         KILLED
 *     reword this header                             SURVIVED, as intended
 *
 *   THREE OF THOSE SURVIVED THE FIRST RUN, and each survivor was the same
 *   mistake: asserting that a NAME appears rather than that a RULE holds.
 *   `route.includes("hasAppAccess")` passed with the guard replaced by
 *   `if (false)`, because the name was still on the import line. A slice
 *   anchored on the old check name returned -1 after the rename and examined
 *   the wrong region. A tooltip assertion checked that a #486 comment existed
 *   rather than what the tooltip said. All three now pin the condition, and the
 *   mutants that exposed them are in the table above.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const code = (rel: string) => stripComments(readFileSync(rel, 'utf-8'), { label: rel });

const ACTION = 'src/app/actions/land-listings.ts';
const ROUTE = 'src/app/api/farm-nation/create-listing/route.ts';
const FORENSICS = 'src/app/actions/forensics.ts';

/** The body of one named function, up to the next top-level declaration. */
function functionBody(source: string, marker: string): string {
    const start = source.indexOf(marker);
    if (start === -1) return '';
    const next = source.indexOf('\nasync function ', start + marker.length);
    const alt = source.indexOf('\nexport async function ', start + marker.length);
    const ends = [next, alt].filter((n) => n > -1);
    return source.slice(start, ends.length ? Math.min(...ends) : source.length);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#486 — both doors to a land listing ask whether the caller is in this module', () => {
    it('EVERY SERVER ACTION THAT WRITES A LISTING REQUIRES FARM NATION ACCESS', () => {
        //   THE test. Each required a session and nothing else, so any
        //   signed-in account on the platform could create land listings.
        //
        //   IT NAMES BOTH ACTIONS BECAUSE THE FIRST ATTEMPT AT THIS FIX GATED
        //   THE WRONG ONE. I anchored on a `const { session } = sessionResult`
        //   that turned out to belong to _createLandListingAction and left
        //   _submitLandListingAction — the one whose own comment says
        //   "/land/submit and farm-nation/list-land both call it" — wide open.
        //   Asserting per-function is what caught it.
        for (const fn of ['_createLandListingAction', '_submitLandListingAction']) {
            const body = functionBody(code(ACTION), `async function ${fn}(`);

            expect({ fn, found: body.length > 0 }).toEqual({ fn, found: true });
            //   The CONDITION, not the imported name — see the note on the
            //   route assertion below, where a mutant proved the difference.
            expect({ fn, gated: /if\s*\(\s*!hasAppAccess\([\s\S]{0,80}?"farm-nation"\s*\)\s*\)/.test(body) })
                .toEqual({ fn, gated: true });
        }
    });

    it('AND SO DOES THE API ROUTE THE WIZARD ACTUALLY POSTS TO', () => {
        //   Three doors to the same table. Gating two is worth nothing: this is
        //   the one the create-listing wizard uses.
        //
        //   IT ASSERTS THE CONDITION, NOT THE NAME. The first version looked
        //   for the string `hasAppAccess` anywhere in the file, and a mutant
        //   that changed the guard to `if (false)` SURVIVED — the name was
        //   still there, on the import line. A source assertion that a
        //   capability is imported says nothing about whether it is used.
        const route = code(ROUTE);

        expect(route).toMatch(/if\s*\(\s*!hasAppAccess\([\s\S]{0,80}?"farm-nation"\s*\)\s*\)/);
        expect(route).toContain('status: 403');
    });

    it('AND THE REFUSAL COMES BEFORE ANYTHING IS WRITTEN', () => {
        //   A gate after the write is a log entry, not a gate.
        for (const [rel, marker] of [
            [ACTION, 'async function _createLandListingAction('],
            [ACTION, 'async function _submitLandListingAction('],
            [ROUTE, 'export async function POST'],
        ] as const) {
            const body = rel === ACTION ? functionBody(code(rel), marker) : code(rel);
            const gate = body.indexOf('hasAppAccess');
            const write = body.search(/\.(set|add|create)\(|addDoc|collection\([^)]*\)\.doc\(\)/);

            expect({ rel, marker, gated: gate > -1 }).toEqual({ rel, marker, gated: true });
            if (write > -1) {
                expect({ rel, marker, gateBeforeWrite: gate < write }).toEqual({ rel, marker, gateBeforeWrite: true });
            }
        }
    });

    it('and a pending applicant is NOT locked out — the deliberate limit of this fix', () => {
        //   `hasAppAccess(roles, "farm-nation")` is true for anyone holding
        //   farmer / land_owner / investor, which the application form grants.
        //   Requiring APPROVAL instead would stop every pending applicant today,
        //   which is how a fix becomes an outage.
        const mapping = code('src/lib/role-app-mapping.ts');

        expect(mapping).toMatch(/farmer:\s*\[[^\]]*"farm-nation"/);
        for (const rel of [ACTION, ROUTE]) {
            expect({ rel, requiresApproval: /farmNation\?\.status\s*===\s*["']approved["']/.test(code(rel)) })
                .toEqual({ rel, requiresApproval: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#486 — the forensic check compares two things that should agree', () => {
    it('IT NO LONGER READS isVerified, WHICH IS NOT A FARM NATION BADGE', () => {
        //   THE assertion the owner's two false findings are about. Thirteen
        //   paths across every module write that flag, including payment
        //   fulfilment.
        //   THE SLICE WAS ANCHORED ON THE OLD CHECK NAME, so after the rename
        //   indexOf returned -1 and this examined the wrong region entirely —
        //   a mutant restoring the isVerified query SURVIVED. Anchored on the
        //   query variable, which the check cannot lose.
        const check = code(FORENSICS);
        const start = check.indexOf('const farmerRoleQuery');
        const section = check.slice(start, start + 3000);

        expect(start).toBeGreaterThan(-1);
        expect(section).not.toContain('"isVerified"');
        expect(section).toContain('"roles", "array-contains", "farmer"');
    });

    it('IT COMPARES THE USER RECORD AGAINST THE AUTHORITATIVE APPLICATION', () => {
        //   _approveFarmerAction writes both in ONE transaction, so drift
        //   between them is a half-applied approval — a real anomaly, about data
        //   the platform itself writes, rather than a question about an
        //   unrelated flag.
        const check = code(FORENSICS);

        expect(check).toContain('FARM_NATION_APPLICATIONS');
        expect(check).toContain('serviceRegistrations?.farmNation?.status');
    });

    it('AND IT IS NOT COMPARING A RECORD TO ITSELF', () => {
        //   The failure mode of a rewritten check: both sides read from the
        //   same document, so it agrees with itself and can never fail. #331's
        //   defect, arriving through the repair.
        const check = code(FORENSICS);
        const start = check.indexOf('const farmerRoleQuery');
        const section = check.slice(start, check.indexOf('Approval Drift', start) + 500);

        expect(start).toBeGreaterThan(-1);
        //   Two distinct collections are read in the same loop.
        expect(section).toContain('COLLECTIONS.FARM_NATION_APPLICATIONS');
        expect(section).toContain('COLLECTIONS.USERS');
    });

    it('AND THE APPLICATION IT READS IS THE SCANNED USER\'S OWN', () => {
        //   The gap the behavioural suite cannot close: its firestore mock
        //   answers by COLLECTION NAME and ignores `where`, so a check that
        //   read every application and compared against the wrong one would
        //   pass there. An unfiltered read would compare each farmer to the
        //   whole queue and report almost nobody — a check that cannot fail,
        //   #331's defect arriving through its own repair for the third time.
        const check = code(FORENSICS);
        const start = check.indexOf('const appSnap = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)');
        const section = check.slice(start, start + 300);

        expect(start).toBeGreaterThan(-1);
        expect(section).toContain('.where("userId", "==", doc.id)');
    });

    it('and the population it scans is stated, so a pass cannot be read as more than it is', () => {
        const check = code(FORENSICS);
        const section = check.slice(check.indexOf('const farmerRoleQuery'));

        expect(section).toMatch(/Scanned \$\{/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#486 — the shared flag is named for what it is', () => {
    /**
     * `isVerified` is read in four places that show it to somebody: the admin
     * table's green shield, its Verify/Unverify control, the platform-wide
     * "verified users" count, and a filter. All four read it as an identity
     * verification. It is not one — and after #485 the platform performs no
     * automated identity verification at all.
     */
    it('THE ADMIN SHIELD SAYS WHAT THE FLAG MEANS', () => {
        //   The first version asserted that a #486 comment existed and that a
        //   title referenced the flag. A mutant that changed the tooltip to say
        //   "identity confirmed" SURVIVED both. What matters is the CLAIM the
        //   operator reads, so that is what this pins.
        const columns = readFileSync('src/app/admin/users/_columns.tsx', 'utf-8');
        const tooltip = columns.slice(columns.indexOf('<title>'), columns.indexOf('</title>'));

        expect(tooltip).toContain('not an identity check');
        expect(tooltip).toMatch(/Approved by a module/);
        expect(tooltip).not.toMatch(/identity confirmed/i);
    });

    it('AND THE PLATFORM METRIC DOES NOT CALL IT IDENTITY VERIFICATION', () => {
        //   global-aggregation counts users carrying this flag. Labelled
        //   "verified users" it reads as a KYC number, and payment fulfilment
        //   is one of the things that sets it.
        const agg = readFileSync('src/app/actions/global-aggregation.ts', 'utf-8');

        expect(agg).toMatch(/#486/);
    });
});
