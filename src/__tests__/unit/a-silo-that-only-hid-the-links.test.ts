/**
 *   #618 THE MODULE-ADMIN SILO WAS A NAVIGATION CONVENIENCE, NOT A GUARD.
 *
 *   `canAccessAdminRoute` implements strict silo isolation — a cooperative_admin
 *   reaches /admin/cooperatives and nothing else, a wave_admin /admin/wave, and
 *   module admins are "strictly blocked from Analytics, Audit Logs, and Content
 *   Approval" in its own words.
 *
 *   It was consulted in EXACTLY ONE PLACE: AdminSidebar, to decide which links
 *   to draw. Nothing consulted it to decide what could be OPENED. Hiding a link
 *   is not a guard — typing the URL was enough, and so was calling the action
 *   behind it.
 *
 *   admin/layout.tsx imported it, computed a pathname to pass it, AND NEVER
 *   CALLED IT. The test guarding that was named "and both the layout and the
 *   sidebar enforce it", commented "Vacuity guard: an unused rule is not a
 *   policy", and asserted only that the layout CONTAINED the string. An
 *   import-level assertion passing against a door that enforced nothing — the
 *   exact failure that file warns about elsewhere. #617 removed the dead import
 *   while extracting the layout, which is how it surfaced.
 *
 *   Three API routes made it worse, delegating their own authorisation to it in
 *   comments: "canAccessAdminRoute already silos these people by module at the
 *   route layer." That was never true of any layer.
 *
 * ── WHY MIDDLEWARE, AND WHY IT WAS NEVER WIRED ──────────────────────────────
 *
 *   The reason is visible in what the layout had to do to attempt it: an App
 *   Router layout is not given the pathname, so it was reading `x-invoke-path`,
 *   a framework internal. Middleware is handed `req.nextUrl.pathname` as a
 *   matter of course. The check was written for a layer that could not ask the
 *   question.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 *
 *   It does not decide whether somebody is an admin at all — AdminShell already
 *   refuses everyone `isAdmin` rejects, and repeating that here would be two
 *   copies of one contract. This answers only the narrower question: this IS an
 *   admin, may they be on THIS route.
 *
 *   And it does not cover /loans/approve, the one admin screen outside /admin.
 *   That path is not in canAccessAdminRoute's vocabulary, so it would fall to
 *   the default branch and refuse a cooperative_admin — while the sidebar shows
 *   them the link, because they hold cooperatives:approve_loans. Extending the
 *   rule there is a decision about who may approve a business loan, not a defect
 *   to fix in passing.
 *
 * ── AND THE FIX WAS A LOCKOUT BEFORE IT WAS A GUARD ─────────────────────────
 *
 *   The first working draft would have locked `moderator` and `support` out of
 *   the admin portal completely. Both are admins by isAdmin — #356's finding —
 *   and canAccessAdminRoute's default branch, `r === "admin" || r ===
 *   "super_admin"`, refused them the base dashboard. So every admin URL refused
 *   them, the refusal sent them to /admin, and /admin refused them again.
 *
 *   That branch is one more copy of the hand-written admin test #356 swept out
 *   of six files, and while the rule only hid sidebar LINKS it cost a moderator
 *   one link. Making the rule decide what may be OPENED turned it into an
 *   infinite redirect. The base-dashboard allowance now covers all ten admin
 *   roles, and the middleware checks the redirect target against the same rule
 *   before using it, so a future disagreement lets the request through rather
 *   than looping.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { adminSiloRedirect, ADMIN_REFUSAL_LANDING, isAdmin, ALL_ADMIN_ROLES } from '@/lib/admin-permissions';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** Every /admin section a global admin reaches, used as the sweep's route set. */
const GLOBAL_ROUTES = [
    '/admin', '/admin/dashboard', '/admin/analytics', '/admin/audit-logs',
    '/admin/content-approval', '/admin/cooperatives', '/admin/wave',
    '/admin/marketplace', '/admin/export', '/admin/farm-nation', '/admin/academy',
    '/admin/settings', '/admin/users', '/admin/messages',
];

const MODULE_ADMINS: [string, string][] = [
    ['cooperative_admin', '/admin/cooperatives'],
    ['wave_admin', '/admin/wave'],
    ['marketplace_admin', '/admin/marketplace'],
    ['export_admin', '/admin/export'],
    ['farm_nation_admin', '/admin/farm-nation'],
    ['academy_admin', '/admin/academy'],
];

describe('#618 — the guard is a function, so it can be asked questions', () => {
    /*
     *   EVERY ASSERTION IN THIS BLOCK EXERCISES THE DECISION. The first version
     *   read middleware.ts and matched strings, and mutation testing killed the
     *   idea: `const isAnyAdmin = true` and `if (false && isAnyAdmin && ...)`
     *   both SURVIVED, because the assertions pinned a variable name and the
     *   mutants left the name alone. Neither survives a question with a known
     *   answer.
     */

    it('AN ADMIN ON A ROUTE THEIR SILO FORBIDS IS SENT TO THE LANDING PAGE', () => {
        for (const [role] of MODULE_ADMINS) {
            for (const [other, otherRoute] of MODULE_ADMINS) {
                if (other === role) continue;
                expect(adminSiloRedirect([role], otherRoute)).toBe(ADMIN_REFUSAL_LANDING);
            }
            //   The three the rule blocks module admins from by name.
            for (const global of ['/admin/analytics', '/admin/audit-logs', '/admin/content-approval']) {
                expect(adminSiloRedirect([role], global)).toBe(ADMIN_REFUSAL_LANDING);
            }
        }
    });

    it('AND ON THEIR OWN SECTION THEY ARE LET THROUGH', () => {
        for (const [role, route] of MODULE_ADMINS) {
            expect(adminSiloRedirect([role], route)).toBeNull();
            expect(adminSiloRedirect([role], `${route}/some/deep/page`)).toBeNull();
        }
    });

    it('A PLAIN ADMIN IS NEVER REDIRECTED — nobody who worked yesterday is locked out today', () => {
        //   The other way a silo goes wrong: it silos the wrong people.
        for (const route of GLOBAL_ROUTES) {
            expect(adminSiloRedirect(['admin'], route)).toBeNull();
            expect(adminSiloRedirect(['super_admin'], route)).toBeNull();
        }
    });

    it('AND NO ADMIN IS EVER SENT SOMEWHERE THEY WOULD BE REFUSED AGAIN', () => {
        /*
         *   THE LOOP, AND IT IS HOW THIS FIX WAS A LOCKOUT BEFORE IT WAS A GUARD.
         *
         *   The first working draft bounced `moderator` and `support` between two
         *   refusals for ever — not one page lost, the whole portal — because
         *   both are admins by isAdmin and canAccessAdminRoute's default branch,
         *   one more hand-written "admin or super_admin", refused them /admin.
         *
         *   The test written to catch precisely that enumerated the six module
         *   admins: the roles the silo is ABOUT, rather than every role the guard
         *   APPLIES TO. A guard's blast radius is who it can refuse, so that is
         *   what gets enumerated, and the fixed point is asserted directly.
         */
        for (const role of ALL_ADMIN_ROLES) {
            expect(isAdmin([role])).toBe(true);                       // vacuity guard
            for (const route of GLOBAL_ROUTES) {
                const target = adminSiloRedirect([role], route);
                if (target === null) continue;
                //   Wherever it sends them, going THERE must not redirect again.
                expect(adminSiloRedirect([role], target)).toBeNull();
            }
        }
        expect(ALL_ADMIN_ROLES).toContain('moderator');
        expect(ALL_ADMIN_ROLES).toContain('support');
    });

    it('AND THE LOOP IS IMPOSSIBLE EVEN IF THE RULE STOPS AGREEING', () => {
        /*
         *   The assertion above proves today's rule and today's landing page
         *   agree. It cannot prove they will, and mutation testing showed the
         *   difference bluntly: deleting the loop guard changed no answer the
         *   real rule can produce, so the mutant survived ten roles over
         *   fourteen routes. A line that cannot run cannot be tested.
         *
         *   So the rule is handed in. This is the case the guard exists for —
         *   somebody narrows the landing page — and the right answer is to LET
         *   THE REQUEST THROUGH, because AdminShell still refuses everyone
         *   isAdmin rejects, and a portal that admits too much for one release
         *   beats one that locks its administrators out for ever.
         */
        const refusesEverything = () => false;
        const refusesOnlyTheLanding = (_r: string[] | undefined, route: string) =>
            route !== ADMIN_REFUSAL_LANDING;

        for (const role of ALL_ADMIN_ROLES) {
            expect(adminSiloRedirect([role], '/admin/wave', refusesEverything)).toBeNull();
            expect(adminSiloRedirect([role], '/admin/wave', refusesOnlyTheLanding)).toBeNull();
        }

        //   POSITIVE CONTROL: an injected rule that ALLOWS the landing still
        //   redirects, so the two cases above are the guard firing and not the
        //   seam swallowing every answer.
        const allowsOnlyTheLanding = (_r: string[] | undefined, route: string) =>
            route === ADMIN_REFUSAL_LANDING;
        expect(adminSiloRedirect(['wave_admin'], '/admin/export', allowsOnlyTheLanding))
            .toBe(ADMIN_REFUSAL_LANDING);
    });

    it('AND IT DOES NOT ANSWER "IS THIS AN ADMIN" — that is AdminShell\'s job', () => {
        //   Two hand-maintained copies of one contract is the defect this audit
        //   keeps finding, and the middleware copy would be the one nobody looks
        //   at. A non-admin is let through here and refused by the shell.
        for (const role of ['general_user', 'marketplace_seller', 'cooperative_member', 'pending_admin']) {
            expect(isAdmin([role])).toBe(false);                      // vacuity guard
            expect(adminSiloRedirect([role], '/admin/wave')).toBeNull();
        }
        expect(read('src/components/admin/AdminShell.tsx')).toContain('isAdmin(roles)');
    });

    it('AND IT LEAVES EVERY NON-ADMIN PATH ALONE', () => {
        //   A gate applied to every path would be an outage across the whole
        //   site, which is the worst thing in this file's blast radius.
        for (const route of ['/dashboard', '/loans/apply', '/marketplace', '/wave', '/', '/auth/login']) {
            for (const role of [...ALL_ADMIN_ROLES, 'general_user']) {
                expect(adminSiloRedirect([role], route)).toBeNull();
            }
        }
    });

    it('AND /loans/approve IS DELIBERATELY OUTSIDE ITS VOCABULARY', () => {
        //   The one admin screen outside /admin. canAccessAdminRoute does not
        //   know the path, so it would fall to the default branch and refuse a
        //   cooperative_admin — while the sidebar shows them the link, because
        //   they hold cooperatives:approve_loans. Who may approve a business loan
        //   is a product decision, not something to settle in passing, so the
        //   guard does not reach it and this says so rather than leaving it to be
        //   read as an oversight.
        expect(adminSiloRedirect(['cooperative_admin'], '/loans/approve')).toBeNull();
    });
});

describe('#618 — and the middleware actually calls it', () => {
    it('THE ONLY LAYER HANDED A RELIABLE PATHNAME IS THE ONE ENFORCING IT', () => {
        //   An App Router layout is not given the pathname — admin/layout.tsx
        //   was reading `x-invoke-path`, a framework internal, which is why the
        //   check was never wired. Middleware is handed req.nextUrl.pathname.
        /*
         *   READ, NOT RUN, AND THAT IS THE POINT OF THE FUNCTION. middleware.ts
         *   is a NextAuth-wrapped edge handler and cannot be exercised here, so
         *   everything this file can say about it is a claim about its text.
         *
         *   Which is why the DECISION is not in it. The inline version was
         *   asserted the same way, and mutation testing found the assertions
         *   worthless: `const isAnyAdmin = true` survived, and so did wrapping
         *   the whole block in `if (false && ...)`, because a `toContain` pins a
         *   phrase and both mutants left the phrase alone. This anchor matches
         *   the SHAPE — call, then the result consumed as the whole condition —
         *   so `false &&` no longer slides past it. It is still the weakest
         *   assertion in this file, and the reason there is only one of it.
         */
        const mw = read('src/middleware.ts');
        expect(mw).toMatch(
            /const siloRedirect = adminSiloRedirect\(req\.auth\?\.user\?\.roles, pathname\);\s*\n\s*if \(siloRedirect\) \{\s*\n\s*return NextResponse\.redirect\(new URL\(siloRedirect, req\.nextUrl\.origin\)\);/
        );
    });

    it('AND THE SIDEBAR STILL DRAWS FROM THE SAME RULE, SO THE TWO LAYERS AGREE', () => {
        //   The links a module admin is shown and the routes they may open have
        //   to be one set. Drawing from one rule and enforcing another is how
        //   they come apart.
        expect(read('src/components/admin/AdminSidebar.tsx'))
            .toContain('canAccessAdminRoute(roles, item.href)');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     no silo at all — never refuse anything                         KILLED
 *     drop the redirect-target loop guard                            KILLED
 *     the injected-rule seam is ignored                              KILLED
 *     restore the under-grant on the base dashboard                  KILLED
 *     land a refusal on /dashboard instead of the portal             KILLED
 *     apply the guard to every path, not only /admin                 KILLED
 *     let module admins reach Analytics/Audit/Content                KILLED
 *     middleware wraps the call in `if (false && ...)`               KILLED
 *     middleware ignores the answer it got                           KILLED
 *     AdminSidebar stops consulting the rule                         KILLED
 *     AdminShell drops the isAdmin refusal                           KILLED
 *
 *     EQUIVALENT — NOT COUNTED AS COVERAGE
 *     apply the guard to non-admins as well                          SURVIVED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 * ── THE FIRST RUN OF THIS TABLE WAS WORTHLESS, AND SAID SO ──────────────────
 *
 *   An earlier version of these assertions read middleware.ts and matched
 *   strings. TWO MUTANTS SURVIVED IT: `const isAnyAdmin = true`, which applied
 *   the guard to every logged-in visitor, and `if (false && isAnyAdmin && ...)`,
 *   which switched the guard off entirely. Both left the pinned phrases in
 *   place, and a `toContain` pins a phrase.
 *
 *   That is the repair this audit has now had to make to its own tests five
 *   times: move the decision into a named function and ask it questions with
 *   known answers. One string assertion remains, on the call site, because
 *   middleware.ts is a NextAuth-wrapped edge handler that cannot be executed
 *   here — and it is anchored on the SHAPE of the call rather than its name, so
 *   the `false &&` mutant that survived the old version dies against it.
 *
 *   A later run also came back with EVERY mutant killed INCLUDING THE CONTROL,
 *   which is the signature of a red baseline rather than a thorough suite: an
 *   assertion in admin-permission-gates still named the old inline call. The
 *   baseline check is the only reason that run was thrown away instead of
 *   believed.
 *
 * ── THE SURVIVOR, AND WHY IT IS NOT A HOLE ──────────────────────────────────
 *
 *   Removing the `isAdmin` test changes no answer: a non-admin is refused every
 *   /admin route AND the landing page, so the loop guard returns null on the
 *   next line. The two guards mask each other, which is the property that makes
 *   this equivalent and also the property worth having. It is recorded as an
 *   equivalent mutant rather than counted, and the line stays — it stops being
 *   equivalent the moment the landing page is opened to non-admins.
 */
