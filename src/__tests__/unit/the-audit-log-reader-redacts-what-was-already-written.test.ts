/**
 * @jest-environment node
 */

/**
 *   #474 #468 FIXED THE WRITER AND LEFT EVERYTHING ALREADY WRITTEN ON SCREEN.
 *
 *   #468 stopped the WAVE handler putting an applicant's name, home state and
 *   calculated age into audit metadata, and stopped the cooperative withdrawal
 *   handler putting a bank account number there. The owner then opened
 *   /admin/audit-logs and asked why they were still looking at:
 *
 *       Target ID: WAVE-1786820450436-HMVQJKIV1
 *       Metadata: {
 *         "surname": "Garba ", "firstName": "Ularju ",
 *         "ageVerification": "Verified 18+ (Auto-calculated: 26)",
 *         "stateOfResidence": "Adamawa"
 *       }
 *
 *   Because that entry was written on 15 August 2026 and #468 landed on
 *   7 September. A fix to a writer applies to what is written after it. Every
 *   entry from before still holds the data, and the screen still rendered it.
 *
 *   Fourth time in this audit that a fix reached some of the doors — and the one
 *   left unfixed was the door the owner was standing at.
 *
 *   NOTHING IS DELETED, AND THAT IS NOT A COMPROMISE. An audit log that can be
 *   edited after the fact is not an audit log. The rows keep everything; the
 *   READER redacts, and replaces rather than removes, so an auditor can still
 *   see that a field was captured and go to the record — where somebody
 *   entitled to those details reads them.
 *
 *   THE KEY-ONLY VERSION WOULD HAVE LEFT THE AGE ON SCREEN. `ageVerification`
 *   is not a banned key and must not be: that an 18+ gate ran is exactly what an
 *   auditor needs. The age is inside its VALUE. That case is asserted below,
 *   because a redactor that only looked at keys would have passed every other
 *   test in this file and left the owner looking at the same number.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     redaction removed from the reader          KILLED
 *     the embedded-value rule dropped            KILLED
 *     redaction made key-removal not replacement KILLED
 *     PII_KEYS dropped from the banned list      KILLED
 *     email added to the banned list             KILLED
 *     recursion removed (nested metadata)        KILLED
 *     reword this header                         SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import {
    redactAuditMetadata,
    redactAuditEntries,
    PERSONAL_METADATA_KEYS,
    REDACTED,
} from '@/lib/audit-metadata-privacy';
import { PII_KEYS } from '@/lib/admin-pii';

/** Verbatim, from the owner's screen. */
const THE_ENTRY = {
    surname: 'Garba ',
    firstName: 'Ularju ',
    ageVerification: 'Verified 18+ (Auto-calculated: 26)',
    stateOfResidence: 'Adamawa',
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#474 — the entry the owner was looking at', () => {
    it('IS FULLY REDACTED, FIELD BY FIELD', () => {
        // The assertion the finding is about, on the actual data.
        const safe = redactAuditMetadata(THE_ENTRY) as Record<string, string>;

        expect(safe).toEqual({
            surname: REDACTED,
            firstName: REDACTED,
            ageVerification: REDACTED,
            stateOfResidence: REDACTED,
        });
    });

    it('AND THE AGE IS GONE FROM THE VALUE, NOT JUST THE KEY', () => {
        //   `ageVerification` is deliberately NOT a banned key — that a gate ran
        //   is what an auditor needs. The age is inside the string. A key-only
        //   redactor passes every other test here and leaves 26 on screen.
        const safe = JSON.stringify(redactAuditMetadata(THE_ENTRY));

        expect(safe).not.toContain('26');
        expect(safe).not.toContain('Auto-calculated');
    });

    it('AND THE SHAPE SURVIVES — a reader can see a field was recorded', () => {
        //   Removing the keys would hide that anything was captured, which is
        //   the opposite of what an audit log is for. The entry must still say
        //   "there was a surname here, go to the record".
        const safe = redactAuditMetadata(THE_ENTRY) as Record<string, string>;

        expect(Object.keys(safe).sort()).toEqual(
            ['ageVerification', 'firstName', 'stateOfResidence', 'surname'],
        );
        expect(safe.surname).toBe(REDACTED);
    });

    it('and the marker points somewhere, rather than just saying "hidden"', () => {
        expect(REDACTED).toContain('see the record');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#474 — and the rest of the entry is still readable', () => {
    it('EMAIL IS NOT REDACTED — it is the audit, not a leak', () => {
        //   An entry saying an admin unlocked an account has to say whose.
        //   Banning email would make the log useless for the thing it exists for.
        const safe = redactAuditMetadata({ email: 'ada@example.com', reason: 'unlocked' }) as any;

        expect(safe).toEqual({ email: 'ada@example.com', reason: 'unlocked' });
    });

    it('AND NEITHER ARE THE FIELDS THAT NAME THE RECORD', () => {
        const safe = redactAuditMetadata({
            applicationId: 'WAVE-123',
            status: 'approved',
            amount: 5000,
            bankName: 'Zenith',
        }) as any;

        expect(safe).toEqual({
            applicationId: 'WAVE-123',
            status: 'approved',
            amount: 5000,
            bankName: 'Zenith',
        });
    });

    it('POSITIVE CONTROL: an ordinary string is not mistaken for an embedded age', () => {
        // Without this, an over-eager value rule would blank the whole log.
        const safe = redactAuditMetadata({ note: 'Approved after review on 26 August' }) as any;

        expect(safe.note).toBe('Approved after review on 26 August');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#474 — the rule reaches nested and financial data too', () => {
    it("THE PLATFORM'S OWN PII LIST IS PART OF THE BANNED SET", () => {
        //   Imported rather than restated, for #468's reason: a key added to
        //   admin-pii.ts is redacted here without anybody remembering to. A
        //   mutation dropping `...PII_KEYS` must fail.
        for (const key of ['accountNumber', 'bvn', 'nin', 'bankDetails']) {
            expect({ key, banned: PERSONAL_METADATA_KEYS.includes(key) })
                .toEqual({ key, banned: true });
        }

        const safe = redactAuditMetadata({ amount: 100, accountNumber: '0123456789' }) as any;
        expect(safe).toEqual({ amount: 100, accountNumber: REDACTED });
    });

    it('AND IT RECURSES — metadata is free-form and nothing stops nesting', () => {
        const safe = redactAuditMetadata({
            applicant: { firstName: 'Ada', surname: 'Obi', email: 'a@b.c' },
            history: [{ dateOfBirth: '1998-01-01' }],
        }) as any;

        expect(safe.applicant).toEqual({ firstName: REDACTED, surname: REDACTED, email: 'a@b.c' });
        expect(safe.history[0]).toEqual({ dateOfBirth: REDACTED });
    });

    it('AND A CREDENTIAL IS REMOVED OUTRIGHT, NOT MARKED', () => {
        //   stripSecrets runs first. A TOTP secret is not information about a
        //   person that an auditor might need to request — it is the thing that
        //   proves they are that person, so it does not even leave a marker.
        const safe = redactAuditMetadata({ totpSecret: 'ABC123', action: 'mfa_enabled' }) as any;

        expect(safe).toEqual({ action: 'mfa_enabled' });
    });

    it('and null, undefined and primitives pass through unharmed', () => {
        expect(redactAuditMetadata(null)).toBeNull();
        expect(redactAuditMetadata(undefined)).toBeUndefined();
        expect(redactAuditMetadata(42)).toBe(42);
        expect(redactAuditEntries([{ metadata: null }, {} as any])).toEqual([{ metadata: null }, {}]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#474 — it is wired into the only door that returns metadata', () => {
    const action = () => readFileSync('src/app/actions/audit-log-actions.ts', 'utf-8');

    it('THE READER REDACTS BEFORE RETURNING', () => {
        expect(action()).toContain('redactAuditEntries(');
    });

    it('AND THE CSV EXPORT INHERITS IT RATHER THAN HAVING ITS OWN COPY', () => {
        //   The premise of only fixing one place: exportAuditLogsCSV pages
        //   through getAuditLogsAction. If it ever queried the collection
        //   directly it would need its own redaction, and this is what would
        //   tell somebody.
        const code = action();
        const from = code.indexOf('export async function exportAuditLogsCSV');
        // Bounded at the NEXT export. Slicing to end-of-file swept in
        // getAuditStatsAction, which does query the collection — legitimately,
        // since it returns only counts — and failed this on a passing codebase.
        const to = code.indexOf('export async function', from + 1);
        const exportFn = code.slice(from, to === -1 ? undefined : to);

        expect(exportFn).toContain('await getAuditLogsAction(');
        expect(exportFn).not.toContain('db.collection(COLLECTIONS.AUDIT_LOGS)');
    });

    it('AND THE STATS READER RETURNS NO METADATA — the other reader, checked', () => {
        //   getAuditStatsAction queries the same collection. It is not redacted
        //   because it returns only counts; if it ever returned rows it would
        //   need to be. This is what would notice.
        const code = action();
        const from = code.indexOf('export async function getAuditStatsAction');
        const stats = code.slice(from);

        expect(stats).toContain('db.collection(COLLECTIONS.AUDIT_LOGS)');
        expect(stats).not.toContain('data: logs');
    });

    it('AND THE WRITE-SIDE BAN FROM #468 IS STILL IN FORCE', () => {
        //   This redaction is a second line, not a replacement. New entries must
        //   still not carry the data at all — otherwise the database accumulates
        //   what only the screen refuses to show.
        const wave = readFileSync('src/app/actions/wave/_wv_applications.ts', 'utf-8');

        expect(wave).toContain('ageVerification: "passed: 18 or over"');
        expect(wave).not.toContain('Auto-calculated: ${calculatedAge}');
    });

    it('and the two lists are the same list', () => {
        // #468's ratchet scans the tree for these keys; this redacts them. They
        // drift the moment one restates the other.
        for (const key of PII_KEYS) {
            expect({ key, shared: PERSONAL_METADATA_KEYS.includes(key) }).toEqual({ key, shared: true });
        }
    });
});
