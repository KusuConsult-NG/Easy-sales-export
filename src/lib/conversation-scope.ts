/**
 *   #635 WHO MAY SEE A CONVERSATION — ASKED ONCE.
 *
 *   This rule was written out twice in infrastructure/messaging/service.ts:
 *   once in `validateConversationAccess`, which decides whether a thread may be
 *   OPENED or REPLIED TO, and once inside `getAllConversationsAdmin`'s filter,
 *   which decides what the admin inbox LISTS. Six module branches each, kept in
 *   step by hand.
 *
 *   They had come apart. The list carried a seventh branch the opener did not:
 *
 *       if (!c.context) {
 *           const email = (d.email || "").toLowerCase();
 *           if (roles.includes("wave_admin") && email.includes("wave")) return true;
 *           ...
 *       }
 *
 *   a "fallback for uncategorized legacy support chats". Two things followed,
 *   and both were live:
 *
 *     THE INBOX LISTED THREADS THAT WOULD NOT OPEN. Every direct member-to-member
 *     conversation is contextless — nothing in the UI passes a context when one
 *     member messages another — so this branch admitted them to a module admin's
 *     list, and `validateConversationAccess`, which has no such branch, then
 *     refused every one. That is #633's symptom exactly, in the branch #633 did
 *     not reach: a list where nothing opens.
 *
 *     AND IT LEAKED PRIVATE THREADS ON A SUBSTRING. The test is that a
 *     PARTICIPANT's email contains the module keyword — any participant, the
 *     member included. Two members whose addresses happen to contain "wave",
 *     "coop", "academy" or "export" had their private conversation listed to
 *     that module's admin, with both names and THE TEXT OF THE LAST MESSAGE,
 *     which is what the inbox renders under each row.
 *
 *   The fallback is gone rather than copied into the opener. It infers authority
 *   from a substring in an address, which is not a fact about the conversation,
 *   and the legacy support chats it was meant to rescue are still reachable by
 *   the people whose job they are: an unscoped admin — admin, super_admin,
 *   moderator, support — sees every conversation regardless of context.
 *
 * ── AND THE ORDER PREFIXES DESCRIBE NO ID THIS PLATFORM ISSUES ──────────────
 *
 *   Each module branch also matched `orderId?.startsWith("coop_")` and friends.
 *   No conversation in this codebase is created with an orderId at all — the two
 *   places that start one pass a participant and, at most, a context — and if one
 *   ever were, the ids this platform mints are `ORD-`, `POD-` and `EXP-ORD-`.
 *   Not one begins with `coop_`, `academy_`, `wave_`, `farm_` or `export_`.
 *
 *   So all six prefix tests are dead, and they are kept and marked as such rather
 *   than deleted: they are the convention somebody intended, the table is now the
 *   single place to correct it, and a test pins the mismatch so it is discovered
 *   deliberately rather than by a module admin seeing nothing.
 *
 *   ONE BRANCH WAS NOT DEAD, AND WAS A HOLE. marketplace_admin matched
 *
 *       conversation.productId || conversation.orderId
 *
 *   — ANY order, where every sibling required its own prefix. The moment a
 *   conversation carries an orderId, a marketplace admin would see the
 *   cooperative's, the academy's and Farm Nation's along with their own. It asks
 *   for marketplace's real order prefixes now, like everybody else.
 */

import { MODULE_ADMIN_ROLE, isUnscopedAdmin } from "@/lib/admin-permissions";
import type { Conversation } from "@/lib/types/messages";

interface ModuleScope {
    /** The admin role this scope belongs to. */
    readonly role: string;
    /** Conversation contexts this module owns. */
    readonly contexts: readonly string[];
    /**
     * Order-id prefixes this module owns.
     *
     * The `*_` ones match no id this platform issues — see the header. They are
     * the intended convention, kept in one place so correcting them is one edit.
     */
    readonly orderIdPrefixes: readonly string[];
    /** Whether a conversation attached to a PRODUCT belongs to this module. */
    readonly ownsProducts?: boolean;
}

export const MODULE_CONVERSATION_SCOPES: readonly ModuleScope[] = [
    {
        role: "cooperative_admin",
        contexts: ["cooperative_broadcast", "cooperative_support"],
        orderIdPrefixes: ["coop_"],
    },
    {
        //   The marketplace is the only module that owns a PRODUCT thread, and
        //   the only one whose orders this platform actually mints ids for:
        //   `ORD-` from checkout and `POD-` from pay-on-delivery.
        role: "marketplace_admin",
        contexts: ["marketplace_support"],
        orderIdPrefixes: ["ORD-", "POD-"],
        ownsProducts: true,
    },
    {
        role: "academy_admin",
        contexts: ["academy_support"],
        orderIdPrefixes: ["academy_"],
    },
    {
        role: "wave_admin",
        contexts: ["wave_support"],
        orderIdPrefixes: ["wave_"],
    },
    {
        //   `EXP-ORD-` is the real export order id. It is listed alongside the
        //   intended `export_` so an export thread reaches the export admin
        //   rather than nobody, and does NOT collide with the marketplace's
        //   `ORD-`, which it does not begin with.
        role: "export_admin",
        contexts: ["export_support"],
        orderIdPrefixes: ["EXP-ORD-", "export_"],
    },
    {
        //   `farm_nation_admin`, not "farmnation_admin" — the role tested here
        //   used to be one that does not exist, so a real Farm Nation admin
        //   matched no module filter and saw an empty list. See MODULE_ADMIN_ROLE.
        role: MODULE_ADMIN_ROLE.farmnation,
        contexts: ["farmnation_support"],
        orderIdPrefixes: ["farm_"],
    },
];

/** Does this conversation fall inside a module these roles administer? */
export function conversationInModuleScope(
    conversation: Pick<Conversation, "context" | "orderId" | "productId">,
    roles: string[] | undefined,
): boolean {
    if (!roles || roles.length === 0) return false;

    return MODULE_CONVERSATION_SCOPES.some((scope) => {
        if (!roles.includes(scope.role)) return false;
        if (conversation.context && scope.contexts.includes(conversation.context)) return true;
        if (scope.ownsProducts && conversation.productId) return true;
        return !!conversation.orderId
            && scope.orderIdPrefixes.some((prefix) => conversation.orderId!.startsWith(prefix));
    });
}

/**
 * May this person see this conversation at all?
 *
 * THE ONE ANSWER. The admin inbox lists what this admits and the thread view
 * opens what this admits, so the list can no longer offer a door that is locked.
 */
export function mayAccessConversation(
    conversation: Pick<Conversation, "context" | "orderId" | "productId" | "participants">,
    userId: string,
    roles: string[] | undefined,
): boolean {
    if (Array.isArray(conversation.participants) && conversation.participants.includes(userId)) {
        return true;
    }

    /*
     *   #633 #356 FIXED THE LIST AND NOT THE READER.
     *
     *   getAllConversationsAdmin refused `moderator` and `support` — the two
     *   roles whose job this screen is — and was changed to ask isAdmin().
     *   validateConversationAccess, which decides whether any one of those
     *   conversations can be OPENED or REPLIED TO, kept the hand-written test,
     *   so a support agent was handed every conversation on the platform,
     *   clicked one, and was refused.
     *
     *   The two questions are one function now, which is the durable form of
     *   that fix: there is no second copy left to forget.
     */
    if (isUnscopedAdmin(roles)) return true;

    return conversationInModuleScope(conversation, roles);
}

/**
 *   #752 WHICH ADMIN MAY A MEMBER MESSAGE — ASKED ONCE, AND ASKED OF THE ROLE.
 *
 *   The rule the platform intends is simple and was stated nowhere: a member
 *   may reach THEIR OWN module's admin, and the unscoped admins — admin,
 *   super_admin, moderator, support — who serve everybody. It was implemented
 *   three times in actions/messages.ts and got a different answer each time.
 *
 *     searchUsersAction, EMPTY QUERY   returned EVERY admin on the platform,
 *                                      filtered only for "not me". This is the
 *                                      people-picker's DEFAULT state, so a
 *                                      cooperative member opening Messages was
 *                                      shown the wave, academy, marketplace,
 *                                      export and Farm Nation admins as
 *                                      people to write to. No scoping at all.
 *
 *     searchUsersAction, WITH A QUERY  scoped on the admin's EMAIL ADDRESS:
 *
 *                                          isGlobal = email.includes("super")
 *                                              || email.includes("admin.easysalesexport")
 *                                          matchesModule = keywords
 *                                              .some(k => email.includes(k))
 *
 *     startSupportConversationAction   matched the module's ROLE — and then
 *                                      `|| email.includes(targetModule)`
 *                                      beside it, so the substring decided
 *                                      whenever the role did not.
 *
 *   #635 REMOVED EXACTLY THIS TEST FROM THE ADMIN INBOX and wrote down why:
 *   "It infers authority from a substring in an address, which is not a fact
 *   about the conversation." The same sentence applies to a person. What the
 *   address form costs, concretely:
 *
 *     - an admin whose address carries no module word — grace@easysalesexport
 *       .com, a real shape for a real person — was invisible to EVERY member,
 *       including the members of their own module, who then had nobody to
 *       write to;
 *     - `email.includes("super")` promotes any address containing those five
 *       letters (a supervisor@, a surname) to platform-wide reachability;
 *     - and a genuine super_admin at ceo@easysalesexport.com matched neither
 *       test and disappeared from the picker for every non-admin.
 *
 *   The roles array is read on the line above each of these tests. It is the
 *   fact; the address is a coincidence about it. Same shape as #353's
 *   "_admin suffix", #635's participant-email fallback, and #431's hand-written
 *   role list.
 *
 * ── AND ADMINS STILL SEE EACH OTHER ─────────────────────────────────────────
 *
 *   The scoping applies to a MEMBER looking at admins. An admin searching the
 *   directory is unscoped, as before: module admins have to be able to hand a
 *   case to one another, and the caller-is-admin branch is what makes the
 *   support workflow possible at all.
 */

/**
 * The module a participant role belongs to, keyed to MODULE_ADMIN_ROLE.
 *
 * Written out twice inside actions/messages.ts, once per function — the shape
 * #635, #633 and #353 each found in this area. One copy now.
 */
export const ROLE_MODULE: Readonly<Record<string, string>> = {
    wave_participant: "wave",
    cooperative_member: "cooperative",
    academy_participant: "academy",
    marketplace_buyer: "marketplace",
    buyer: "marketplace",
    seller: "marketplace",
    export_participant: "export",
    farmer: "farmnation",
    land_owner: "farmnation",
    investor: "farmnation",
};

/** The modules this person belongs to, from their roles. */
export function memberModules(roles: string[] | undefined): string[] {
    if (!roles) return [];
    return [...new Set(roles.map((r) => ROLE_MODULE[r]).filter(Boolean))];
}

/**
 * May `memberRoles` start a conversation with an admin holding `adminRoles`?
 *
 * The one answer, asked of the role on both sides.
 */
export function adminIsReachableBy(
    adminRoles: string[] | undefined,
    memberRoles: string[] | undefined,
): boolean {
    if (!adminRoles || adminRoles.length === 0) return false;

    //   Serves everybody, by definition — see UNSCOPED_ADMIN_ROLES.
    if (isUnscopedAdmin(adminRoles)) return true;

    const modules = memberModules(memberRoles);

    return MODULE_CONVERSATION_SCOPES.some((scope) =>
        adminRoles.includes(scope.role)
        && modules.some((m) => MODULE_ADMIN_ROLE[m] === scope.role));
}
