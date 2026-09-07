/**
 * @jest-environment node
 */

/**
 *   #468 THE WAVE APPLICATION WROTE THE APPLICANT'S NAME, STATE AND AGE INTO
 *   THE AUDIT LOG, WHICH EVERY ADMIN ROLE CAN READ.
 *
 *   Noticed by the owner on /admin/audit-logs — "the audit logs show WAVE
 *   metadata". They do, and this is what was in it:
 *
 *       metadata: {
 *           surname: validatedData.surname,
 *           firstName: validatedData.firstName,
 *           stateOfResidence: validatedData.stateOfResidence,
 *           ageVerification: `Verified 18+ (Auto-calculated: ${calculatedAge})`
 *       }
 *
 *   The age itself, not the verdict. The screen renders metadata as raw JSON,
 *   and `audit:read` is held by ALL TEN admin roles — super_admin, admin,
 *   moderator, support, and every module admin. So a marketplace_admin or a
 *   support agent could read the name, home state and age of every woman who
 *   applied to WAVE, from a screen that has nothing to do with WAVE.
 *
 *   THE RULE WAS ALREADY WRITTEN, ONE FILE OVER. _wv_admin_live.ts logs the
 *   roomName and deliberately not the roomKey:
 *
 *       "the audit log is read by every admin role, and the key is the
 *        credential that opens the room. What is needed here is which session
 *        ran, not how to join it."
 *
 *   The same test applied here gives the same answer: what is needed is WHICH
 *   application was submitted, and `targetId` is already the application id.
 *   Anyone entitled to the applicant's details can open the application.
 *
 *   THE CHECK IS KEPT, THE DATA IS NOT. That an 18+ gate ran and passed is
 *   audit-worthy — an auditor needs to know it was applied. The date of birth
 *   derived from it is not, and it is one field away from her identity in a
 *   women-only programme. The gate itself is untouched: calculatedAge still
 *   refuses an under-18 applicant.
 *
 *   AND THE RATCHET FOUND A WORSE ONE. cooperative/_withdrawal.ts wrote the
 *   member's BANK ACCOUNT NUMBER into the same log:
 *
 *       metadata: { amount, bankName, accountNumber }
 *
 *   `accountNumber` is on the platform's OWN PII list — admin-pii.ts:21, whose
 *   header has said "no bvn, no nin, no accountNumber" since #151. The list
 *   existed; this log had simply never been measured against it. The number is
 *   on the withdrawal row, where the people who process payouts see it. The bank
 *   NAME stays: not a credential, and a bank changing between requests is
 *   exactly what an auditor looks for.
 *
 *   `email` IS DELIBERATELY NOT BANNED BELOW. An entry saying an admin unlocked
 *   an account has to say WHOSE — that is the audit, not a leak. The banned list
 *   is the fields that describe a PERSON rather than identify the record acted
 *   on.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the name fields put back                   KILLED
 *     the age put back into ageVerification      KILLED
 *     the account number put back                KILLED
 *     the scan's banned list emptied             KILLED
 *     PII_KEYS dropped from the banned list      KILLED
 *     reword this header                         SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { PII_KEYS } from '@/lib/admin-pii';

/**
 * What may not appear in an audit entry's metadata.
 *
 * THE FINANCIAL AND IDENTITY HALF IS NOT RESTATED HERE. It comes from
 * PII_KEYS in lib/admin-pii.ts — the platform's own declared list, whose header
 * has said "no bvn, no nin, no accountNumber" since #151. The withdrawal
 * handler was writing `accountNumber` into this log anyway, so the list existed
 * and the log had simply never been measured against it. Importing it means a
 * key added there is banned here without anybody remembering to.
 *
 * WHAT IS ADDED are the fields that describe a PERSON rather than a credential.
 * They are deliberately NOT pushed into PII_KEYS: stripPii() runs over admin
 * screens that legitimately show a member's name, and widening that list to
 * make this test shorter would blank them.
 */
const PERSONAL = [
    ...PII_KEYS,
    'firstName', 'surname', 'lastName', 'fullName', 'middleName', 'otherName',
    'dateOfBirth', 'dob', 'age',
    'phone', 'phoneNumber', 'alternativePhone',
    'address', 'residentialAddress', 'stateOfResidence', 'stateOfOrigin',
];

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
}

/** Every `metadata: { ... }` literal in a file, brace-matched. */
function metadataBlocks(code: string): string[] {
    const blocks: string[] = [];
    let from = 0;

    for (;;) {
        const start = code.indexOf('metadata: {', from);
        if (start === -1) break;

        let depth = 0;
        let i = code.indexOf('{', start);
        const open = i;
        for (; i < code.length; i += 1) {
            if (code[i] === '{') depth += 1;
            else if (code[i] === '}') {
                depth -= 1;
                if (depth === 0) break;
            }
        }
        blocks.push(code.slice(open, i + 1));
        from = i + 1;
    }
    return blocks;
}

const FILES = [...walk('src/app/actions'), ...walk('src/app/api')];

// ─────────────────────────────────────────────────────────────────────────────
describe('#468 — an audit entry names the record, not the person', () => {
    it('NO AUDIT METADATA CARRIES A PERSONAL FIELD', () => {
        const offenders: string[] = [];

        for (const file of FILES) {
            const code = stripComments(readFileSync(file, 'utf-8'));
            for (const block of metadataBlocks(code)) {
                for (const field of PERSONAL) {
                    if (new RegExp(`\\b${field}\\s*:`).test(block)) {
                        offenders.push(`${file.replace(/^src\//, '')} -> ${field}`);
                    }
                }
            }
        }

        expect({ offenders }).toEqual({ offenders: [] });
    });

    it('POSITIVE CONTROL: the scan really would catch the block this removed', () => {
        // Without this, "no offenders" could mean the brace matching is broken
        // and every block comes back empty.
        const wasThere = `metadata: {
            surname: validatedData.surname,
            firstName: validatedData.firstName,
            stateOfResidence: validatedData.stateOfResidence,
            ageVerification: \`Verified 18+ (Auto-calculated: \${calculatedAge})\`
        }`;

        const blocks = metadataBlocks(wasThere);
        expect(blocks.length).toBe(1);

        const caught = PERSONAL.filter((f) => new RegExp(`\\b${f}\\s*:`).test(blocks[0]));
        expect(caught.sort()).toEqual(['firstName', 'stateOfResidence', 'surname']);
    });

    it("POSITIVE CONTROL: the PLATFORM'S OWN PII list is doing work here", () => {
        //   A mutation that deleted `...PII_KEYS` from the banned list SURVIVED:
        //   once the withdrawal handler was fixed, nothing in the tree carried a
        //   PII key, so removing half the rule changed nothing observable. The
        //   half that caught the account number would have been silently
        //   retired, and the next one would go unnoticed.
        //
        //   These names come from PII_KEYS and NOT from the list added beside
        //   it, so this fails the moment the import stops contributing.
        const fromPiiKeysOnly = ['accountNumber', 'bvn', 'nin', 'bankDetails'];

        for (const field of fromPiiKeysOnly) {
            expect({ field, banned: PERSONAL.includes(field) }).toEqual({ field, banned: true });
        }

        const block = metadataBlocks('metadata: { amount: 100, accountNumber: acct, bvn: id }')[0];
        const caught = PERSONAL.filter((f) => new RegExp(`\\b${f}\\s*:`).test(block));
        expect(caught.sort()).toEqual(['accountNumber', 'bvn']);
    });

    it('and the scan is looking at a real number of files', () => {
        // Vacuity guard: an empty FILES list passes the ratchet trivially.
        expect(FILES.length).toBeGreaterThan(50);
        expect(FILES.some((f) => f.includes('_wv_applications'))).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#468 — the WAVE application still records that the gate ran', () => {
    const wave = () => stripComments(readFileSync('src/app/actions/wave/_wv_applications.ts', 'utf-8'));

    it('THE AGE CHECK IS STILL RECORDED, WITHOUT THE AGE', () => {
        const code = wave();

        expect(code).toContain('ageVerification: "passed: 18 or over"');
        expect(code).not.toContain('Auto-calculated: ${calculatedAge}');
    });

    it('AND THE GATE ITSELF IS UNTOUCHED — an under-18 applicant is still refused', () => {
        // The finding is about what gets logged, not about who may apply.
        // Removing the log line must not quietly remove the check.
        const code = wave();

        expect(code).toContain('if (calculatedAge < 18)');
        expect(code).toContain('You must be at least 18 years old to apply');
    });

    it('and the entry still identifies the record it is about', () => {
        // What replaces the personal data: targetId already says which
        // application, which is what an auditor needs.
        const code = wave();
        const start = code.indexOf('ageVerification: "passed: 18 or over"');
        const block = code.slice(Math.max(0, start - 500), start);

        expect(block).toContain('targetId: applicationId');
        expect(block).toContain('targetType: "wave_application"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#468 — the rule this follows was already written down', () => {
    it('THE LIVE-SESSION LOG STATES IT, and still does', () => {
        // Not a coincidence to be preserved by luck: if that reasoning is ever
        // deleted, the next person has nothing to reason from.
        const live = readFileSync('src/app/actions/wave/_wv_admin_live.ts', 'utf-8');

        expect(live).toContain('by every admin role');
    });

    it('AND THE AUDIENCE IS REALLY THAT WIDE — the premise', () => {
        // If audit:read were ever narrowed to super_admin, the argument above
        // weakens and somebody should re-read this finding rather than assume it.
        const { rolesWithPermission } = require('@/lib/admin-permissions');

        expect(rolesWithPermission('audit:read').length).toBeGreaterThanOrEqual(8);
    });
});
