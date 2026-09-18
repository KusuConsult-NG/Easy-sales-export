/**
 * @jest-environment node
 */

/**
 *   #875 THE RULE EXISTED, AND TEN SCREENS DID NOT ASK IT.
 *
 *   From the owner's production log, AFTER #831 built the manifest check that
 *   was supposed to end exactly this:
 *
 *       ⨯ The requested resource isn't a valid image for
 *         /images/products/yams.jpg received null          ×4
 *
 *   #831's diagnosis was right: `public/images/products/` has never existed,
 *   the path is in DATA, and `lib/first-image` answers it by refusing any local
 *   path that is not in the generated manifest of what the app ships.
 *
 *   Its REPAIR reached the helpers and not the screens. Ten render sites passed
 *   a stored value straight to `next/image`:
 *
 *       marketplace/products/[id]     the thumbnail strip   ← THE LOG LINE
 *       farm-nation/property/[id]     the thumbnail grid
 *       land/verify                   the admin's image grid
 *       ProductReviewsSection         a review's photos
 *       farm-nation/my-purchases      the property thumbnail
 *       farm-nation/saved             the saved-listing thumbnail
 *       marketplace/buyer/saved       the seller's logo
 *       marketplace/sellers/[id]      the storefront logo
 *       cooperatives/directory        the member's avatar
 *       marketplace/village-market/[id]  a related product
 *       profile                       the account avatar
 *
 *   Every one branched on TRUTHINESS — `x && <Image src={x}>` — and a stored
 *   "/images/products/yams.jpg" is perfectly truthy. Truthiness is not the
 *   question; renderability is, and it is one import away in all eleven files.
 *
 * ── AND ONE OF THEM WAS A HALF-FIX INSIDE A SINGLE COMPONENT ────────────────
 *
 *   farm-nation/property/[id] already called `imageSrcOrNull` for the MAIN
 *   image and handed the raw array to the strip forty lines below. So the rule
 *   was imported, used once, and skipped at the second site in the same file —
 *   which is this codebase's dominant defect class, stated in first-image.ts's
 *   own header: "a rule stated by hand in every reader, and a fix that reaches
 *   most of them".
 *
 * ── WHY A SWEEP AND NOT ELEVEN ASSERTIONS ───────────────────────────────────
 *
 *   Because eleven assertions are a list, and the defect IS that a list was
 *   incomplete. This reads every `<Image src={…}>` in the tree and requires
 *   each one to be guarded, to be the loop variable of a map over something
 *   guarded, or to be named below with a reason. A twelfth site fails until
 *   somebody decides which it is.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry !== 'node_modules' && entry !== '__tests__') walk(full, out);
        } else if (full.endsWith('.tsx')) {
            out.push(full);
        }
    }
    return out;
}

/** `<Image … src={EXPR}` — the expression the optimiser is handed. */
const IMAGE_SRC = /<Image\b[\s\S]*?\bsrc=\{([^}]+)\}/g;

/** The three doors in lib/first-image, by name. */
const GUARDS = /\b(?:imageSrcOrNull|imageSrcOr|firstImageSrc|firstImageSrcOr|renderableImages)\s*\(/;

/**
 * Sources that are NOT a stored record, each named with its reason.
 *
 *   Named individually rather than pattern-matched, because "it looks like a
 *   preview" is the sort of inference that lets a real stored field through.
 */
const NOT_A_STORED_VALUE: Record<string, string> = {
    //   Browser-side object/data URLs, created moments earlier by the upload
    //   control itself. They are not in the manifest and must not be judged by
    //   it — the guard would blank the user's own preview of the file they just
    //   chose.
    'src/app/marketplace/village-market/[id]/VillageMarketEventClient.tsx|imagePreview': 'an upload preview held in component state',
    'src/components/shared/DocumentUpload.tsx|preview': 'an upload preview held in component state',
    'src/components/onboarding/DocumentUpload.tsx|previewUrl': 'an upload preview held in component state',

    //   Generated in the browser as data: URLs.
    'src/app/settings/security/mfa/MfaSetupClient.tsx|qrCode': 'a data: URL generated for the MFA secret',
    'src/components/DigitalIDCard.tsx|qrCodeDataUrl': 'a data: URL generated for the ID card',

    //   Literal paths declared in the file. The #829 sweep in
    //   an-image-path-that-was-never-shipped checks these against public/, which
    //   is the right question for a path the SOURCE names.
    'src/app/wave/landing/page.tsx|img': 'a local constant array, swept by #829',
    'src/app/wave/landing/page.tsx|imgSrc': 'a YouTube thumbnail URL built from a video id',
    'src/components/hub/HubHero.tsx|img': 'a local constant array, swept by #829',
    'src/components/hub/ModuleCard.tsx|iconImage': 'a module icon from a local constant',
    'src/components/features/HeroSlider.tsx|slide.image': 'a local constant array, swept by #829',
    'src/components/ui/ImageSlider.tsx|image.src': 'slides passed in by a caller that owns them',
    'src/components/onboarding/OnboardingGuide.tsx|imageSrc': 'a local constant per guide step',

    //   Its own check, and a stricter one: http(s) only, so a local path can
    //   never reach the optimiser from here at all. See the component.
    'src/components/marketplace/ProductImage.tsx|src': 'the component requires http(s) before rendering',

    //   NOT next/image. @react-pdf/renderer exports its own <Image>, which
    //   never touches the Next optimiser.
    'src/components/pdf/CertificateDocument.tsx|logoSrc': 'react-pdf, not next/image',
};

interface Site { file: string; expr: string }

/**
 * Is this src expression safe?
 *
 *   Three ways, and the second is the one that matters for galleries: a strip
 *   renders `gallery.map((img) => <Image src={img} …>)`, so `img` is only as
 *   good as what is being mapped over. The nearest preceding `.map((img` in the
 *   file names that expression, and it is checked instead.
 */
function verdict(file: string, expr: string, code: string): 'guarded' | 'exempt' | 'unguarded' {
    const trimmed = expr.trim();

    if (GUARDS.test(trimmed)) return 'guarded';
    if (NOT_A_STORED_VALUE[`${file}|${trimmed}`]) return 'exempt';

    //   A plain identifier: find what it is the loop variable of.
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
        const at = code.lastIndexOf(`<Image`, code.indexOf(`src={${trimmed}}`) + 1);
        const before = code.slice(0, at < 0 ? code.length : at);
        const maps = [...before.matchAll(
            new RegExp(String.raw`([A-Za-z_$][\w$.()\[\],\s]*?)\.map\(\s*\(?\s*${trimmed}\b`, 'g'),
        )];
        if (maps.length) {
            const receiver = maps[maps.length - 1][1];
            if (GUARDS.test(receiver)) return 'guarded';
            //   `gallery.slice(0, 6)` — the list itself was filtered where it
            //   was declared, which is the shape the fix uses.
            const name = receiver.trim().split(/[.\s[(]/)[0];
            const decl = new RegExp(String.raw`const\s+${name}\s*=\s*[^;]*`);
            const m = decl.exec(code);
            if (m && GUARDS.test(m[0])) return 'guarded';
        }

        //   Or the identifier is itself declared from a guard.
        const own = new RegExp(String.raw`const\s+${trimmed}\s*=\s*[^;]*`).exec(code);
        if (own && GUARDS.test(own[0])) return 'guarded';
    }

    return 'unguarded';
}

function sweep(): { unguarded: Site[]; guarded: number; exempt: number; files: number } {
    const files = walk(join(ROOT, 'src/app')).concat(walk(join(ROOT, 'src/components')));
    const unguarded: Site[] = [];
    let guarded = 0;
    let exempt = 0;

    for (const full of files) {
        const rel = full.slice(ROOT.length + 1).replace(/\\/g, '/');
        //   STRIPPED. This suite's own header quotes the defective lines, and
        //   #741 records the sweep that reported its own explanation as an
        //   offender.
        const code = stripComments(readFileSync(full, 'utf-8'), { label: rel });
        if (!code.includes('<Image')) continue;

        for (const match of code.matchAll(IMAGE_SRC)) {
            const expr = match[1].trim();
            const answer = verdict(rel, expr, code);
            if (answer === 'guarded') guarded += 1;
            else if (answer === 'exempt') exempt += 1;
            else unguarded.push({ file: rel, expr });
        }
    }

    return { unguarded, guarded, exempt, files: files.length };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#875 — nothing hands the optimiser a value it has not checked', () => {
    it('THE SWEEP IS READING THE APPLICATION — the control', () => {
        /*
         *   A verdict of "no unguarded sites" is also what a walk that found
         *   nothing returns, and this codebase has met that shape (#484). Both
         *   halves are asserted: the tree was walked, and real sites were
         *   classified.
         */
        const { files, guarded, exempt } = sweep();

        expect(files).toBeGreaterThan(200);
        expect(guarded).toBeGreaterThan(5);
        expect(exempt).toBeGreaterThan(5);
    });

    it('THE REPORTED DEFECT: every <Image src> is guarded, exempt, or named', () => {
        const { unguarded } = sweep();

        //   Printed as file|expression so a failure says which line to look at
        //   rather than only that the count moved.
        expect(unguarded.map((s) => `${s.file}  ←  ${s.expr}`).sort()).toEqual([]);
    });

    it('AND THE SWEEP STILL CATCHES ONE — the guard that zero needs', () => {
        //   Vacuity: the assertion above passes trivially if the regex stopped
        //   matching or the verdict started answering "guarded" to everything.
        const code = 'const x = <Image src={product.images[0]} alt="" />;';

        expect([...code.matchAll(IMAGE_SRC)].map((m) => m[1])).toEqual(['product.images[0]']);
        expect(verdict('some/file.tsx', 'product.images[0]', code)).toBe('unguarded');
    });

    it('AND IT ACCEPTS A GUARDED ONE, AND A MAP OVER A GUARDED LIST', () => {
        //   Or "no unguarded sites" would be indistinguishable from "nothing is
        //   ever considered a site".
        expect(verdict('f.tsx', 'imageSrcOrNull(row.image)!', '')).toBe('guarded');

        const gallery = [
            'const gallery = renderableImages(property.images);',
            '{gallery.slice(0, 6).map((img, index) => (',
            '<Image src={img} alt="" />',
        ].join('\n');
        expect(verdict('f.tsx', 'img', gallery)).toBe('guarded');
    });

    it('AND AN EXEMPTION HAS TO BE NAMED WITH A REASON', () => {
        /*
         *   The list is the decision record. An entry with an empty reason is a
         *   site somebody waved through, which is the thing this suite exists to
         *   prevent — and every reason has to say what the value IS, because
         *   "not a stored value" is the whole claim being made.
         */
        for (const [key, reason] of Object.entries(NOT_A_STORED_VALUE)) {
            expect({ key, ok: reason.trim().length > 15 }).toEqual({ key, ok: true });
        }
    });
});
