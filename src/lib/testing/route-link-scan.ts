/**
 * Find internal links that point at routes which do not exist.
 *
 * THE DEFECT CLASS
 * ----------------
 * _submitQuoteRequestAction notified a seller with a link to
 * `/marketplace/seller/quotes/{id}`. That route did not exist, nor did its
 * parent, nor `/marketplace/buyer/quotes`, which the same function's
 * revalidatePath named. Every RFQ notification a seller ever received led to a
 * 404, and nothing failed anywhere — a dead internal link is invisible to the
 * type checker, to the linter, and to every test that does not click it.
 *
 * That was found by reading one function. This finds the rest.
 *
 * WHAT COUNTS AS A LINK
 * ---------------------
 * A string literal starting with "/" that appears as a Link href, a
 * router.push/replace target, a `link:` field on a notification, or a
 * revalidatePath argument. Template literals are included with their `${...}`
 * holes treated as a single dynamic segment, since that is what they are.
 *
 * WHAT DOES NOT
 * -------------
 * - `/api/...` — route handlers, matched against route.ts instead.
 * - Anything with a `.` in the last segment (a file, not a route).
 * - Bare "/" and "#..." fragments.
 * - Non-literal expressions. A link built from a variable cannot be resolved
 *   statically, and guessing produces false positives that get a scanner
 *   switched off.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

export interface DeadLink {
    file: string;
    line: number;
    href: string;
}

/** Every route path the app serves, as segment arrays. */
export function collectRoutes(appDir: string): string[][] {
    const routes: string[][] = [];

    const walk = (dir: string, segments: string[]) => {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }

        const hasPage = entries.includes("page.tsx") || entries.includes("page.ts");
        const hasRoute = entries.includes("route.ts") || entries.includes("route.tsx");
        if (hasPage || hasRoute) routes.push([...segments]);

        for (const entry of entries) {
            const full = join(dir, entry);
            if (!statSync(full).isDirectory()) continue;
            // Route groups and private folders are not URL segments.
            if (entry.startsWith("(") && entry.endsWith(")")) {
                walk(full, segments);
            } else if (entry.startsWith("_") || entry === "node_modules") {
                continue;
            } else {
                walk(full, [...segments, entry]);
            }
        }
    };

    walk(appDir, []);
    return routes;
}

/** Does this concrete path match a route's segment pattern? */
function matches(pathSegments: string[], route: string[]): boolean {
    // A catch-all absorbs everything from its position on.
    const catchAllAt = route.findIndex((s) => s.startsWith("[..."));
    if (catchAllAt >= 0) {
        if (pathSegments.length < catchAllAt) return false;
        return route.slice(0, catchAllAt).every((s, i) => s.startsWith("[") || s === pathSegments[i]);
    }

    if (pathSegments.length !== route.length) return false;
    return route.every((s, i) => (s.startsWith("[") && s.endsWith("]")) || s === pathSegments[i]);
}

export function isKnownRoute(href: string, routes: string[][]): boolean {
    const clean = href.split("?")[0].split("#")[0];
    const segments = clean.split("/").filter(Boolean);
    if (segments.length === 0) return routes.some((r) => r.length === 0);
    return routes.some((r) => matches(segments, r));
}

/**
 * Blanks out comments, preserving line numbers.
 *
 * Without this the scanner reports links that nothing emits. Its first run
 * flagged three `/admin/marketplace/orders/{id}` notification links — all three
 * inside commented-out `_fanOut(adminIds, {...})` blocks, so no notification was
 * ever sent to that URL. A scanner that reports dead links in dead code inflates
 * its own findings and gets switched off.
 *
 * Lines are replaced rather than removed so a reported line number still points
 * at the right place in the file.
 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
        .split("\n")
        .map((line) => {
            const trimmed = line.trimStart();
            if (trimmed.startsWith("//") || trimmed.startsWith("*")) return "";
            // A trailing `// ...` comment, but not a `//` inside a URL or string.
            const at = line.indexOf("//");
            if (at > 0 && line[at - 1] !== ":" && line[at - 1] !== "/") {
                return line.slice(0, at);
            }
            return line;
        })
        .join("\n");
}

/**
 * Link-shaped string literals in a file.
 *
 * Template holes become "[dyn]" so `/orders/${id}` is treated as a two-segment
 * path with a dynamic tail — which is exactly how Next.js will resolve it.
 */
function linksIn(source: string): Array<{ line: number; href: string }> {
    const out: Array<{ line: number; href: string }> = [];
    const lines = stripComments(source).split("\n");

    const contexts = [
        /href=\{?["'`](\/[^"'`]*)["'`]/g,
        /router\.(?:push|replace)\(\s*["'`](\/[^"'`]*)["'`]/g,
        /\blink:\s*["'`](\/[^"'`]*)["'`]/g,
        /revalidatePath\(\s*["'`](\/[^"'`]*)["'`]/g,
        /redirect\(\s*["'`](\/[^"'`]*)["'`]/g,
    ];

    lines.forEach((text, i) => {
        for (const pattern of contexts) {
            pattern.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = pattern.exec(text)) !== null) {
                const raw = m[1].replace(/\$\{[^}]*\}/g, "[dyn]");
                out.push({ line: i + 1, href: raw });
            }
        }
    });

    return out;
}

/** True for links this scanner deliberately does not judge. */
function skip(href: string): boolean {
    if (href === "/" || href.startsWith("//")) return true;
    // A file, not a route.
    const last = href.split("?")[0].split("#")[0].split("/").filter(Boolean).pop() ?? "";
    if (last.includes(".")) return true;
    // Anything still carrying an unresolvable expression.
    if (href.includes("${")) return true;
    return false;
}

export function scanFileForDeadLinks(filePath: string, srcDir: string, routes: string[][]): DeadLink[] {
    const source = readFileSync(filePath, "utf-8");
    const rel = relative(srcDir, filePath).split(/[\\/]/).join("/");

    return linksIn(source)
        .filter(({ href }) => !skip(href))
        .filter(({ href }) => !isKnownRoute(href, routes))
        .map(({ line, href }) => ({ file: rel, line, href }));
}

export function scanForDeadLinks(dirs: string[], srcDir: string, appDir: string): DeadLink[] {
    const routes = collectRoutes(appDir);
    const files: string[] = [];

    const walk = (dir: string) => {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                if (entry === "node_modules" || entry === "__tests__") continue;
                walk(full);
            } else if (/\.(tsx?|jsx?)$/.test(entry)) {
                files.push(full);
            }
        }
    };

    dirs.forEach(walk);

    const seen = new Set<string>();
    return files
        .flatMap((f) => scanFileForDeadLinks(f, srcDir, routes))
        .filter((d) => {
            const key = `${d.file}:${d.line}:${d.href}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line));
}
