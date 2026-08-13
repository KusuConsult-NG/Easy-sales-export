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


/**
 * Status values a collection is QUERIED for that nothing ever WRITES.
 *
 * The next question along from field-name drift, and it found two live wrong
 * numbers on admin dashboards:
 *
 *   ESCROW_TRANSACTIONS  counted `status == "completed"`. An escrow is never
 *                        completed — pending, funded, released, refunded,
 *                        disputed — so the figure was structurally always 0
 *                        however many had been paid out. `completed` survived
 *                        review because it IS written a few lines away, to the
 *                        wallet and ledger rows an escrow release creates.
 *
 *   LAND_LISTINGS        counted `status == "pending"` as an approval backlog.
 *                        `pending` is written, which is why no
 *                        field-existence check catches this — it just means
 *                        something else: farm-nation sets it when a buyer
 *                        RESERVES a listing. The review queue is
 *                        `pending_verification`, which two other screens
 *                        correctly use.
 *
 * So the check is not "is this field written" but "is this VALUE written". A
 * query for a value no writer produces returns nothing, forever, silently.
 *
 * LIMITS, STATED
 * --------------
 * It only sees string literals on both sides. A status held in a constant, or
 * built from a variable, is invisible — and a value written by a migration or
 * seeded by hand exists in the data while appearing nowhere in the source, which
 * is why this reports leads rather than failing a build.
 */
export interface StatusDrift {
    collection: string;
    queried: string;
    queriedAt: string[];
    writtenValues: string[];
}

export function statusVocabularyDrift(): StatusDrift[] {
    const written = new Map<string, Set<string>>();
    const queried = new Map<string, Map<string, string[]>>();

    for (const file of sourceFiles()) {
        const src = readFileSync(file, "utf-8");
        if (!src.includes("COLLECTIONS.")) continue;
        const rel = relative(ROOT, file).split(/[\\/]/).join("/");
        const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);

        const refCollections = new Map<string, string>();
        const collectRefs = (n: ts.Node) => {
            if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
                const c = collectionIn(n.initializer);
                if (c) refCollections.set(n.name.text, c);
            }
            ts.forEachChild(n, collectRefs);
        };
        collectRefs(sf);

        const resolve = (expr: ts.Node): string | null => {
            const inline = collectionIn(expr);
            if (inline) return inline;
            let root: ts.Node = expr;
            while (ts.isCallExpression(root) || ts.isPropertyAccessExpression(root)) {
                root = (root as any).expression;
            }
            return ts.isIdentifier(root) ? refCollections.get(root.text) ?? null : null;
        };

        // Status literals named anywhere in this file, and the collections the
        // file writes. They are matched file-wide rather than per call.
        //
        // Per-payload matching was the first attempt and it reported correct
        // code, which is worse than reporting nothing. A status is very often
        // NOT a literal in the write: `claimStatusTransition(..., { to:
        // "released" })` sets it through a helper, and `update({ status })`
        // takes it from a variable. Both were flagged as "never written" —
        // including, for `released`, the fix this scanner was written to
        // support.
        //
        // File-wide is coarser and its failure direction is a missed lead rather
        // than a false accusation, which is the right way round for a tool
        // people have to trust enough to read.
        const fileStatusLiterals = new Set<string>();
        const filesCollections = new Set<string>();

        const collectStatusLiterals = (n: ts.Node) => {
            if (
                ts.isPropertyAssignment(n) &&
                ts.isIdentifier(n.name) &&
                (n.name.text === "status" || n.name.text === "to" || n.name.text === "from") &&
                ts.isStringLiteral(n.initializer)
            ) {
                fileStatusLiterals.add(n.initializer.text);
            }
            // `x.status = "y"`
            if (
                ts.isBinaryExpression(n) &&
                n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                ts.isPropertyAccessExpression(n.left) &&
                n.left.name.text === "status" &&
                ts.isStringLiteral(n.right)
            ) {
                fileStatusLiterals.add(n.right.text);
            }
            // A status very often arrives as a union-typed PARAMETER —
            //     moderateReviewAction(id, status: "approved" | "rejected")
            // and is written with `{ status }`. Those literals appear only in
            // the type annotation, so without this the scanner reported
            // "approved" as never written for PRODUCT_REVIEWS, SELLER_REVIEWS
            // and PRODUCTS. All three were correct code.
            if (ts.isUnionTypeNode(n)) {
                for (const member of n.types) {
                    if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
                        fileStatusLiterals.add(member.literal.text);
                    }
                }
            }
            ts.forEachChild(n, collectStatusLiterals);
        };
        collectStatusLiterals(sf);

        const visit = (n: ts.Node) => {
            if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
                const method = n.expression.name.text;

                // Which collections does this FILE write?
                if (WRITE_METHODS.has(method)) {
                    const collection = resolve(n.expression);
                    if (collection) filesCollections.add(collection);
                }

                // Queried: `.where("status", "==", "x")`.
                if (method === "where") {
                    const [field, op, value] = n.arguments;
                    if (
                        field && ts.isStringLiteral(field) && field.text === "status" &&
                        op && ts.isStringLiteral(op) && op.text === "==" &&
                        value && ts.isStringLiteral(value)
                    ) {
                        const collection = resolve(n.expression);
                        if (collection) {
                            if (!queried.has(collection)) queried.set(collection, new Map());
                            const perValue = queried.get(collection)!;
                            const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
                            perValue.set(value.text, [...(perValue.get(value.text) ?? []), `${rel}:${line}`]);
                        }
                    }
                }
            }
            ts.forEachChild(n, visit);
        };
        visit(sf);

        for (const collection of filesCollections) {
            if (!written.has(collection)) written.set(collection, new Set());
            for (const value of fileStatusLiterals) written.get(collection)!.add(value);
        }
    }

    const drift: StatusDrift[] = [];
    for (const [collection, values] of queried) {
        const writes = written.get(collection);
        // A collection with no literal status write anywhere tells us nothing —
        // its statuses may all come from constants or from data.
        if (!writes || writes.size === 0) continue;

        for (const [value, sites] of values) {
            if (!writes.has(value)) {
                drift.push({
                    collection,
                    queried: value,
                    queriedAt: sites,
                    writtenValues: [...writes].sort(),
                });
            }
        }
    }

    return drift.sort((a, b) => (a.collection + a.queried).localeCompare(b.collection + b.queried));
}
