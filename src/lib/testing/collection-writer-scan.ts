/**
 * Every writer of every collection, and what each one actually writes.
 *
 * WHY THIS QUESTION
 * -----------------
 * Three defects in this audit had the same shape, and none of the other
 * scanners could see any of them, because each writer is correct on its own
 * terms. The defect only exists in the relationship BETWEEN writers of one
 * collection, or between a writer and a reader:
 *
 *   announcements    cms.ts writes `content` and `targetAudience`.
 *                    admin-communications.ts writes `message` and neither of the
 *                    others. The only reader maps `content` and filters on
 *                    `targetAudience`, so every row the second writer ever
 *                    produced was invisible. (#143)
 *
 *   certificates     /api/academy/certificate/generate writes an issued
 *                    credential; uploadCertificateAction writes a file the user
 *                    attached. Three readers treated every row as the first
 *                    kind, including a PUBLIC verify endpoint that answered
 *                    isValid:true for either. (#144)
 *
 *   loan_products    the API route validates min<max, coerces numbers and stamps
 *                    createdBy. The server action wrote whatever arrived. Same
 *                    collection, and the money path reads it. (#145)
 *
 * WHAT IT LOOKS FOR
 * -----------------
 *   DIVERGENT-KEYS   one writer omits a key its siblings write. That is the
 *                    announcements shape and the certificates shape.
 *
 *   READER-EXPECTS   a field the readers of a collection actually use, that some
 *                    writer never supplies. A row from that writer is
 *                    permanently invisible or permanently mis-handled.
 *
 *   NO-PROVENANCE    a writer that stamps no createdAt/createdBy while its
 *                    siblings do. Cheap to see, and it is how #145 announced
 *                    itself.
 *
 * IT IS A LEAD LIST
 * -----------------
 * Divergence is normal: an update patches a few fields, a create writes them
 * all. The signal is a CREATE that omits what other creates include. Updates are
 * therefore tracked separately and never compared for missing keys.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import * as ts from "typescript";

const ROOT = process.cwd();

export interface WriteSite {
    file: string;
    fn: string;
    collection: string;
    kind: "create" | "update";
    keys: string[];
    line: number;
}

export interface CollectionReport {
    collection: string;
    creates: WriteSite[];
    updates: WriteSite[];
    /** Fields the readers of this collection actually consume. */
    readerFields: string[];
    findings: string[];
}

function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                if (entry === "node_modules" || entry === "__tests__") continue;
                walk(full);
            } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
        }
    };
    walk(join(ROOT, "src"));
    return out;
}

/** The COLLECTIONS.X named inside an expression, if exactly one is. */
function collectionIn(node: ts.Node): string | null {
    const found: string[] = [];
    const visit = (n: ts.Node) => {
        if (
            ts.isPropertyAccessExpression(n) &&
            ts.isIdentifier(n.expression) &&
            n.expression.text === "COLLECTIONS"
        ) {
            found.push(n.name.text);
        }
        ts.forEachChild(n, visit);
    };
    visit(node);
    return found.length === 1 ? found[0] : null;
}

/** Keys of the first object-literal argument. */
function literalKeys(call: ts.CallExpression): string[] | null {
    for (const arg of call.arguments) {
        if (ts.isObjectLiteralExpression(arg)) {
            const keys: string[] = [];
            for (const prop of arg.properties) {
                if ((ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) && prop.name) {
                    if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) keys.push(prop.name.text);
                } else if (ts.isSpreadAssignment(prop)) {
                    keys.push("...spread");
                }
            }
            return keys;
        }
        // `add(payload)` — a named object we cannot read here.
        if (ts.isIdentifier(arg)) return null;
    }
    return null;
}

const WRITE_METHODS = new Set(["add", "set", "update"]);

/**
 * Is this `.set(data, { merge: true })`?
 *
 * A merge is a PATCH, not a create. The first run of this scanner counted them
 * as creates and reported 300-odd findings, most of them a partial upsert
 * "omitting" fields it was never meant to write — auto-provision helpers,
 * payment-status syncs, profile edits. Every real finding was drowned.
 */
function isMerge(call: ts.CallExpression): boolean {
    const last = call.arguments[call.arguments.length - 1];
    return !!last && ts.isObjectLiteralExpression(last) &&
        last.properties.some((p) =>
            ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "merge");
}

export function scanWriteSites(): WriteSite[] {
    const sites: WriteSite[] = [];

    for (const file of sourceFiles()) {
        const src = readFileSync(file, "utf-8");
        if (!src.includes("COLLECTIONS.")) continue;
        const rel = relative(ROOT, file).split(/[\\/]/).join("/");
        const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);

        // `const ref = db.collection(COLLECTIONS.X)...` — so a later ref.set()
        // can be attributed. Without this most writes are unattributable, since
        // the common idiom is to take a ref first.
        const refCollections = new Map<string, string>();
        const collectRefs = (n: ts.Node) => {
            if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
                const c = collectionIn(n.initializer);
                if (c) refCollections.set(n.name.text, c);
            }
            ts.forEachChild(n, collectRefs);
        };
        collectRefs(sf);

        const enclosingFn = (node: ts.Node): string => {
            for (let n: ts.Node | undefined = node; n; n = n.parent) {
                if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
                if (ts.isVariableDeclaration(n.parent ?? n) && ts.isIdentifier((n.parent as any).name)) {
                    return (n.parent as any).name.text;
                }
            }
            return "(top level)";
        };

        const visit = (n: ts.Node) => {
            if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
                const method = n.expression.name.text;
                if (WRITE_METHODS.has(method)) {
                    // Inline chain first, then a ref resolved above.
                    let collection = collectionIn(n.expression);
                    if (!collection) {
                        let root: ts.Node = n.expression.expression;
                        while (ts.isCallExpression(root) || ts.isPropertyAccessExpression(root)) {
                            root = (root as any).expression;
                        }
                        if (ts.isIdentifier(root)) collection = refCollections.get(root.text) ?? null;
                    }

                    if (collection) {
                        const keys = literalKeys(n);
                        if (keys) {
                            sites.push({
                                file: rel,
                                fn: enclosingFn(n),
                                collection,
                                kind: method === "update" || isMerge(n) ? "update" : "create",
                                keys,
                                line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
                            });
                        }
                    }
                }
            }
            ts.forEachChild(n, visit);
        };
        visit(sf);
    }

    return sites;
}

/**
 * Fields the readers of a collection consume.
 *
 * Deliberately crude: any `.where("field", ...)` on a query naming the
 * collection, plus `data.field` reads in the same function. It exists to answer
 * one question — is there a field the code depends on that some writer never
 * supplies — and over-collecting is safer than under-collecting for that.
 */
export function readerFieldsFor(collection: string): string[] {
    const fields = new Set<string>();

    for (const file of sourceFiles()) {
        const src = readFileSync(file, "utf-8");
        if (!src.includes(`COLLECTIONS.${collection}`)) continue;

        const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
        const visit = (n: ts.Node) => {
            if (
                ts.isCallExpression(n) &&
                ts.isPropertyAccessExpression(n.expression) &&
                n.expression.name.text === "where"
            ) {
                const chain = n.expression.getText();
                const first = n.arguments[0];
                if (first && ts.isStringLiteral(first) && chain.includes(`COLLECTIONS.${collection}`)) {
                    // Nested paths and Firestore internals are not fields a
                    // writer omits; they are noise in this comparison.
                    if (!first.text.includes(".") && !first.text.startsWith("__")) {
                        fields.add(first.text);
                    }
                }
            }
            ts.forEachChild(n, visit);
        };
        visit(sf);
    }

    return [...fields].sort();
}

export function reportByCollection(): CollectionReport[] {
    const sites = scanWriteSites();
    const byCollection = new Map<string, WriteSite[]>();
    for (const s of sites) {
        if (!byCollection.has(s.collection)) byCollection.set(s.collection, []);
        byCollection.get(s.collection)!.push(s);
    }

    const PROVENANCE = /^(createdAt|createdBy|created_at|updatedAt|submittedAt|issuedAt|appliedAt|initiatedAt|uploadedAt|publishedAt|date|timestamp|joinedAt|recordedAt|sentAt)$/;

    const reports: CollectionReport[] = [];
    for (const [collection, all] of byCollection) {
        const creates = all.filter((s) => s.kind === "create");
        const updates = all.filter((s) => s.kind === "update");
        const findings: string[] = [];

        // Only meaningful with more than one independent create.
        const creatingFiles = new Set(creates.map((c) => c.file));
        const readerFields = creatingFiles.size > 1 ? readerFieldsFor(collection) : [];

        // A "create" of three fields is a stub, not a document, and comparing it
        // to a twenty-field create produces noise rather than a finding.
        const substantial = creates.filter((c) => c.keys.length >= 5);

        if (creatingFiles.size > 1 && substantial.length > 1) {
            // A key most creates write, that one omits.
            const keyCounts = new Map<string, number>();
            for (const c of substantial) {
                for (const k of new Set(c.keys)) {
                    if (k === "...spread") continue;
                    keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
                }
            }
            for (const c of substantial) {
                if (c.keys.includes("...spread")) continue;
                const missing = [...keyCounts]
                    .filter(([k, n]) => n >= substantial.length - 1 && n > 1 && !c.keys.includes(k))
                    .map(([k]) => k);
                if (missing.length > 0) {
                    findings.push(`DIVERGENT-KEYS ${c.file}:${c.line} ${c.fn} omits ${missing.join(", ")}`);
                }

                const readerNeeds = readerFields.filter((f) => !c.keys.includes(f) && f !== "id");
                if (readerNeeds.length > 0) {
                    findings.push(`READER-EXPECTS ${c.file}:${c.line} ${c.fn} never writes ${readerNeeds.join(", ")} — queried by readers`);
                }

                if (!c.keys.some((k) => PROVENANCE.test(k))) {
                    findings.push(`NO-PROVENANCE ${c.file}:${c.line} ${c.fn} stamps no timestamp`);
                }
            }
        }

        reports.push({ collection, creates, updates, readerFields, findings });
    }

    return reports.sort((a, b) => a.collection.localeCompare(b.collection));
}
