/**
 * @jest-environment node
 */

/**
 *   #431 THE SELLER'S KYC DOCUMENTS WERE DEMANDED, DISCARDED, AND REVIEWED AS
 *   FILENAMES.
 *
 *   Found by a read/write census of every collection — which collections have
 *   writers and no readers, and which have readers and no writers. That census
 *   needed SEVEN corrections before it could be believed, and they are recorded
 *   at the foot of this header because the instrument is the finding's evidence.
 *
 *   WHAT IT FOUND. `_document_uploads` is read by exactly one place —
 *   /api/admin/documents/[docId] — and is written by NOTHING: not in src, not
 *   in scripts, not by any migration. Pulling on that:
 *
 *   /api/marketplace/submit-verification REFUSES a submission without all three
 *   documents, reads them out of the form, and stored:
 *
 *       documents: {
 *           businessDoc:  `placeholder_${businessDoc.name}`,
 *           idDoc:        `placeholder_${idDoc.name}`,
 *           addressProof: `placeholder_${addressProof.name}`,
 *       }
 *
 *   The bytes went nowhere. /admin/marketplace/sellers then rendered three
 *   "View Document" links built from those strings —
 *   /api/admin/documents/placeholder_passport.pdf — against the route reading
 *   the table nothing writes. Every one 404'd.
 *
 *   So a seller submits identity, business registration and proof of address;
 *   none is stored; and the admin deciding whether to approve them sees a link
 *   that fails. The decision is made on a filename.
 *
 *   That is #284's and #285's shape — bank verification simulated on both
 *   onboarding paths, a typed BVN marking itself verified — a third time, on
 *   the document half of the same KYC.
 *
 *   WHAT IS FIXED, AND WHAT CANNOT BE
 *     - the submit route uploads the three files and stores their URLs, and a
 *       failed upload FAILS THE SUBMISSION rather than recording it as received;
 *     - the review screen links to what was stored, through one rule rather
 *       than three copies of the expression;
 *     - rows written before this carry a placeholder and the documents are gone
 *       — nobody stored them. Those are named plainly instead of being rendered
 *       as a link that fails, because a reviewer has to tell "missing" from
 *       "viewer broken" to know to ask for a resubmission;
 *     - the dead route is retired behind a flag, and the three defects it
 *       carried besides being dead are fixed rather than preserved: a
 *       hand-written admin role list read off the stale JWT (the class #364 and
 *       #356 swept, which missed this route), an inline response with a
 *       caller-stored MIME type on the admin origin, and a catch that logged
 *       nothing.
 *
 *   NOT FIXED, AND SAID PLAINLY: the documents land on public Cloudinary URLs.
 *   #280 recorded that and the owner closed it fix-never-delete. Storing them
 *   publicly is strictly better than discarding them; the exposure is the one
 *   already on the record.
 *
 *   THE INSTRUMENT NEEDED SEVEN CORRECTIONS, AND EACH ONE WAS A FALSE FINDING
 *   I WOULD OTHERWISE HAVE REPORTED:
 *
 *     1. a 400-character window after the collection name missed writes through
 *        a held ref (`const r = db.collection(X).doc(id)` … `t.set(r, …)`) —
 *        it called wave_withdrawals never-written;
 *     2. the repo's own AST scanner drops any write whose payload is not an
 *        object literal, so `.add(messageData)` was invisible — it called
 *        escrow_messages never-written;
 *     3. money and capacity paths write through Postgres CAS functions taking
 *        the table as a STRING ARGUMENT (`{ table: "cooperative_loans" }`),
 *        which no collection-chain scanner can see;
 *     4. COLLECTIONS holds ALIASES — `REVIEWS: "product_reviews"` is labelled
 *        as one — so a census keyed on the constant reported a table read under
 *        one name and written under the other;
 *     5. refs pushed into an array and fetched with getAll are reads no
 *        `.get()` scan sees — it called bounced_emails never-read;
 *     6. a query assigned to a variable and executed later is likewise a read —
 *        it called announcements never-read;
 *     7. some collections are passed to helpers as `collection: COLLECTIONS.X`
 *        rather than used in a chain — it called cooperatives_invites
 *        never-written.
 *
 *   Of the ten candidates that survived all seven, three were ALREADY
 *   registered and pinned by existing suites (vendor_profiles,
 *   impersonation_tokens, course_certificates), one is deliberate and says so
 *   in its own header (erasure_retention is "a record for the controller, not a
 *   second copy on a page"), and one is this. That ratio is why the census is
 *   NOT added as a ratchet: at seven corrections and a 1-in-10 hit rate it
 *   would fail on noise more often than on defects, and a check that cries wolf
 *   gets disabled. It was a search, and it is written up as one.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the route stores placeholders again            KILLED
 *     a failed upload is recorded as success         KILLED
 *     the screen links to the dead viewer again      KILLED
 *     a placeholder is rendered as a working link    KILLED
 *     a bare filename is treated as a location       KILLED
 *     the retired route stops refusing               KILLED
 *     the retired route reads the JWT roles again    KILLED
 *     reword the header prose                        SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    sellerDocumentState,
    UNSTORED_DOCUMENT_PREFIX,
    UNSTORED_DOCUMENT_MESSAGE,
} from '@/lib/seller-verification-document';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });

const SUBMIT = 'src/app/api/marketplace/submit-verification/route.ts';
const SCREEN = 'src/app/admin/marketplace/sellers/page.tsx';
const VIEWER = 'src/app/api/admin/documents/[docId]/route.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#431 — the documents the route demands are actually stored', () => {
    it('THE PLACEHOLDER WRITE IS GONE', () => {
        // The whole defect in one line: it demanded the files and stored their
        // names.
        const src = code(SUBMIT);
        expect(src).not.toMatch(/placeholder_\$\{/);
        expect(src).not.toMatch(/`placeholder_/);
    });

    it('and the three files are uploaded through the shared storage helper', () => {
        const src = code(SUBMIT);
        expect(src).toMatch(/uploadFileToStorage\(file, `seller_verification\/\$\{userId\}\//);
        for (const label of ['"business"', '"identity"', '"address"']) {
            expect({ label, uploaded: src.includes(`storeDocument(`) && src.includes(label) })
                .toEqual({ label, uploaded: true });
        }
    });

    it('and what is stored is the URL the upload returned', () => {
        expect(code(SUBMIT)).toMatch(
            /documents: \{\s*businessDoc: businessDocUrl,\s*idDoc: idDocUrl,\s*addressProof: addressProofUrl,/);
    });

    it('A FAILED UPLOAD FAILS THE SUBMISSION — it is not recorded as received', () => {
        /**
         * The half that keeps this from becoming the same defect in a new form.
         * A verification request whose evidence was not stored is not a
         * verification request; writing the row anyway is how the original
         * looked like working software for as long as it did.
         */
        const src = code(SUBMIT);
        // Anchored on the WRITE, not on the first mention of the collection —
        // the duplicate-submission check names it earlier in the file, and a
        // bare indexOf finds that instead. The same trap cost two assertions in
        // #430; it caught two more here on the first run.
        const failure = src.indexOf('catch (uploadError)');
        const write = src.indexOf('COLLECTIONS.SELLER_VERIFICATIONS).doc(userId).set(');
        expect(failure).toBeGreaterThan(-1);
        expect(write).toBeGreaterThan(-1);
        expect(failure).toBeLessThan(write);
        expect(src).toMatch(/status: 502/);
        expect(src).toMatch(/could not be uploaded/);
    });

    it('and the route still REFUSES a submission missing any document', () => {
        // The pre-existing check, which must survive the change — it is the
        // reason the files are there to store.
        expect(code(SUBMIT)).toMatch(/if \(!businessDoc \|\| !idDoc \|\| !addressProof\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#431 — a reviewer can tell a stored document from one that is gone', () => {
    it('A STORED URL IS OPENABLE', () => {
        expect(sellerDocumentState('https://res.cloudinary.com/x/y.pdf'))
            .toEqual({ kind: 'stored', href: 'https://res.cloudinary.com/x/y.pdf' });
        expect(sellerDocumentState('/uploads/seller/abc.pdf'))
            .toEqual({ kind: 'stored', href: '/uploads/seller/abc.pdf' });
    });

    it('and a LEGACY PLACEHOLDER is named, not linked', () => {
        // The version of this defect that would survive the fix: render the
        // placeholder as "View Document", the reviewer clicks, gets a 404, and
        // cannot tell whether the document is missing or the viewer is broken.
        expect(sellerDocumentState(`${UNSTORED_DOCUMENT_PREFIX}passport.pdf`))
            .toEqual({ kind: 'unstored', fileName: 'passport.pdf' });
    });

    it('and a BARE FILENAME is not treated as a location either', () => {
        // The failure being fixed is a link built out of a string that was
        // never a location, so anything unrecognised fails closed.
        expect(sellerDocumentState('passport.pdf').kind).toBe('unstored');
        expect(sellerDocumentState('some/relative/path.pdf').kind).toBe('unstored');
    });

    it('and a protocol-relative value is NOT openable — #262\'s shape', () => {
        // "//evil.example/x" is an off-site link wearing a path's clothes.
        expect(sellerDocumentState('//evil.example/x.pdf').kind).toBe('unstored');
    });

    it('and nothing submitted at all is "absent", which is a different statement', () => {
        for (const v of [undefined, null, '', '   ', 0, {}]) {
            expect({ v: String(v), kind: sellerDocumentState(v).kind })
                .toEqual({ v: String(v), kind: 'absent' });
        }
    });

    it('THE SCREEN NO LONGER LINKS TO THE DEAD VIEWER', () => {
        const src = code(SCREEN);
        expect(src).not.toMatch(/api\/admin\/documents\//);
        expect(src).toMatch(/sellerDocumentState\(value\)/);
        expect(src).toMatch(/UNSTORED_DOCUMENT_MESSAGE/);
    });

    it('and it states the rule ONCE for all three documents', () => {
        /**
         * The expression was written out three times, once per document. That
         * is the shape behind #425, #426 and #429 — the fix reaching one of the
         * copies — so the count is asserted, not assumed.
         */
        const src = code(SCREEN);
        expect([...src.matchAll(/sellerDocumentState\(/g)].length).toBe(1);
        for (const label of ['"Business"', '"ID"', '"Address Proof"']) {
            expect({ label, present: src.includes(label) }).toEqual({ label, present: true });
        }
    });

    it('and the message tells the reviewer what to do about it', () => {
        expect(UNSTORED_DOCUMENT_MESSAGE).toMatch(/re-upload/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#431 — the viewer that could never serve anything is retired', () => {
    it('IT REFUSES BY DEFAULT', () => {
        const src = code(VIEWER);
        expect(src).toMatch(/if \(!legacyDocumentFallbackEnabled\(\)\)/);
        expect(src).toMatch(/status: 410/);
    });

    it('and the flag is read at CALL time, so reviving it needs no redeploy', () => {
        expect(code(VIEWER)).toMatch(
            /return process\.env\[LEGACY_FLAG\] === ENABLED_VALUE;/);
    });

    it('and the permission gate runs BEFORE the retirement notice', () => {
        // Otherwise the refusal itself becomes a way for an unauthenticated
        // caller to learn about the endpoint.
        const src = code(VIEWER);
        // The notice anchor is searched FROM the gate: the flag reader's own
        // definition appears above the handler, so a bare indexOf finds the
        // declaration rather than the call inside GET.
        const gate = src.indexOf('await requireAdmin(');
        const notice = src.indexOf('if (!legacyDocumentFallbackEnabled())', gate);
        expect(gate).toBeGreaterThan(-1);
        expect(notice).toBeGreaterThan(gate);
    });

    it('and the hand-written admin role list is GONE — #364/#356 missed this route', () => {
        const src = code(VIEWER);
        expect(src).not.toMatch(/"cooperative_manager"/);
        expect(src).not.toMatch(/superadmin/);
        // And it no longer reads the JWT claim, which is stale for up to eight
        // hours after a revocation.
        expect(src).not.toMatch(/session\.user\.roles/);
        expect(src).toMatch(/requireAdmin\("users:read"\)/);
    });

    it('and it no longer serves stored bytes inline under a stored MIME type', () => {
        /**
         * `Content-Type: data.mimeType` with `Content-Disposition: inline` on
         * the admin origin is a stored-XSS shape: whoever wrote the row chooses
         * what the admin's browser executes. Unreachable today only because
         * nothing writes the collection — which is not a control.
         */
        const src = code(VIEWER);
        expect(src).not.toMatch(/data\.mimeType/);
        expect(src).not.toMatch(/inline; filename/);
        expect(src).toMatch(/"Content-Type": "application\/octet-stream"/);
        expect(src).toMatch(/attachment; filename/);
    });

    it('and its catch logs rather than swallowing — #308', () => {
        expect(code(VIEWER)).toMatch(/logger\.error\("\[admin\/documents\] failed"/);
    });

    it('and the premise holds — nothing writes that collection', () => {
        /**
         * The fact the retirement rests on, checked rather than asserted. If a
         * writer is ever added, this fails and the retirement should be
         * revisited rather than silently kept.
         */
        const { readdirSync, statSync } = require('fs') as typeof import('fs');
        const files: string[] = [];
        const walk = (d: string) => {
            for (const n of readdirSync(d)) {
                const p = join(d, n);
                if (statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p); }
                else if (/\.(ts|tsx|sql)$/.test(n)) files.push(p);
            }
        };
        walk(join(ROOT, 'src'));
        walk(join(ROOT, 'supabase'));

        const writers = files.filter((f) => {
            if (f.includes('__tests__')) return false;
            const src = stripComments(readFileSync(f, 'utf-8'), { label: f });
            if (!/DOCUMENT_UPLOADS|_document_uploads/.test(src)) return false;
            // A write, or a table creation.
            return /DOCUMENT_UPLOADS\)[^\n]*\.(set|add|update)\(/.test(src)
                || /create table[^\n]*_document_uploads/i.test(src);
        }).map((f) => relative(ROOT, f));

        expect({ writers }).toEqual({ writers: [] });
    });
});
