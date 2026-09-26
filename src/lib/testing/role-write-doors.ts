import fs from "fs";
import path from "path";
import { stripComments } from "@/lib/testing/strip-comments";

/**
 * Find the doors that WRITE the `roles` field, and how they decide authorisation.
 *
 *   #954 ELEVEN FILES WRITE A MEMBER'S ROLES FROM THE TOKEN, AND THE SUMMARY
 *        THAT LOST THEM WAS MINE.
 *
 *   #750 converted admin/_users.ts and bulk-user-operations.ts off the JWT, and
 *   was PRECISE about its scope: they "are the only two writes on the platform
 *   that can put 'super_admin' into a roles array", because "every other
 *   role-touching write uses arrayUnion with a fixed participant role". That is
 *   accurate, and it names the deferral explicitly.
 *
 *   #951 then summarised it in one line of stale-authorisation.ts as "the two
 *   role-writing files, converted WHOLE" — dropping the qualifier that did all
 *   the work. I wrote that line, and this finding began by measuring against it
 *   rather than against #750. So the count was never wrong; a summary of it was,
 *   and the eleven files #750 deferred were carried in prose from then on.
 *
 *   Eleven files write a member's `roles` array and decide who may do it from the
 *   token alone. They grant fixed participant roles, so #750 was right that they
 *   cannot mint a super_admin — and the risk is not nil: a revoked admin can
 *   still grant paid Academy access, cooperative membership or seller status for
 *   the life of their token, and the grant outlives the revocation.
 *
 *   The criterion #750 gave for picking them is the one that matters most on
 *   #951's list, and it is quoted in stale-authorisation.ts: a revoked admin who
 *   can still write roles GRANTS ACCESS THAT SURVIVES THEIR OWN REVOCATION. An
 *   eight-hour stale window on an editorial queue costs an edit somebody undoes.
 *   An eight-hour stale window on a role write costs a grant nobody knows to
 *   look for.
 *
 * ── WHY THIS IS A SCANNER AND NOT A LIST ────────────────────────────────────
 *
 *   Because a hand-taken count is what went wrong. #948's finding was that a
 *   ledger which moves for two reasons and reports one is worse than no ledger,
 *   and a hand list has the same defect in a simpler form: it cannot tell you
 *   that it has gone stale.
 *
 * ── WHAT COUNTS AS A ROLE WRITE ─────────────────────────────────────────────
 *
 *   A `roles` key inside the argument list of a write call — .set(), .update(),
 *   .create(), .add(), and the transaction and batch forms of each.
 *
 *   ALSO a `roles` key in an object literal bound to a local that is then passed
 *   to a write call:
 *
 *       const payload = { roles: next };
 *       await userRef.update(payload);
 *
 *   I added that second clause for completeness and wrote here that it did not
 *   occur in the tree. IT DOES, AND IT IS THE LOAD-BEARING HALF. Measured by
 *   running the scan with the clause removed:
 *
 *       9 role writes across 7 files disappear
 *       6 of those files disappear ENTIRELY, having no in-call write at all
 *       5 token gates disappear with them
 *
 *   The worst of the six is actions/cooperative/_coop_admin_members.ts, which
 *   grants and revokes cooperative membership roles in three places, gates all
 *   five of its doors on the token, and writes every one of its three role
 *   payloads through a local. An in-call-only scanner reports that file as
 *   having no role writes, so it would never reach the ledger below — and the
 *   ledger would read 10 files and 30 gates, look complete, and be wrong in the
 *   one direction that matters.
 *
 *   Which is #948's finding arriving by a different road: an instrument that is
 *   blind in a shape nobody checked returns a number that cannot be told apart
 *   from the number you wanted.
 *
 * ── WHAT DOES NOT COUNT, AND THIS IS THE HALF THAT NEEDED MEASURING ─────────
 *
 *   A `roles` key in a RESPONSE PROJECTION. The first version of this scan was a
 *   grep for `roles:` and it reported thirteen files. Two were not writes at all:
 *
 *       actions/messages.ts:258      logger.warn("...", { roles: userRoles })
 *       actions/messages.ts:398      the search-result row a member's own
 *                                    conversation picker renders
 *       api/admin/marketplace/buyers/route.ts:80
 *                                    { id, name, email, phone, roles: u.roles }
 *       actions/admin/_marketplace.ts:907   the same projection, server-side
 *
 *   A projection READS roles. Reporting it as a grant would put two files on a
 *   security ledger that cannot grant anything, and a ledger with two entries
 *   nobody can act on is a ledger people learn to skip. The distinguishing
 *   feature is being inside a write call's arguments, which is what this checks.
 *
 *   Type declarations, interfaces and Zod schemas are excluded by the same test:
 *   `roles: string[]` in an interface is not inside a write call either.
 */

/** The write calls a role grant can travel through. */
export const ROLE_WRITE_CALLS = [
    "set",
    "update",
    "create",
    "add",
] as const;

/**
 * Named helpers that ARE writes, reached without a `.set(`/`.update(` in sight.
 *
 *   THE THIRD SHAPE, AND THE ASSERTION THAT FOUND IT. admin/_users.ts is the
 *   file #750 converted and named, so this suite asserts it still appears here as
 *   a converted role writer — a vacuity guard on the claim "the two #750
 *   converted stay converted". It failed, because _users.ts writes roles like
 *   this:
 *
 *       await atomicUpdateUser(userId, writeGuard(
 *           UserRolesWriteSchema, { roles: roles }, 'admin/updateUserRoles'));
 *
 *   No write METHOD anywhere: the payload is an argument to writeGuard, which is
 *   an argument to atomicUpdateUser. Both clauses above miss it, so the scanner
 *   reported the file that started this finding as writing no roles at all.
 *
 *   Measured reach: two files, admin/_users.ts (2 sites) and admin/_exports.ts
 *   (1). _exports.ts was already on the ledger for an in-call write, so the
 *   blind spot lost exactly one file — and it was the one whose regression the
 *   ledger most needs to notice, since it is already converted and therefore
 *   invisible to the on-the-token count either way.
 *
 *   A named list is a liability, so it is short and it is checked: the suite
 *   asserts _users.ts is found as a role writer, which is the assertion that
 *   caught its absence in the first place.
 */
export const ROLE_WRITE_HELPERS = [
    "atomicUpdateUser",
    "writeGuard",
] as const;

export interface RoleWrite {
    /** 1-based line of the `roles` key. */
    readonly line: number;
    /** The write call it sits inside, e.g. "update". */
    readonly via: string;
    /** "in-call" when the key is inside the call's arguments; "via-local" when
     *  it is in an object literal bound to a local the call is then passed. */
    readonly shape: "in-call" | "via-local";
}

/** Walk from the index of an opening paren/brace to its match. -1 if unbalanced. */
function matchingClose(src: string, open: number): number {
    const opener = src[open];
    const closer = opener === "(" ? ")" : "}";
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (c === opener) depth++;
        else if (c === closer) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

const ROLES_KEY = /(?:^|[{,\s])"?roles"?\s*:/;

function lineOf(src: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") line++;
    return line;
}

/**
 * Every role write in one already-comment-stripped source.
 *
 * Takes stripped source rather than stripping it here so a caller that also
 * needs the gates pays for the strip once — and so a fixture can be handed in
 * directly without the stripper's floor rejecting a three-line example.
 */
export function findRoleWrites(stripped: string): RoleWrite[] {
    const found: RoleWrite[] = [];
    const seen = new Set<number>();

    //   1. `roles:` inside a write call's arguments — a write METHOD, or one of
    //      the named helpers that is a write by another name.
    const callPattern = new RegExp(
        `(?:\\.(${ROLE_WRITE_CALLS.join("|")})|\\b(${ROLE_WRITE_HELPERS.join("|")}))\\s*\\(`,
        "g",
    );
    const callArgSpans: Array<{ from: number; to: number; via: string }> = [];
    for (const m of stripped.matchAll(callPattern)) {
        const open = m.index! + m[0].length - 1;
        const close = matchingClose(stripped, open);
        if (close < 0) continue;
        callArgSpans.push({ from: open, to: close, via: m[1] ?? m[2] });
    }

    for (const span of callArgSpans) {
        const args = stripped.slice(span.from, span.to);
        for (const km of args.matchAll(new RegExp(ROLES_KEY.source, "g"))) {
            const at = span.from + km.index!;
            if (seen.has(at)) continue;
            seen.add(at);
            found.push({ line: lineOf(stripped, at), via: span.via, shape: "in-call" });
        }
    }

    //   2. `roles:` in an object literal bound to a local that a write call is
    //      then handed. See the header: not present in the tree, implemented so
    //      that a zero from this scanner means one thing.
    for (const m of stripped.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*\{/g)) {
        const open = m.index! + m[0].length - 1;
        const close = matchingClose(stripped, open);
        if (close < 0) continue;
        const body = stripped.slice(open, close);
        const km = body.match(new RegExp(ROLES_KEY.source));
        if (!km) continue;

        const name = m[1];
        const passed = callArgSpans.find(
            (s) => s.from > close && new RegExp(`(?:^|[(,\\s])${name}(?:[),\\s]|$)`).test(stripped.slice(s.from, s.to)),
        );
        if (!passed) continue;

        const at = open + (km.index ?? 0);
        if (seen.has(at)) continue;
        seen.add(at);
        found.push({ line: lineOf(stripped, at), via: passed.via, shape: "via-local" });
    }

    return found.sort((a, b) => a.line - b.line);
}

export interface TokenGate {
    readonly line: number;
    /** The permission string, when the call names one literally. */
    readonly permission: string | null;
    /**
     * True when the SAME authorisation expression also forgives its refusal with
     * a bare role-name check — see findRoleLiteralGates.
     */
    readonly forgivenByRoleLiteral: boolean;
}

/**
 * Gates that decide from the token: `hasAdminPermission(session.user.roles, …)`.
 *
 * Counted per CALL, not per file. #952's M41 survived a per-file sweep: reverting
 * one of three gates in a file left the file still containing the live form, so
 * the sweep passed.
 */
export function findTokenGates(stripped: string): TokenGate[] {
    const gates: TokenGate[] = [];
    for (const m of stripped.matchAll(/hasAdminPermission\(\s*([^,]+),\s*("([^"]*)"|'([^']*)'|[^)]*)\)/g)) {
        const permission = m[3] ?? m[4] ?? null;
        //   The role literal may sit on either side of the && and on the next
        //   line, so the window is the enclosing statement, not the match.
        const stmtStart = stripped.lastIndexOf(";", m.index!) + 1;
        const braceStart = stripped.lastIndexOf("{", m.index!) + 1;
        const from = Math.max(stmtStart, braceStart);
        const to = stripped.indexOf("{", m.index! + m[0].length);
        const expr = stripped.slice(from, to < 0 ? m.index! + m[0].length : to);
        gates.push({
            line: lineOf(stripped, m.index!),
            permission,
            forgivenByRoleLiteral: /roles\??\.includes\(\s*["'][^"']+["']\s*\)/.test(expr),
        });
    }
    return gates;
}

export interface RoleLiteralGate {
    readonly line: number;
    readonly permission: string | null;
    /** The role name the literal admits, e.g. "academy_admin". */
    readonly role: string;
}

/**
 * Gates whose refusal a bare role name forgives — #365's shape, still open.
 *
 *   if (!hasAdminPermission(session.user.roles, "users:update") &&
 *       !session.user.roles?.includes("academy_admin")) { refuse }
 *
 *   #365 closed this in _exports.ts and _marketplace.ts, recording that there
 *   the literal "admitted nobody the permissions did not". In the academy files
 *   it admits somebody the permission does not: the matrix gives users:update to
 *   super_admin and admin only, and academy_admin reaches these doors solely
 *   through the literal.
 *
 *   It coincides today with academy:approve_applications — super_admin, admin,
 *   academy_admin, exactly. That is the defect rather than the excuse: the gate
 *   is SPELLING A PERMISSION OUT BY HAND, so it stops agreeing with the matrix
 *   the moment the matrix moves, in either direction, and nothing says so.
 *
 *   It also cannot be classified by #951's rule at all, which is per permission.
 *   A role name is not a permission, so mustRevalidateLive has nothing to decide
 *   on — which is why these four gates were invisible to the door ledger while
 *   sitting on the most irreversible act on it.
 */
export function findRoleLiteralGates(stripped: string): RoleLiteralGate[] {
    const found: RoleLiteralGate[] = [];
    for (const g of findTokenGates(stripped)) {
        if (!g.forgivenByRoleLiteral) continue;
        //   Re-read the enclosing expression for the role name itself.
        const lines = stripped.split("\n");
        const window = lines.slice(g.line - 1, g.line + 2).join("\n");
        const rm = window.match(/roles\??\.includes\(\s*["']([^"']+)["']\s*\)/);
        found.push({ line: g.line, permission: g.permission, role: rm ? rm[1] : "?" });
    }
    return found;
}

export interface IsAdminDoor {
    readonly line: number;
    /**
     * "refusal"   — `if (!isAdmin(session…)) return/throw`. Denies on the token.
     * "admission" — `if (isAdmin(session…)) return <everything>`. The admin
     *               FAST PATH, which decides authorisation from the token just as
     *               much as a refusal does, and is the easier of the two to read
     *               past. lib/hub-guard.ts, actions/resource-actions.ts and
     *               actions/wave/_member.ts each short-circuit to a full answer
     *               this way.
     * "binding"   — bound to a name and used later to decide what to SHOW rather
     *               than whether to admit. #535's rule governs those, and
     *               mayRevealMemberPii is their live-reading form.
     */
    readonly kind: "refusal" | "admission" | "binding";
    /** `session.user.id !== someoneElse && !isAdmin(…)` — needs a per-site edit. */
    readonly ownerOrAdmin: boolean;
}

/** The body an `if` at `condOpen` controls: its block, or its single statement. */
function ifBodyAfter(src: string, condOpen: number): string {
    const condClose = matchingClose(src, condOpen);
    if (condClose < 0) return src.slice(condOpen, condOpen + 240);
    let i = condClose + 1;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] === "{") {
        const end = matchingClose(src, i);
        return end < 0 ? src.slice(i, i + 240) : src.slice(i, end + 1);
    }
    const semi = src.indexOf(";", i);
    return src.slice(i, semi < 0 ? Math.min(i + 240, src.length) : semi + 1);
}

/**
 * The SECOND spelling of a token gate, which the door ledger never counted.
 *
 *   #954 THE LEDGER SAID SIXTY DOORS AND SWEPT ONE OF TWO SPELLINGS.
 *
 *   Every count in #951, #952 and #953 — "75 doors", then 64, then 60 — came
 *   from sweeping `hasAdminPermission(`. `isAdmin(session.user.roles)` reads the
 *   same JWT array and refuses on the same stale claim, and there are 45 of those
 *   in refusal position. The ledger was not wrong about what it counted; it was
 *   silent about what it did not, which is the harder failure to notice because
 *   the number went DOWN three times in a row and looked like progress.
 *
 *   Ten more bind it to a name (`const viewerIsAdmin = isAdmin(…)`) and decide
 *   what a page SHOWS rather than whether to admit. Those are #535's territory,
 *   not this rule's, and mayRevealMemberPii is already the live-reading form of
 *   them — so they are classified separately rather than swept into a door count
 *   they would inflate.
 *
 *   The owner-or-admin subset is flagged because OWNER_OR_ADMIN_SHAPE in
 *   stale-authorisation.ts already records why those cannot be substituted: the
 *   live read has to sit inside the non-owner branch, or every member pays a
 *   database read to act on their own row and is then refused for not being an
 *   admin.
 */
export function findIsAdminDoors(stripped: string): IsAdminDoor[] {
    const found: IsAdminDoor[] = [];
    for (const m of stripped.matchAll(/isAdmin\(\s*session[^)]*\)/g)) {
        const line = lineOf(stripped, m.index!);
        //   The statement this call sits in: back to the previous ; { or }, so a
        //   condition spanning lines is included whole.
        const from = Math.max(
            stripped.lastIndexOf(";", m.index!),
            stripped.lastIndexOf("{", m.index!),
            stripped.lastIndexOf("}", m.index!),
        ) + 1;
        const stmt = stripped.slice(from, m.index! + m[0].length);

        const bound = /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=]*)?=\s*(?:await\s+)?[^;]*isAdmin\(/.test(stmt);

        //   The `if` this call belongs to, and the body that `if` controls.
        //
        //   Taking a fixed character window from the match instead got
        //   actions/certificates.ts:160 wrong — `if (… && !isAdmin(…)) return [];`
        //   with the body on the same line. The window began after the statement's
        //   first `;`, which is the one ENDING the return, so the scanner looked
        //   past the refusal and called a door a binding.
        const ifOpen = stripped.lastIndexOf("if", m.index!) >= from
            ? stripped.indexOf("(", stripped.lastIndexOf("if", m.index!))
            : -1;
        const body = ifOpen >= 0 && ifOpen < m.index! ? ifBodyAfter(stripped, ifOpen) : "";
        const decides = /\breturn\b|\bthrow\b|NextResponse|redirect\(|notFound\(/.test(body);
        const negated = /!\s*(?:await\s+)?isAdmin\(\s*session/.test(stmt);

        let kind: IsAdminDoor["kind"];
        if (bound) kind = "binding";
        else if (!decides) kind = "binding";
        else kind = negated ? "refusal" : "admission";

        found.push({
            line,
            kind,
            ownerOrAdmin: /!==\s*session|\.id\s*!==|\bisOwner\b|\bisParty\b|\bhasAccess\b|isOwnedBySession/.test(stmt),
        });
    }
    return found.sort((a, b) => a.line - b.line);
}

/** Every isAdmin(session…) door in the tree, with its file. */
export function scanIsAdminDoors(
    dirs: readonly string[],
    srcDir: string,
): Array<IsAdminDoor & { readonly file: string }> {
    const files: string[] = [];
    for (const d of dirs) {
        const full = path.join(srcDir, d);
        if (fs.existsSync(full)) walk(full, files);
    }
    const out: Array<IsAdminDoor & { file: string }> = [];
    for (const file of files.sort()) {
        const raw = fs.readFileSync(file, "utf8");
        if (!raw.includes("isAdmin(")) continue;
        const stripped = stripComments(raw, { minRetainedRatio: 0, label: file });
        const rel = path.relative(srcDir, file).split(path.sep).join("/");
        for (const d of findIsAdminDoors(stripped)) out.push({ ...d, file: rel });
    }
    return out;
}

export interface RoleWriteDoor {
    /** src-relative path. */
    readonly file: string;
    readonly roleWrites: readonly RoleWrite[];
    readonly tokenGates: readonly TokenGate[];
    readonly liveGates: number;
    readonly roleLiteralGates: readonly RoleLiteralGate[];
}

function walk(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "__tests__" || entry.name === "node_modules") continue;
            walk(full, out);
        } else if (/\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
}

/** Every file under `dirs` that writes roles, with how it gates. */
export function scanRoleWriteDoors(dirs: readonly string[], srcDir: string): RoleWriteDoor[] {
    const files: string[] = [];
    for (const d of dirs) {
        const full = path.join(srcDir, d);
        if (fs.existsSync(full)) walk(full, files);
    }

    const doors: RoleWriteDoor[] = [];
    for (const file of files.sort()) {
        const raw = fs.readFileSync(file, "utf8");
        //   minRetainedRatio 0: a whole-tree walk meets files that are almost
        //   all comment, and the floor is for single-file callers that can say
        //   what they expected.
        const stripped = stripComments(raw, { minRetainedRatio: 0, label: file });
        const roleWrites = findRoleWrites(stripped);
        if (roleWrites.length === 0) continue;
        doors.push({
            file: path.relative(srcDir, file).split(path.sep).join("/"),
            roleWrites,
            tokenGates: findTokenGates(stripped),
            liveGates: (stripped.match(/requireAdmin\(/g) ?? []).length,
            roleLiteralGates: findRoleLiteralGates(stripped),
        });
    }
    return doors;
}

/** The role-writing doors that still decide authorisation from the token. */
export function roleWritersOnTheToken(doors: readonly RoleWriteDoor[]): RoleWriteDoor[] {
    return doors.filter((d) => d.tokenGates.length > 0);
}

/**
 * Every role-literal gate in the tree, whether or not its file writes roles.
 *
 * Swept separately from scanRoleWriteDoors because the role-write scan only
 * looks at files that write roles, and one of the four literal gates is in
 * actions/academy/_ac_admin_applications.ts — the PENDING QUEUE, which reads.
 * Scanning for literals only inside role-writing files found three of four and
 * would have left the fourth to be discovered by hand again.
 */
export function scanRoleLiteralGates(
    dirs: readonly string[],
    srcDir: string,
): Array<RoleLiteralGate & { readonly file: string }> {
    const files: string[] = [];
    for (const d of dirs) {
        const full = path.join(srcDir, d);
        if (fs.existsSync(full)) walk(full, files);
    }

    const found: Array<RoleLiteralGate & { file: string }> = [];
    for (const file of files.sort()) {
        const stripped = stripComments(fs.readFileSync(file, "utf8"), {
            minRetainedRatio: 0,
            label: file,
        });
        if (!stripped.includes("hasAdminPermission(")) continue;
        const rel = path.relative(srcDir, file).split(path.sep).join("/");
        for (const g of findRoleLiteralGates(stripped)) found.push({ ...g, file: rel });
    }
    return found;
}
