import { hasSellerRole } from "@/lib/seller-approval";

/**
 * May somebody holding these roles see this nav entry?
 *
 *   #908 EXTRACTED SO THE OWNER'S QUESTION CAN BE ANSWERED BY A TEST.
 *
 *   THE OWNER: "did you verify that a user who signs up as a seller only sees
 *   seller's dashboard and same applies to buyer and also if they apply as both
 *   then they see the 2 dashboards?"
 *
 *   That is a question about this predicate, and it lived inline in a client
 *   component's `.filter()` callback — so the suite over this file asserted on
 *   its SOURCE ("expect(src).toContain('item.sellerOnly && !isSeller')")
 *   instead of on what it decides. Source assertions cannot answer "what does a
 *   buyer-only account see"; they can only confirm a line is present.
 *
 *   Pure and exported, so the three cases can be run rather than read. The
 *   component's other two filters — the cross-module access check and the
 *   academy plan check — stay in the callback, because they need `hasAppAccess`
 *   and the session and are not what this question is about.
 *
 *   IN A LIB RATHER THAN IN THE COMPONENT, for the reason role-app-mapping
 *   already gives about LAND_SELLER_ROLES: ModuleSidebar is a client component
 *   carrying "use client" and a tree of icon imports, and requiring it from a
 *   node-environment test fails on the first untransformed dependency. The rule
 *   is not part of the rendering.
 */
export function navItemAllowedForRoles(
    item: { sellerOnly?: boolean; rolesAny?: readonly string[] },
    roles: readonly string[],
): boolean {
    // Role check for marketplace seller items
    if (item.sellerOnly && !hasSellerRole(roles)) return false;

    //   #858 The general form. Same direction as sellerOnly above — an item
    //   naming roles is hidden from somebody holding none of them.
    //   Compared as plain strings: `roles` is typed UserRole[], and the
    //   module vocabularies this gates on are the roles the onboarding
    //   actions actually grant, not a union maintained beside them.
    if (item.rolesAny && !item.rolesAny.some((r) => roles.includes(r))) return false;

    return true;
}
