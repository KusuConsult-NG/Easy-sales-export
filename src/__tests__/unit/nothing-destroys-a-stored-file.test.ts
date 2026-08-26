/**
 * @jest-environment node
 */

/**
 *   #303 THE LAST OF THE DESTRUCTIVE DOORS, AND THE ONLY ONES THAT REACHED
 *        STORAGE.
 *
 *        The owner's instruction names this case exactly: nothing on the file
 *        store is to be destroyed. Two certificate doors did it, and three
 *        other places destroyed a record whose only purpose was to survive.
 *
 *        CERTIFICATES, TWICE. api/certificates/[id] took the storage path off
 *        the row and called `file.delete()`; actions/certificates.ts parsed the
 *        object path out of the stored URL and called
 *        `bucket.file(objectPath).delete({ ignoreNotFound: true })`. Both then
 *        deleted the row.
 *
 *        Both wrapped the storage call in a catch that carried on. One logged
 *        "Storage delete failed (file may not exist)"; the other said it
 *        outright — "Log but don't fail — Firestore doc is still deleted". So
 *        the two possible outcomes were: the member loses their proof of a
 *        qualification irreversibly, or the file survives with nothing left
 *        recording whose it was. That second one is #292's shape on a different
 *        bucket.
 *
 *        ADMIN_USERS. Revoking someone's last privileged role deleted their row
 *        from the admin register. The privileges are removed from the user
 *        document two statements earlier — that is what revokes access — so
 *        this row's only job was to record that they had been an admin, which
 *        is what an audit of their past actions has to check against.
 *
 *        THE MIGRATION'S OWN SOURCE ROW. migrateLegacyUserData copied a
 *        cooperative member to the new key and then deleted the original, with
 *        a comment calling it "Safely delete". The copy is a set(..., { merge:
 *        true }) whose success is never verified, the delete was
 *        fire-and-forget behind a .catch() that only logged, and it runs
 *        unattended ON LOGIN. Its own sibling branch — for rows matched by
 *        query rather than by id — already repointed instead of deleting.
 *
 *        THE EMAIL QUEUE, BACKWARDS. A permanent failure is marked `status:
 *        "failed"` with the error and stays. A SUCCESS was deleted. So the
 *        collection could answer "what never went out" and had nothing at all
 *        on "was the member's loan approval emailed, and when". The code was
 *        visibly undecided: "We'll delete to keep collection clean, or move to
 *        'sent_log' if audit needed. For resilience, let's just delete."
 *
 * WHAT IS DELIBERATELY LEFT DELETING
 * ----------------------------------
 * Three purges are retention policy rather than accidental destruction, and
 * keeping their rows would be the defect:
 *
 *   lib/audit-log.ts        purges entries past a configured retention period.
 *                           A retention policy that retains for ever is not one.
 *   api/admin/password-resets  purges USED and EXPIRED reset tokens. A spent
 *                           credential artefact kept for ever is a liability.
 *   lib/mfa.ts              deletes a single-use code once it is used. That is
 *                           what single-use means.
 *
 * my-data.ts's deleteMyNotification is also left alone: a member dismissing
 * their own notification is transient UI state, not a record of anything.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

function code(rel: string): string {
    return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'));
}

const CERT_ROUTE = 'src/app/api/certificates/[id]/route.ts';
const CERT_ACTION = 'src/app/actions/certificates.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#303 — NOTHING IN THIS CODEBASE DELETES A STORED FILE', () => {
    /**
     * Stated as a property over the whole tree rather than as two exclusions,
     * because the point is not that these two doors were fixed — it is that a
     * third one must not appear. Every storage delete API this codebase could
     * reach is listed.
     */
    const STORAGE_DELETES = [
        /\.file\([^)]*\)\.delete\(/,     // firebase-admin storage
        /bucket\.file\([^)]*\)\.delete/,
        /destroy\(\s*['"`]?[^)]*public_id/, // cloudinary destroy
        /cloudinary[^\n]*\.destroy\(/,
    ];

    const FILES = [
        CERT_ROUTE,
        CERT_ACTION,
        'src/lib/storage-admin.ts',
        'src/app/actions/upload.ts',
        'src/app/api/upload/route.ts',
        'src/app/actions/user.ts',
    ];

    it.each(FILES)('%s deletes nothing from the file store', (path) => {
        const src = code(path);
        for (const pattern of STORAGE_DELETES) {
            expect({ path, pattern: String(pattern), matched: pattern.test(src) })
                .toEqual({ path, pattern: String(pattern), matched: false });
        }
    });

    it('and the certificate doors keep the ROW as well', () => {
        expect(code(CERT_ROUTE)).not.toMatch(/\.delete\(\)/);
        expect(code(CERT_ACTION)).not.toMatch(/certRef\.delete\(\)/);
    });

    it('BOTH doors mark instead — fixing one of a pair is the recurring mistake', () => {
        for (const path of [CERT_ROUTE, CERT_ACTION]) {
            const src = code(path);
            expect({ path, marks: src.includes('retirementPatch(') && src.includes('removedByOwner: true') })
                .toEqual({ path, marks: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#303 — a removed certificate still looks removed', () => {
    /**
     * The row surviving must not become a way to reach something somebody
     * deleted. Both listings filter it and the download refuses it — and the
     * download matters most, because it used to 404 on the row's ABSENCE, so
     * keeping the row would silently restore access to every certificate anyone
     * had ever removed.
     */
    it('BOTH listings filter it — and they read DIFFERENT collections', () => {
        // certificates.ts reads COLLECTIONS.CERTIFICATES; api/certificates
        // reads COLLECTIONS.USER_CERTIFICATES. Two collections behind one
        // feature, so neither filter covers the other.
        expect(code(CERT_ACTION)).toMatch(/COLLECTIONS\.CERTIFICATES/);
        expect(code(CERT_ACTION)).toMatch(/isRetired\(/);

        expect(code('src/app/api/certificates/route.ts')).toMatch(/COLLECTIONS\.USER_CERTIFICATES/);
        expect(code('src/app/api/certificates/route.ts')).toMatch(/filter\(doc => !isRetired\(doc\.data\(\)\)\)/);
    });

    it('AND THE DOWNLOAD REFUSES IT', () => {
        const src = code('src/app/api/certificates/download/route.ts');

        expect(src).toMatch(/if \(isRetired\(certData\)\)/);
        // Refused before the redirect, not after it.
        expect(src.indexOf('isRetired(certData)'))
            .toBeLessThan(src.indexOf('NextResponse.redirect'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#303 — the three other records that had to survive', () => {
    it('REVOKING ADMIN KEEPS THE REGISTER ENTRY', () => {
        const src = code('src/app/api/admin/add-roles/route.ts');

        expect(src).not.toMatch(/ADMIN_USERS\)\.doc\(userId\)\.delete\(\)/);
        expect(src).toMatch(/active: false/);
        expect(src).toMatch(/revokedRoles: roles/);
    });

    it('THE MIGRATION KEEPS ITS SOURCE ROW, matching its own other branch', () => {
        const src = code('src/lib/user-migration.ts');

        expect(src).not.toMatch(/memberSourceRef\.delete\(\)/);
        expect(src).toMatch(/_migratedTo: supabaseUid/);
        // The branch that was already correct is still correct.
        expect(src).toMatch(/userId: supabaseUid,\s*_legacyFirebaseUid: firebaseUid/);
    });

    it('A SENT EMAIL IS RECORDED, not destroyed', () => {
        const src = code('src/app/api/cron/process-email-queue/route.ts');

        expect(src).not.toMatch(/EMAIL_QUEUE\)\.doc\(doc\.id\)\.delete\(\)/);
        expect(src).toMatch(/status: "sent"/);
        expect(src).toMatch(/sentAt:/);
        // And it still leaves the pending loop, which is what deleting achieved.
        expect(src).toMatch(/\.where\("status", "==", "pending"\)/);
    });

    it('while the failure branch is unchanged — it was already right', () => {
        expect(code('src/app/api/cron/process-email-queue/route.ts'))
            .toMatch(/status: "failed"/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#303 — the purges that are policy, and stay', () => {
    /**
     * A vacuity guard from the other side. If a later change makes "nothing is
     * ever deleted" absolute, these three stop doing their job — an audit log
     * that never expires, spent password-reset tokens kept for ever, and a
     * single-use MFA code that is not single-use.
     */
    it('the audit log still purges past its retention period', () => {
        const src = code('src/lib/audit-log.ts');

        expect(src).toMatch(/batch\.delete\(doc\.ref\)/);
        expect(src).toMatch(/retentionDays/);
    });

    it('used and expired password-reset tokens are still purged', () => {
        const src = code('src/app/api/admin/password-resets/route.ts');

        expect(src).toMatch(/batch\.delete\(ref\)/);
        expect(src).toMatch(/\.where\("used", "==", true\)/);
    });

    it('and a single-use MFA code is still consumed', () => {
        expect(code('src/lib/mfa.ts')).toMatch(/codeDocRef\.delete\(\)/);
    });
});
