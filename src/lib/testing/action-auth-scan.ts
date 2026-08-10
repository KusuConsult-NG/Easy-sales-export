/**
 * Find server-action functions that never call an authorisation guard.
 *
 * WHY THIS EXISTS
 * ---------------
 * `action-security-audit.test.ts` checks that an action FILE imports
 * `requireSession`. That is file-level, and a file can import the guard and
 * still contain functions that never call it. It is exactly how the vendor
 * defects survived: `vendor.ts` imports the guard, four functions take an id and
 * write to it, and only one of them checked ownership. The file passed.
 *
 * This walks each function body instead of the file text.
 *
 * WHY THE COMPILER AND NOT A REGEX
 * --------------------------------
 * The thing being replaced was a regex over whole-file text. A regex cannot tell
 * which function a `requireSession()` call sits in, cannot see that a wrapper
 * delegates to a guarded helper, and reads guards inside comments and strings as
 * real. Every false negative in the old check came from one of those.
 *
 * WHAT COUNTS AS GUARDED
 * ----------------------
 * A function is guarded if its own body calls a guard, OR if it delegates to
 * another function in the same file that is guarded. The delegation case is not
 * optional: the `withSafeAction("x", _x)` idiom used throughout this codebase
 * means the exported symbol is a wrapper and the guard lives in `_x`.
 *
 * WHAT THIS DOES NOT PROVE
 * ------------------------
 * That the guard is CORRECT. `vendor.ts` called `requireSession` in all four
 * functions; three then used the session only to write an audit row — recording
 * who acted without deciding whether they may. Ownership checks are a different
 * property and this scan cannot see them. It catches the absence of a guard, not
 * a guard that does nothing.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import * as ts from "typescript";

/** Calls that establish who the caller is. */
const GUARD_NAMES = new Set([
    "requireSession",
    "requireAdmin",
    "auth",
    "getServerSession",
    "getSession",
    "requireRole",
    "requireCronSecret",
]);

export interface UnguardedFunction {
    /** Path relative to src/, e.g. "app/actions/vendor.ts". */
    file: string;
    /** The function's name as written. */
    name: string;
}

/** Every .ts file under a directory, excluding barrels. */
export function collectActionFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        if (statSync(fullPath).isDirectory()) {
            files.push(...collectActionFiles(fullPath));
        } else if (entry.endsWith(".ts") && !entry.startsWith("index")) {
            files.push(fullPath);
        }
    }
    return files;
}

/** The identifier being called, for both `f()` and `obj.f()`. */
function calleeName(node: ts.CallExpression): string | null {
    const { expression } = node;
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    return null;
}

/** Every function-ish node in a file, named where a name can be determined. */
function collectFunctions(source: ts.SourceFile): Map<string, ts.Node> {
    const functions = new Map<string, ts.Node>();

    function visit(node: ts.Node) {
        if (ts.isFunctionDeclaration(node) && node.name) {
            functions.set(node.name.text, node);
        } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            // `const x = async () => {}` and `const x = function () {}`.
            if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
                functions.set(node.name.text, node.initializer);
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(source);
    return functions;
}

/**
 * Names a function body reaches: what it calls, plus any identifier it passes
 * as an argument.
 *
 * The argument half is not optional. The dominant idiom here is
 *
 *     return withFlexibleSafeAction("createDisputeAction", _createDisputeAction)(params);
 *
 * where the real implementation is an ARGUMENT, never a callee. Collecting only
 * callees reported 90 functions as unguarded, almost all of them wrappers whose
 * implementation is properly guarded one line away.
 *
 * The trade this makes: a function that merely mentions a guarded function
 * without invoking it is treated as guarded. That is a missed detection rather
 * than a false alarm, which is the right way round — a checker that cries wolf
 * gets switched off, and this one is meant to survive.
 */
function referencedWithin(node: ts.Node): Set<string> {
    const referenced = new Set<string>();
    function visit(n: ts.Node) {
        if (ts.isCallExpression(n)) {
            const name = calleeName(n);
            if (name) referenced.add(name);
            for (const arg of n.arguments) {
                if (ts.isIdentifier(arg)) referenced.add(arg.text);
            }
        }
        ts.forEachChild(n, visit);
    }
    ts.forEachChild(node, visit);
    return referenced;
}

/**
 * Functions in `file` that are exported and never reach a guard.
 *
 * Delegation is followed transitively, with a visited set — a wrapper calling a
 * wrapper calling the guarded implementation is guarded, and a cycle terminates
 * rather than hanging the test run.
 */
export function scanFile(filePath: string, srcDir: string): UnguardedFunction[] {
    const content = readFileSync(filePath, "utf-8");
    const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

    const functions = collectFunctions(source);
    const callsByFunction = new Map<string, Set<string>>();
    for (const [name, node] of functions) {
        callsByFunction.set(name, referencedWithin(node));
    }

    function isGuarded(name: string, seen: Set<string>): boolean {
        if (seen.has(name)) return false;
        seen.add(name);

        const calls = callsByFunction.get(name);
        if (!calls) return false;

        for (const called of calls) {
            if (GUARD_NAMES.has(called)) return true;
            // Delegating to a guarded function in the same file counts. This is
            // the withSafeAction("x", _x) idiom: the export is a wrapper and the
            // guard lives in the implementation it names.
            if (functions.has(called) && isGuarded(called, seen)) return true;
        }
        return false;
    }

    /** Names referenced anywhere in a call position, used to link wrappers. */
    const exported = new Set<string>();

    function visitExports(node: ts.Node) {
        const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
        const isExported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

        if (isExported && ts.isFunctionDeclaration(node) && node.name) {
            exported.add(node.name.text);
        }
        if (isExported && ts.isVariableStatement(node)) {
            for (const decl of node.declarationList.declarations) {
                if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;

                // `export const x = withSafeAction("x", _x)` — the guard lives in
                // the argument, so the wrapper is judged by what it wraps.
                if (ts.isCallExpression(decl.initializer)) {
                    const args = decl.initializer.arguments
                        .filter(ts.isIdentifier)
                        .map((a) => a.text)
                        .filter((a) => functions.has(a));

                    if (args.length > 0) {
                        // Judge the wrapped implementation under the export's name.
                        if (!args.some((a) => isGuarded(a, new Set()))) {
                            exported.add(decl.name.text);
                            callsByFunction.set(decl.name.text, new Set(args));
                            functions.set(decl.name.text, decl.initializer);
                        }
                        continue;
                    }
                }
                if (functions.has(decl.name.text)) exported.add(decl.name.text);
            }
        }
        ts.forEachChild(node, visitExports);
    }
    visitExports(source);

    const relPath = relative(srcDir, filePath).split(/[\\/]/).join("/");
    const unguarded: UnguardedFunction[] = [];

    for (const name of exported) {
        if (!isGuarded(name, new Set())) {
            unguarded.push({ file: relPath, name });
        }
    }

    return unguarded.sort((a, b) => a.name.localeCompare(b.name));
}

/** Every unguarded exported action across a directory tree. */
export function scanDirectory(actionsDir: string, srcDir: string): UnguardedFunction[] {
    return collectActionFiles(actionsDir)
        .flatMap((file) => scanFile(file, srcDir))
        .sort((a, b) => (a.file + a.name).localeCompare(b.file + b.name));
}

/** "app/actions/vendor.ts::updateStock" — stable across runs, for the baseline. */
export function keyOf(fn: UnguardedFunction): string {
    return `${fn.file}::${fn.name}`;
}
