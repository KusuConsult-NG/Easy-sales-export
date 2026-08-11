/**
 * Find server actions that authenticate the caller and then never use the
 * answer.
 *
 * THE SIGNATURE THIS LOOKS FOR
 * ----------------------------
 * `vendor.ts` is the reference case. Four functions took an id and wrote to it.
 * All four called `requireSession`. Three then used `session.user.id` only to
 * stamp an audit row:
 *
 *     const { session } = await requireSession();
 *     ...
 *     await productRef.update({ stock: 0, updatedBy: session.user.id });
 *
 * That records WHO acted without ever deciding whether they MAY. The id came
 * from the caller and was never compared to anything. Any authenticated user
 * could zero any vendor's stock.
 *
 * `action-auth-scan.ts` cannot see this — the guard is present and called, so
 * that scan is satisfied. This is the next question along: having established
 * who the caller is, does the function do anything with that?
 *
 * WHAT COUNTS AS DECIDING
 * -----------------------
 * Any of:
 *   - comparing the session id to something (`!== userId`, `=== data.userId`)
 *   - a role check (isAdmin, hasRole, hasAdminPermission, requireAdmin) — an
 *     admin action is legitimately not owner-scoped
 *   - scoping a query by the caller (`.where("userId", "==", userId)`) — the
 *     record cannot be somebody else's if it was fetched as the caller's
 *
 * WHY THIS IS A LEAD LIST AND NOT A DEFECT LIST
 * ---------------------------------------------
 * Ownership can be enforced in ways no syntactic rule sees: a helper that
 * returns only the caller's records, an id derived from the session rather than
 * the argument, a collection that is per-user by construction. Everything here
 * needs reading. It narrows ~500 functions to a few dozen worth an hour.
 */

import { readFileSync } from "fs";
import { relative } from "path";
import * as ts from "typescript";
import { collectActionFiles } from "./action-auth-scan";

const SESSION_GUARDS = new Set([
    "requireSession", "auth", "getServerSession", "getSession",
]);

/** A role check makes an action legitimately not owner-scoped. */
const ROLE_CHECKS = new Set([
    "isAdmin", "hasRole", "hasAdminPermission", "requireAdmin",
    "hasPermission", "isSuperAdmin", "needsDualControl",
]);

/** Calls that write. */
const WRITE_CALLS = new Set([
    "update", "set", "delete", "add", "create", "commit",
]);

/**
 * Claim primitives that take the OWNER explicitly and enforce it in SQL.
 *
 * Narrower than it first was, and the correction came from a bug this scanner
 * failed to report. `bookExportSlotAction` authenticated, ignored the session,
 * and booked a slot for a caller-supplied userId — and was invisible here
 * because it calls `incrementWithinCeiling`, which was on this list.
 *
 * incrementWithinCeiling enforces a CEILING. decrementManyOrFail enforces
 * STOCK. claimVersionedUpdate enforces a VERSION. claimIdempotencyKey enforces
 * a KEY. None of them knows who the caller is, so none of them is evidence that
 * ownership was checked. Only primitives that take a user id belong here.
 */
const OWNER_AWARE_PRIMITIVES = new Set([
    "debitWalletOnce", "debitWalletLocked", "debitJsonbBalance",
    "debitJsonbBalanceWithFloor", "creditWalletOnce", "claimPaymentOnce",
    "claimSingleOpenLoanApplication",
]);

export interface OwnershipLead {
    file: string;
    name: string;
    /** Why it was flagged, for the triage notes. */
    reason: string;
}

interface FnFacts {
    guarded: boolean;
    writes: boolean;
    decides: boolean;
    takesId: boolean;
}

function calleeName(node: ts.CallExpression): string | null {
    const { expression } = node;
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    return null;
}

/**
 * Does this node compare something to a session-derived identity?
 *
 * Deliberately loose. A comparison naming `userId`, `session`, `uid` or
 * `ownerId` on either side is treated as a decision, because the alternative —
 * demanding an exact shape — would flag every function that spells its
 * ownership check differently.
 */
function looksLikeIdentityComparison(node: ts.BinaryExpression): boolean {
    const ops = [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
    ];
    if (!ops.includes(node.operatorToken.kind)) return false;

    const text = `${node.left.getText()} ${node.right.getText()}`.toLowerCase();
    return /\b(userid|session|uid|ownerid|sellerid|buyerid|memberid|createdby)\b/.test(text);
}

/**
 * Names holding a session-derived value, resolved to a fixed point.
 *
 * Needed because ownership is often established through a local:
 *
 *     const bookingUserId = sessionResult.session?.user?.id;
 *     ...
 *     userId: bookingUserId
 *
 * Matching only the literal text "session" missed those, which is why
 * bookExportSlotAction still appeared after it had been fixed.
 */
function sessionDerived(fn: ts.Node): Set<string> {
    const names = new Set<string>(["session", "sessionResult"]);
    let changed = true;
    while (changed) {
        changed = false;
        const visit = (n: ts.Node) => {
            if (ts.isVariableDeclaration(n) && n.initializer) {
                const init = n.initializer.getText();
                const hit = /\bsession\b/i.test(init) ||
                    [...names].some((v) => new RegExp(`\\b${v}\\b`).test(init));
                if (hit) {
                    if (ts.isIdentifier(n.name) && !names.has(n.name.text)) {
                        names.add(n.name.text); changed = true;
                    }
                    if (ts.isObjectBindingPattern(n.name)) {
                        for (const el of n.name.elements) {
                            if (ts.isIdentifier(el.name) && !names.has(el.name.text)) {
                                names.add(el.name.text); changed = true;
                            }
                        }
                    }
                }
            }
            ts.forEachChild(n, visit);
        };
        ts.forEachChild(fn, visit);
    }
    return names;
}

function analyseFunction(node: ts.Node, source: ts.SourceFile): FnFacts {
    const facts: FnFacts = { guarded: false, writes: false, decides: false, takesId: false };
    const fromSession = sessionDerived(node);

    // Does it take an id-ish parameter? A function with no caller-supplied
    // identifier has nothing to confuse.
    const params = (node as any).parameters as ts.NodeArray<ts.ParameterDeclaration> | undefined;
    if (params) {
        for (const p of params) {
            const t = p.getText().toLowerCase();
            if (/\bid\b|id[:?)]|ids\b|\bref\b/.test(t)) facts.takesId = true;
        }
    }

    function visit(n: ts.Node) {
        if (ts.isCallExpression(n)) {
            const name = calleeName(n);
            if (name) {
                if (SESSION_GUARDS.has(name)) facts.guarded = true;
                if (ROLE_CHECKS.has(name)) facts.decides = true;
                if (WRITE_CALLS.has(name)) facts.writes = true;
                if (OWNER_AWARE_PRIMITIVES.has(name)) facts.decides = true;

                // .where("userId", "==", x) scopes the read to the caller.
                if (name === "where") {
                    const first = n.arguments[0];
                    if (first && ts.isStringLiteral(first)) {
                        if (/user|owner|seller|buyer|member|created/i.test(first.text)) {
                            facts.decides = true;
                        }
                    }
                }
            }
        }
        if (ts.isBinaryExpression(n) && looksLikeIdentityComparison(n)) {
            facts.decides = true;
        }

        // Assigning a session value INTO an identity field decides ownership by
        // construction — `ownerId: session.user.id` cannot be forged, so there
        // is nothing left to compare.
        //
        // This is deliberately narrow. The vendor writers also referenced
        // session.user.id, but only as `updatedBy` on an audit row: recording
        // who acted without deciding whether they may. So the field being
        // assigned has to be an IDENTITY field on the record, not any field
        // that happens to receive the session.
        const IDENTITY_FIELD_NAME = /^(userid|ownerid|sellerid|buyerid|memberid|initiatorid|createdby)$/i;

        if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) &&
            IDENTITY_FIELD_NAME.test(n.name.text)) {
            const init = n.initializer.getText();
            const root = init.split(/[^\w$]/)[0];
            if (/\bsession\b/i.test(init) || fromSession.has(root)) facts.decides = true;
        }

        // `{ ownerId }` where ownerId came from the session. Shorthand is a
        // different node type and was missed entirely, so _createLandListingAction
        // still appeared after being fixed.
        if (ts.isShorthandPropertyAssignment(n) &&
            IDENTITY_FIELD_NAME.test(n.name.text) &&
            fromSession.has(n.name.text)) {
            facts.decides = true;
        }

        // Reading the caller's roles counts as deciding.
        //
        // The commonest admin check here does not call any helper:
        //
        //     const roles = sessionResult.session.user.roles || [];
        //     const isAdmin = roles.some(r => r === "admin" || r === "super_admin");
        //     if (!isAdmin) return { error: "Unauthorized: Admin only" };
        //
        // `isAdmin` is a local variable, not the imported function, and
        // `r === "admin"` names no user id — so neither of the rules above sees
        // it. Requiring the helper would flag every correct action that spells
        // the check out by hand, which is most of them.
        if (ts.isPropertyAccessExpression(n) && n.name.text === "roles") {
            facts.decides = true;
        }
        if (
            ts.isStringLiteral(n) &&
            /^(admin|super_admin|superadmin)$/i.test(n.text)
        ) {
            facts.decides = true;
        }
        ts.forEachChild(n, visit);
    }

    ts.forEachChild(node, visit);
    return facts;
}

export function scanFileForOwnership(filePath: string, srcDir: string): OwnershipLead[] {
    const content = readFileSync(filePath, "utf-8");
    const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const relPath = relative(srcDir, filePath).split(/[\\/]/).join("/");
    const leads: OwnershipLead[] = [];

    function visit(node: ts.Node) {
        let name: string | null = null;
        let fnNode: ts.Node | null = null;

        if (ts.isFunctionDeclaration(node) && node.name) {
            name = node.name.text;
            fnNode = node;
        } else if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) {
            name = node.name.text;
            fnNode = node.initializer;
        }

        if (name && fnNode) {
            const f = analyseFunction(fnNode, source);
            if (f.guarded && f.writes && f.takesId && !f.decides) {
                leads.push({
                    file: relPath,
                    name,
                    reason: "authenticates, writes to a caller-supplied id, never checks ownership or role",
                });
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(source);
    return leads;
}

export function scanForOwnership(actionsDir: string, srcDir: string): OwnershipLead[] {
    return collectActionFiles(actionsDir)
        .flatMap((f) => scanFileForOwnership(f, srcDir))
        .sort((a, b) => (a.file + a.name).localeCompare(b.file + b.name));
}
