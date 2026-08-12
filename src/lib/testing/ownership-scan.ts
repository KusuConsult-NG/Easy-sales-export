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
 *
 * WHAT IT USED TO MISS, AND WHY
 * -----------------------------
 * It only considered functions that WRITE. Reading somebody else's data is the
 * same defect with the same cause, and by the time it was noticed the read half
 * had been found by hand four separate times — getPaymentByReferenceAction and
 * getUserCertificatesAction (both closed in one earlier pass),
 * getUserExportSlotsAction, and getUserPaymentHistoryAction.
 *
 * Worse, one rule made reads actively invisible. Scoping a query by the caller
 *
 *     .where("userId", "==", userId)
 *
 * counted as evidence that ownership had been decided. For a write that holds:
 * the row cannot be someone else's if it was fetched as the caller's. For a read
 * keyed on a caller-supplied ARGUMENT it is the exact opposite — that clause is
 * the vulnerability, because the caller chose whose rows come back.
 *
 * So the rule now asks where the compared value came from. Session-derived, it
 * still counts as deciding. Caller-derived, it is what makes the function a
 * lead. `sessionDerived` was already computed for another rule and answers this.
 *
 * A THIRD BLIND SPOT: STAMPING AN IDENTITY INTO A LOG
 * ---------------------------------------------------
 * `ownerId: session.user.id` on a record being written decides ownership by
 * construction, so the rule below treats an identity field receiving a session
 * value as a decision. But the same shape appears in a catch block:
 *
 *     logger.error("getSellerReviewSummaryAction error:", {
 *         sellerId, userId: sessionResult?.session?.user?.id, error: ...
 *     });
 *
 * That is a log line. It decides nothing, and it silently marked the whole
 * function as safe. This is precisely the distinction the rule was written to
 * make — the vendor writers "recorded WHO acted without deciding whether they
 * MAY" — implemented only for `updatedBy` and missed for `userId:` inside a log.
 *
 * Identity assignments inside a logging or audit call therefore no longer count.
 *
 * STILL INVISIBLE
 * ---------------
 * A single document fetched by id with no ownership check after it —
 * `db.collection(X).doc(inquiryId).get()` — takes no userId and runs no
 * `.where`, so neither rule has anything to catch. _getLandInquiryByIdAction was
 * exactly that and was found by reading the file next door to a lead, not by
 * this tool. Recorded because a scanner's blind spots are worth writing down.
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
 * Calls that read.
 *
 * `get` covers both `doc(...).get()` and a query's `.get()`, which is the whole
 * surface in this codebase — the adapter exposes nothing else.
 */
const READ_CALLS = new Set(["get"]);

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
/**
 * Calls whose arguments only RECORD what happened. An identity stamped into one
 * of these decides nothing — see the header note.
 */
const RECORDING_CALLS = new Set([
    "error", "warn", "info", "debug", "log", "trace",
    "createAdminAuditLog", "logAdminAction", "logAdminFinancialAction",
    "logTelemetryAction", "captureException", "captureMessage",
]);

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
    reads: boolean;
    decides: boolean;
    takesId: boolean;
    /**
     * Set when a query is scoped by an identity field whose value did NOT come
     * from the session — `.where("userId", "==", userId)` on a parameter. For a
     * read that is the defect itself rather than a defence against it.
     */
    scopedByCallerValue: boolean;
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

/** Is this node an argument to a call that merely records? */
function insideRecordingCall(node: ts.Node): boolean {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
        if (ts.isCallExpression(n)) {
            const name = calleeName(n);
            if (name && RECORDING_CALLS.has(name)) return true;
        }
        // Stop at the enclosing function; a call further out is a different
        // statement entirely.
        if (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
            return false;
        }
    }
    return false;
}

function analyseFunction(node: ts.Node, source: ts.SourceFile): FnFacts {
    const facts: FnFacts = {
        guarded: false, writes: false, reads: false, decides: false,
        takesId: false, scopedByCallerValue: false,
    };
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
                if (READ_CALLS.has(name)) facts.reads = true;
                if (OWNER_AWARE_PRIMITIVES.has(name)) facts.decides = true;

                // .where("userId", "==", x) — but only a decision if x is the
                // SESSION's id. Scoping by a caller-supplied argument is how a
                // read serves other people's rows, so it is the opposite of
                // evidence. See the header note.
                if (name === "where") {
                    const first = n.arguments[0];
                    if (first && ts.isStringLiteral(first) &&
                        /user|owner|seller|buyer|member|created/i.test(first.text)) {
                        const compared = n.arguments[2];
                        const text = compared ? compared.getText() : "";
                        const root = text.split(/[^\w$]/)[0];
                        if (/\bsession\b/i.test(text) || fromSession.has(root)) {
                            facts.decides = true;
                        } else {
                            facts.scopedByCallerValue = true;
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
            IDENTITY_FIELD_NAME.test(n.name.text) && !insideRecordingCall(n)) {
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
            if (f.guarded && f.takesId && !f.decides) {
                if (f.writes) {
                    leads.push({
                        file: relPath,
                        name,
                        reason: "authenticates, writes to a caller-supplied id, never checks ownership or role",
                    });
                } else if (f.reads && f.scopedByCallerValue) {
                    // Reads are only reported when the query was scoped by a
                    // caller-supplied identity. Without that the function has no
                    // demonstrable link to another user's rows and the noise
                    // would drown the list.
                    leads.push({
                        file: relPath,
                        name,
                        reason: "authenticates, then reads rows scoped by a caller-supplied id, never checks ownership or role",
                    });
                }
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
