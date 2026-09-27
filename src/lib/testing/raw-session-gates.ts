/**
 * Finds an access decision made from a RAW `auth()` session.
 *
 *   #966 AFTER #965 MEASURED WHAT requireSession ACTUALLY RETURNS, THIS IS THE
 *        ONLY SHAPE LEFT THAT CAN DECIDE AUTHORISATION FROM A STALE CLAIM.
 *
 *   #965 drove the guard and found that requireSession force-syncs the live roles
 *   over the token, mints a `general_user` row when none exists, and refuses an
 *   elevated session outright when the read fails. So `isAdmin(session.user.roles)`
 *   behind requireSession is judging the ROW, and the forty-four doors converted
 *   under #951 were closing a narrower gap than their commit messages claimed.
 *
 *   WHAT IS NOT NARROW is calling `auth()` directly and deciding from that. Such a
 *   session has had none of it: no force-sync, no ban check, no suspension check,
 *   no sessionsValidFrom revocation, no fail-closed on an unverifiable elevated
 *   role. Its roles are the JWT's, minted up to eight hours ago — which is the
 *   claim #356 made and #951 inherited, true here and only here.
 *
 *   So this replaces door-by-door conversion as the thing worth asserting. A
 *   conversion fixes one door and the next one written repeats the shape; a
 *   prohibition on the shape covers every door nobody has written yet.
 *
 * ── PER CALL SITE, NOT PER FILE ─────────────────────────────────────────────
 *
 *   My own first census of a neighbouring class scored three API routes as
 *   non-invalidating because it matched file-level substrings, and two more files
 *   as role-writers on the strength of a COMMENT. A file that calls auth()
 *   somewhere and asks isAdmin somewhere else is not this defect, and a detector
 *   that cannot tell the difference produces a list nobody can act on.
 *
 *   So the binding auth() was assigned to has to reach the predicate: the name
 *   itself, or a name taken from its `.roles` one hop later.
 */

export interface RawSessionGate {
    /** 1-indexed line of the PREDICATE call, which is where the decision is. */
    readonly line: number;
    /** The name `await auth()` was assigned to. */
    readonly binding: string;
    /** The role or access function that binding reached. */
    readonly predicate: string;
}

/**
 * Every function in this codebase that answers "may this caller do this".
 *
 * hasAppAccess and checkModuleAccess are here beside the four role predicates
 * because module access IS authorisation — #932's finding was that a module gate
 * and an admin gate fail the same way, and checkModuleAccess taking its roles as
 * a parameter is exactly how one of them stayed invisible to the isAdmin ledger.
 */
export const ACCESS_PREDICATES = [
    "isAdmin",
    "isSuperAdmin",
    "isPlatformAdmin",
    "hasAdminPermission",
    "hasAppAccess",
    "checkModuleAccess",
] as const;

export function findRawSessionGates(stripped: string): RawSessionGate[] {
    const out: RawSessionGate[] = [];

    const DECL = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=\s*await\s+auth\(\s*\)/g;

    for (const m of stripped.matchAll(DECL)) {
        const binding = m[1];
        const from = m.index! + m[0].length;
        const after = stripped.slice(from);

        /*
         *   The binding, plus any name that took its roles one hop later —
         *   `const roles = session.user.roles || []` is how wave/page.tsx spelled
         *   it, and a detector anchored only on `session` would have missed the
         *   call that actually decided.
         */
        const carriers = new Set<string>([binding]);
        const HOP = new RegExp(
            `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=;]*)?=\\s*[^;]*\\b${binding}\\b[^;]*\\.roles\\b`,
            "g",
        );
        for (const h of after.matchAll(HOP)) carriers.add(h[1]);

        for (const predicate of ACCESS_PREDICATES) {
            const CALL = new RegExp(`\\b${predicate}\\(([^)]*)\\)`, "g");
            for (const c of after.matchAll(CALL)) {
                const args = c[1];
                const reached = [...carriers].some((name) =>
                    new RegExp(`\\b${name}\\b`).test(args),
                );
                if (!reached) continue;

                out.push({
                    line: stripped.slice(0, from + c.index!).split("\n").length,
                    binding,
                    predicate,
                });
            }
        }
    }

    return out.sort((a, b) => a.line - b.line);
}
