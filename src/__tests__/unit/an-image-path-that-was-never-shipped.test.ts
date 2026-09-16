/**
 * @jest-environment node
 */

/**
 *   #829 THREE PLACEHOLDER IMAGES THAT WERE REFERENCED AND NEVER SHIPPED.
 *
 *   The owner: "/images/products/yams.jpg returning null".
 *
 *   That exact path is in DATA — a product row whose image points at a file
 *   nobody uploaded — and nothing in src/ writes it. But asking the question
 *   the report implies, rather than the one it names, found the same fault in
 *   the CODE, three times:
 *
 *       /images/export-placeholder.jpg   actions/export-investments
 *       /images/placeholder-product.jpg  marketplace/products/[id]
 *       /placeholder-land.jpg            farm-nation properties, ×2
 *
 *   `public/images/products/` does not exist either, and neither do those
 *   three. Measured by sweeping every quoted static-asset path in src/ against
 *   the filesystem rather than by reading any one screen.
 *
 * ── WHY A SYNTHESISED PATH IS WORSE THAN NO PATH ────────────────────────────
 *
 *   Every one of them was a FALLBACK: `data.image || "/images/…"`. So an item
 *   with no picture was given a path to a file that does not exist, which:
 *
 *     - costs a guaranteed 404 on every such item, and
 *     - defeats the fallback the render layer already has, because a truthy
 *       string passes `src ? … : …`, and
 *     - LIES TO ANY CALLER that asks `if (item.image)`.
 *
 *   ThumbnailImage recovers from a broken image — that is what #791 built it
 *   for — so three of the sites drew their placeholder icon anyway after the
 *   wasted request. The two export screens had never been given it and rendered
 *   a bare <Image>, which paints its ALT TEXT inside the image box when the src
 *   404s. Their alt is the commodity, so an export window with no photo printed
 *   "Sesame" across its own card. That is #791 itself, in two more places: a
 *   correct rule applied to some of the places it names.
 *
 *   Absent is absent now, everywhere. `imageSrcOrNull` is the null-returning
 *   sibling the callers with a fallback element actually wanted.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     a missing asset path reintroduced in a screen                  KILLED
 *     the sweep reading raw source instead of stripped               KILLED
 *     export-investments returning the fake path again               KILLED
 *     imageSrcOrNull returning a string instead of null              KILLED
 *     the two export screens back to a bare <Image>                  KILLED
 *     reword this header                                 SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { imageSrcOrNull, firstImageSrc } from '@/lib/first-image';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry !== 'node_modules') walk(full, out);
        } else if (/\.tsx?$/.test(full)) {
            out.push(full);
        }
    }
    return out;
}

/** A quoted absolute path that looks like a local static asset. */
const ASSET = /["'`](\/[A-Za-z0-9_\-./]+\.(?:jpg|jpeg|png|webp|svg|gif|avif|ico))["'`]/g;

/**
 * Served by Next from somewhere other than public/, so absence there is right.
 *
 *   Named individually rather than pattern-matched — "it looks generated" is
 *   the kind of inference that lets a real missing asset through.
 */
const NOT_IN_PUBLIC = new Set([
    //   src/app/favicon.ico. Next serves it at the root; public/ has no copy.
    '/favicon.ico',
]);

describe('#829 — every static asset a screen asks for exists', () => {
    it('NO SOURCE FILE REFERENCES AN IMAGE THAT IS NOT THERE', () => {
        /*
         *   STRIPPED, because the comments recording this finding quote the
         *   very paths they removed. That is the #741 trap, and this suite
         *   would have walked into it — the first run of the sweep this test
         *   comes from reported all three as still present, from its own
         *   explanation of why they are gone.
         *
         *   It is also #827's repair that makes stripping trustworthy here:
         *   several of these files carry regexes containing quotes, and the
         *   stripper used to desync on exactly that and hand back the comments
         *   it was asked to remove.
         */
        const files = walk(join(ROOT, 'src'))
            .filter((p) => !/__tests__|\.test\./.test(p));

        const missing: string[] = [];
        for (const file of files) {
            const code = stripComments(readFileSync(file, 'utf-8'), { label: file });
            for (const match of code.matchAll(ASSET)) {
                const path = match[1];
                if (NOT_IN_PUBLIC.has(path)) continue;
                if (existsSync(join(ROOT, 'public', path))) continue;
                missing.push(`${path}  ←  ${file.slice(ROOT.length + 1)}`);
            }
        }

        expect([...new Set(missing)].sort()).toEqual([]);
    });

    it('CONTROL: THE SWEEP FINDS A MISSING ASSET WHEN THERE IS ONE', () => {
        /*
         *   Vacuity guard. The assertion above passes trivially if the regex
         *   stopped matching, the walk stopped walking, or the existence check
         *   started answering yes — and this codebase has met all three shapes.
         */
        const code = stripComments('const hero = "/images/definitely-not-here.png";\n', { label: 'x' });
        const hits = [...code.matchAll(ASSET)].map((m) => m[1]);

        expect(hits).toEqual(['/images/definitely-not-here.png']);
        expect(existsSync(join(ROOT, 'public', hits[0]))).toBe(false);
    });

    it('CONTROL: AND IT ACCEPTS ONE THAT IS THERE', () => {
        //   Or "no missing assets" would be indistinguishable from "nothing is
        //   ever considered present".
        const code = stripComments('const hero = "/images/hero-1.jpg";\n', { label: 'x' });
        const hits = [...code.matchAll(ASSET)].map((m) => m[1]);

        expect(hits).toEqual(['/images/hero-1.jpg']);
        expect(existsSync(join(ROOT, 'public', hits[0]))).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#829 — absent is absent, not a path to nothing', () => {
    it('imageSrcOrNull RETURNS NULL RATHER THAN A FAKE URL', () => {
        expect(imageSrcOrNull(undefined)).toBeNull();
        expect(imageSrcOrNull(null)).toBeNull();
        expect(imageSrcOrNull('')).toBeNull();
        expect(imageSrcOrNull('   ')).toBeNull();
    });

    it('AND STILL RETURNS A REAL ONE, TRIMMED', () => {
        expect(imageSrcOrNull('  https://cdn.example/a.jpg ')).toBe('https://cdn.example/a.jpg');
        expect(imageSrcOrNull('/images/hero-1.jpg')).toBe('/images/hero-1.jpg');
    });

    it('AND firstImageSrc AGREES for a list with nothing renderable in it', () => {
        //   The two helpers answer the same question for one value and for a
        //   list; a caller should not have to know which shape it holds.
        expect(firstImageSrc([])).toBeNull();
        expect(firstImageSrc([null, '', '   '])).toBeNull();
        expect(firstImageSrc(undefined)).toBeNull();
    });

    it('THE EXPORT READER NO LONGER INVENTS A PATH', () => {
        /*
         *   Read from the source because both sites are inside a `.map()` over
         *   a snapshot, and executing them needs the whole action. The claim is
         *   narrow and checkable: the literal is gone and the field falls back
         *   to null.
         */
        const src = stripComments(
            readFileSync(join(ROOT, 'src/app/actions/export-investments.ts'), 'utf-8'),
            { label: 'export-investments.ts' },
        );

        expect(src).not.toContain('export-placeholder');
        expect(src).toContain('image: data.image || null');
        //   and the type admits it, so a caller cannot assume a string
        expect(src).toMatch(/image: string \| null;/);
    });

    it('AND THE TWO EXPORT SCREENS DRAW A FALLBACK INSTEAD OF ALT TEXT', () => {
        /*
         *   #791's component, in the two places that never got it. A bare
         *   <Image> whose src fails paints `alt` inside the image box — here
         *   the commodity name, across the card it belongs to.
         */
        for (const file of [
            'src/app/export/windows/page.tsx',
            'src/app/export/windows/[id]/ExportWindowDetailClient.tsx',
        ]) {
            const src = stripComments(readFileSync(join(ROOT, file), 'utf-8'), { label: file });

            expect(src).toContain('<ThumbnailImage');
            expect(src).toContain('fallback=');
            //   The commodity image specifically — not merely "the file
            //   mentions ThumbnailImage somewhere", which is the weakest
            //   assertion in this codebase's vocabulary.
            expect(src).toMatch(/<ThumbnailImage[\s\S]{0,200}src=\{window\.image\}/);
        }
    });
});
