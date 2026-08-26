/**
 * @jest-environment node
 */

/**
 *   #300 ERASURE DESTROYED RECORDS INSTEAD OF RETIRING THEM.
 *
 *        OWNER DECISION, and it closes #280 and #292 together: nothing is to be
 *        deleted — not a Cloudinary asset, and not a row that was wrongly
 *        programmed. The code gets fixed and the data stays recoverable.
 *
 *        Three things in deleteAccountAction were outright destruction:
 *
 *            kycSnap.docs.forEach(doc => batch.delete(doc.ref));
 *            batch.delete(db.collection(SELLER_VERIFICATIONS).doc(userId));
 *            batch.delete(db.collection(WALLETS).doc(userId));
 *
 *        THE WALLET ONE CONTRADICTED THE FUNCTION'S OWN COMMENT. Fifteen lines
 *        below it, the scrub keeps the uid "so that database foreign keys (like
 *        'sellerId' on an order or 'buyerId' on a farm purchase) do not break".
 *        A wallet is the other end of exactly those keys — every
 *        wallet_transactions row points at it. The blocker check above refuses
 *        to erase an account holding a balance, so no naira was lost; what was
 *        lost was the record that the account had ever existed.
 *
 *        AND `documents` WENT WITH IT. That field on the user row is the only
 *        place recording WHICH Cloudinary assets belong to a person, and
 *        nothing in this codebase ever removes an asset — every reference to
 *        their API is an upload. So erasure destroyed the index and left the
 *        files: the worst of both. That was #292, reported and left open
 *        because deleting production assets is not an audit's call.
 *
 *        It is not the call being made. The references are COPIED to a
 *        server-only retention record before the user row is scrubbed, and the
 *        three rows are MARKED rather than deleted.
 *
 * WHY THE RETENTION RECORD IS SAFE WHERE IT SITS
 * ----------------------------------------------
 * COLLECTIONS.ERASURE_RETENTION lives inside document_collections, which
 * migration 004 put under row-level security with NO policies at all. Only the
 * service key reaches it — no browser session, no member, no admin screen. It
 * is a controller's record, not a second copy on a page.
 *
 * THE TENSION, STATED RATHER THAN HIDDEN
 * --------------------------------------
 * Retaining identity-document links after a right-to-erasure request is a
 * position, not a neutral default. It is the owner's decision, applied as
 * given. The mitigations are that the record is server-only and holds links
 * rather than documents. If the position changes, lib/user-erasure.ts is the
 * one place that has to change.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { erasureRetentionRecord, erasedOwnerMarker, ERASED_FIELDS } from '@/lib/user-erasure';
import { COLLECTIONS } from '@/lib/types/firestore';

const ACTION = 'src/app/actions/user.ts';

function code(rel: string): string {
    return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'));
}

const src = code(ACTION);

/** deleteAccountAction's body, where the deletes lived. */
function erasureBody(): string {
    const start = src.indexOf('async function _deleteUserAccountAction');
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start);
    const end = rest.indexOf('\nasync function');
    return rest.slice(0, end > 0 ? end : rest.length);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#300 — nothing is deleted', () => {
    const body = erasureBody();

    it('THE WALLET IS NEVER DROPPED', () => {
        // The one that contradicted the function's own reason for keeping uid.
        expect(body).not.toMatch(/batch\.delete\([^)]*WALLETS/);
    });

    it('NOR THE SELLER VERIFICATION, NOR ANY KYC ROW', () => {
        expect(body).not.toMatch(/batch\.delete\([^)]*SELLER_VERIFICATIONS/);
        expect(body).not.toMatch(/batch\.delete\(doc\.ref\)/);
    });

    it('THERE IS NO batch.delete LEFT IN THE ERASURE AT ALL', () => {
        // Stated as a property rather than three exclusions, so a fourth
        // collection added later cannot be deleted quietly.
        expect(body).not.toContain('batch.delete(');
    });

    it('and the three records are MARKED instead', () => {
        expect(body).toMatch(/kycSnap\.docs\.forEach\(doc => batch\.update\(doc\.ref, erasedOwnerMarker/);
        expect(body).toMatch(/SELLER_VERIFICATIONS[\s\S]{0,120}erasedOwnerMarker/);
        expect(body).toMatch(/WALLETS[\s\S]{0,120}erasedOwnerMarker/);
    });

    it('the marks merge rather than replace, so nothing on those rows is lost', () => {
        // `set` without merge would overwrite the wallet with three fields,
        // which is deletion wearing a different name.
        const marks = body.match(/erasedOwnerMarker\(userId\),\s*\{ merge: true \}/g) ?? [];

        expect(marks.length).toBeGreaterThanOrEqual(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#300 — the document index survives the erasure', () => {
    const body = erasureBody();

    it('THE REFERENCES ARE COPIED BEFORE THE USER ROW IS SCRUBBED', () => {
        // Order matters: userErasurePatch deletes `documents`, so reading it
        // afterwards would read nothing. Both use the same snapshot, but the
        // retention write has to be in the batch before the scrub is applied.
        const retained = body.indexOf('erasureRetentionRecord(');
        const scrubbed = body.indexOf('userErasurePatch(userId)');

        expect(retained).toBeGreaterThan(-1);
        expect(scrubbed).toBeGreaterThan(retained);
    });

    it('the record carries the Cloudinary references', () => {
        const record = erasureRetentionRecord('u-1', {
            email: 'ada@example.com',
            documents: { validId: 'https://res.cloudinary.com/x/id.pdf' },
        });

        expect(record.userId).toBe('u-1');
        expect(record.documents).toEqual({ validId: 'https://res.cloudinary.com/x/id.pdf' });
        expect(record.reason).toBe('right_to_erasure');
        expect(record.retainedAt).toEqual(expect.any(String));
    });

    it('and copes with a user who never uploaded anything', () => {
        // A member with no documents must not break the erasure.
        const record = erasureRetentionRecord('u-2', { email: 'b@e.com' });

        expect(record.documents).toBeNull();
    });

    it('AND IS NOT A SECOND COPY OF THE PROFILE', () => {
        // The point is the asset index, not a backup of the person. Copying
        // BVN, NIN or next of kin here would defeat the erasure entirely.
        const record = erasureRetentionRecord('u-3', {
            email: 'c@e.com',
            documents: {},
            bvn: '22222222222',
            nin: '11111111111',
            nextOfKin: { name: 'Someone Else' },
            bankAccountNumber: '0123456789',
        });

        for (const leaked of ['bvn', 'nin', 'nextOfKin', 'bankAccountNumber']) {
            expect({ leaked, present: leaked in record }).toEqual({ leaked, present: false });
        }
    });

    it('the user row still loses every PII field it lost before', () => {
        // Vacuity guard from the other side. Retention must not have quietly
        // become "keep it on the row".
        expect(ERASED_FIELDS).toContain('documents');
        expect(ERASED_FIELDS).toContain('bvn');
        expect(ERASED_FIELDS).toContain('nextOfKin');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#300 — the marker says why a row is inert', () => {
    it('records that the owner erased, and when', () => {
        const mark = erasedOwnerMarker('u-9');

        expect(mark.ownerErased).toBe(true);
        expect(mark.ownerErasedUserId).toBe('u-9');
        expect(mark.ownerErasedAt).toEqual(expect.any(String));
    });

    it('and carries nothing else, so it cannot overwrite the row it marks', () => {
        expect(Object.keys(erasedOwnerMarker('u-9')).sort())
            .toEqual(['ownerErased', 'ownerErasedAt', 'ownerErasedUserId']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#300 — the retention collection is server-only', () => {
    it('it exists, and is a document_collections name', () => {
        expect(COLLECTIONS.ERASURE_RETENTION).toBe('erasure_retention');
    });

    it('AND MIGRATION 004 LEAVES document_collections WITH NO POLICY', () => {
        /**
         * The safety argument, checked rather than asserted. RLS is enabled on
         * document_collections and every CREATE POLICY in that migration is
         * commented out, so the table is deny-all to the browser role and
         * reachable only through the service key. If somebody adds a permissive
         * policy later, this fails and the retention record needs revisiting.
         */
        const migration = readFileSync(
            join(process.cwd(), 'supabase/migrations/004_enable_row_level_security.sql'),
            'utf-8',
        );

        expect(migration).toMatch(/ALTER TABLE document_collections\s+ENABLE ROW LEVEL SECURITY/);

        const livePolicies = migration.split('\n')
            .filter((l) => /^\s*CREATE POLICY/i.test(l));

        expect(livePolicies).toEqual([]);
    });

    it('and nothing in the browser layer reads it', () => {
        // A page that rendered this would undo the whole arrangement.
        const offenders: string[] = [];
        const walk = (dir: string) => {
            for (const e of require('fs').readdirSync(dir)) {
                const full = join(dir, e);
                if (require('fs').statSync(full).isDirectory()) {
                    if (!full.includes('__tests__')) walk(full);
                } else if (full.endsWith('.tsx')) {
                    if (/ERASURE_RETENTION|erasure_retention/.test(readFileSync(full, 'utf-8'))) {
                        offenders.push(full.slice(process.cwd().length + 1));
                    }
                }
            }
        };
        walk(join(process.cwd(), 'src'));

        expect(offenders).toEqual([]);
    });
});
