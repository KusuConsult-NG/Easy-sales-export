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

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
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

/**
 * A consent link whose text names a document, and where that document is.
 *
 *   #961 A CONSENT THAT NAMED A DOCUMENT NOBODY COULD READ.
 *
 *   The scanner above answers "does this route exist". That is not enough for a
 *   consent, and the export programme's onboarding is where the difference cost
 *   something: it asked an investor to tick
 *
 *       "I have read and agree to the Investment Terms and Conditions"
 *
 *   and linked that phrase to /terms — a route that exists, so the dead-link
 *   scan was satisfied, and which has eight sections about services, payment,
 *   intellectual property, liability, governing law and disputes, and NOT ONE
 *   WORD about investment. The same step did it again for "Escrow Service
 *   Terms", with "for fund protection" beside it.
 *
 *   A member followed the link, found no such document, and ticked the box
 *   anyway, because the box is required to continue. Four of nine such links
 *   were in that state when this was first measured.
 *
 * ── WHY THE TEXT IS THE ASSERTION ───────────────────────────────────────────
 *
 *   What a consent is worth depends on the member being able to read the thing
 *   named. So the check is: the page the link goes to must contain the words the
 *   member was shown. Crude, and it is exactly the property — a page that does
 *   not even mention the document's title certainly does not contain it.
 *
 *   It cannot tell a real document from a page that merely repeats its title,
 *   which is why the two placeholder pages under /terms state in their own words
 *   that the terms are not published yet: this scan proves the member reaches a
 *   page about the right subject, and that page is then responsible for being
 *   honest about what it does and does not contain.
 *
 *   NOT every link — only ones naming a document. "Contact us" promises nothing
 *   about its destination's contents; "Privacy Policy" does.
 */
export interface ConsentDocumentLink {
    /** src/app-relative path of the file holding the consent. */
    readonly file: string;
    readonly href: string;
    /** The words the member reads and clicks. */
    readonly label: string;
    readonly routeExists: boolean;
    /** The linked page mentions the document it was called. */
    readonly documentPresent: boolean;
}

/** Words that make a link text a claim about a document rather than a place. */
const DOCUMENT_WORDS = /terms|polic(y|ies)|disclosure|agreement|conditions/i;

/**
 * Every document-naming link in a file that collects a consent, with a verdict.
 *
 * `appDir` is src/app. Only files containing a checkbox are considered, because
 * this rule is about what somebody is asked to AGREE to, not about link hygiene
 * in general — that is scanForDeadLinks' job.
 */
export function scanConsentDocumentLinks(appDir: string): ConsentDocumentLink[] {
    const files: string[] = [];
    const walk = (dir: string): void => {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir)) {
            if (entry === "node_modules" || entry === "__tests__") continue;
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (/\.tsx$/.test(entry)) files.push(full);
        }
    };
    walk(appDir);

    const pageSource = (href: string): string | null => {
        const p = join(appDir, href.replace(/^\//, ""), "page.tsx");
        return existsSync(p) ? readFileSync(p, "utf8") : null;
    };

    const out: ConsentDocumentLink[] = [];
    for (const file of files.sort()) {
        const src = readFileSync(file, "utf8");
        //   Only where a consent is actually collected.
        if (!src.includes('type="checkbox"')) continue;

        for (const m of src.matchAll(/href="(\/[^"]*)"[^>]*>\s*([^<]{3,60}?)\s*</g)) {
            const href = m[1];
            const label = m[2].trim();
            if (!DOCUMENT_WORDS.test(label)) continue;

            const page = pageSource(href);
            out.push({
                file: relative(appDir, file).split("/").join("/"),
                href,
                label,
                routeExists: page !== null,
                documentPresent: page !== null && page.includes(label),
            });
        }
    }
    return out;
}

/** The ones whose linked page does not contain the document they named. */
export function consentsNamingAnAbsentDocument(
    links: readonly ConsentDocumentLink[],
): ConsentDocumentLink[] {
    return links.filter((l) => !l.documentPresent);
}
