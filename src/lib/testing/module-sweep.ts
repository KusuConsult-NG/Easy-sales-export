/**
 * Every server-side entry point, grouped by BUSINESS MODULE.
 *
 * WHY GROUPING BY MODULE FINDS THINGS THE OTHER SCANNERS DO NOT
 * -------------------------------------------------------------
 * The other three scanners each ask one question of one function. This asks a
 * different kind of question: within a business module, does one endpoint differ
 * from its siblings?
 *
 * That is how autoEnrollPaidUser was found. It sat in the unguarded baseline
 * among catalogue reads and read like one of them; beside getCoursesAction under
 * "academy", "auto-enrol" stopped looking like a query.
 *
 * And it is how _syncShipmentWithCarrierAction was found: every other WAVE
 * endpoint requires a session, and that one took an id and required nothing —
 * while calling the logistics provider on each invocation and writing the result
 * to the shipment.
 *
 * WHAT IT GETS WRONG IF YOU DO NOT TELL IT
 * ---------------------------------------
 * Two corrections, both made after the first run reported careful code:
 *
 *   Delegating wrappers. `export async function foo(...args) { return
 *   withFlexibleSafeAction("foo", _foo)(...args) }` holds no guard of its own.
 *   Three wave/_admin functions were reported as unguarded for this reason; all
 *   three were wrappers around guarded implementations.
 *
 *   Guards behind a helper. my-data.ts routes every function through a one-line
 *   currentUserId() that calls requireSession, so all sixteen looked unguarded —
 *   including deleteMyNotification, which is in fact careful: session, ownership
 *   check, and "not found" on a cross-user id.
 *
 * Both are handled. A sweep that reports correct code teaches people to ignore
 * it, which is worse than not running it.
 *
 * IT IS A LEAD LIST, NOT A DEFECT LIST
 * ------------------------------------
 * Same as ownership-scan. Callbacks legitimately have no session; a member
 * paying their own contribution legitimately has no role check. Read the module,
 * then read the outlier.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import * as ts from "typescript";
import { scanDirectory } from "@/lib/testing/action-auth-scan";
import { scanForOwnership } from "@/lib/testing/ownership-scan";
import { scanForFakeGuards } from "@/lib/testing/fake-guard-scan";

const ROOT = process.cwd();

/** Every server action file and every API route handler. */
function entryFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
        }
    };
    walk(join(ROOT, "src/app/actions"));
    walk(join(ROOT, "src/app/api"));
    return out;
}

const MODULE_RULES: Array<[RegExp, string]> = [
    [/wave/i, "wave"],
    [/cooperative|coop/i, "cooperative"],
    [/marketplace|vendor|product|order|cart|escrow|dispute|review/i, "marketplace"],
    [/export/i, "export"],
    [/academy|course|lesson|certificate|enroll/i, "academy"],
    [/farm-nation|farm_nation|land|property/i, "farm-nation"],
    [/loan/i, "loans"],
    [/wallet|payment|paystack|payout|withdraw|transaction|refund/i, "money"],
    [/auth|login|register|password|session|account|kyc|onboard|mfa/i, "identity"],
    [/admin|forensic|audit|bulk-user|impersonat/i, "admin"],
    [/notification|message|sms|email|broadcast|chat|briefing|announce|cms|banner/i, "comms"],
];

function moduleOf(relPath: string, fnName: string): string {
    const hay = `${relPath} ${fnName}`;
    for (const [pattern, name] of MODULE_RULES) if (pattern.test(hay)) return name;
    return "other";
}

interface Entry {
    file: string;
    name: string;
    kind: "action" | "route";
    guarded: boolean;
    roleChecked: boolean;
    writes: boolean;
    takesId: boolean;
    touches: string[];
    flags: string[];
}

const MONEY_COLLECTIONS = /WALLET|PAYMENT|ESCROW|LOAN|CONTRIBUTION|WITHDRAWAL|TRANSACTION|PAYOUT|REVENUE|SAVINGS/;

function analyse(file: string): Entry[] {
    const src = readFileSync(file, "utf-8");
    const rel = relative(ROOT, file).split(/[\\/]/).join("/");
    const isRoute = rel.includes("/api/");
    if (!isRoute && !src.includes('"use server"') && !src.includes("'use server'")) return [];

    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const entries: Entry[] = [];

    /**
     * Local helpers whose body reaches a session guard.
     *
     * my-data.ts routes every function through a one-line `currentUserId()`
     * that calls requireSession. Without following that, all sixteen of its
     * functions looked unguarded — including `deleteMyNotification`, which is in
     * fact correct: session, ownership check, and "not found" on a cross-user
     * id. A sweep that cannot see one level of indirection reports careful code
     * as the defect.
     */
    const guardingHelpers = new Set<string>();

    // Walked, not matched with a regex.
    //
    // This was `/function\s+(\w+)\([^)]*\)[^{]*\{([\s\S]{0,400}?)\n\}/`, which
    // only sees a helper whose body fits in 400 characters. Adding a comment to
    // currentUserId() pushed it over, the helper stopped being recognised, and
    // all sixteen of my-data.ts's functions were reported unguarded again — by
    // documentation, with the guard untouched. A detector that answers
    // differently depending on how much prose sits above the code is not
    // measuring what it claims to.
    //
    // The file is already parsed above for everything else, so the same tree
    // answers this exactly and with no length limit. Arrow functions assigned
    // to a const are included; the regex never saw those at all.
    const GUARD_CALLEES = /^(requireSession|requireAdmin|auth|getServerSession)$/;

    const bodyCallsGuard = (node: ts.Node): boolean => {
        let found = false;
        const visit = (n: ts.Node) => {
            if (found) return;
            if (ts.isCallExpression(n)) {
                const callee = ts.isPropertyAccessExpression(n.expression)
                    ? n.expression.name.text
                    : ts.isIdentifier(n.expression) ? n.expression.text : '';
                if (GUARD_CALLEES.test(callee)) { found = true; return; }
            }
            ts.forEachChild(n, visit);
        };
        ts.forEachChild(node, visit);
        return found;
    };

    const collectHelpers = (node: ts.Node) => {
        // function currentUserId() { ... }
        if (ts.isFunctionDeclaration(node) && node.name && node.body) {
            if (bodyCallsGuard(node.body)) guardingHelpers.add(node.name.text);
        }
        // const currentUserId = async () => { ... }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            const init = node.initializer;
            if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.body) {
                if (bodyCallsGuard(init.body)) guardingHelpers.add(node.name.text);
            }
        }
        ts.forEachChild(node, collectHelpers);
    };
    collectHelpers(sf);

    // Names this module actually exports, however they are declared.
    const exportedNames = new Set<string>();
    for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)/gm)) {
        exportedNames.add(m[1]);
    }

    const visit = (node: ts.Node) => {
        let name: string | null = null;
        let fnNode: ts.Node | null = null;

        if (ts.isFunctionDeclaration(node) && node.name) {
            const exported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
            if (exported || node.name.text.startsWith("_")) { name = node.name.text; fnNode = node; }
        } else if (
            ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) {
            name = node.name.text; fnNode = node.initializer;
        }

        if (name && fnNode) {
            // A delegating wrapper — `export async function foo(...args) {
            // return withFlexibleSafeAction("foo", _foo)(...args) }` — carries no
            // guard of its own and must not be reported as unguarded. The guard
            // lives in the _foo it delegates to, which is analysed separately.
            //
            // The first run of this sweep flagged three wave/_admin functions as
            // NO-SESSION for exactly this reason. All three were wrappers.
            const body = (fnNode as any).body ? (fnNode as any).body.getText() : "";
            const isDelegatingWrapper = /return\s+with\w*SafeAction\(/.test(body) && body.length < 400;

            // Pure local helpers are not endpoints. Only exported names, route
            // handlers, and the _-prefixed implementations behind wrappers.
            const isEndpoint = isRoute
                ? /^(GET|POST|PUT|PATCH|DELETE)$/.test(name) || /Handler$/.test(name)
                : name.startsWith("_") || exportedNames.has(name);

            if (isEndpoint && !isDelegatingWrapper) {
                let guarded = false, roleChecked = false, writes = false, takesId = false;
                const touches = new Set<string>();

                const params = (fnNode as any).parameters as ts.NodeArray<ts.ParameterDeclaration> | undefined;
                if (params) for (const p of params) if (/\bid\b|id[:?)]|ids\b/i.test(p.getText())) takesId = true;

                const walk = (n: ts.Node) => {
                    if (ts.isCallExpression(n)) {
                        const callee = ts.isPropertyAccessExpression(n.expression)
                            ? n.expression.name.text
                            : ts.isIdentifier(n.expression) ? n.expression.text : "";
                        if (/^(requireSession|auth|getServerSession|requireAdmin)$/.test(callee)) guarded = true;
                        if (guardingHelpers.has(callee)) guarded = true;
                        if (/^(isAdmin|hasRole|hasAdminPermission|requireAdmin|hasPermission|isSuperAdmin)$/.test(callee)) roleChecked = true;
                        if (/^(update|set|delete|add|create|commit|increment)$/.test(callee)) writes = true;
                    }
                    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "COLLECTIONS") {
                        touches.add(n.name.text);
                    }
                    if (ts.isPropertyAccessExpression(n) && n.name.text === "roles") roleChecked = true;
                    if (ts.isStringLiteral(n) && /^(admin|super_admin)$/.test(n.text)) roleChecked = true;
                    ts.forEachChild(n, walk);
                };
                ts.forEachChild(fnNode, walk);

                const flags: string[] = [];
                // Webhooks and cron jobs do not carry a user session by nature;
                // they authenticate by signature or a shared secret. Flagged as
                // their own thing so they do not drown the list.
                const isCallback = /\/api\/(webhooks|cron)\//.test(rel);
                if (!guarded && !isCallback) flags.push("NO-SESSION");
                if (isCallback && !/signature|secret|CRON|verifyPaystack|createHmac|timingSafeEqual/i.test(src)) {
                    flags.push("CALLBACK-UNVERIFIED");
                }
                if (writes && !roleChecked && takesId) flags.push("writes-by-id");
                if ([...touches].some((c) => MONEY_COLLECTIONS.test(c))) flags.push("MONEY");

                entries.push({
                    file: rel, name, kind: isRoute ? "route" : "action",
                    guarded, roleChecked, writes, takesId,
                    touches: [...touches].sort(), flags,
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return entries;
}


export interface ModuleGroup {
    module: string;
    entries: Entry[];
}

export type { Entry as ModuleEntry };

/** Does this entry's combination of facts warrant reading? */
export function isLead(e: Entry): boolean {
    return (
        (e.flags.includes("NO-SESSION") && e.writes) ||
        (e.flags.includes("MONEY") && !e.roleChecked) ||
        e.flags.includes("CALLBACK-UNVERIFIED") ||
        e.flags.includes("ownership-lead") ||
        e.flags.includes("fake-guard")
    );
}

export function sweepByModule(): ModuleGroup[] {
    const all = entryFiles().flatMap(analyse);

    const ownership = new Set(scanForOwnership("src/app/actions", "src").map((l) => `${l.file}::${l.name}`));
    const fake = new Set(scanForFakeGuards("src/app/actions", "src").map((l: any) => `${l.file}::${l.name}`));
    const unguarded = new Set(
        scanDirectory(join(ROOT, "src/app/actions"), join(ROOT, "src")).map((f: any) => `${f.file}::${f.name}`)
    );

    const byModule = new Map<string, Entry[]>();
    for (const e of all) {
        const key = `${e.file.replace(/^src\//, "")}::${e.name}`;
        if (ownership.has(key)) e.flags.push("ownership-lead");
        if (fake.has(key)) e.flags.push("fake-guard");
        if (unguarded.has(key)) e.flags.push("baseline-unguarded");
        const m = moduleOf(e.file, e.name);
        if (!byModule.has(m)) byModule.set(m, []);
        byModule.get(m)!.push(e);
    }

    return [...byModule]
        .map(([module, entries]) => ({ module, entries }))
        .sort((a, b) => a.module.localeCompare(b.module));
}
