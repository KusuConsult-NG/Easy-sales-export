/**
 * @jest-environment node
 */

/**
 * A preview of the file you just picked, refused for not being a URL.
 *
 *   THE OWNER: "when a user is adding a product, it doesnt show a preview of
 *   the image or video being added, the thumbnail is blank."
 *
 *   `URL.createObjectURL(file)` returns `blob:https://host/<uuid>`. isRenderableSrc
 *   accepted an absolute http(s) URL, or a leading-slash path in the shipped
 *   asset manifest, and nothing else — so a blob: URL fell through every arm and
 *   imageSrcOrNull answered null. ThumbnailImage then drew its placeholder.
 *
 *   The preview was not broken when it was written; it broke when #875 moved
 *   this rule INTO the shared component to stop bad stored paths reaching the
 *   optimiser. That fix was right and took the pre-upload case with it — the
 *   cost of asking one question in one place is that it is asked of callers the
 *   question was not written for.
 *
 *   Verified by mutation: dropping the blob:/data: arm fails the first test.
 */

import { describe, it, expect } from '@jest/globals';
import { imageSrcOrNull } from '@/lib/first-image';

describe('a preview of the file you just picked', () => {
    it('A blob: URL IS RENDERABLE — it is what every pre-upload preview uses', () => {
        const objectUrl = 'blob:https://easysalesexport.com/8f14e45f-ceea-467a-9f2a-1b0c9d3e5a77';
        expect(imageSrcOrNull(objectUrl)).toBe(objectUrl);
    });

    it('A data: URI IS RENDERABLE — FileReader produces these for small previews', () => {
        const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
        expect(imageSrcOrNull(dataUri)).toBe(dataUri);
    });

    it('AND THE RULES THAT MATTERED STILL HOLD', () => {
        //   #439's absolute URL — every Cloudinary upload.
        expect(imageSrcOrNull('https://res.cloudinary.com/x/image/upload/y.jpg'))
            .toBe('https://res.cloudinary.com/x/image/upload/y.jpg');

        //   #831's dead local path — not in the shipped manifest.
        expect(imageSrcOrNull('/images/products/yams.jpg')).toBeNull();

        //   #262's protocol-relative path wearing a local path's clothes.
        expect(imageSrcOrNull('//evil.example/x.jpg')).toBeNull();

        //   A bare storage key, which next/image throws on.
        expect(imageSrcOrNull('products/marketplace/1712345_yam.jpg')).toBeNull();

        //   The ordinary "no image" cases.
        expect(imageSrcOrNull('')).toBeNull();
        expect(imageSrcOrNull('   ')).toBeNull();
        expect(imageSrcOrNull(null)).toBeNull();
        expect(imageSrcOrNull(undefined)).toBeNull();
        expect(imageSrcOrNull(42)).toBeNull();
    });

    it('A STRING THAT ONLY MENTIONS blob: IS NOT ONE', () => {
        //   The check is startsWith, not includes — a stored path that merely
        //   contains the word must not be waved through. (A /uploads/ path is
        //   deliberately exempt for local development, so it is not the example
        //   to use here; an ordinary unshipped path is.)
        expect(imageSrcOrNull('/images/blob:evil.jpg')).toBeNull();
        expect(imageSrcOrNull('https://host/blob:thing.jpg'))
            .toBe('https://host/blob:thing.jpg');
    });
});
