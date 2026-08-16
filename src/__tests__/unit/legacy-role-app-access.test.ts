/**
 * Legacy role names, and what they did to app access.
 *
 * WHAT WAS WRONG
 * --------------
 * ROLE_APP_ACCESS is `Record<UserRole, AppIdentifier[]>`. Both consumers are
 * typed `userRoles: UserRole[]` and both are called with roles read straight
 * out of the users table, where the value is whatever was written — including
 * the pre-migration names in LEGACY_ROLE_MAP.
 *
 * "member" is the common one. It is on 8 of the 9 seeded accounts because that
 * mirrors production, and it is not a key of ROLE_APP_ACCESS:
 *
 *   getUserAccessibleApps   ROLE_APP_ACCESS[role] was undefined and .forEach()
 *                           threw. getPrimaryApp threw, getPostLoginRedirect
 *                           fell into its catch and returned /dashboard. So
 *                           every login by a legacy user landed on the generic
 *                           hub instead of their module — 81 occurrences of
 *                           "Cannot read properties of undefined (reading
 *                           'forEach')" in a single local test session.
 *
 *   hasAppAccess            did NOT throw. The identical lookup there was
 *                           written `allowedApps?.includes(app) ?? false`, so
 *                           it answered FALSE and the same users were quietly
 *                           denied access their role was meant to grant.
 *
 * The silent one is the worse of the two, and it is the reason this file tests
 * both functions rather than just the one that crashed.
 *
 * WHY NOT SIMPLY GUARD THE LOOKUP
 * -------------------------------
 * `?? []` stops the crash and leaves the denial: a legacy user gets no apps
 * from that role. "member" MEANS "general_user", so the roles are translated
 * before lookup. A test that only asserted "does not throw" would pass against
 * the guard-only fix, so every case below asserts what access is actually
 * granted.
 */

import { getUserAccessibleApps, getPrimaryApp, hasAppAccess, ROLE_APP_ACCESS } from "@/lib/role-app-mapping";
import { LEGACY_ROLE_MAP } from "@/lib/types/roles";

describe("app access for legacy role names", () => {
    it("does not throw on a role that is not a key of ROLE_APP_ACCESS", () => {
        // The exact call that broke every login: e2e.user's roles are
        // ["member"], and that is what production carries too.
        expect(() => getUserAccessibleApps(["member"] as any)).not.toThrow();
    });

    it("grants a legacy 'member' the same apps as 'general_user'", () => {
        // The assertion that makes this a fix rather than a guard. Skipping the
        // unknown role would also "not throw", and would leave the user with
        // nothing.
        const legacy = getUserAccessibleApps(["member"] as any).sort();
        const modern = getUserAccessibleApps(["general_user"] as any).sort();

        expect(legacy).toEqual(modern);
    });

    it("stops silently denying a legacy role its apps", () => {
        // hasAppAccess never threw — it answered false, which is why this went
        // unnoticed.
        //
        // Tested through "vendor" rather than "member": general_user grants no
        // module apps at all, only the universal ones, so hasAppAccess("member")
        // returns true either way and would prove nothing. vendor maps to
        // seller, which does grant apps, so a failure to translate is visible.
        const sellerApps = ROLE_APP_ACCESS["seller"];
        expect(sellerApps.length).toBeGreaterThan(0);

        for (const app of sellerApps) {
            expect(hasAppAccess(["vendor"] as any, app)).toBe(true);
        }
    });

    it("translates every name in LEGACY_ROLE_MAP, not just member", () => {
        // member is the one that showed up; the others are the same defect
        // waiting on different data.
        for (const [legacy, modern] of Object.entries(LEGACY_ROLE_MAP)) {
            expect(() => getUserAccessibleApps([legacy] as any)).not.toThrow();
            expect(getUserAccessibleApps([legacy] as any).sort())
                .toEqual(getUserAccessibleApps([modern] as any).sort());
        }
    });

    it("leaves modern roles alone", () => {
        // The translation must not change what already worked.
        const seller = getUserAccessibleApps(["seller"] as any);
        expect(seller).toEqual(expect.arrayContaining(ROLE_APP_ACCESS["seller"]));
        expect(hasAppAccess(["seller"] as any, ROLE_APP_ACCESS["seller"][0])).toBe(true);
    });

    it("handles a mixed legacy and modern roles array, as the database has", () => {
        // Real rows look like ["member", "wave_participant"] — never one or the
        // other. The legacy entry used to take the whole call down with it.
        const apps = getUserAccessibleApps(["member", "wave_participant"] as any);

        expect(apps).toEqual(expect.arrayContaining(ROLE_APP_ACCESS["general_user"]));
        expect(apps).toEqual(expect.arrayContaining(ROLE_APP_ACCESS["wave_participant"]));
    });

    it("routes a legacy 'member' the same way as a general_user", () => {
        // getPrimaryApp had the same untranslated-role problem, one layer up:
        // ["member"] matched none of its priority lists — not even the explicit
        // general_user branch — and fell through to the "roles are somehow
        // unrecognised" scan at the end.
        //
        // "/" is its answer for "no role names a module". getPostLoginRedirect
        // turns that into /dashboard, which is where these users have always
        // landed (previously by way of the crash's catch block).
        expect(getPrimaryApp(["member"] as any)).toBe(getPrimaryApp(["general_user"] as any));
        expect(getPrimaryApp(["vendor"] as any)).toBe(getPrimaryApp(["seller"] as any));
        expect(getPrimaryApp(["exporter"] as any)).toBe(getPrimaryApp(["export_participant"] as any));
    });

    it("still prefers a module role over a legacy one in the same array", () => {
        // ["member", "wave_participant"] must route to WAVE, not to the hub.
        // Translating member to general_user must not let it win the priority
        // contest it previously could not enter at all.
        expect(getPrimaryApp(["member", "wave_participant"] as any))
            .toBe(getPrimaryApp(["wave_participant"] as any));
    });

    it("degrades rather than throwing on an unrecognisable role", () => {
        // Not every bad value is a known legacy name. A row with a typo, or a
        // role invented by an admin tool, must not be able to break login.
        expect(() => getUserAccessibleApps(["not_a_real_role"] as any)).not.toThrow();
        expect(() => getUserAccessibleApps([] as any)).not.toThrow();
        expect(() => getUserAccessibleApps(undefined as any)).not.toThrow();
        expect(() => getUserAccessibleApps([null, 42] as any)).not.toThrow();
    });
});
