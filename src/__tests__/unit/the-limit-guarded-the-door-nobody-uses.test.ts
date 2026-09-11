/**
 * @jest-environment node
 */

/**
 *   #641 THE WITHDRAWAL RATE LIMIT GUARDED THE ONE DOOR NOBODY USES.
 *
 *   Found by asking a sweep's question of a module rather than of a function:
 *   cooperative money has TWO surfaces — server actions and API routes — for the
 *   same operations, and the audit's most frequent finding is a rule that
 *   reached one door and not its sibling. Comparing the two withdrawal doors
 *   rule by rule, they agreed on every money rule (#276 and #488 had already
 *   harmonised the minimum, the floor, the membership test and the member
 *   lookup) and differed on exactly one: the route rate-limited and the action
 *   did not.
 *
 *   Then the direction turned out to be the opposite of the obvious one.
 *
 *   `rateLimitConfig.withdrawal` — "very strict (financial security)", five per
 *   minute — had ONE consumer in the whole codebase, the route. And NOTHING
 *   CALLS THAT ROUTE: every other mention of `/api/cooperative/withdraw` in src
 *   is prose inside a comment. The screens a member actually presses call server
 *   actions, and not one of the three had a limiter:
 *
 *     cooperatives/(member)/withdraw       submitWithdrawalRequestAction
 *     cooperatives/(member)/fixed-savings  withdrawMaturedFixedSavingsAction
 *     wave/(member)/earnings               withdrawEarningsAction
 *
 *   A limit that is real for a door with no callers and absent from the three
 *   with callers is not a weaker limit than intended. It is no limit.
 *
 * ── WHAT IT COSTS ───────────────────────────────────────────────────────────
 *
 *   A withdrawal request is not a read. Each one debits the member's savings,
 *   moves the amount into `lockedBalance`, and writes a row an administrator has
 *   to approve or reject. The floor check bounds the TOTAL — a member cannot
 *   take their balance below the minimum — but nothing bounded the COUNT. At the
 *   ₦1,000 minimum a balance fragments into as many locked pending rows as it
 *   divides into, and a retry loop on a flaky connection does it by accident.
 *
 * ── ONE COUNTER, NOT ONE PER DOOR ───────────────────────────────────────────
 *
 *   The limiter instance is shared. `rateLimit()` builds its own counter, so
 *   four instances named "withdrawal" would be four separate budgets — the same
 *   defect wearing the shape of a fix, and the exact failure rate-limits.config
 *   already records for key spaces that split by accident.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

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

/** The three doors a member presses, and the route that had the limit. */
const DOORS = [
    ['src/app/actions/cooperative/_withdrawal.ts', 'submitWithdrawalRequestAction'],
    ['src/app/actions/cooperative/_coop_money.ts', 'withdrawMaturedFixedSavingsAction'],
    ['src/app/actions/wave/_wv_earnings.ts', 'withdrawEarningsAction'],
] as const;

const ROUTE = 'src/app/api/cooperative/withdraw/route.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#641 — every withdrawal door asks the limit', () => {
    it.each(DOORS)('%s ASKS IT', (file) => {
        expect(code(file)).toContain('await checkWithdrawalRateLimit(userId)');
        //   And acts on the answer — a check whose result is discarded is #331's
        //   shape, and this file would otherwise be satisfied by one.
        expect(code(file)).toContain('if (!limit.allowed)');
    });

    it('AND THE ROUTE SHARES THE SAME COUNTER', () => {
        /*
         *   Not "the route also has a limiter". `rateLimit()` builds its own
         *   counter, so a second instance from the same config is a second
         *   budget: five per minute through the actions AND five more through
         *   the route, for one rule. The route imports the instance now.
         */
        const route = code(ROUTE);
        expect(route).toContain("from '@/lib/withdrawal-rate-limit'");
        expect(route).not.toMatch(/rateLimit\(rateLimitConfig\.withdrawal\)/);
        expect(route).toContain('withdrawalLimiter.check(session.user.id)');

        //   Exactly one construction of it exists.
        const builders = APP_FILES.filter((f) => /rateLimit\(rateLimitConfig\.withdrawal\)/.test(code(f)));
        expect(builders).toEqual(['src/lib/withdrawal-rate-limit.ts']);
    });

    it('AND NOTHING HAPPENS BEFORE IT BUT ESTABLISHING WHO YOU ARE', () => {
        /*
         *   The property, sharpened. "Before the debit" was the first version,
         *   and a mutant that slid the check down to sit immediately above the
         *   debit SURVIVED it — correctly, because the money still had not
         *   moved. But a limiter exists to protect the WORK as well as the
         *   money: every line above it is a database read this member is
         *   entitled to make five times a minute and was making without limit.
         *
         *   So the rule is that the check is the first thing to happen once the
         *   caller is known — no `await` between resolving their id and asking.
         *
         *   READ INSIDE THE FUNCTION'S OWN BODY, and against a CALL rather than
         *   a name. The first version searched the whole file for
         *   `debitJsonbBalanceWithFloor` and found the IMPORT, which sits above
         *   everything, so a correct door failed; and `_coop_money.ts` holds a
         *   dozen functions, so a whole-file search would have compared this
         *   door's check against a neighbour's write.
         */
        for (const [file, fn] of DOORS) {
            const src = code(file);
            const open = src.indexOf(`async function _${fn}`);
            expect({ file, found: open > -1 }).toEqual({ file, found: true });
            const next = src.indexOf('\nasync function ', open + 1);
            const body = src.slice(open, next === -1 ? src.length : next);

            //   From the line that names the caller to the line that asks.
            const idAt = body.search(/const userId = (?:session|sessionResult\.session)[\w.!]*\.user\.id;/);
            const checkAt = body.indexOf('await checkWithdrawalRateLimit(userId)');
            expect({ file, id: idAt > -1, check: checkAt > -1 })
                .toEqual({ file, id: true, check: true });
            expect({ file, checkedAfterId: idAt < checkAt })
                .toEqual({ file, checkedAfterId: true });

            const between = body.slice(idAt, checkAt);
            expect({ file, awaitsBetween: (between.match(/\bawait\b/g) ?? []).length })
                .toEqual({ file, awaitsBetween: 0 });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#641 — and the door that had the limit still has no callers', () => {
    it('NOTHING IN THE APPLICATION CALLS /api/cooperative/withdraw', () => {
        /*
         *   Recorded rather than acted on. The route is KEPT — it may serve a
         *   client this repository cannot see, and deleting a money endpoint on
         *   the strength of a grep is not a trade worth making — but the fact
         *   that it has no in-app caller is why its limit protected nobody, so
         *   it is pinned. If a caller appears, this fails and somebody reads the
         *   pair again.
         */
        const callers = APP_FILES.filter((f) =>
            f !== ROUTE && /["'`]\/api\/cooperative\/withdraw/.test(code(f)));
        expect({ callers }).toEqual({ callers: [] });
    });

    it('AND THE THREE SCREENS CALL THE ACTIONS — the doors that lacked it', () => {
        //   The other half: "the route has no callers" would also be true if the
        //   feature had been removed. These are the pages that press it.
        const screens: Array<[string, string]> = [
            ['src/app/cooperatives/(member)/withdraw/page.tsx', 'submitWithdrawalRequestAction'],
            ['src/app/cooperatives/(member)/fixed-savings/FixedSavingsClient.tsx', 'withdrawMaturedFixedSavingsAction'],
            ['src/app/wave/(member)/earnings/WaveEarningsClient.tsx', 'withdrawEarningsAction'],
        ];
        for (const [screen, action] of screens) {
            expect({ screen, calls: code(screen).includes(`${action}(`) })
                .toEqual({ screen, calls: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#641 — the limit itself answers usefully', () => {
    beforeEach(() => { jest.resetModules(); });

    /** A fresh module, so each test gets its own in-memory window. */
    async function freshLimit() {
        return (await import('@/lib/withdrawal-rate-limit')).checkWithdrawalRateLimit;
    }

    it('ALLOWS THE FIRST FIVE AND REFUSES THE SIXTH', async () => {
        const check = await freshLimit();
        const who = `member-${Math.random()}`;

        for (let i = 1; i <= 5; i++) {
            expect({ i, allowed: (await check(who)).allowed }).toEqual({ i, allowed: true });
        }
        const sixth = await check(who);
        expect(sixth.allowed).toBe(false);
    });

    it('AND ONE MEMBER\'S BURST DOES NOT REFUSE ANOTHER', async () => {
        /*
         *   The half that matters for a shared-IP network. Keyed on the account,
         *   so a member behind the same carrier NAT as somebody who has just
         *   made five requests can still reach their own money.
         */
        const check = await freshLimit();
        const noisy = `noisy-${Math.random()}`;
        for (let i = 0; i < 6; i++) await check(noisy);

        expect((await check(noisy)).allowed).toBe(false);
        expect((await check(`quiet-${Math.random()}`)).allowed).toBe(true);
    });

    it('AND THE REFUSAL SAYS WHEN TO COME BACK', async () => {
        /*
         *   #307/#408's class applied to a limiter: "Too many requests" with no
         *   duration is a refusal a member cannot act on, and the one thing they
         *   will do with it is press the button again.
         */
        const check = await freshLimit();
        const who = `member-${Math.random()}`;
        for (let i = 0; i < 6; i++) await check(who);

        const refused = await check(who);
        expect(refused.allowed).toBe(false);
        expect(refused.retryAfterSeconds).toBeGreaterThan(0);
        expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
        expect(refused.message).toContain(String(refused.retryAfterSeconds));
        expect(refused.message).toMatch(/try again in \d+ seconds?\./);
    });

    it('AND AN ALLOWED CALL CARRIES NO MESSAGE TO SHOW', async () => {
        //   Otherwise a caller that rendered `message` unconditionally would
        //   show a rate-limit warning to somebody who was not limited.
        const check = await freshLimit();
        const allowed = await check(`member-${Math.random()}`);
        expect(allowed).toEqual({ allowed: true, retryAfterSeconds: 0, message: '' });
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the cooperative withdrawal drops the check          KILLED
 *     THE DEFECT: the fixed-savings withdrawal drops the check        KILLED
 *     THE DEFECT: the WAVE withdrawal drops the check                 KILLED
 *     a door asks the limit and ignores the answer                    KILLED
 *     the check moves below everything it guards                      KILLED
 *     the route builds its own counter again                          KILLED
 *     the limit allows one more than it should                        KILLED
 *     the refusal stops naming a retry time                           KILLED
 *     the limit is keyed on something other than the member           KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 *   "The limit is keyed on something other than the member" is the one that
 *   would look like a stricter limit and is a worse defect: one counter for
 *   everybody means five withdrawals per minute ACROSS THE PLATFORM, and the
 *   sixth member of the day is told their own money is rate-limited.
 *
 * ── AND ONE SURVIVED FIRST, WHICH SHARPENED THE PROPERTY ────────────────────
 *
 *   "The check moves below everything it guards" survived. The first version of
 *   the position test asserted the check ran before the DEBIT, and the mutant
 *   slid it down to sit immediately above the debit — which satisfies that, and
 *   correctly: the money still had not moved.
 *
 *   But a limiter exists to protect the WORK as well as the money. Every line
 *   the mutant moved it past is a database read the member is entitled to make
 *   five times a minute and was making without limit. The property is now the
 *   stronger and more defensible one — nothing happens between resolving who the
 *   caller is and asking whether they may — and it kills the mutant.
 *
 *   Third finding running where a survivor was an under-stated property rather
 *   than a redundant rule.
 */
