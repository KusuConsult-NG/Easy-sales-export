/**
 * Find writes where caller data could overwrite a security-relevant field.
 *
 * THE FRAGILITY THIS ENFORCES
 * ---------------------------
 * From security-review-2026-08-10.md, recorded as a caveat with nothing
 * enforcing it:
 *
 *     const escrow = { ...data,          // caller-supplied
 *         status: "pending",             // ← overwrites an injected status
 *         _version: 0 };
 *
 * "Reverse those two lines and it becomes privilege escalation — an escrow
 * created already funded, without payment. Fourteen sites depend on this, and
 * nothing enforces it."
 *
 * All fourteen are currently correct. That is the point: they are safe by the
 * order of two lines in an object literal, which no reviewer checks and no test
 * covered. This makes the property structural.
 *
 * WHAT COUNTS AS DANGEROUS
 * ------------------------
 * A sensitive field assigned BEFORE a spread of caller-controlled data, in the
 * same object literal. The spread wins, so the caller's value is what gets
 * written.
 *
 * WHAT DOES NOT
 * -------------
 * A spread of anything that is not a function parameter. The first version of
 * this flagged thirteen sites, and the two worst turned out to be:
 *
 *   - a conditional spread of server timestamps:
 *         ...(isLease ? { leasedAt: serverTimestamp() } : { soldAt: ... })
 *   - a spread of a document loaded from the database
 *
 * Neither is reachable by a caller, so neither is mass assignment. Restricting
 * to caller-rooted spreads took the count from 13 to 0 — and 0 is the correct
 * answer, which the noisier version would have buried.
 *
 * WHAT "CALLER-ROOTED" MEANS, WIDENED LATER
 * ----------------------------------------
 * It used to mean "a function parameter", and that made both scanners in this
 * file blind to every API route: a route handler's caller data does not arrive
 * as a parameter, it arrives as `await request.json()` assigned to a local.
 *
 * api/marketplace/update-product wrote
 *
 *     const { productId, ...updateData } = body;
 *     await productRef.update({ ...updateData, updatedAt: ... });
 *
 * guarded only by ownership, so a seller could set `status`, `rating`,
 * `reviewCount` and `sellerId` on their own product. Both scanners reported
 * nothing — correct by their own rule and useless in practice.
 *
 * taintedNames() now follows a request read and the REST element of a
 * destructuring of anything already tainted. A NAMED binding is deliberately
 * not tainted: `const { title } = body` is one field, which is the safe shape,
 * and tainting it would fire on every route that reads a named field.
 *
 * The ordering gate stayed at zero after the widening, so it is still a gate.
 *
 * THE OTHER HALF, ADDED LATER
 * ---------------------------
 * Everything above is about ORDER: a caller OVERWRITING a field the literal
 * names. That is only half the exposure, and the half that is already green.
 *
 * The other half is ADDITION. `{ ...data, status: "pending" }` stops a caller
 * setting `status`, and does nothing at all about a caller setting a field the
 * literal never mentions. The declared parameter type is erased before the
 * request arrives, so `data` is whatever JSON was posted to the server action.
 * Three real instances of this were found and fixed:
 *
 *   payments.ts             PaymentRecord declares completedAt and
 *                           paystackResponse — a "pending" payment could be
 *                           filed already carrying a gateway response.
 *   _escrow_disputes.ts     Dispute declares resolution, resolvedBy,
 *                           resolvedAt — a caller could open a dispute with a
 *                           resolution already planted and attributed.
 *   land-listings.ts        LandListing declares verified, verificationStatus,
 *                           verifiedBy, verifiedAt — the record of an admin
 *                           decision, writable at create time.
 *
 * None of them was reachable by the ordering scanner, because in all three the
 * spread came first — which is exactly what the ordering rule asks for. Two
 * correct-looking rules, one real gap between them.
 *
 * scanForCallerSpreadWrites finds this shape. It is NOT a gate at zero: the
 * remaining sites spread admin-supplied or server-built objects and are fine.
 * It is pinned to a known set instead, so a NEW one fails.
 */

import { readFileSync } from "fs";
import { relative } from "path";
import * as ts from "typescript";
import { collectActionFiles } from "./action-auth-scan";

/**
 * Fields where a caller-supplied value changes what someone is allowed to do,
 * or what they are owed.
 */
const SENSITIVE_FIELD =
    /^(status|role|roles|_version|verified|isverified|balance|amount|ownerid|userid|sellerid|buyerid|isadmin|permissions|approved|paymentstatus|escrowreleased)$/i;

export interface MassAssignmentLead {
    file: string;
    line: number;
    /** Fields the spread would overwrite. */
    fields: string[];
}

/** Root identifier of `a.b.c` → "a". */
function rootName(node: ts.Node): string | null {
    let cur = node;
    while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
    return ts.isIdentifier(cur) ? cur.text : null;
}

function parameterNames(fn: ts.Node): Set<string> {
    const names = new Set<string>();
    const params = (fn as any).parameters as ts.NodeArray<ts.ParameterDeclaration> | undefined;
    for (const p of params ?? []) {
        if (ts.isIdentifier(p.name)) names.add(p.name.text);
        if (ts.isObjectBindingPattern(p.name)) {
            for (const el of p.name.elements) {
                if (ts.isIdentifier(el.name)) names.add(el.name.text);
            }
        }
    }
    return names;
}

function scanFunction(
    fn: ts.Node,
    source: ts.SourceFile,
    relPath: string,
    out: MassAssignmentLead[]
) {
    const params = taintedNames(fn);
    if (params.size === 0) return;

    const visit = (n: ts.Node) => {
        if (ts.isObjectLiteralExpression(n)) {
            const props = n.properties;

            const spreadIndex = props.findIndex((p) => {
                if (!ts.isSpreadAssignment(p)) return false;
                const root = rootName(p.expression);
                return root !== null && params.has(root);
            });

            if (spreadIndex >= 0) {
                const overwritten = props
                    .slice(0, spreadIndex)
                    .filter(
                        (p) =>
                            (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
                            ts.isIdentifier(p.name) &&
                            SENSITIVE_FIELD.test(p.name.text)
                    )
                    .map((p) => (p.name as ts.Identifier).text);

                if (overwritten.length > 0) {
                    const { line } = source.getLineAndCharacterOfPosition(n.getStart());
                    out.push({ file: relPath, line: line + 1, fields: overwritten });
                }
            }
        }
        ts.forEachChild(n, visit);
    };
    ts.forEachChild(fn, visit);
}

export function scanFileForMassAssignment(filePath: string, srcDir: string): MassAssignmentLead[] {
    const source = ts.createSourceFile(
        filePath,
        readFileSync(filePath, "utf-8"),
        ts.ScriptTarget.Latest,
        true
    );
    const relPath = relative(srcDir, filePath).split(/[\\/]/).join("/");
    const out: MassAssignmentLead[] = [];

    const visit = (node: ts.Node) => {
        if (ts.isFunctionDeclaration(node)) {
            scanFunction(node, source, relPath, out);
        } else if (
            ts.isVariableDeclaration(node) &&
            node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) {
            scanFunction(node.initializer, source, relPath, out);
        }
        ts.forEachChild(node, visit);
    };

    visit(source);
    return out;
}

export function scanForMassAssignment(dirs: string[], srcDir: string): MassAssignmentLead[] {
    return dirs
        .flatMap((d) => collectActionFiles(d))
        .flatMap((f) => scanFileForMassAssignment(f, srcDir))
        .sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line));
}

// ---------------------------------------------------------------------------
// The addition half: a parameter-rooted spread reaching a persistence call,
// whatever the field order.
// ---------------------------------------------------------------------------

/** Adapter methods that persist an object literal. */
const WRITE_METHODS = new Set(["set", "add", "update", "insert", "upsert"]);

export interface CallerSpreadWrite {
    file: string;
    line: number;
    /** The spread expression, e.g. "data" or "input.payload". */
    spread: string;
    /** Fields the literal names explicitly — everything else rides in on the spread. */
    named: string[];
}

/** `{ ...param, a, b }` → its details, or null if no parameter-rooted spread. */
function callerSpreadLiteral(
    literal: ts.ObjectLiteralExpression,
    params: Set<string>,
    source: ts.SourceFile
): Omit<CallerSpreadWrite, "file"> | null {
    const spread = literal.properties.find(
        (p) => ts.isSpreadAssignment(p) && params.has(rootName(p.expression) ?? "")
    ) as ts.SpreadAssignment | undefined;
    if (!spread) return null;

    const named = literal.properties
        .filter((p) => ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p))
        .map((p) => {
            const name = (p as ts.PropertyAssignment).name;
            return name && ts.isIdentifier(name) ? name.text : "?";
        });

    return {
        line: source.getLineAndCharacterOfPosition(literal.getStart()).line + 1,
        spread: spread.expression.getText(),
        named,
    };
}

/** Strips `as T` / `<T>x` so the literal underneath is still seen. */
function unwrap(node: ts.Node): ts.Node {
    let cur = node;
    while (ts.isAsExpression(cur) || ts.isTypeAssertionExpression(cur) || ts.isParenthesizedExpression(cur)) {
        cur = (cur as any).expression;
    }
    return cur;
}

/** How caller data enters a Next.js route handler. */
const REQUEST_READERS = new Set(["json", "formData", "text", "arrayBuffer"]);

/**
 * Names holding caller-controlled data inside a function.
 *
 * Parameters are the obvious source, and were the only one the first version of
 * this scanner knew about. That made it blind to every API route, because a
 * route handler's caller data does not arrive as a parameter — it arrives as
 * `await request.json()`, assigned to a local. api/marketplace/update-product
 * wrote `const { productId, ...updateData } = body` and spread `updateData`
 * into an update, letting a seller set status, rating, reviewCount and sellerId
 * on their own product; the scanner reported nothing, correctly by its own rule
 * and uselessly in practice.
 *
 * So taint now propagates: a parameter, anything read off a request, and the
 * rest element of a destructuring of either.
 */
function taintedNames(fn: ts.Node): Set<string> {
    const tainted = parameterNames(fn);

    const visit = (n: ts.Node) => {
        if (ts.isVariableDeclaration(n) && n.initializer) {
            let init: ts.Node = n.initializer;
            if (ts.isAwaitExpression(init)) init = init.expression;

            // const body = await request.json()
            const fromRequest =
                ts.isCallExpression(init) &&
                ts.isPropertyAccessExpression(init.expression) &&
                REQUEST_READERS.has(init.expression.name.text);

            // const other = body            /  const { a, ...rest } = body
            const initRoot = ts.isIdentifier(init) ? init.text : rootName(init);
            const fromTainted = initRoot !== null && tainted.has(initRoot);

            if (fromRequest || fromTainted) {
                if (ts.isIdentifier(n.name)) {
                    tainted.add(n.name.text);
                } else if (ts.isObjectBindingPattern(n.name)) {
                    for (const el of n.name.elements) {
                        // Only the REST element carries the unlisted fields.
                        // A named binding is one field, which is the safe shape.
                        if (el.dotDotDotToken && ts.isIdentifier(el.name)) {
                            tainted.add(el.name.text);
                        }
                    }
                }
            }
        }
        ts.forEachChild(n, visit);
    };
    // Two passes: a `const x = body` can appear before or after the declaration
    // of `body` in nested blocks, and one pass would miss the earlier order.
    ts.forEachChild(fn, visit);
    ts.forEachChild(fn, visit);

    return tainted;
}

function scanFunctionForSpreadWrites(
    fn: ts.Node,
    source: ts.SourceFile,
    relPath: string,
    out: CallerSpreadWrite[]
) {
    const params = taintedNames(fn);
    if (params.size === 0) return;

    // `const doc = { ...data, ... }` followed by `.add(doc)` is the same write,
    // one hop away. Both real instances in this codebase were written that way,
    // so a scanner that only looked at call arguments would have found neither.
    const viaVariable = new Map<string, Omit<CallerSpreadWrite, "file">>();

    const visit = (n: ts.Node) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
            const init = unwrap(n.initializer);
            if (ts.isObjectLiteralExpression(init)) {
                const info = callerSpreadLiteral(init, params, source);
                if (info) viaVariable.set(n.name.text, info);
            }
        }

        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
            if (WRITE_METHODS.has(n.expression.name.text)) {
                for (const rawArg of n.arguments) {
                    const arg = unwrap(rawArg);
                    if (ts.isObjectLiteralExpression(arg)) {
                        const info = callerSpreadLiteral(arg, params, source);
                        if (info) out.push({ file: relPath, ...info });
                    } else if (ts.isIdentifier(arg) && viaVariable.has(arg.text)) {
                        out.push({ file: relPath, ...viaVariable.get(arg.text)! });
                    }
                }
            }
        }

        ts.forEachChild(n, visit);
    };
    ts.forEachChild(fn, visit);
}

export function scanFileForCallerSpreadWrites(filePath: string, srcDir: string): CallerSpreadWrite[] {
    const source = ts.createSourceFile(
        filePath,
        readFileSync(filePath, "utf-8"),
        ts.ScriptTarget.Latest,
        true
    );
    const relPath = relative(srcDir, filePath).split(/[\\/]/).join("/");
    const out: CallerSpreadWrite[] = [];

    const visit = (node: ts.Node) => {
        if (ts.isFunctionDeclaration(node)) {
            scanFunctionForSpreadWrites(node, source, relPath, out);
        } else if (
            ts.isVariableDeclaration(node) &&
            node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) {
            scanFunctionForSpreadWrites(node.initializer, source, relPath, out);
        }
        ts.forEachChild(node, visit);
    };

    visit(source);

    // One entry per literal: a literal handed to a write AND assigned to a name
    // would otherwise be reported twice.
    const seen = new Set<string>();
    return out.filter((h) => {
        const key = `${h.file}:${h.line}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function scanForCallerSpreadWrites(dirs: string[], srcDir: string): CallerSpreadWrite[] {
    return dirs
        .flatMap((d) => collectActionFiles(d))
        .flatMap((f) => scanFileForCallerSpreadWrites(f, srcDir))
        .sort((a, b) => (a.file + String(a.line).padStart(6, "0")).localeCompare(b.file + String(b.line).padStart(6, "0")));
}
