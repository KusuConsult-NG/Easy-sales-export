/**
 * @jest-environment node
 */

/**
 *   #280 EVERY UPLOAD IS PUBLICLY READABLE, INCLUDING THE IDENTITY DOCUMENTS
 *        FOUR CALLERS BELIEVED THEY WERE STORING PRIVATELY.
 *
 *        uploadFileToStorage took a third argument, `_isPublic`. Its own doc
 *        comment said the quiet part:
 *
 *            "Retained for call-site compatibility. ... the parameter no longer
 *             changes the returned URL."
 *
 *        So the removal WAS recorded — on the function. It never reached the
 *        callers that depended on it, and they went on passing it:
 *
 *          export/_ex_onboarding.ts   id-document, proof-of-address  (default)
 *          marketplace/_mp_onboarding business verification documents (false)
 *          actions/certificates.ts    certificates                    (false)
 *
 *        _mp_onboarding.ts carried this, directly above its call:
 *
 *            // Use signed URLs (private/secure) for verification docs
 *            return await uploadFileToStorage(file, destination, false);
 *
 *        There are no signed URLs. The upload signs `public_id` and `timestamp`
 *        and sends neither `type=authenticated` nor `access_mode`, so every
 *        asset is an ordinary public Cloudinary delivery URL: anyone holding
 *        the link fetches a member's ID document or proof of address, with no
 *        session and no expiry.
 *
 *        This is the class #272 and #274 found twice already — a configured
 *        control that nothing reads — in its sharpest form, because here the
 *        control is a privacy guarantee and the payload is somebody's identity
 *        documents.
 *
 * WHAT THIS COMMIT DOES AND DELIBERATELY DOES NOT DO
 * --------------------------------------------------
 * The parameter is REMOVED rather than honoured, and the exposure is REPORTED
 * rather than closed.
 *
 * Honouring it means authenticated delivery, which changes the URL shape: every
 * consumer — the onboarding screens, the admin verification review, the legacy
 * import — would have to sign on read. That needs a Cloudinary account to test
 * against, and a wrong signature format would 401 every KYC document in
 * production. Guessing at it is precisely the kind of change this audit exists
 * to stop.
 *
 * What is safe and correct NOW is to stop the codebase asserting a control it
 * does not have, so the exposure is visible rather than believed handled. The
 * assertions below are therefore about CLAIMS, not about privacy — they cannot
 * prove the files are protected, because they are not.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

const STORAGE = 'src/lib/storage-admin.ts';

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
}

function codeOnly(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

const APP_FILES = walk(join(process.cwd(), 'src'))
    .map((f) => f.slice(process.cwd().length + 1))
    .filter((f) => !f.includes('__tests__'));

// ─────────────────────────────────────────────────────────────────────────────
describe('#280 — no caller is told it is getting a private upload', () => {
    it('THE UPLOADER TAKES NO PRIVACY FLAG AT ALL', () => {
        // The defect in one line: a parameter named for a security property,
        // defaulted, and never read. Callers passed it and believed it.
        const src = codeOnly(STORAGE);
        const sig = src.slice(
            src.indexOf('export async function uploadFileToStorage'),
            src.indexOf('): Promise<string>'),
        );

        expect(sig).not.toMatch(/isPublic|isPrivate|_public|signed/i);
    });

    it('AND NO CALL SITE PASSES A THIRD ARGUMENT', () => {
        // Was: eight, four of them passing `false` for identity documents and
        // verification paperwork. Derived rather than listed, so a new caller
        // reviving the habit is caught too.
        const offenders = APP_FILES
            .flatMap((f) => codeOnly(f).split('\n').map((line, i) => ({ at: `${f}:${i + 1}`, line })))
            .filter(({ line }) => /uploadFileToStorage\([^)]*,[^)]*,[^)]*\)/.test(line))
            .map((o) => o.at);

        expect(offenders).toEqual([]);
    });

    it('and nothing in src claims a signed or private upload', () => {
        // The comment in _mp_onboarding.ts is why this exists: the parameter
        // could have been removed cleanly and that sentence would still have
        // told the next reader their KYC documents were secured.
        //
        // Comments are read here ON PURPOSE — a false assurance in a comment is
        // the thing being ratcheted, so stripping comments first would defeat
        // it. The #280 write-ups are excluded by requiring the claim to sit
        // near an upload call rather than anywhere in the file.
        const offenders: string[] = [];

        for (const f of APP_FILES) {
            const lines = readFileSync(join(process.cwd(), f), 'utf-8').split('\n');
            lines.forEach((line, i) => {
                if (!/signed url|private\/secure|securely stored/i.test(line)) return;

                // Only `//` comments and code count. A `/** ... */` block is
                // where findings get WRITTEN UP — this file's own header quotes
                // both false claims verbatim — and flagging those would make
                // recording a defect impossible. The claims that mislead are
                // the ones sitting beside the call.
                if (line.trim().startsWith('*')) return;
                if (/#280/.test(lines.slice(Math.max(0, i - 12), i + 1).join('\n'))) return;
                const near = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
                if (/uploadFileToStorage\(/.test(near)) offenders.push(`${f}:${i + 1}`);
            });
        }

        // Was: src/app/actions/marketplace/_mp_onboarding.ts, "Use signed URLs
        // (private/secure) for verification docs".
        expect(offenders).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#280 — the exposure itself, pinned as OPEN', () => {
    /**
     * This block asserts the vulnerability still exists. That is intentional
     * and it is not a test of correct behaviour — it is a marker.
     *
     * When the owner decides how Cloudinary should store private assets and
     * somebody implements authenticated delivery, THESE TESTS FAIL. That is the
     * signal to delete this block and write real ones, and it is the only
     * mechanism that stops "reported to the owner" from quietly becoming
     * "forgotten".
     */
    it('the upload still sends no authenticated type — STILL OPEN, owner decision', () => {
        const src = codeOnly(STORAGE);

        expect(src).not.toMatch(/type=authenticated|access_mode|access_control/);
    });

    it('and the signature still covers only public_id and timestamp', () => {
        // Named precisely so whoever implements this knows what to change: the
        // signed parameter string is what Cloudinary validates, so an
        // authenticated upload has to appear in BOTH the signature and the form.
        const src = codeOnly(STORAGE);

        expect(src).toContain('`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`');
    });

    it('and the finding is written down where the code is', () => {
        // A report that lives only in a chat message is a report that is lost.
        const raw = readFileSync(join(process.cwd(), STORAGE), 'utf-8');

        // Matched on the FILE PATHS the finding names rather than on its prose:
        // the first version asserted a sentence that the comment wrapping had
        // split across two lines, so it failed against a write-up that was
        // there. The paths are what a reader needs anyway.
        expect(raw).toContain('#280');
        expect(raw).toContain('export/_ex_onboarding.ts');
        expect(raw).toContain('marketplace/_mp_onboarding');
    });
});
