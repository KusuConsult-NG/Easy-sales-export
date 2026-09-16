/**
 * @jest-environment node
 */

/**
 *   #831 A STORED IMAGE PATH THE APPLICATION NEVER SHIPPED.
 *
 *   From the owner's production log, on every render of one product:
 *
 *       ⨯ The requested resource isn't a valid image for
 *         /images/products/yams.jpg received null
 *
 *   `public/images/products/` has never existed in this repository. The path is
 *   in DATA — a row written by a seed or an import that pointed at a file
 *   nobody uploaded — which is why #829's sweep of src/ could not see it, and
 *   why nothing I could change in src/ would have fixed it. I said so, and said
 *   it was the owner's to repair. It was not: what the application CAN know is
 *   what it ships.
 *
 *   lib/public-assets.generated is that list, generated from public/ by
 *   `npm run assets:manifest`. A stored local path that is not in it is dead,
 *   so isRenderableSrc treats it as no image: the caller's placeholder renders,
 *   next/image is never asked, and the error stops — with no operator action
 *   and no database edit.
 *
 * ── THE DRIFT GUARD IS THE WHOLE RISK ───────────────────────────────────────
 *
 *   A generated manifest introduces a failure mode that did not exist before:
 *   add an image to public/, forget to regenerate, and that image silently
 *   stops rendering. That is a worse bug than the one being fixed, because it
 *   is invisible.
 *
 *   So the first test below regenerates the list from disk and compares. It
 *   cannot drift: adding an asset without running the script fails here, with
 *   the command in the message. This is the only reason the manifest approach
 *   is safe, and it is the test to keep working if any other is dropped.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     an asset added to public/ but not to the manifest               KILLED
 *     an asset removed from public/ but left in the manifest          KILLED
 *     isRenderableSrc back to accepting any leading slash             KILLED
 *     the query-string strip removed                                  KILLED
 *     absolute URLs put through the manifest check too                KILLED
 *     reword this header                                  SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { PUBLIC_ASSETS } from '@/lib/public-assets.generated';
import { firstImageSrc, imageSrcOrNull } from '@/lib/first-image';

const ROOT = process.cwd();
const PUBLIC = join(ROOT, 'public');

/** The same extensions the generator walks. */
const RENDERABLE = /\.(?:jpg|jpeg|png|webp|svg|gif|avif|ico)$/i;

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (RENDERABLE.test(entry)) out.push(full);
    }
    return out;
}

function onDisk(): string[] {
    return walk(PUBLIC)
        .map((p) => '/' + relative(PUBLIC, p).split(sep).join('/'))
        .sort();
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#831 — the manifest is what is actually on disk', () => {
    it('IT HAS NOT DRIFTED — regenerated from public/ and compared', () => {
        /*
         *   THE test. Everything else here rests on this one being true, and a
         *   stale manifest turns a fix into an invisible outage: an image that
         *   exists, is referenced correctly, and does not appear.
         *
         *   The failure message carries the command, because a ratchet an
         *   engineer cannot act on in ten seconds is a ratchet that gets
         *   deleted.
         */
        const disk = onDisk();
        const manifest = [...PUBLIC_ASSETS].sort();

        const missingFromManifest = disk.filter((p) => !PUBLIC_ASSETS.has(p));
        const staleInManifest = manifest.filter((p) => !disk.includes(p));

        expect({
            hint: 'run: npm run assets:manifest',
            missingFromManifest,
            staleInManifest,
        }).toEqual({
            hint: 'run: npm run assets:manifest',
            missingFromManifest: [],
            staleInManifest: [],
        });
    });

    it('AND IT IS NOT EMPTY, which would make every local image dead', () => {
        //   Vacuity guard. An empty manifest passes the comparison above only
        //   if public/ is also empty — but a generator that wrote `new Set([])`
        //   for any other reason would silently blank every local image on the
        //   platform. This is the cheapest possible check against that.
        expect(PUBLIC_ASSETS.size).toBeGreaterThan(100);
        expect(PUBLIC_ASSETS.has('/images/hero-1.jpg')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#831 — and a path that was never shipped is not an image', () => {
    it('THE REPORTED ONE IS REFUSED', () => {
        //   The exact string from the owner's log.
        expect(firstImageSrc(['/images/products/yams.jpg'])).toBeNull();
        expect(imageSrcOrNull('/images/products/yams.jpg')).toBeNull();
    });

    it('AND SO IS ANY OTHER DEAD LOCAL PATH', () => {
        for (const dead of [
            '/images/products/anything.jpg',
            '/placeholder-land.jpg',
            '/images/placeholder-product.jpg',
            '/images/export-placeholder.jpg',
            '/uploads/legacy/whatever.png',
        ]) {
            expect({ dead, src: imageSrcOrNull(dead) }).toEqual({ dead, src: null });
        }
    });

    it('AND A REAL LOCAL PATH STILL RENDERS', () => {
        //   Or the fix would be "no local image ever works", which is not a fix.
        expect(imageSrcOrNull('/images/hero-1.jpg')).toBe('/images/hero-1.jpg');
        expect(firstImageSrc(['/images/hero-1.jpg'])).toBe('/images/hero-1.jpg');
    });

    it('AND A QUERY STRING OR HASH DOES NOT MAKE A REAL ONE DEAD', () => {
        /*
         *   A cache-buster is ordinary on a stored path, and matching the raw
         *   string against the manifest would refuse `/images/hero-1.jpg?v=2`.
         *   The value returned is the ORIGINAL, query string intact — the
         *   manifest decides existence, it does not rewrite the src.
         */
        expect(imageSrcOrNull('/images/hero-1.jpg?v=2')).toBe('/images/hero-1.jpg?v=2');
        expect(imageSrcOrNull('/images/hero-1.jpg#top')).toBe('/images/hero-1.jpg#top');
        //   and it does not rescue a dead one
        expect(imageSrcOrNull('/images/products/yams.jpg?v=2')).toBeNull();
    });

    it('CONTROL: AN ABSOLUTE URL IS NEVER PUT THROUGH THE MANIFEST', () => {
        /*
         *   THE case that matters most, because every image this platform
         *   actually uploads goes to Cloudinary. If the manifest check reached
         *   absolute URLs it would blank every real product photo on the
         *   platform — a far worse outage than the log line this fixes.
         */
        expect(imageSrcOrNull('https://res.cloudinary.com/x/image/upload/v1/a.jpg'))
            .toBe('https://res.cloudinary.com/x/image/upload/v1/a.jpg');
        expect(imageSrcOrNull('http://cdn.example/anything-at-all.png'))
            .toBe('http://cdn.example/anything-at-all.png');
    });

    it('CONTROL: THE OLD REFUSALS STILL REFUSE', () => {
        //   #439 and #262's rules are unchanged by this.
        expect(imageSrcOrNull('land/bare-key.jpg')).toBeNull();      // #439
        expect(imageSrcOrNull('../x.jpg')).toBeNull();               // #439
        expect(imageSrcOrNull('//evil.example/x.jpg')).toBeNull();   // #262
        expect(imageSrcOrNull('')).toBeNull();
        expect(imageSrcOrNull(null)).toBeNull();
    });
});
