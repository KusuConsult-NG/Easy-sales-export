/**
 * @jest-environment node
 */

/**
 *   #636 EVERY CERTIFICATE THIS PLATFORM PRINTS NAMED A PAGE THAT DOES NOT
 *        EXIST.
 *
 *   The academy certificate chain was audited end to end — issuance, the number,
 *   the store, the public verifier, the PDF, the dashboard tally. The chain is
 *   sound; the ADDRESS ON THE CREDENTIAL was not.
 *
 *   The verifier lives at `/academy/verify/[certificateId]`. Four places tell
 *   somebody where to check a credential, and three of them said:
 *
 *     CertificateClient footer   `www.easysalesexport.com/verify/{certNumber}`
 *     CertificateDocument (PDF)  `https://easysalesexport.com/verify/{id}`
 *     CertificateGenerator       `easysalesexport.com/verify/{id}`
 *
 *   There is no `/verify/:id` route and there was no redirect to one. `/verify-id`
 *   and `/verify-status` are real, unrelated pages; neither is this. Measured
 *   against a built server before the fix: `/verify/ACAD-…` answered 404, the
 *   app-path manifest listed no `/verify/[certificateId]`, and unknown paths 404
 *   as a control.
 *
 *   Only the LinkedIn button had the path right — which is exactly why this
 *   survived: the one route that is CLICKED rather than TYPED or PRINTED was the
 *   one route that worked. The line a third party reads off a printed
 *   certificate, and the line on the screen the holder is looking at, both led
 *   nowhere.
 *
 *   THIS CHAIN HAS BEEN REPAIRED FOR THIS TWICE ALREADY, each time at one call
 *   site:
 *
 *     #430   "the LinkedIn verify link still lands on Certificate not found"
 *     WAVE   `/wave/verify-certificate/{n}` — "a route with no page and no
 *            handler anywhere in the app, so every certificate ever issued
 *            carried a verification link that 404s"
 *
 *   The path is one exported string now, so a fourth site cannot be wrong on its
 *   own.
 *
 * ── AND THE CERTIFICATES ALREADY IN THE WORLD ───────────────────────────────
 *
 *   A PDF downloaded last month carries the old address and cannot be reissued.
 *   Correcting the string alone would have fixed only the credentials not yet
 *   printed, so next.config redirects `/verify/:certificateId` permanently. It
 *   is two segments, so `/verify-id` and `/verify-status` are untouched —
 *   measured, not assumed; both still answer as they did.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { join, relative } from 'path';
import {
    ACADEMY_VERIFY_PATH,
    academyVerificationPath,
    academyCertificateNumber,
} from '@/lib/academy-certificate';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Comment-stripped — a path discussed in prose is not a path anybody prints.
 *
 * THE SHARED STRIPPER, NOT A HAND-ROLLED ONE. The first draft of this file used
 * the naive `replace(/\/\*[\s\S]*?\*\//g, '')`, and the sweep below is a
 * NEGATIVE assertion — "no file prints the old address" — run over every file in
 * src. That is the combination strip-comments.test.ts exists to warn about: the
 * naive regex opens a block comment on a `/*` inside a quoted string and eats
 * the rest of the file, and a swept file that has been eaten contains nothing,
 * which reads as nothing wrong. "Could not tell" answering as "no", over a sweep
 * that is the whole evidence for this finding.
 */
const code = (rel: string) => stripComments(read(rel), { label: rel });

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full) && !/\.d\.ts$/.test(full)) out.push(full);
    }
    return out;
}

const APP_FILES = walk(join(ROOT, 'src'))
    .map((f) => relative(ROOT, f))
    .filter((f) => !f.includes('__tests__') && !f.includes('/testing/'));

/** The four places that tell somebody where to verify a credential. */
const PRINTERS = [
    'src/app/academy/certificate/[certificateId]/CertificateClient.tsx',
    'src/components/pdf/CertificateDocument.tsx',
    'src/components/CertificateGenerator.tsx',
    'src/app/actions/wave/_wv_certificates.ts',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#636 — the page the certificate names is a page that exists', () => {
    it('THE VERIFIER IS WHERE THE PATH SAYS IT IS', () => {
        //   The premise. If the route moved, every assertion below would be
        //   pinning the printers to a new 404.
        expect(ACADEMY_VERIFY_PATH).toBe('/academy/verify');
        expect(existsSync(join(ROOT, 'src/app/academy/verify/[certificateId]/page.tsx'))).toBe(true);
        expect(academyVerificationPath('ACAD-2026-ABCDEF-123456'))
            .toBe('/academy/verify/ACAD-2026-ABCDEF-123456');
    });

    it('AND `/verify/{id}` IS A PAGE NOBODY WROTE', () => {
        /*
         *   The finding's other half, stated as a fact about this repository
         *   rather than as prose. If somebody later adds the page, this fails —
         *   and at that point the redirect should go, not stay shadowing a real
         *   route.
         */
        expect(existsSync(join(ROOT, 'src/app/verify'))).toBe(false);

        //   The two directories whose names look like it and are not it.
        expect(existsSync(join(ROOT, 'src/app/verify-id'))).toBe(true);
        expect(existsSync(join(ROOT, 'src/app/verify-status'))).toBe(true);
    });

    it('AND NO FILE PRINTS THE ADDRESS THAT LED NOWHERE', () => {
        /*
         *   Swept across the whole application rather than checked at the three
         *   known sites: the defect was one site out of four being wrong on its
         *   own, twice before, so "the ones I know about are fixed" is not the
         *   assertion worth making.
         */
        const offenders = APP_FILES.filter((f) => /easysalesexport\.com\/verify\//.test(code(f)));
        expect({ offenders }).toEqual({ offenders: [] });

        //   And no `/verify/` literal outside the redirect that rescues the old
        //   ones. (next.config is not under src, so it is not in this sweep.)
        const literals = APP_FILES.filter((f) => /["'`]\/verify\/\$?\{/.test(code(f)));
        expect({ literals }).toEqual({ literals: [] });
    });

    it('AND ALL FOUR PRINTERS ASK THE ONE FUNCTION', () => {
        //   "Nobody prints the wrong path" is also satisfied by nobody printing
        //   a path at all. Each of the four must be asking for one.
        for (const printer of PRINTERS) {
            expect({ printer, asks: code(printer).includes('academyVerificationPath(') })
                .toEqual({ printer, asks: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#636 — and the certificates already printed still resolve', () => {
    const config = code('next.config.ts');

    it('THE OLD ADDRESS REDIRECTS TO THE NEW ONE, PERMANENTLY', () => {
        /*
         *   Verified against a built server as well as here: `/verify/ACAD-…`
         *   answered 308 to `/academy/verify/ACAD-…`, and the destination
         *   answered 200.
         */
        expect(config).toMatch(/source: '\/verify\/:certificateId'/);
        expect(config).toMatch(/destination: '\/academy\/verify\/:certificateId'/);

        //   Permanent, because the address on a printed credential never
        //   changes and a 307 invites clients to keep asking.
        const block = config.slice(config.indexOf("source: '/verify/:certificateId'"));
        expect(block.slice(0, 200)).toMatch(/permanent: true/);
    });

    it('AND IT CANNOT SWALLOW THE TWO PAGES WHOSE NAMES LOOK LIKE IT', () => {
        /*
         *   `/verify-id` and `/verify-status` are real screens — identity
         *   verification and its result. A one-character-looser pattern
         *   (`/verify:rest*`) would capture both and send people scanning their
         *   ID to a certificate verifier. Measured on the built server too:
         *   both still answer as they did.
         */
        expect(config).not.toMatch(/source: '\/verify:/);
        expect(config).not.toMatch(/source: '\/verify\/:path\*'/);

        //   The pattern is exactly one segment deep.
        expect(config).toMatch(/source: '\/verify\/:certificateId',/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#636 — the number the address carries is the number the holder has', () => {
    /*
     *   The reason the path matters at all. #430 made the verifier resolve by
     *   the certificate NUMBER as well as by the document id, because the number
     *   is the only string a third party is ever given. A correct path carrying
     *   an identifier nobody holds would be the same defect wearing a different
     *   hat.
     */
    it('THE PAGE, THE PDF AND THE LINKEDIN ENTRY ALL CARRY THE SAME NUMBER', () => {
        const page = code('src/app/academy/certificate/[certificateId]/CertificateClient.tsx');
        const pdfRoute = code('src/app/api/academy/certificate/[certificateId]/route.tsx');

        expect(page).toContain('academyCertificateNumber(session?.user?.id ?? "", courseId, completionDate)');
        expect(pdfRoute).toContain('academyCertificateNumber(session.user.id, courseId, completedAt)');
        //   And the page's footer address is built from that same number.
        expect(page).toContain('academyVerificationPath(certNumber)');
    });

    it('AND THE VERIFIER RESOLVES THAT NUMBER, not only the document id', () => {
        const reader = code('src/lib/certificate-verification-reader.ts');
        expect(reader).toContain('.where("certificateNumber", "==", certificateId)');
        //   …and refuses a row that was uploaded rather than issued, by number
        //   as well as by id — two call sites, so a number lookup is no more
        //   trusted than an id one.
        expect((reader.match(/isIssuedCertificate\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });

    it('AND THE NUMBER IS STABLE, so the printed address does not rot', () => {
        //   A number that changed per render would make every printed address
        //   stale the moment it was printed — which is what the PDF's old
        //   `CRT-{…}-{Date.now()}` did.
        const at = new Date('2026-01-15T10:00:00Z');
        const first = academyCertificateNumber('user-123', 'course-abc', at);
        expect(academyCertificateNumber('user-123', 'course-abc', at)).toBe(first);
        //   Different learners on one course do not share a number.
        expect(academyCertificateNumber('user-999', 'course-abc', at)).not.toBe(first);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the page footer prints /verify/ again              KILLED
 *     THE DEFECT: the PDF footer prints /verify/ again               KILLED
 *     THE DEFECT: CertificateGenerator prints /verify/ again         KILLED
 *     the redirect is removed                                        KILLED
 *     the redirect becomes temporary                                 KILLED
 *     the redirect widens to /verify:rest*                           KILLED
 *     the canonical path points somewhere else                       KILLED
 *     the verifier stops resolving by certificate number             KILLED
 *     the number stops depending on the learner                      KILLED
 *     a printer stops printing an address at all                     KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   "A printer stops printing an address at all" is the guard against the cheap
 *   way to pass the sweep: "nobody prints the wrong path" is also true of a
 *   certificate that tells nobody where to check it.
 *
 *   "The redirect widens to /verify:rest*" is the one that would look like a
 *   more generous fix and is a worse defect: it captures /verify-id and
 *   /verify-status — identity verification and its result — and sends somebody
 *   scanning their ID to a certificate verifier.
 *
 * ── AND THIS FILE'S OWN INSTRUMENT WAS REPAIRED BEFORE IT WAS TRUSTED ───────
 *
 *   The sweep above is a NEGATIVE assertion over every file in src, and the
 *   first draft ran it through the naive `replace(/\/\*[\s\S]*?\*\//g, '')`.
 *   That regex opens a block comment on a `/*` inside a quoted string and eats
 *   the rest of the file — strip-comments.test.ts measures twenty-two files in
 *   this repository where it does — and an eaten file contains nothing, which a
 *   negative sweep reads as nothing wrong.
 *
 *   That is "could not tell" answering as "no", over the sweep that is this
 *   finding's whole evidence. It uses lib/testing/strip-comments now.
 */
