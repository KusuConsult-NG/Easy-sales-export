/**
 * @jest-environment node
 */

/**
 *   #748 THE FOUR DOORS MONEY LEAVES BY WERE STILL ASKING THE TOKEN.
 *
 *   #356 established what a JWT role claim costs: it "keeps its value for hours
 *   after the database loses it", which is why requireAdmin exists and re-reads
 *   roles live on every call.
 *
 *   #532 converted the three files that disagreed with THEMSELVES — one
 *   function on the live gate, another in the same file still on the token —
 *   and deliberately stopped there, recording the rest as a ledger:
 *
 *       "Converting every admin gate on the platform in one change is the kind
 *        of sweep the owner's standing brief exists to prevent... The THREE
 *        below are the bounded set where the platform already disagrees with
 *        ITSELF inside one file, which is both the sharpest evidence and the
 *        safest scope."
 *
 *   That reasoning is right, and it leaves the question of what the NEXT
 *   bounded set is. Picked by #532's own criterion — not "reads a queue" but
 *   MONEY GOES OUT:
 *
 *       api/admin/cooperative/mark-withdrawal-completed   marks a payout done
 *       api/admin/marketplace/withdrawals                 the queue, with bank
 *                                                         details in the clear
 *       actions/wave/_wv_admin_withdrawals                approves/rejects a
 *                                                         WAVE withdrawal
 *       api/admin/cooperative/approve-loan                approves a loan AND
 *                                                         increments loanBalance
 *
 *   Four of the eighty-four. The stale claim sat between a revoked admin and a
 *   payout on every one.
 *
 * ── REPLACED, NOT STACKED ───────────────────────────────────────────────────
 *
 *   #532's reasoning, applied again: once requireAdmin has asked the database, a
 *   second check on the token refuses nobody the first would admit — except an
 *   admin GRANTED the permission after their token was issued, who is refused
 *   by a claim that is merely out of date. "A redundant check that can only
 *   produce false refusals is not defence in depth."
 *
 * ── AND #743's LEDGER DID EXACTLY WHAT IT WAS BUILT FOR ─────────────────────
 *
 *   One finding after it was written, the stale-JWT ledger went red with:
 *
 *       "IMPROVED to 80, below the recorded 84. Lower the recorded count to 80,
 *        or the difference becomes room for 4 new instances that no test would
 *        notice."
 *
 *   Under the `<= 88` ceiling it replaced, this improvement would have been
 *   absorbed in silence and the slack would have grown from four to eight.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. The table
 *   was written BEFORE the sweep ran, which is the wrong order and is recorded
 *   rather than tidied away; the sweep was then run in full and every row below
 *   is its actual result.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

/** The four, with the permission each demands. */
const CONVERTED: Array<[string, string]> = [
    ['src/app/api/admin/cooperative/mark-withdrawal-completed/route.ts', 'finance:process_withdrawals'],
    ['src/app/api/admin/marketplace/withdrawals/route.ts', 'finance:process_withdrawals'],
    ['src/app/actions/wave/_wv_admin_withdrawals.ts', 'finance:process_withdrawals'],
    ['src/app/api/admin/cooperative/approve-loan/route.ts', 'cooperatives:approve_loans'],
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#748 — each of the four asks the database', () => {
    it('THEY CALL requireAdmin WITH THE PERMISSION THEIR ACTION NEEDS', () => {
        for (const [file, permission] of CONVERTED) {
            expect({ file, gated: code(file).includes(`requireAdmin("${permission}")`) })
                .toEqual({ file, gated: true });
        }
    });

    it('AND NONE OF THEM STILL READS THE TOKEN FOR A ROLE', () => {
        /*
         *   The defect, stated as its absence. `hasAdminPermission(session...)`
         *   is the exact expression the stale-JWT ledger counts, so this is the
         *   same measurement that file makes, asserted per file.
         */
        for (const [file] of CONVERTED) {
            expect({ file, readsToken: /hasAdminPermission\(\s*session/.test(code(file)) })
                .toEqual({ file, readsToken: false });
        }
    });

    it('AND THE REFUSAL USES THE GATE\'S OWN MESSAGE, NOT A GUESS', () => {
        //   Returning a hand-written "Admin access required" would discard the
        //   reason requireAdmin worked out — suspended, MFA, or the permission —
        //   and an admin who cannot act needs to know which.
        for (const [file] of CONVERTED) {
            expect({ file, relays: /gate\.error/.test(code(file)) })
                .toEqual({ file, relays: true });
        }
    });

    it('AND THE DEAD IMPORT WENT WITH THE CHECK', () => {
        /*
         *   Two of the four imported `hasAdminPermission` for the gate alone.
         *   Lint does not flag an unused import here, so it would have sat there
         *   telling a reader the file still consults the token — and it would
         *   have muddied the ledger's own population, which greps for the
         *   expression.
         */
        for (const f of [
            'src/app/api/admin/marketplace/withdrawals/route.ts',
            'src/app/api/admin/cooperative/mark-withdrawal-completed/route.ts',
        ]) {
            expect({ f, imports: code(f).includes('hasAdminPermission') })
                .toEqual({ f, imports: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#748 — and the gate they moved onto is the live one', () => {
    it('requireAdmin RE-READS ROLES RATHER THAN TRUSTING THE SESSION', () => {
        /*
         *   The whole point. If requireAdmin ever started reading
         *   `session.user.roles`, all four conversions would be renames.
         */
        const gate = code('src/lib/require-admin.ts');

        expect(gate).toContain('if (!isAdmin(roles))');
        expect(gate).toContain('if (permission && !hasAdminPermission(roles, permission))');
        //   `roles` comes from the database read, not from the session object.
        expect(gate).not.toContain('hasAdminPermission(session.user.roles');
    });

    it('AND IT REFUSES A SUSPENDED ACCOUNT, WHICH THE TOKEN CHECK NEVER DID', () => {
        //   Worth naming: the conversion buys more than freshness. A token
        //   check cannot see a suspension at all.
        expect(code('src/lib/require-admin.ts')).toContain('Account suspended');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#748 — and the ledger recorded the progress', () => {
    it('THE STALE-JWT COUNT IS DOWN FROM 84 TO 80 (75 AFTER THE UNNAMED-FILE SWEEP)', () => {
        /*
         *   Four converted, four fewer. Asserted here as well as in that file
         *   because the number moving is the evidence that these four left the
         *   population rather than merely gaining a second gate.
         */
        expect(code('src/__tests__/unit/half-converted-off-the-stale-token.test.ts'))
            .toContain('ledgerVerdict(jwtOnly.length, 75)');
    });

    it('AND THE LEDGER IS STILL AN EXACT PIN, NOT A CEILING', () => {
        //   #743's mechanism, which is what surfaced the improvement. If this
        //   went back to `<=`, the next four conversions would be silent again.
        const src = code('src/__tests__/unit/half-converted-off-the-stale-token.test.ts');

        expect(src).toContain('LEDGER_HELD');
        expect(src).not.toMatch(/toBeLessThanOrEqual\(\s*\d/);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by full path, each mutant proving its edit landed by a unique string
 *   on disk.
 *
 *     MUTANT                                                        RESULT
 *     one route goes back to the token check                         KILLED
 *     one route keeps requireAdmin but drops the permission          KILLED
 *     one route swallows the gate's reason                           KILLED
 *     the dead import is put back                                    KILLED
 *     requireAdmin reads the session's roles instead of the live ones KILLED
 *     requireAdmin stops refusing a suspended account                KILLED
 *     the ledger is raised back to 84                                KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
