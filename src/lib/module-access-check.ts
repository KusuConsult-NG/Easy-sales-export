/**
 * Module Access Check — Stale-JWT-Safe
 *
 * Problem: Every module layout checks `hasAppAccess(session.user.roles, module)`.
 * The JWT is minted at login and refreshed only every 1 hour. When an admin
 * approves a user's application (writing the role to Firestore), the user's JWT
 * is still stale and doesn't carry the new role — so `hasAppAccess` returns false
 * and the layout bounces them back to onboarding indefinitely.
 *
 * Solution: Two-layer check.
 *   Layer 1 (fast)  — JWT roles via hasAppAccess(). Covers 99% of requests.
 *   Layer 2 (authoritative) — Direct Firestore lookup of `serviceRegistrations`
 *                             when Layer 1 fails. If the Firestore record shows
 *                             "approved", we let the user in.
 *
 * The Firestore key mapping must match what onboarding actions write to
 * `serviceRegistrations`:  wave, academy, export, cooperatives, farmNation, marketplace.
 */

import { hasAppAccess, type AppIdentifier } from "@/lib/role-app-mapping";
import { isAcademyEntitled } from "@/lib/academy-entitlement";
import { invalidateServiceCache } from "@/lib/cache-invalidation";
import { memberStatusOf } from "@/lib/cooperative-membership-status";
import { isPaymentBypassAccount } from "@/lib/payment-bypass";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { UserRole } from "@/lib/types/roles";
import { logger } from "@/lib/logger";
import { FieldValue } from "@/lib/firestore-compat";
import { normalizeUserUpdate } from "@/lib/schema-normalizer";
import { registrationProgressScore, isDecidedAgainst } from "@/lib/registration-progress";
//   Academy's payment gate is for LEARNERS. See the carve-out in Layer 1.
import { isAdmin } from "@/lib/role-utils";
import { latestApplication, APPLICATION_SCAN_LIMIT } from "@/lib/latest-application";
import { claimableByEmail } from "@/lib/claimable-application";
import { ownedProfileIds, ownedProfileIdsFor, filterByOwner } from "@/lib/owned-profile-ids";
import { isLiveUserRow } from "@/lib/user-identity";
import { readUserDocOnce } from "@/lib/current-user-doc";
import { applicationsTypedTo, forgetApplicationReads } from "@/lib/application-request-reads";
import { mayClaimMembershipByEmail } from "@/lib/cooperative-membership-claim";


/** Maps the AppIdentifier to the Firestore serviceRegistrations key */
const APP_TO_REG_KEY: Partial<Record<AppIdentifier, string>> = {
    wave: "wave",
    academy: "academy",
    export: "export",
    cooperatives: "cooperatives",
    "farm-nation": "farmNation",
    marketplace: "marketplace",
};

/** Maps each AppIdentifier to the Firestore role(s) that grant access */
const APP_TO_ROLES: Partial<Record<AppIdentifier, string[]>> = {
    wave:         ["wave_participant"],
    academy:      ["academy_participant"],
    export:       ["export_participant"],
    cooperatives: ["cooperative_member"],
    "farm-nation": ["farmer", "land_owner", "investor"],
    //   #885 `marketplace_seller` was the one missing from this pair. The list
    //   carried `marketplace_buyer` beside `buyer` and then named `seller`
    //   alone — and Layer 2.5 below compares with a raw `.includes()`, so no
    //   canonicalisation could cover for it. Half a pair, hand-written.
    marketplace:  ["buyer", "seller", "marketplace_buyer", "marketplace_seller"],
};

/**
 * Returns true if the user has access to the given app.
 *
 * Layer 1 (fast)    — JWT role check via hasAppAccess(). Covers 99% of requests.
 * Layer 2 (Firestore) — serviceRegistrations[module].status === "approved"|"active".
 *                       Handles stale JWT after normal onboarding approval.
 * Layer 2.5 (Firestore roles) — Direct roles[] array lookup on the user document.
 *                       Handles manually-added users where serviceRegistrations
 *                       was never written (e.g. admin used "Update Roles" only).
 */
export async function checkModuleAccess(
    userId: string,
    jwtRoles: UserRole[],
    app: AppIdentifier
): Promise<boolean> {
    // ── Layer 1: JWT check (fast, no DB) ─────────────────────────────────────
    if (hasAppAccess(jwtRoles, app)) {
        /*
         *   AND ACADEMY CANNOT USE THIS FAST PATH, which is the whole reason
         *   the payment gate below is worth anything.
         *
         *   Layer 1 answers from the JWT alone and never reads the database.
         *   The role it reads for Academy is `academy_participant` — the exact
         *   role Layer 2.7's heal granted to anybody with an approved
         *   application and no payment. Once that role is on the user document
         *   it is minted into every subsequent JWT, so an unpaid learner would
         *   be waved through here for ever and none of the gates below would
         *   ever run. Stripping the role instead would not converge either: the
         *   JWT is minted FROM those roles, so the role has to stop being
         *   sufficient, not merely be deleted once.
         *
         *   THE COST, STATED. Academy loses the no-database path: one cached
         *   user-document read per request (session-guard already caches the
         *   profile for 300s), on one module of six, and only for callers the
         *   fast path would otherwise have admitted. Every other module keeps
         *   Layer 1 exactly as it was — the WAVE control in
         *   an-approved-academy-place-nobody-paid-for.test.ts pins that.
         */
        /*
         *   AN ADMIN IS NOT A LEARNER, and this carve-out is not a convenience.
         *
         *   Found by the suite rather than by me: `and an admin role reaches
         *   every module` went red. ROLE_APP_ACCESS grants academy to `admin`,
         *   `super_admin` AND `academy_admin`, and none of them has a
         *   registration or a programme fee — so falling through would have put
         *   the people who REVIEW Academy applications behind the payment gate
         *   for the applications they review.
         *
         *   role-utils.isAdmin covers all seven admin roles, so a future
         *   module admin is carved out with them rather than discovered
         *   locked out.
         */
        if (app !== "academy" || isAdmin(jwtRoles)) {
            return true;
        }
    }

    // ── Layer 2: Firestore fallback (handles stale JWT after normal approval) ──
    const regKey = APP_TO_REG_KEY[app];

    try {
        const db = getAdminDb();

        /**
         *   THE MEMBER'S OWN PROFILE ROWS, RESOLVED ONCE.
         *
         *   Every collection lookup below asked `where("userId","==",userId)`
         *   with the id of the row the caller signed in as. A member whose
         *   profile was superseded — the `_migratedTo` population the userId
         *   sweep exists for — has their application filed under the OLD id,
         *   so the query returned nothing and this function answered "no
         *   access".
         *
         *   THAT IS WORSE HERE THAN ON A LISTING. A listing that misses shows
         *   an empty table; this is the gate. It tells a member who paid and
         *   was approved that they have not applied, on every one of the six
         *   modules below.
         *
         *   LAZY, AND AT MOST ONCE. Layer 1 returns above this line for the
         *   99% of requests its own comment describes, so the fast path pays
         *   nothing. Past it, the resolution is two indexed queries per
         *   supersession level and is shared by every layer that follows.
         */
        /*
         *   AND THROUGH THE REQUEST MEMO, WHICH IS WHAT IT WAS BUILT FOR.
         *
         *   lib/current-user-doc's own header names this read as one of the
         *   four copies of the same row it counted on a single WAVE page draw
         *   — "the layout's checkModuleAccess (twice: once directly, once
         *   inside the identity walk it need not have taken), the module's
         *   status action, and the sidebar's live-roles read". The walk was
         *   dealt with below; this is the direct one, and it was still a bare
         *   `.doc(id).get()` on the gate that every module layout runs on
         *   every page of every module.
         *
         *   Measured with #261's read meter, /farm-nation/onboarding:
         *   EIGHT reads, of which two were this row. Seven now.
         *
         *   SAFE ACROSS THE HEALS BELOW. All six of them call
         *   `invalidateServiceCache` straight after writing, and that drops
         *   the memo (`forgetUserDoc`) before it touches Redis — so a reader
         *   later in the same request cannot be served the copy taken before
         *   the grant. That is #692's rule, and it is why the memo could be
         *   introduced here at all.
         *
         *   SAME HANDLE, NOT A WIDER ONE. `getAdminDb()` in this file returns
         *   `supabaseDb`, which is exactly what current-user-doc reads
         *   through. Nothing about what this gate may see changes.
         */
        const userDoc = await readUserDocOnce(userId);

        if (!userDoc.exists) return false;

        const userData = userDoc.data!;

        /*
         *   AND THE FORWARD HALF OF THAT RESOLUTION IS THE ROW ABOVE.
         *
         *   THE OWNER, a fourth time: "the app is still not fast, still taking
         *   so long to load the pages." Measured with #261's read meter rather
         *   than read off the source, one WAVE page draw costs ELEVEN
         *   sequential round trips through its gates before the page fetches
         *   anything of its own — and this was one of them.
         *
         *   `ownedProfileIdsFor` is `liveProfileId` composed with
         *   `ownedProfileIds`: the FORWARD walk, then the backward search. Its
         *   own header says so — "ONE EXTRA KEYED READ over ownedProfileIds,
         *   and only that: a live id resolves to itself on the first hop."
         *
         *   That first hop reads `users/<userId>`. Which is the document
         *   sitting in `userData`, read on the line above, on the gate that
         *   every module layout runs on every page of every module.
         *
         *   SO IT IS ANSWERED FROM THE ROW WE HOLD, not asked again — and the
         *   rule is imported rather than rewritten here, because `pointerOf`
         *   honours `_migratedTo` AND `supabaseAuthId` and #804's header is
         *   explicit about what copying that test out does.
         *
         *   THE OTHER BRANCH IS KEPT, AND IT IS NOT DEAD. Every caller today
         *   passes `session.user.id`, which #490 makes live at sign-in — but a
         *   session minted BEFORE an admin settles a duplicate carries an id
         *   that has since been superseded. Narrowing a GATE on the strength of
         *   "no caller does that" is how a member who paid gets told they have
         *   not applied. The walk still runs for exactly that row, and only for
         *   it.
         *
         *   STILL LAZY, AND STILL AT MOST ONCE. Layer 1 returns above this for
         *   the 99% its comment describes, and the branches below that never
         *   need the ids still pay nothing.
         */
        let ownedIdsCache: string[] | null = null;
        const ownedIds = async (): Promise<string[]> => {
            if (ownedIdsCache === null) {
                ownedIdsCache = isLiveUserRow(userId, userData)
                    ? await ownedProfileIds(userId)
                    : await ownedProfileIdsFor(userId);
            }
            return ownedIdsCache;
        };

        // Payment bypass — see src/lib/payment-bypass.ts for who and why.
        if (isPaymentBypassAccount(userData.email)) {
            if (app === "cooperatives" || app === "academy") {
                logger.info(`[ModuleAccess] payment bypass applied on '${app}'`);
                return true;
            }
        }

        /*
         *   ── ACADEMY WAS OPEN TO ANYBODY AN ADMIN HAD APPROVED ───────────────
         *
         *   THE OWNER: "Academy is gated but it is granting permission to users
         *   even before they make the payment, why?"
         *
         *   Layer 2.7 read the application and granted on `status === "active"
         *   || status === "approved"` with no payment check anywhere — and then
         *   PERSISTED the grant, writing `academy_participant` and
         *   `serviceRegistrations.academy.status: "approved"` onto the user
         *   document. That is why gating Layer 2.7 alone would have fixed
         *   almost nothing: the two fields it writes are exactly what Layer 2
         *   and Layer 2.5 above grant on, so everybody the defect had already
         *   enrolled would keep the module for ever and never reach 2.7 again.
         *
         *   All three grant points ask this now.
         *
         * ── THE CARVE-OUT, AND WHY IT IS SAFE ───────────────────────────────
         *
         *   Layer 2.6 did this for cooperatives after MEASURING production: 77
         *   active-and-unpaid members, 74 of them legacy, and its comment is
         *   the warning — "a payment requirement without that carve-out would
         *   lock the entire pre-platform membership out of their own savings to
         *   catch two people."
         *
         *   I HAVE NO PRODUCTION ACCESS AND SO NO EQUIVALENT COUNT. What makes
         *   this safe without one is that every door which can settle an Academy
         *   payment already writes a marker this reads:
         *
         *       admin/_legacy.ts          paymentStatus: "completed" AND
         *                                 _isLegacy: true, on the user
         *                                 registration and the application
         *       payments/service.ts       paymentStatus: "completed" on both,
         *                                 plus a processed_payments row
         *       academy/_ac_admin_review  paymentStatus on both — and it accepts
         *                                 "paid" as well as "completed", which
         *                                 is why both spellings count here
         *
         *   So a legacy learner is admitted twice over, and the only records
         *   with none of these are the ones the defect minted. The
         *   processed_payments query is the backstop for a stale field beside a
         *   real payment, and it runs ONLY when every free check has already
         *   failed.
         *
         *   ENROLMENT COUNTS AS WELL AS REGISTRATION. payment-router is explicit
         *   that `academy_enrollment` is "the purchase of a single course" and
         *   not a spelling of `academy_registration`. Both are money paid to
         *   Academy, and this decides only whether the MODULE opens — which plan
         *   a course belongs to is checkCourseAccess's question, not this one.
         *   Refusing the module to somebody who has bought a course in it would
         *   be a worse defect than the one being closed.
         */
        //   A GRANT OPENS THE MODULE TOO. The two admin doors used to write
        //   `paymentStatus: "completed"` for a place nobody paid for, so this
        //   gate admitted them without knowing it was doing so. They write
        //   "waived" now — a deliberate decision, still entitling — and the
        //   vocabulary lives in lib/academy-entitlement so this gate and the
        //   four other readers of the field cannot drift apart again.
        //
        //   isAcademyEntitled, not isAcademyPaid: refusing a learner an admin
        //   deliberately let in would be a worse defect than the one being
        //   closed, which is the same reasoning as the enrolment note above.
        const isAcademyPaid = (value: unknown): boolean => isAcademyEntitled(value);

        let academyEntitlementCache: boolean | null = null;

        /**
         * Has this person's Academy place been paid for, or is it legacy?
         *
         *   Memoised, and ordered cheapest-first: two field reads and a legacy
         *   marker settle it for everybody on the ordinary path, and the query
         *   runs only for a record that looks unpaid — which, after this lands,
         *   is meant to be nobody.
         */
        const academyPaidOnRecord = async (registration?: any): Promise<boolean> => {
            if (isAcademyPaid(registration?.paymentStatus)) return true;

            if (academyEntitlementCache !== null) return academyEntitlementCache;

            const academyReg = (userData.serviceRegistrations || {}).academy;
            const isLegacyLearner =
                !!userData.legacyOnboardedBy
                || userData.isLegacy === true
                || academyReg?._isLegacy === true;

            let settled = isAcademyPaid(academyReg?.paymentStatus) || isLegacyLearner;

            if (!settled) {
                try {
                    const paid = await filterByOwner(
                        db.collection(COLLECTIONS.PROCESSED_PAYMENTS), "userId", await ownedIds())
                        .where("type", "in", ["academy_registration", "academy_enrollment"])
                        .where("status", "==", "completed")
                        .limit(APPLICATION_SCAN_LIMIT)
                        .get();
                    settled = !paid.empty;
                } catch (lookupErr) {
                    //   #492's rule, and Layer 2.6 applies it for the same
                    //   reason: a FAILED READ IS NOT A REFUSAL. If the payments
                    //   collection is unreachable this must not revoke a paid
                    //   learner's course mid-lesson. The existing approval
                    //   stands and the failure is loud.
                    logger.error(
                        `[ModuleAccess] Academy — processed_payments lookup failed for ${userId}; `
                        + `honouring the existing approval rather than revoking access.`,
                        lookupErr,
                    );
                    settled = true;
                }
            }

            academyEntitlementCache = settled;
            return settled;
        };

        /**
         *   #763 The status Layer 2 resolved, kept for Layer 2.5 below.
         *
         *   Layer 2 reads the registration to ask "does it say approved". The
         *   opposite question — "does it say a person decided AGAINST this" —
         *   has to be asked one layer further down, where the roles array is,
         *   and the answer is the same object. Undefined when the module has no
         *   registration key or the member has no registration, which is the
         *   ordinary case and must stay permissive.
         */
        let resolvedStatus: string | undefined;

        // Layer 2 — serviceRegistrations check
        if (regKey) {
            const serviceRegistrations = userData.serviceRegistrations || {};
            let registration = serviceRegistrations[regKey];
            
            // Legacy fallbacks for keys that changed over time - use advanced progression resolution logic
            if (regKey === "cooperatives") {
                const coopReg = serviceRegistrations["cooperatives"];
                const legacyReg = serviceRegistrations["cooperative"];


                if (coopReg && legacyReg) {
                    const scorePlural = registrationProgressScore(coopReg.status || '');
                    const scoreSingular = registrationProgressScore(legacyReg.status || '');
                    registration = scoreSingular > scorePlural ? legacyReg : coopReg;
                } else {
                    registration = coopReg || legacyReg;
                }
            }

            if (regKey === "farmNation") {
                const fnReg = serviceRegistrations["farmNation"];
                const legacyFnReg = serviceRegistrations["farm_nation"];


                if (fnReg && legacyFnReg) {
                    const scorePlural = registrationProgressScore(fnReg.status || '');
                    const scoreSingular = registrationProgressScore(legacyFnReg.status || '');
                    registration = scoreSingular > scorePlural ? legacyFnReg : fnReg;
                } else {
                    registration = fnReg || legacyFnReg;
                }
            }

            // Core statuses that always grant access across all modules
            const VALID_STATUSES = ["approved", "active"];
            // Extended statuses that are module-specific valid access states:
            //   "verified"  — Farm Nation: admin approved the land listing/application
            //   "paid"      — Cooperatives: payment confirmed, membership activated
            const EXTENDED_VALID_STATUSES: Partial<Record<string, string[]>> = {
                "farmNation": ["verified"],
            };

            const extendedStatuses = EXTENDED_VALID_STATUSES[regKey] || [];
            const allValidStatuses = [...VALID_STATUSES, ...extendedStatuses];

            resolvedStatus = registration?.status;

            if (allValidStatuses.includes(registration?.status)) {
                //   The status says approved; the payment is a separate
                //   question, and for Academy it was never asked. See the rule
                //   above — this is the grant the defect's own heal fed.
                if (app === "academy" && !(await academyPaidOnRecord(registration))) {
                    logger.warn(
                        `[ModuleAccess] Layer 2 — '${app}' registration is '${registration.status}' `
                        + `but no settled payment and no legacy marker was found (uid: ${userId}). No access.`
                    );
                    return false;
                }

                logger.info(
                    `[ModuleAccess] Layer 2 — serviceRegistrations confirmed '${app}' access (uid: ${userId}, status: ${registration.status}).`
                );
                return true;
            }
        }

        // ── Layer 2.5: Direct Firestore roles[] check ───────────────────────────
        // Handles users who were manually assigned a role via the admin "Update Roles"
        // panel BEFORE the serviceRegistrations backfill was added. Their Firestore
        // roles array is correct but serviceRegistrations was never written.
        const requiredRoles = APP_TO_ROLES[app];
        if (requiredRoles) {
            const firestoreRoles: string[] = userData.roles || [];
            const hasRole = requiredRoles.some(r => firestoreRoles.includes(r));

            /**
             *   #763 A LEFTOVER ROLE OVERRODE A RECORDED DECISION.
             *
             *   registration-progress.ts states the rule this layer was missing,
             *   in the header above isDecidedAgainst: "A decision is a decision.
             *   Nothing derived may overwrite one." It was applied at the login
             *   self-heal (#207) and at Layer 2.6 below, for cooperatives, and
             *   not here — where every module passes.
             *
             *   What that cost, measured against the real rejection paths with
             *   the JWT empty so the database decides:
             *
             *       Farm Nation, role=buyer   rejected, still holds investor   IN
             *       Farm Nation, role=both    rejected, still holds investor   IN
             *       Export, approved then rejected, still holds the role       IN
             *
             *   Both of those grants are fixed at their source in this same
             *   finding. This is the half that makes the class unreachable
             *   rather than the two instances of it: any future path that writes
             *   `rejected`, `suspended` or `revoked` and forgets the role is now
             *   closed by default, and `farm-nation`'s `land_owner` — a role no
             *   module flow grants and no rejection should strip — stops being a
             *   way back into a module somebody was refused.
             *
             *   PERMISSIVE WHERE IT SHOULD BE. isDecidedAgainst('') is false, so
             *   a member with no registration at all — the manually-role-assigned
             *   case this layer exists for — is unaffected. Every writer of a
             *   decided-against status in this repository is an explicit admin
             *   rejection, suspension or revocation; there is no benign one.
             */
            if (hasRole && isDecidedAgainst(resolvedStatus)) {
                logger.warn(
                    `[ModuleAccess] Layer 2.5 — '${app}' registration is '${resolvedStatus}' `
                    + `(uid: ${userId}); the roles array still carries a grant for it, and a `
                    + `decision is not overridden by a leftover role. No access.`
                );
                return false;
            }

            if (hasRole) {
                //   `academy_participant` is the OTHER field the defect's heal
                //   wrote, so a role alone must not re-open the module either.
                if (app === "academy" && !(await academyPaidOnRecord())) {
                    logger.warn(
                        `[ModuleAccess] Layer 2.5 — '${app}' role is held (uid: ${userId}) but no `
                        + `settled payment and no legacy marker was found. No access.`
                    );
                    return false;
                }

                logger.info(
                    `[ModuleAccess] Layer 2.5 — Firestore roles[] confirmed '${app}' access (uid: ${userId}, roles: ${firestoreRoles.join(", ")}).`
                );
                return true;
            }
        }

        // ── Layer 2.6: Direct Collection query/lookup fallback ──────────────────
        // Handles legacy/bulk-imported cooperative members whose user documents
        // were never updated/backfilled, and whose roles/serviceRegistrations are empty.
        if (app === "cooperatives") {
            const memberQuery = await filterByOwner(
                db.collection(COLLECTIONS.COOPERATIVE_MEMBERS), "userId", await ownedIds())
                .limit(APPLICATION_SCAN_LIMIT)
                .get();

            let memberDocData: any = null;
            let memberRef: any = null;
            //   Whether the row above was located by the caller's EMAIL alone.
            //   See the gate on the writes further down for why that matters
            //   and why the READ is deliberately not gated on it.
            let matchedByEmailOnly = false;

            if (!memberQuery.empty) {
                const latestMember = latestApplication(memberQuery.docs);
                memberDocData = latestMember?.data();
                memberRef = latestMember?.ref;
            } else {
                const memberDoc = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();
                if (memberDoc.exists) {
                    memberDocData = memberDoc.data();
                    memberRef = memberDoc.ref;
                } else if (userData.email) {
                    /*
                     *   THE SEVENTH DOOR WITH THE EMAIL FALLBACK, AND THE ONE
                     *   THAT DECIDES ACCESS TO THE MODULE ITSELF.
                     *
                     *   lib/cooperative-membership-claim.ts names five readers
                     *   that match a membership on the caller's email and then
                     *   treat it as theirs; the onboarding page was a sixth.
                     *   All six are under src/app. This is the seventh, and it
                     *   is not a screen — it is Layer 2.6 of the access check,
                     *   so what an email match buys here is the cooperative
                     *   MODULE: savings, contributions, loans and withdrawals.
                     *
                     *   And it does not merely read. The heal below writes
                     *   `membershipStatus: "active"` back onto whichever row
                     *   this found and grants the cooperative role with it.
                     *
                     *   "A MATCHING EMAIL IS NOT PROOF OF OWNERSHIP. The
                     *   caller's address comes from their own profile, and
                     *   profile.ts lets them change it." An orphaned
                     *   membership sits at an address no account holds, which
                     *   is precisely what makes it reachable.
                     *
                     *   Same gate as the other six: either the row is already
                     *   this person's, or a completed registration payment
                     *   ties it to their money.
                     */
                    const emailQuery = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                        .where("email", "==", userData.email.toLowerCase())
                        .limit(APPLICATION_SCAN_LIMIT)
                        .get();
                    if (!emailQuery.empty) {
                        const latestByEmail = latestApplication(emailQuery.docs);
                        memberDocData = latestByEmail?.data();
                        memberRef = latestByEmail?.ref;
                        //   A READ, NOT PROOF. Flagged so the WRITES below ask
                        //   the claim gate; the access decision itself does
                        //   not, because this fallback is what legacy
                        //   spreadsheet imports are found by.
                        matchedByEmailOnly = true;
                    }
                }
            }

            if (memberDocData) {
                const status = memberStatusOf(memberDocData);
                const isApprovedOrActive = status === "active" || status === "approved";

                // A SUSPENSION WAS UNDONE BY THE NEXT PAGE LOAD.
                //
                // isHealable asked "did they pay and finish onboarding?" and
                // never "was a decision made against them?". A suspended member
                // satisfies it exactly: they paid to join and their onboarding
                // is complete, and `suspended` is not "active" or "approved" —
                // so the heal below fired, wrote `membershipStatus: "active"`
                // back onto the member document, wrote
                // `serviceRegistrations.cooperatives.status: "active"` and
                // `arrayUnion("cooperative_member")` onto the user document, and
                // returned true.
                //
                // _coop_admin_members.ts was taught to revoke the role on
                // suspension precisely so a suspended member loses the module.
                // This layer handed it back on the very next cooperative page
                // load, in the database — savings, loans, contributions and
                // withdrawals with it.
                //
                // registration-progress.ts states "the cooperative was safe only
                // because its suspend path revokes the role too". That was
                // wrong, and this is why: revoking a role means nothing while a
                // repair rule re-grants it without reading the decision. Fourth
                // instance of the same shape — #207 (login self-heal), #225
                // (course enrolment), #227 (the application picked here).
                const decidedAgainst = isDecidedAgainst(status);

                const isHealable = !isApprovedOrActive
                    && !decidedAgainst
                    && memberDocData.onboardingCompleted === true
                    && memberDocData.paymentStatus === "completed";

                if (decidedAgainst) {
                    logger.info(
                        `[ModuleAccess] Layer 2.6 — cooperative membership decided against `
                        + `(uid: ${userId}, status: ${status}). No access, and no heal.`
                    );
                    return false;
                }

                /**
                 *   #497 THE PAYMENT CONDITION WAS ENFORCED ON THE WAY IN AND
                 *        NEVER AFTERWARDS.
                 *
                 *   `isHealable` directly above demands `paymentStatus ===
                 *   "completed"` before PROMOTING anyone to active — so the
                 *   author of this layer plainly held that paying matters for
                 *   cooperative access.
                 *
                 *   `isApprovedOrActive` then granted that same access to anyone
                 *   already carrying `membershipStatus: "active"`, without ever
                 *   asking. And "already carrying" is not rare: #496 found
                 *   _coop_identity's heal writing exactly that field from central
                 *   status alone, and _legacy.ts:657, _coop_membership.ts:307 and
                 *   _dashboard.ts:252 each write it by their own routes. A rule
                 *   checked at one entrance and at none of the other four is not
                 *   a rule — #486's class, and this is its fifth appearance.
                 *
                 *   WHAT THAT OPENED. Not the ID card — #496 closed that. This
                 *   layer is the cooperative MODULE: savings, contributions,
                 *   loans and withdrawals. An unpaid member reached all of it.
                 *
                 * ── MEASURED BEFORE THE GATE MOVED ─────────────────────────
                 *
                 *   active with payment not completed                 77
                 *     ...legacy, exempt by design                      74
                 *     ...non-legacy                                     3
                 *       ...with a real payment in processed_payments     1
                 *       ...with no payment anywhere                      2
                 *
                 *   THE LEGACY EXEMPTION IS THE WHOLE REASON THIS IS SAFE.
                 *   Seventy-four of the seventy-seven joined before this platform
                 *   charged anything; a payment requirement without that carve-out
                 *   would lock the entire pre-platform membership out of their own
                 *   savings to catch two people. _coop_identity.ts already carries
                 *   the same exemption and this mirrors it rather than inventing a
                 *   second spelling of it.
                 *
                 *   AND THE AUTHORITATIVE FALLBACK IS CONSULTED, as it is there:
                 *   a stale `paymentStatus` beside a real processed payment must
                 *   not cost somebody their module. The extra query runs ONLY for
                 *   a member who is active, unpaid and not legacy — three people
                 *   on the whole platform — so it costs nothing on the ordinary
                 *   path.
                 */
                const isLegacyMember =
                    memberDocData.isLegacy === true || !!userData.legacyOnboardedBy;
                let paymentSettled = memberDocData.paymentStatus === "completed";

                if (isApprovedOrActive && !paymentSettled && !isLegacyMember) {
                    try {
                        //   APPLICATION_SCAN_LIMIT, not `.limit(1)`. #227 banned
                        //   the latter across this file after finding it at
                        //   sixteen sites "each trusting whatever came back",
                        //   and the ban is worth more kept blanket than carved
                        //   up per query. This one only asks whether ANY
                        //   completed registration payment exists, so reading a
                        //   bounded handful and testing `.empty` is the same
                        //   answer for the same cost.
                        const authPayment = await filterByOwner(
                            db.collection(COLLECTIONS.PROCESSED_PAYMENTS), "userId", await ownedIds())
                            .where("type", "==", "cooperative_membership_registration")
                            .where("status", "==", "completed")
                            .limit(APPLICATION_SCAN_LIMIT)
                            .get();
                        paymentSettled = !authPayment.empty;
                    } catch (lookupErr) {
                        //   A FAILED READ IS NOT A REFUSAL — #492's rule, and it
                        //   matters more here than on a screen. If the payments
                        //   collection is unreachable this must not silently
                        //   revoke a paid-up member's savings; the pre-existing
                        //   approval stands and the failure is loud.
                        logger.error(
                            `[ModuleAccess] Layer 2.6 — processed_payments lookup failed for ${userId}; `
                            + `honouring the existing approval rather than revoking access.`,
                            lookupErr,
                        );
                        paymentSettled = true;
                    }
                }

                const mayEnter = (isApprovedOrActive && (paymentSettled || isLegacyMember)) || isHealable;

                if (isApprovedOrActive && !mayEnter) {
                    logger.warn(
                        `[ModuleAccess] Layer 2.6 — '${app}' membership is ${status} but the `
                        + `registration fee is unpaid and the member is not legacy `
                        + `(uid: ${userId}). No access.`
                    );
                }

                if (mayEnter) {
                    logger.info(
                        `[ModuleAccess] Layer 2.6 — Direct query confirmed '${app}' access (uid: ${userId}, status: ${status}, isHealable: ${isHealable}).`
                    );
                    
                    /*
                     *   MAY THIS CALLER BE WRITTEN ONTO THIS ROW?
                     *
                     *   Trivially yes when the row was found by document id or
                     *   by its `userId` field — those ARE ownership. Only an
                     *   email match needs the claim gate, which demands a
                     *   completed registration payment tying the row to the
                     *   caller's money rather than to a string they can edit.
                     *
                     *   Access above is already decided; this only decides
                     *   whether anything is written back. A legacy imported
                     *   member keeps their module and simply takes the slow
                     *   path on each load, which is the cost the heal existed
                     *   to save and a fair price for not binding a stranger's
                     *   savings to whoever shares an address with them.
                     */
                    const mayWriteToRow = !matchedByEmailOnly || await mayClaimMembershipByEmail(
                        db, { data: memberDocData, id: memberRef?.id ?? "" }, userId,
                    );
                    if (!mayWriteToRow) {
                        logger.warn(
                            `[ModuleAccess] Layer 2.6 — membership matched on email only and is `
                            + `not claimable (uid: ${userId}). Access granted, NOTHING written.`,
                        );
                    }

                    if (isHealable && memberRef && mayWriteToRow) {
                        try {
                            // Update membership status to active
                            await memberRef.update({
                                membershipStatus: "active",
                                updatedAt: FieldValue.serverTimestamp()
                            });
                            
                            // Update user status and roles
                            await db.collection(COLLECTIONS.USERS).doc(userId).update(
                                normalizeUserUpdate({
                                    "serviceRegistrations.cooperatives.status": "active",
                                    "serviceRegistrations.cooperatives.activatedAt": FieldValue.serverTimestamp(),
                                    roles: FieldValue.arrayUnion("cooperative_member"),
                                    isVerified: true,
                                    updatedAt: FieldValue.serverTimestamp()
                                })
                            );
                            //   #692 As the five below — this heal grants
                            //   cooperative_member and must clear the cached
                            //   profile session-guard serves for 300 seconds.
                            await invalidateServiceCache(userId, app);
                            logger.info(`[ModuleAccess] Healed membership status to 'active' for user ${userId}`);
                        } catch (healErr) {
                            logger.error(`[ModuleAccess] Failed to heal membership status for user ${userId}`, healErr);
                        }
                    } else if (!memberDocData.userId && memberRef && mayWriteToRow) {
                        //   THE BINDING. `userId` on this row makes it the
                        //   caller's for every later reader, savings and
                        //   documents included — so it needs the claim gate
                        //   above, which a row found by id or userId field
                        //   passes trivially.
                        await memberRef.update({ userId });
                        logger.info(`[ModuleAccess] Healed membership ${memberRef.id} with userId ${userId}`);
                    }
                    return true;
                }
            }
        }

        // ── Layer 2.7: Direct Collection query/lookup fallback for Academy ──────
        // Handles manually approved/assigned academy learners whose user documents
        // were never updated/backfilled, and whose roles/serviceRegistrations are empty.
        if (app === "academy") {
            const appQuery = await filterByOwner(
                db.collection(COLLECTIONS.ACADEMY_APPLICATIONS), "userId", await ownedIds())
                .limit(APPLICATION_SCAN_LIMIT)
                .get();

            let appDocData: any = null;
            let appRef: any = null;

            if (!appQuery.empty) {
                const latestApp = latestApplication(appQuery.docs);
                appDocData = latestApp?.data();
                appRef = latestApp?.ref;
            } else if (userData.email) {
                /*
                 *   HALF THE RULE HERE, AND THE HALF THAT IS MISSING IS MISSING
                 *   FROM THE DATA, NOT FROM THE CHECK.
                 *
                 *   The other three application layers drop their typed-address
                 *   query and keep `userEmail`, which is written from
                 *   `session.user.email` at submission. AN ACADEMY APPLICATION
                 *   HAS NO SUCH FIELD — nothing under src/app/actions/academy
                 *   writes `userEmail` at all — so `personalInfo.email`, typed
                 *   on the form, is the only address on the row. Deleting this
                 *   query would not narrow the rule; it would delete the
                 *   email route outright and lock out every learner whose
                 *   application predates their account.
                 *
                 *   SO DEFECT 2 IS CLOSED AND DEFECT 1 CANNOT BE, and closing
                 *   defect 2 is what shuts the exploit anyway: every
                 *   application submitted through this platform is written by a
                 *   signed-in user and therefore carries a `userId`, so a typed
                 *   address on a REAL application can no longer be read by the
                 *   person whose address was typed. What remains reachable is a
                 *   row nobody owns — an import — which no applicant wrote.
                 *
                 *   Layer 2.7 also requires the programme fee on top of this
                 *   (#258), so a match alone has never been enough here.
                 */
                //   SHARED WITH THE TWO ACADEMY ACTIONS. Identical query,
                //   identical bound, and on /academy/application all three ran
                //   it in the same request — see lib/application-request-reads.
                const emailQuery = await applicationsTypedTo(COLLECTIONS.ACADEMY_APPLICATIONS, "personalInfo.email", userData.email);

                const { claimable, ownedByOthers } = claimableByEmail(emailQuery.docs);

                if (claimable) {
                    appDocData = claimable.data();
                    appRef = (claimable as any).ref;
                } else if (ownedByOthers > 0) {
                    logger.warn(
                        `[ModuleAccess] Layer 2.7 — ${ownedByOthers} Academy application(s) match `
                        + `${userData.email} but every one already belongs to another account; `
                        + `none claimed (uid: ${userId}).`
                    );
                }
            }

            if (appDocData) {
                const status = appDocData.status;
                if (status === "active" || status === "approved") {
                    /*
                     *   THE ORIGINAL SITE OF THE DEFECT. An approved application
                     *   was treated as sufficient, and the heal below then made
                     *   that permanent. The application's OWN payment fields are
                     *   free evidence here and are read first; everything else
                     *   falls back to the shared rule above.
                     */
                    const entitled =
                        isAcademyPaid(appDocData.paymentStatus)
                        || appDocData._isLegacy === true
                        || appDocData.isLegacy === true
                        || await academyPaidOnRecord();

                    if (!entitled) {
                        logger.warn(
                            `[ModuleAccess] Layer 2.7 — '${app}' application is '${status}' (uid: ${userId}) `
                            + `but the programme fee is unpaid and the learner is not legacy. `
                            + `No access, and no heal.`
                        );
                        return false;
                    }

                    logger.info(
                        `[ModuleAccess] Layer 2.7 — Direct application query confirmed '${app}' access (uid: ${userId}, status: ${status}).`
                    );
                    
                    // Heal the application document with the userId if missing
                    const updates: any = {};
                    if (!appDocData.userId) {
                        updates.userId = userId;
                    }
                    if (Object.keys(updates).length > 0 && appRef) {
                        const { FieldValue } = await import("./firestore-compat");
                        await appRef.update(updates);
                        //   A claim changes what the owner-scoped query would
                        //   answer, so no later reader in this request may be
                        //   served the set taken before it.
                        forgetApplicationReads();
                        logger.info(`[ModuleAccess] Healed application ${appRef.id} with updates: ${JSON.stringify(updates)}`);
                    }

                    // Proactively backfill the USERS doc so the primary Layer 2 check works in the future
                    const { FieldValue } = await import("./firestore-compat");
                    await db.collection(COLLECTIONS.USERS).doc(userId).set({
                        roles: FieldValue.arrayUnion("academy_participant"),
                        serviceRegistrations: {
                            academy: {
                                status: "approved",
                                applicationId: appRef.id,
                                approvedAt: appDocData.approvedAt || FieldValue.serverTimestamp(),
                            }
                        },
                        updatedAt: FieldValue.serverTimestamp()
                    }, { merge: true });

                    /*
                     *   #692 THE HEAL CLEARS THE PROFILE IT JUST CORRECTED.
                     *
                     *   session-guard reads roles and serviceRegistrations from
                     *   CacheKeys.userProfile, TTL 300 seconds. These layers
                     *   exist to repair a member whose record says they have no
                     *   access when they do — and the repair was then invisible
                     *   to the very reader it was written for, for five minutes.
                     *
                     *   Inside the heal branch, which is rare, rather than on
                     *   this function's hot path.
                     */
                    await invalidateServiceCache(userId, app);

                    return true;
                }
            }
        }

        // ── Layer 2.8: Direct Collection query/lookup fallback for WAVE ─────────
        if (app === "wave") {
            const appQuery = await filterByOwner(
                db.collection(COLLECTIONS.WAVE_APPLICATIONS), "userId", await ownedIds())
                .limit(APPLICATION_SCAN_LIMIT)
                .get();

            let appDocData: any = null;
            let appRef: any = null;

            if (!appQuery.empty) {
                const latestApp = latestApplication(appQuery.docs);
                appDocData = latestApp?.data();
                appRef = latestApp?.ref;
            } else if (userData.email) {
                /*
                 *   ONLY `userEmail`, AND ONLY IF NOBODY OWNS IT. The rule and
                 *   the two defects it closes are in lib/claimable-application;
                 *   the three status actions have carried it for a while and
                 *   this gate had not.
                 *
                 *   The "email" query that used to follow this one is gone
                 *   rather than narrowed. One fewer round trip on this path as
                 *   a side effect, which is not why it went.
                 */
                const emailQuery = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                    .where("userEmail", "==", userData.email.toLowerCase())
                    .limit(APPLICATION_SCAN_LIMIT)
                    .get();

                const { claimable, ownedByOthers } = claimableByEmail(emailQuery.docs);

                if (claimable) {
                    appDocData = claimable.data();
                    appRef = (claimable as any).ref;
                } else if (ownedByOthers > 0) {
                    logger.warn(
                        `[ModuleAccess] Layer 2.8 — ${ownedByOthers} WAVE application(s) match `
                        + `${userData.email} but every one already belongs to another account; `
                        + `none claimed (uid: ${userId}).`
                    );
                }
            }

            if (appDocData) {
                const status = appDocData.status;
                if (status === "approved" || status === "active") {
                    logger.info(
                        `[ModuleAccess] Layer 2.8 — Direct WAVE application query confirmed '${app}' access (uid: ${userId}, status: ${status}).`
                    );
                    
                    // Heal the application document with the userId if missing
                    const updates: any = {};
                    if (!appDocData.userId) {
                        updates.userId = userId;
                    }
                    if (Object.keys(updates).length > 0 && appRef) {
                        await appRef.update(updates);
                        //   A claim changes what the owner-scoped query would
                        //   answer — see the note on the Academy heal above.
                        //   Every heal here drops the memos, not only the ones
                        //   whose module reads through them today: the next
                        //   module to adopt them must not inherit a stale set.
                        forgetApplicationReads();
                        logger.info(`[ModuleAccess] Healed WAVE application ${appRef.id} with updates: ${JSON.stringify(updates)}`);
                    }

                    // Proactively backfill the USERS doc
                    const { FieldValue } = await import("./firestore-compat");
                    await db.collection(COLLECTIONS.USERS).doc(userId).set({
                        roles: FieldValue.arrayUnion("wave_participant"),
                        serviceRegistrations: {
                            wave: {
                                status: "approved",
                                applicationId: appRef.id,
                                approvedAt: appDocData.approvedAt || FieldValue.serverTimestamp(),
                            }
                        },
                        updatedAt: FieldValue.serverTimestamp()
                    }, { merge: true });

                    /*
                     *   #692 THE HEAL CLEARS THE PROFILE IT JUST CORRECTED.
                     *
                     *   session-guard reads roles and serviceRegistrations from
                     *   CacheKeys.userProfile, TTL 300 seconds. These layers
                     *   exist to repair a member whose record says they have no
                     *   access when they do — and the repair was then invisible
                     *   to the very reader it was written for, for five minutes.
                     *
                     *   Inside the heal branch, which is rare, rather than on
                     *   this function's hot path.
                     */
                    await invalidateServiceCache(userId, app);

                    return true;
                }
            }
        }

        // ── Layer 2.9: Direct Collection query/lookup fallback for Export ────────
        if (app === "export") {
            const appQuery = await filterByOwner(
                db.collection(COLLECTIONS.EXPORT_APPLICATIONS), "userId", await ownedIds())
                .limit(APPLICATION_SCAN_LIMIT)
                .get();

            let appDocData: any = null;
            let appRef: any = null;

            if (!appQuery.empty) {
                const latestApp = latestApplication(appQuery.docs);
                appDocData = latestApp?.data();
                appRef = latestApp?.ref;
            } else if (userData.email) {
                /*
                 *   ONLY `userEmail`, AND ONLY IF NOBODY OWNS IT. The rule and
                 *   the two defects it closes are in lib/claimable-application;
                 *   the three status actions have carried it for a while and
                 *   this gate had not.
                 *
                 *   The "profile.email" query that used to follow this one is gone
                 *   rather than narrowed. One fewer round trip on this path as
                 *   a side effect, which is not why it went.
                 */
                //   SHARED WITH checkExportStatusAction, which the screen
                //   behind this gate runs in the same request — identical
                //   query, identical bound, one round trip. See
                //   lib/application-request-reads.
                const emailQuery = await applicationsTypedTo(
                    COLLECTIONS.EXPORT_APPLICATIONS, "userEmail", userData.email);

                const { claimable, ownedByOthers } = claimableByEmail(emailQuery.docs);

                if (claimable) {
                    appDocData = claimable.data();
                    appRef = (claimable as any).ref;
                } else if (ownedByOthers > 0) {
                    logger.warn(
                        `[ModuleAccess] Layer 2.9 — ${ownedByOthers} Export application(s) match `
                        + `${userData.email} but every one already belongs to another account; `
                        + `none claimed (uid: ${userId}).`
                    );
                }
            }

            if (appDocData) {
                const status = appDocData.status;
                if (status === "approved" || status === "active" || status === "approved_admin") {
                    logger.info(
                        `[ModuleAccess] Layer 2.9 — Direct Export application query confirmed '${app}' access (uid: ${userId}, status: ${status}).`
                    );
                    
                    // Heal the application document with the userId if missing
                    const updates: any = {};
                    if (!appDocData.userId) {
                        updates.userId = userId;
                    }
                    if (Object.keys(updates).length > 0 && appRef) {
                        await appRef.update(updates);
                        //   A claim changes what the owner-scoped query would
                        //   answer — see the note on the Academy heal above.
                        //   Every heal here drops the memos, not only the ones
                        //   whose module reads through them today: the next
                        //   module to adopt them must not inherit a stale set.
                        forgetApplicationReads();
                        logger.info(`[ModuleAccess] Healed Export application ${appRef.id} with updates: ${JSON.stringify(updates)}`);
                    }

                    // Proactively backfill the USERS doc
                    const { FieldValue } = await import("./firestore-compat");
                    await db.collection(COLLECTIONS.USERS).doc(userId).set({
                        roles: FieldValue.arrayUnion("export_participant"),
                        serviceRegistrations: {
                            export: {
                                status: "approved",
                                applicationId: appRef.id,
                                approvedAt: appDocData.approvedAt || FieldValue.serverTimestamp(),
                            }
                        },
                        updatedAt: FieldValue.serverTimestamp()
                    }, { merge: true });

                    /*
                     *   #692 THE HEAL CLEARS THE PROFILE IT JUST CORRECTED.
                     *
                     *   session-guard reads roles and serviceRegistrations from
                     *   CacheKeys.userProfile, TTL 300 seconds. These layers
                     *   exist to repair a member whose record says they have no
                     *   access when they do — and the repair was then invisible
                     *   to the very reader it was written for, for five minutes.
                     *
                     *   Inside the heal branch, which is rare, rather than on
                     *   this function's hot path.
                     */
                    await invalidateServiceCache(userId, app);

                    return true;
                }
            }
        }

        // ── Layer 2.10: Direct Collection query/lookup fallback for Farm Nation ──
        if (app === "farm-nation") {
            const appQuery = await filterByOwner(
                db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS), "userId", await ownedIds())
                .limit(APPLICATION_SCAN_LIMIT)
                .get();

            let appDocData: any = null;
            let appRef: any = null;

            if (!appQuery.empty) {
                const latestApp = latestApplication(appQuery.docs);
                appDocData = latestApp?.data();
                appRef = latestApp?.ref;
            } else if (userData.email) {
                /*
                 *   ONLY `userEmail`, AND ONLY IF NOBODY OWNS IT. The rule and
                 *   the two defects it closes are in lib/claimable-application;
                 *   the three status actions have carried it for a while and
                 *   this gate had not.
                 *
                 *   The "profile.email" query that used to follow this one is gone
                 *   rather than narrowed. One fewer round trip on this path as
                 *   a side effect, which is not why it went.
                 */
                const emailQuery = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                    .where("userEmail", "==", userData.email.toLowerCase())
                    .limit(APPLICATION_SCAN_LIMIT)
                    .get();

                const { claimable, ownedByOthers } = claimableByEmail(emailQuery.docs);

                if (claimable) {
                    appDocData = claimable.data();
                    appRef = (claimable as any).ref;
                } else if (ownedByOthers > 0) {
                    logger.warn(
                        `[ModuleAccess] Layer 2.10 — ${ownedByOthers} Farm Nation application(s) match `
                        + `${userData.email} but every one already belongs to another account; `
                        + `none claimed (uid: ${userId}).`
                    );
                }
            }

            if (appDocData) {
                const status = appDocData.status;
                if (status === "approved" || status === "active" || status === "approved_admin") {
                    logger.info(
                        `[ModuleAccess] Layer 2.10 — Direct Farm Nation application query confirmed '${app}' access (uid: ${userId}, status: ${status}).`
                    );
                    
                    // Heal the application document with the userId if missing
                    const updates: any = {};
                    if (!appDocData.userId) {
                        updates.userId = userId;
                    }
                    if (Object.keys(updates).length > 0 && appRef) {
                        await appRef.update(updates);
                        //   A claim changes what the owner-scoped query would
                        //   answer — see the note on the Academy heal above.
                        //   Every heal here drops the memos, not only the ones
                        //   whose module reads through them today: the next
                        //   module to adopt them must not inherit a stale set.
                        forgetApplicationReads();
                        logger.info(`[ModuleAccess] Healed Farm Nation application ${appRef.id} with updates: ${JSON.stringify(updates)}`);
                    }

                    // Prepare user roles
                    const roles: string[] = [];
                    if (appDocData.role === "buyer" || appDocData.role === "both") {
                        roles.push("investor");
                    }
                    if (appDocData.role === "seller" || appDocData.role === "both") {
                        roles.push("farmer");
                    }

                    // Proactively backfill the USERS doc
                    const { FieldValue } = await import("./firestore-compat");
                    await db.collection(COLLECTIONS.USERS).doc(userId).set({
                        roles: FieldValue.arrayUnion(...roles),
                        serviceRegistrations: {
                            farmNation: {
                                status: "approved",
                                applicationId: appRef.id,
                                approvedAt: appDocData.approvedAt || FieldValue.serverTimestamp(),
                            }
                        },
                        updatedAt: FieldValue.serverTimestamp()
                    }, { merge: true });

                    /*
                     *   #692 THE HEAL CLEARS THE PROFILE IT JUST CORRECTED.
                     *
                     *   session-guard reads roles and serviceRegistrations from
                     *   CacheKeys.userProfile, TTL 300 seconds. These layers
                     *   exist to repair a member whose record says they have no
                     *   access when they do — and the repair was then invisible
                     *   to the very reader it was written for, for five minutes.
                     *
                     *   Inside the heal branch, which is rare, rather than on
                     *   this function's hot path.
                     */
                    await invalidateServiceCache(userId, app);

                    return true;
                }
            }
        }

        // ── Layer 2.11: Direct Collection query/lookup fallback for Marketplace Seller ─
        if (app === "marketplace") {
            const verQuery = await filterByOwner(
                db.collection(COLLECTIONS.SELLER_VERIFICATIONS), "userId", await ownedIds())
                .limit(APPLICATION_SCAN_LIMIT)
                .get();

            if (!verQuery.empty) {
                const latestVer = latestApplication<any>(verQuery.docs);
                const verDocData = latestVer?.data();
                const verRef = latestVer?.ref;
                const status = verDocData?.status;
                if (status === "approved") {
                    logger.info(
                        `[ModuleAccess] Layer 2.11 — Direct Seller Verification query confirmed '${app}' access (uid: ${userId}, status: ${status}).`
                    );

                    /*
                     *   THE OWNER: "on marketplace buyers are still having add
                     *   product button and that is not supposed to be so."
                     *
                     *   THIS IS WHERE THEY GOT THE ROLE. This backfill granted
                     *   `seller` to ANYONE holding an approved row in
                     *   SELLER_VERIFICATIONS, and never once looked at what
                     *   they had applied to be. A buyer's approved application
                     *   is such a row — the collection holds every marketplace
                     *   application whatever its accountType, which is why
                     *   _mp_onboarding reads `vData?.accountType` off it — so
                     *   approving a buyer made them a seller.
                     *
                     *   MarketplaceProductsClient then tests
                     *   `roles.includes("seller")` and offers "List a Product".
                     *
                     *   Worse than a one-off mis-grant: this is a HEAL on the
                     *   ACCESS path, so it re-granted the role the next time the
                     *   buyer opened the module. An admin removing it by hand
                     *   could not make it stick.
                     *
                     *   Every other door already had the rule. #844 established
                     *   it, _mp_onboarding's own heal applies it fifty lines
                     *   into this file's sibling, and #255 gave both admin
                     *   approval doors one shared implementation. This door was
                     *   missed by all three, and asked no question at all.
                     *
                     *   rolesGrantedOnSellerApproval is that shared rule: "both"
                     *   gets seller and buyer, a buyer-only record gets the
                     *   buyer role, and an absent accountType keeps today's
                     *   seller default so a legacy row is not demoted by this
                     *   change. The accountType is recorded too — the reader at
                     *   _mp_onboarding:211 wants it, and a heal that leaves a
                     *   field unwritten leaves it unwritten for the next one.
                     */
                    const { rolesGrantedOnSellerApproval, accountTypeOnSellerApproval } =
                        await import("./marketplace-approval-roles");
                    const grantedRoles = rolesGrantedOnSellerApproval(verDocData?.accountType);

                    // Proactively backfill the USERS doc
                    const { FieldValue } = await import("./firestore-compat");
                    await db.collection(COLLECTIONS.USERS).doc(userId).set({
                        roles: FieldValue.arrayUnion(...grantedRoles),
                        serviceRegistrations: {
                            marketplace: {
                                status: "approved",
                                accountType: accountTypeOnSellerApproval(verDocData?.accountType),
                                applicationId: verRef.id,
                                approvedAt: verDocData.approvedAt || FieldValue.serverTimestamp(),
                            }
                        },
                        updatedAt: FieldValue.serverTimestamp()
                    }, { merge: true });

                    /*
                     *   #692 THE HEAL CLEARS THE PROFILE IT JUST CORRECTED.
                     *
                     *   session-guard reads roles and serviceRegistrations from
                     *   CacheKeys.userProfile, TTL 300 seconds. These layers
                     *   exist to repair a member whose record says they have no
                     *   access when they do — and the repair was then invisible
                     *   to the very reader it was written for, for five minutes.
                     *
                     *   Inside the heal branch, which is rare, rather than on
                     *   this function's hot path.
                     */
                    await invalidateServiceCache(userId, app);

                    return true;
                }
            }
        }

        return false;
    } catch (error) {
        logger.error(`[ModuleAccess] Firestore fallback check failed for '${app}':`, error);
        // On DB error, deny access conservatively
        return false;
    }
}


//   #880 LAND_SELLER_ROLES moved to role-app-mapping.
//
//   It was declared here first, and `the-app-can-still-be-built` refused it:
//   this module imports cache-invalidation, which imports next/cache, so a
//   CLIENT component importing a constant from here drags a server-only module
//   into the browser bundle. #382's ratchet, doing exactly its job.
//
//   The constant is DATA, not behaviour, and role-app-mapping is where the
//   platform's role tables already live — pure, and already a client-safe
//   dependency of ModuleSidebar, which imports hasAppAccess from it.
export { LAND_SELLER_ROLES } from "@/lib/role-app-mapping";
