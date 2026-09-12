/**
 * @jest-environment node
 */

/**
 *   #680 THE ONE BUTTON ON THE MAINTENANCE SCREEN DID NOTHING AND SAID IT HAD
 *   WORKED.
 *
 *   `/admin/settings/maintenance` is the only screen that calls anything in
 *   actions/maintenance.ts, and it calls exactly one function. That function's
 *   entire body was:
 *
 *       // Placeholder for logic to delete old 'draft' applications
 *       return { success: true, message: "Draft cleanup executed (Dry run).",
 *                count: 0 };
 *
 *   The screen asked the admin to confirm first:
 *
 *       "Are you sure you want to delete all draft listings older than 30
 *        days? This action cannot be undone."
 *
 *   then read `success`, showed a green tick reading "Successfully cleaned up 0
 *   drafts", and rendered a panel saying "Cleanup complete! Removed 0 items."
 *
 *   AN OPERATOR CANNOT TELL THAT FROM "there was nothing to clean". So the
 *   monthly maintenance task is believed to be running, drafts accumulate, and
 *   the number that would say otherwise is the same either way.
 *
 *   That is the shape docs/audit/outstanding-work.md records against push
 *   notifications — "a stub that returned a fake success id for every send, so
 *   nothing was ever delivered while the logs reported success" — and #676 met
 *   it again in the SMS sandbox. This is the third channel.
 *
 *   AND THE CONFIRM DIALOG THREATENED AN IRREVERSIBLE DELETION THAT COULD NOT
 *   HAPPEN, which has its own cost: a dialog that cries wolf is one the next
 *   dialog inherits.
 *
 * ── THE DELETION IS NOT IMPLEMENTED, AND THAT IS THE POINT ──────────────────
 *
 *   The obvious "fix" is to write the delete and make the stub honest. It would
 *   be the wrong repair by a wide margin. The standing instruction for this
 *   codebase is that nothing is deleted or destroyed — #292 built
 *   module-application-erasure.ts on it (a related row is MARKED and keeps its
 *   status, dates and balances; what goes is the copy of the person's
 *   identity), and #675 now guards the Cloudinary half.
 *
 *   So the button refuses and says why, and the screen says so before it is
 *   pressed. Whether abandoned drafts should ever be cleared — and whether
 *   "cleared" means removed or marked and kept, the way an erased application
 *   is — is a decision, and it belongs in that conversation rather than in a
 *   placeholder nobody re-read.
 *
 * ── AND THE THREE FUNCTIONS BESIDE IT REACH NOTHING ─────────────────────────
 *
 *   Recorded, not changed. `repairDataAction` (which bulk-heals payment and
 *   wallet rows), `runConsistencyCheckAction` and `hardResetCacheAction` have
 *   NO caller anywhere in the application. They are not dead in the sense of
 *   being harmless: runConsistencyCheckAction would report a number that is
 *   guaranteed wrong the moment anybody wires it up, because it compares a true
 *   `count()` of the users table against unique emails gathered from a query
 *   with NO `.limit()` — which the adapter caps at 5,000. Against ~41,000
 *   users that is "uniqueEmailsInUsers: 5000" and a `discrepancyPotential` of
 *   some thirty-six thousand phantom duplicates.
 *
 *   Wiring it up is not this finding's business; the assertion below is that it
 *   is still unwired, so that whoever wires it meets this note first.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const raw = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(raw(rel), { label: rel });

const ACTION = 'src/app/actions/maintenance.ts';
const SCREEN = 'src/app/admin/settings/maintenance/page.tsx';

/** Every application source file, so "nothing calls it" is measured. */
const sources = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            if (entry === 'node_modules' || entry === '__tests__' || entry === '.next') continue;
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) { walk(full); continue; }
            if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
        }
    };
    for (const top of ['src', 'packages']) {
        try { walk(join(ROOT, top)); } catch { /* absent tree is not a finding */ }
    }
    return out;
};

const FILES = sources();

/** Which files outside the module itself name this export. */
const callersOf = (name: string): string[] =>
    FILES
        .filter((f) => relative(ROOT, f) !== ACTION)
        .filter((f) => stripComments(readFileSync(f, 'utf8'), { label: relative(ROOT, f) }).includes(name))
        .map((f) => relative(ROOT, f))
        .sort();

// ─────────────────────────────────────────────────────────────────────────────
describe('#680 — the button refuses instead of reporting a cleanup it did not do', () => {
    it('THE ACTION NO LONGER RETURNS SUCCESS', () => {
        /*
         *   THE defect, in one line: `return { success: true, message: "Draft
         *   cleanup executed (Dry run)." }` from a body that did nothing.
         */
        const src = code(ACTION);
        const at = src.indexOf('export async function cleanupAbandonedDraftsAction');
        expect(at).toBeGreaterThan(-1);

        const body = src.slice(at, src.indexOf('\n}', at));
        expect(body).not.toContain('success: true');
        expect(body).toContain('success: false');
    });

    it('AND SAYS WHY, INCLUDING THAT IT NEVER DID ANYTHING BEFORE', () => {
        /*
         *   A bare refusal would read as a new outage. The operator's real
         *   question on meeting this is "did it used to work?", and the honest
         *   answer is no — so the message says so rather than leaving them to
         *   wonder what they broke.
         */
        const body = code(ACTION);
        expect(body).toContain('not implemented');
        expect(body).toContain('nothing has been deleted by this');
        //   And specifically that it was ALWAYS a placeholder. A mutant that
        //   dropped this clause survived on the line above, because "nothing
        //   has been deleted by this button" is true of a feature that broke
        //   yesterday too — and an operator who reads it that way goes looking
        //   for what they changed.
        expect(body).toContain('always been a placeholder that reported success');
    });

    it('AND STILL DELETES NOTHING, WHICH IS THE STANDING RULE', () => {
        /*
         *   THE control, and the one that decides whether this repair is the
         *   right one. Making the stub honest by WRITING the delete would
         *   satisfy "no longer reports a false success" and violate the
         *   instruction the whole audit runs under.
         */
        const src = code(ACTION);
        const at = src.indexOf('export async function cleanupAbandonedDraftsAction');
        const body = src.slice(at, src.indexOf('\n}', at));

        expect(body).not.toMatch(/\.delete\s*\(|deleteDoc|batch\.delete/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#680 — and the screen stops claiming one', () => {
    it('THE CONFIRM NO LONGER THREATENS AN IRREVERSIBLE DELETION', () => {
        //   It asked for consent to something the platform does not do.
        expect(code(SCREEN)).not.toContain('This action cannot be undone');
    });

    it('AND THE GREEN "Cleanup complete!" PANEL IS GONE', () => {
        //   It was rendered from a placeholder's count, so it said "Removed 0
        //   items." every time it was ever shown.
        expect(code(SCREEN)).not.toContain('Cleanup complete!');
    });

    it('AND THE CARD SAYS IT IS NOT IMPLEMENTED BEFORE IT IS PRESSED', () => {
        /*
         *   The half that matters most. A refusal after the click is honest;
         *   saying so on the card is what stops an operator planning around a
         *   cleanup that does not exist.
         */
        expect(code(SCREEN)).toContain('Not implemented');
    });

    it('AND THE REFUSAL IS SHOWN, NOT SWALLOWED', () => {
        //   The control on the three lines above: removing the panel entirely
        //   would satisfy them and leave the operator with a red toast and no
        //   explanation.
        const screen = code(SCREEN);
        expect(screen).toContain('text: response.error');
        expect(screen).toContain('{notice.text}');
        //   #609's probe: a press must change something observable either way,
        //   so the panel renders on success as well — see the note on the state.
        expect(screen).toContain('tone: "info"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#680 — and the three functions beside it are still unwired', () => {
    it('THE SWEEP IS READING THE APPLICATION', () => {
        //   The control for every "nothing calls it" below.
        expect(FILES.length).toBeGreaterThan(500);
        //   And it can find a caller when there is one.
        expect(callersOf('cleanupAbandonedDraftsAction')).toEqual([SCREEN]);
    });

    it.each([
        ['repairDataAction'],
        ['runConsistencyCheckAction'],
        ['hardResetCacheAction'],
    ])('%s HAS NO CALLER', (name) => {
        /*
         *   Recorded rather than wired up. `repairDataAction` performs a bulk
         *   mutation of payment and wallet rows and
         *   `runConsistencyCheckAction` would report roughly thirty-six
         *   thousand phantom duplicates the moment it was rendered — see the
         *   header. Neither should be connected to a button by somebody who has
         *   not read why they were not.
         *
         *   This fails the day one is wired, which is the point.
         */
        expect(callersOf(name)).toEqual([]);
    });

    it('AND THE CONSISTENCY CHECK STILL CARRIES THE FLAW THAT MAKES IT UNSAFE TO WIRE', () => {
        /*
         *   Asserted so the note above cannot go stale silently. If somebody
         *   fixes the capped sweep, this fails and asks them to update the
         *   record — at which point wiring it up becomes a reasonable thing to
         *   do.
         *
         *   A true `count()` on one line and an unlimited-looking `.get()` on
         *   the next, which the adapter caps at 5,000.
         */
        const src = code(ACTION);
        expect(src).toContain('db.collection(COLLECTIONS.USERS).count().get()');
        expect(src).toContain('db.collection(COLLECTIONS.USERS).select("email").get()');
        expect(src).not.toContain('select("email").all()');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the action reports success again                    KILLED
 *     the refusal stops saying it never worked before                 KILLED
 *     the action is made honest by writing the delete                 KILLED
 *     the confirm dialog is restored                                  KILLED
 *     the green "Cleanup complete!" panel is restored                 KILLED
 *     the card stops saying it is not implemented                     KILLED
 *     the refusal is swallowed instead of shown                       KILLED
 *     one of the three unwired actions gains a caller                 KILLED
 *     the consistency check's capped sweep is silently fixed          KILLED
 *     the caller sweep is narrowed to nothing                         KILLED
 *     a successful press renders nothing again                        KILLED
 *
 *   AND THE FIRST VERSION OF THIS FIX BROKE #609, WHICH CAUGHT IT. That suite
 *   presses every button on six admin screens and fails one whose press changes
 *   nothing observable. Rendering a panel only on REFUSAL left the success path
 *   silent, and with the action mocked to succeed the screen did nothing at all
 *   — a dead button, which is a smaller version of the defect this finding is
 *   about. One panel now answers either way, and a mutant covers it.
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   Every export of actions/maintenance.ts was searched for across src and
 *   packages. One has a caller — the screen — and three have none. The capped
 *   sweep in runConsistencyCheckAction was confirmed against the adapter's own
 *   DEFAULT_QUERY_LIMIT, which is 5,000 and is applied to any query that
 *   specifies neither `.limit()` nor `.all()`.
 */
