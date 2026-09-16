#!/usr/bin/env node
/**
 * Write src/lib/public-assets.generated.ts from what public/ actually contains.
 *
 *   #831. A product row in production holds "/images/products/yams.jpg", and
 *   `public/images/products/` has never existed — so next/image was asked to
 *   optimise a file that is not there, logged
 *
 *       ⨯ The requested resource isn't a valid image for
 *         /images/products/yams.jpg received null
 *
 *   on every render, and the screen showed a gap. The path is in DATA, so no
 *   amount of reading src/ finds it; what the application CAN know is which
 *   local assets it ships, and refuse to ask the optimiser for anything else.
 *
 *   Regenerate with `npm run assets:manifest`. A test compares this file to the
 *   filesystem, so it cannot drift silently — adding an image without
 *   regenerating fails CI with the exact command to run.
 */
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const PUBLIC = join(ROOT, "public");
const OUT = join(ROOT, "src/lib/public-assets.generated.ts");

/** Extensions next/image may be pointed at. */
const RENDERABLE = /\.(?:jpg|jpeg|png|webp|svg|gif|avif|ico)$/i;

/**
 * Directories under public/ that are WRITTEN AT RUNTIME, not shipped.
 *
 *   `public/uploads/local/` is where storage-backend puts a file when
 *   isLocalStack() is true, and it is gitignored. Walking it put a dozen
 *   machine-local E2E artefacts into a COMMITTED manifest — paths that exist
 *   for nobody else, and that reappear every time somebody runs the suite. The
 *   drift test would then fail on a clean checkout and fail again after every
 *   local run, which is how a guard that fires on good input gets switched off.
 *
 *   Caught by that drift test on its first full run, which is the argument for
 *   having written it.
 */
const RUNTIME_DIRS = new Set(["uploads"]);

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        if (dir === PUBLIC && RUNTIME_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (RENDERABLE.test(entry)) out.push(full);
    }
    return out;
}

const paths = walk(PUBLIC)
    .map((p) => "/" + relative(PUBLIC, p).split(sep).join("/"))
    .sort();

const body = `/**
 * GENERATED — do not edit. \`npm run assets:manifest\`.
 *
 * Every image under public/, as the path a browser requests it by.
 *
 * See lib/first-image.ts for why this exists: a stored image path that the
 * application never shipped is dead, and asking next/image to optimise it costs
 * a failed request and an error in the log on every render.
 */
export const PUBLIC_ASSETS: ReadonlySet<string> = new Set([
${paths.map((p) => `    ${JSON.stringify(p)},`).join("\n")}
]);
`;

writeFileSync(OUT, body);
console.log(`public-assets.generated.ts: ${paths.length} assets`);
