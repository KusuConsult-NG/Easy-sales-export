/**
 * Find authorisation checks that compare a record against a value the CALLER
 * supplied.
 *
 * THE PATTERN
 * -----------
 * From land-listings.ts, fixed 2026-08-11:
 *
 *     async function _submitForVerificationAction(listingId, ownerId) {
 *         const listingData = listingDoc.data();
 *         if (listingData.ownerId !== ownerId) {          // <- ownerId is a PARAMETER
 *             return { error: "Unauthorized" };
 *         }
 *
 * The check compares the record's owner to an argument. Pass the real owner's
 * id — readable from the public listing — and it passes.
 *
 * **This is worse than having no check at all, because it reads as one.** A
 * reviewer sees an `Unauthorized` branch and stops looking. The two existing
 * scanners both wave it through:
 *
 *   action-auth-scan     asks "is a guard called?"  — sometimes one is
 *   ownership-scan       asks "is the session used?" — a comparison exists, so
 *                        it counts as a decision
 *
 * This asks the third question: **is the thing being compared against something
 * the caller controls?**
 *
 * WHAT COUNTS AS TRUSTWORTHY
 * --------------------------
 * A value is trusted if it derives from the session — `session.user.id`,
 * `sessionResult.session.user.id`, or a local assigned from one. Everything a
 * function receives as a parameter is untrusted, including properties of a
 * parameter object (`data.ownerId`).
 *
 * A comparison is only flagged when BOTH sides are untrusted and the field name
 * looks like an identity. Comparing two record fields to each other is normal
 * and is not an authorisation claim.
 *
 * LIKE ownership-scan, THIS IS A LEAD LIST
 * ----------------------------------------
 * A function can legitimately compare two request values — deduplication, form
 * validation, "is this the same item". Read what it finds; do not gate a build
 * on it.
 */

import { readFileSync } from "fs";
import { relative } from "path";
import * as ts from "typescript";
import { collectActionFiles } from "./action-auth-scan";

/** Field names whose comparison is plausibly an authorisation decision. */
const IDENTITY_FIELD = /\b(userid|ownerid|sellerid|buyerid|memberid|initiatorid|createdby|uid|accountid|customerid)\b/i;

export interface FakeGuardLead {
    file: string;
    fn: string;
    /** The comparison as written. */
    code: string;
    line: number;
}

function textOf(node: ts.Node): string {
    try {
        return node.getText();
    } catch {
        return "";
    }
}

/** Root identifier of `a.b.c` → "a"; of `a` → "a". */
function rootName(node: ts.Node): string | null {
    let cur = node;
    while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
    return ts.isIdentifier(cur) ? cur.text : null;
}

/**
 * Locals assigned, directly or transitively, from a session.
 *
 * Covers `const userId = session.user.id`, the destructured
 * `const { session } = sessionResult`, and `const uid = session?.user?.id`.
 */
function sessionDerivedNames(fn: ts.Node): Set<string> {
    const names = new Set<string>(["session", "sessionResult"]);
    let changed = true;

    // Repeat to a fixed point so a chain of assignments resolves.
    while (changed) {
        changed = false;
        const visit = (n: ts.Node) => {
            if (ts.isVariableDeclaration(n) && n.initializer) {
                const init = textOf(n.initializer);
                const mentionsSession =
                    /\bsession\b/i.test(init) ||
                    [...names].some((v) => new RegExp(`\\b${v}\\b`).test(init));

                if (mentionsSession) {
                    if (ts.isIdentifier(n.name) && !names.has(n.name.text)) {
                        names.add(n.name.text);
                        changed = true;
                    }
                    // const { session } = sessionResult  /  const { id } = session.user
                    if (ts.isObjectBindingPattern(n.name)) {
                        for (const el of n.name.elements) {
                            if (ts.isIdentifier(el.name) && !names.has(el.name.text)) {
                                names.add(el.name.text);
                                changed = true;
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

/** Parameter names, including the object parameter itself (`data`). */
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

/**
 * Parameters that have already been compared against a session value.
 *
 * The good idiom pins the argument once and then uses it freely:
 *
 *     if (session.user.id !== userId) return { error: "Unauthorized" };
 *     ...
 *     if (cert.userId !== userId) return { error: "Unauthorized" };   // fine
 *
 * The second line looks identical to the defect but is not, because `userId` has
 * been proven to be the caller. Reading comparisons in isolation flags it, which
 * is what the first version of this scanner did — `deleteCertificateAction` and
 * `_sendEscrowMessageAction` were both reported and both correct.
 */
function pinnedParameters(fn: ts.Node, trusted: Set<string>, params: Set<string>): Set<string> {
    const pinned = new Set<string>();
    const visit = (n: ts.Node) => {
        if (ts.isBinaryExpression(n)) {
            const l = rootName(n.left);
            const r = rootName(n.right);
            const lTrusted = l ? trusted.has(l) : false;
            const rTrusted = r ? trusted.has(r) : false;

            // One side from the session, the other a parameter → that parameter
            // is now as good as the session for the rest of the function.
            if (lTrusted && r && params.has(r)) pinned.add(textOf(n.right));
            if (rTrusted && l && params.has(l)) pinned.add(textOf(n.left));
        }
        ts.forEachChild(n, visit);
    };
    ts.forEachChild(fn, visit);
    return pinned;
}

function scanFunction(
    fn: ts.Node,
    fnName: string,
    source: ts.SourceFile,
    relPath: string,
    out: FakeGuardLead[]
) {
    const trusted = sessionDerivedNames(fn);
    const params = parameterNames(fn);
    if (params.size === 0) return;

    const pinned = pinnedParameters(fn, trusted, params);

    const visit = (n: ts.Node) => {
        if (ts.isBinaryExpression(n)) {
            const op = n.operatorToken.kind;
            const isCompare =
                op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
                op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
                op === ts.SyntaxKind.ExclamationEqualsToken ||
                op === ts.SyntaxKind.EqualsEqualsToken;

            if (isCompare) {
                const whole = `${textOf(n.left)} ${textOf(n.right)}`;
                if (IDENTITY_FIELD.test(whole)) {
                    const roots = [rootName(n.left), rootName(n.right)];
                    const anyTrusted = roots.some((r) => r && trusted.has(r));
                    const anyParam = roots.some((r) => r && params.has(r));

                    // Both sides from the SAME request object is validation, not
                    // an authorisation claim. _createEscrowAction's
                    // `data.sellerId === data.buyerId` says a seller may not be
                    // their own buyer; there is no record in it to be fooled
                    // about. An authorisation check always compares something
                    // stored against something supplied.
                    const sameParamObject =
                        roots[0] !== null && roots[0] === roots[1] && params.has(roots[0]);
                    if (sameParamObject) {
                        ts.forEachChild(n, visit);
                        return;
                    }
                    // `data.senderId` pinned earlier makes this comparison sound.
                    const anyPinned = [textOf(n.left), textOf(n.right)].some((t) => pinned.has(t));

                    // Flagged only when a parameter is involved, nothing in the
                    // comparison came from the session, and the parameter was
                    // never pinned to the session earlier in the function.
                    if (!anyTrusted && !anyPinned && anyParam) {
                        const { line } = source.getLineAndCharacterOfPosition(n.getStart());
                        out.push({
                            file: relPath,
                            fn: fnName,
                            code: textOf(n).replace(/\s+/g, " ").slice(0, 100),
                            line: line + 1,
                        });
                    }
                }
            }
        }
        ts.forEachChild(n, visit);
    };
    ts.forEachChild(fn, visit);
}

export function scanFileForFakeGuards(filePath: string, srcDir: string): FakeGuardLead[] {
    const content = readFileSync(filePath, "utf-8");
    const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const relPath = relative(srcDir, filePath).split(/[\\/]/).join("/");
    const out: FakeGuardLead[] = [];

    const visit = (node: ts.Node) => {
        if (ts.isFunctionDeclaration(node) && node.name) {
            scanFunction(node, node.name.text, source, relPath, out);
        } else if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) {
            scanFunction(node.initializer, node.name.text, source, relPath, out);
        }
        ts.forEachChild(node, visit);
    };

    visit(source);
    return out;
}

export function scanForFakeGuards(actionsDir: string, srcDir: string): FakeGuardLead[] {
    return collectActionFiles(actionsDir)
        .flatMap((f) => scanFileForFakeGuards(f, srcDir))
        .sort((a, b) => (a.file + a.fn).localeCompare(b.file + b.fn));
}
