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
 * to parameter-rooted spreads took the count from 13 to 0 — and 0 is the
 * correct answer, which the noisier version would have buried.
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
    const params = parameterNames(fn);
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
