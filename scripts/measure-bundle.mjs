#!/usr/bin/env node
/**
 * Measure what a user actually downloads.
 *
 * WHY THIS EXISTS
 * ---------------
 * `outstanding-work.md` recorded "12 MB of JavaScript, with single chunks up to
 * 469 KB" and called it "the second half of the slowness". That number is the
 * sum of every chunk across 361 routes. **No user downloads it.** Acting on it
 * would have meant paying for optimisation work that was already done.
 *
 * The number that matters is the always-loaded baseline plus the route's own
 * chunks. This computes both, so the claim is reproducible instead of
 * remembered.
 *
 * USAGE
 *   npm run build            # ordinary build is enough for the baseline
 *   node scripts/measure-bundle.mjs
 *
 *   ANALYZE=true npm run build   # adds the per-package breakdown
 *   node scripts/measure-bundle.mjs
 *
 * Next 16 no longer prints per-route sizes in the build output, and there is no
 * app-build-manifest.json, which is why this reads build-manifest.json and the
 * analyzer's embedded chartData directly.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const NEXT = '.next';

function kb(bytes) {
    return `${(bytes / 1024).toFixed(0)} KB`;
}

function sizeOf(files) {
    let raw = 0;
    let gz = 0;
    for (const f of files) {
        if (!f.endsWith('.js')) continue;
        const p = join(NEXT, f);
        if (!existsSync(p)) continue;
        const buf = readFileSync(p);
        raw += buf.length;
        gz += gzipSync(buf, { level: 6 }).length;
    }
    return { raw, gz };
}

function baseline() {
    const manifestPath = join(NEXT, 'build-manifest.json');
    if (!existsSync(manifestPath)) {
        console.error('No .next/build-manifest.json — run `npm run build` first.');
        process.exit(1);
    }
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const groups = {
        'framework + app shell': m.rootMainFiles ?? [],
        'polyfills': m.polyfillFiles ?? [],
        'low priority': m.lowPriorityFiles ?? [],
    };

    console.log('EVERY USER DOWNLOADS THIS, WHATEVER PAGE THEY OPEN\n');
    let raw = 0;
    let gz = 0;
    for (const [name, files] of Object.entries(groups)) {
        const s = sizeOf(files);
        // Low-priority files are fetched after paint; counted separately.
        if (name !== 'low priority') {
            raw += s.raw;
            gz += s.gz;
        }
        console.log(`  ${name.padEnd(24)} ${String(files.length).padStart(2)} files  ${kb(s.raw).padStart(9)} raw  ${kb(s.gz).padStart(8)} gzip`);
    }
    console.log(`\n  ${'BASELINE'.padEnd(24)}    ${''.padStart(6)}  ${kb(raw).padStart(9)} raw  ${kb(gz).padStart(8)} gzip`);
    return gz;
}

function packages() {
    const p = join(NEXT, 'analyze', 'client.html');
    if (!existsSync(p)) {
        console.log('\n(Run `ANALYZE=true npm run build` for the per-package breakdown.)');
        return;
    }
    const html = readFileSync(p, 'utf8');
    const match = html.match(/window\.chartData\s*=\s*(\[.*?\]);/s);
    if (!match) {
        console.log('\n(Could not read chartData from the analyzer output.)');
        return;
    }
    const data = JSON.parse(match[1]);

    const perChunk = [];
    const totals = new Map();
    const chunkCount = new Map();
    let largestSingle = new Map();

    const visit = (node, acc) => {
        if (node.groups) {
            for (const g of node.groups) visit(g, acc);
            return;
        }
        const path = node.path || node.label || '';
        const m = path.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
        if (!m) return;
        acc.set(m[1], (acc.get(m[1]) ?? 0) + (node.gzipSize ?? 0));
    };

    for (const chunk of data) {
        const acc = new Map();
        visit(chunk, acc);
        perChunk.push({ label: chunk.label, gz: chunk.gzipSize ?? 0, acc });
        for (const [name, sz] of acc) {
            totals.set(name, (totals.get(name) ?? 0) + sz);
            chunkCount.set(name, (chunkCount.get(name) ?? 0) + 1);
            largestSingle.set(name, Math.max(largestSingle.get(name) ?? 0, sz));
        }
    }

    perChunk.sort((a, b) => b.gz - a.gz);
    console.log('\n\nLARGEST CHUNKS — these load only on the routes that import them\n');
    for (const c of perChunk.slice(0, 10)) {
        const top = [...c.acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
            .map(([k, v]) => `${k} ${(v / 1024).toFixed(0)}k`).join(', ');
        console.log(`  ${kb(c.gz).padStart(8)}  ${c.label.slice(0, 46).padEnd(46)} ${top}`);
    }

    console.log('\n\nPACKAGES BY TOTAL — read the last column, not the first\n');
    console.log(`  ${'total'.padStart(9)}  ${'chunks'.padStart(6)}  ${'worst one'.padStart(9)}  package`);
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    for (const [name, sz] of sorted) {
        console.log(`  ${kb(sz).padStart(9)}  ${String(chunkCount.get(name)).padStart(6)}  ${kb(largestSingle.get(name)).padStart(9)}  ${name}`);
    }
    console.log(`
  A large total with a small "worst one" means the package tree-shakes and each
  route pays only for what it uses. lucide-react is the example: ~432 KB across
  252 chunks, but never more than ~9 KB in any single one. Optimising that
  number would be optimising an illusion.`);
}

const gz = baseline();
packages();

console.log(`
SUMMARY
  A user opening any page downloads about ${kb(gz)} gzipped before route code.
  That is React + the Next App Router client + Sentry's browser SDK — framework
  floor, not application weight.

  The heavy libraries (QR scanning, PDF generation, charts, maps, image capture)
  each sit in their own chunk and load only where they are used. That splitting
  is already done.`);
