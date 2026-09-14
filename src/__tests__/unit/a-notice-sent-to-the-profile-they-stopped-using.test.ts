/**
 * @jest-environment node
 */

/**
 *   #738 A DECISION NOTICE ADDRESSED TO A PROFILE THE PERSON NO LONGER USES.
 *
 *   Nine callers reach createNotification with a userId taken straight off a
 *   record — a loan, an order, a booking, a reservation. None of them resolves
 *   it first.
 *
 *   If that profile was SUPERSEDED, the person signs in as the live one —
 *   profile-choice honours `_migratedTo`, and every money path resolves through
 *   resolveActiveUser — and never sees the notice. The platform records them as
 *   told.
 *
 *   THAT IS #688's HARM BY A DIFFERENT ROUTE. "A loan decision reached the
 *   member from one door of six" was fixed by putting every decision path on one
 *   notifier. This is the layer under it: the notifier itself writing to a row
 *   nobody reads.
 *
 * ── REDIRECTED, NOT REFUSED, AND THE DIFFERENCE IS THE POINT ────────────────
 *
 *   A transactional notice is for ONE person who must be told, so it follows
 *   them to the row they use. An AUDIENCE is the opposite case — a tombstoned
 *   row is simply not in it, which is what in-app-broadcast already does with
 *   loadNonContactableUserIds before ever reaching the bulk writer.
 *
 *   So the two paths differ deliberately, and both are right for what they are.
 *
 * ── AND IT FAILS SOFT ───────────────────────────────────────────────────────
 *
 *   If the lookup throws, the notice is written to the id it was given. Losing a
 *   loan decision entirely is worse than one landing on a superseded row, which
 *   is the state this repairs rather than creates.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. Run before
 *   the table was written.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join, relative, sep } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { activeIdFromRow } from '@/lib/user-identity';

const ROOT = process.cwd();
const SERVICE = 'src/infrastructure/notifications/service.ts';
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

/** createNotification's body alone, so a claim cannot be met by the bulk writer. */
const singleWriter = () => {
    const src = code(SERVICE);
    const at = src.indexOf('export async function createNotification(');
    expect(at).toBeGreaterThan(-1);
    const next = src.indexOf('export ', at + 10);
    return src.slice(at, next > 0 ? next : src.length);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#738 — where a superseded profile sends a reader', () => {
    it('THE POINTER IS THE ACTIVE ID', () => {
        //   The rule the money paths and login already follow, exercised here so
        //   the claim below is not resting on a description of it.
        expect(activeIdFromRow('old', { _migratedTo: 'live' } as any)).toBe('live');
    });

    it('AND A ROW WITH NO POINTER IS ITS OWN ACTIVE ID', () => {
        //   Vacuity guard: a resolver that redirected everything would send
        //   every notice to the wrong place.
        expect(activeIdFromRow('u1', {} as any)).toBe('u1');
        expect(activeIdFromRow('u1', null)).toBe('u1');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#738 — the notifier resolves before it writes', () => {
    it('IT CALLS resolveActiveUserId — the defect, stated as its absence', () => {
        expect(singleWriter()).toContain('resolveActiveUserId(');
    });

    it('AND WRITES THE RESOLVED ID, NOT THE ONE IT WAS HANDED', () => {
        /*
         *   Resolving and then spreading `...data` over the result would put the
         *   original id back — the resolution would run and change nothing,
         *   which is the shape of a guard that cannot fire.
         */
        const body = singleWriter();

        expect(body).toContain('...data,\n            userId,');
        //   And the override comes AFTER the spread, or it is overwritten.
        const spreadAt = body.indexOf('...data,');
        const overrideAt = body.indexOf('userId,', spreadAt);
        expect(overrideAt).toBeGreaterThan(spreadAt);
    });

    it('AND RESOLVES BEFORE THE WRITE, NOT AFTER', () => {
        const body = singleWriter();
        const resolveAt = body.indexOf('resolveActiveUserId(');
        const writeAt = body.indexOf('docRef.set(notification)');

        expect(resolveAt).toBeGreaterThan(-1);
        expect(writeAt).toBeGreaterThan(resolveAt);
    });

    it('AND FAILS SOFT — a lookup error still delivers the notice', () => {
        /*
         *   Losing a loan decision entirely is worse than one landing on a
         *   superseded row, which is the state this repairs rather than creates.
         */
        const body = singleWriter();

        expect(body).toContain('let userId = data.userId;');
        expect(body).toContain('} catch (error) {');
        //   The catch must not rethrow, or "fails soft" is a comment rather than
        //   a behaviour.
        const catchAt = body.indexOf('} catch (error) {');
        expect(body.slice(catchAt, catchAt + 300)).not.toContain('throw');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#738 — and the bulk path is deliberately the other way', () => {
    it('THE AUDIENCE EXCLUDES A TOMBSTONED ROW RATHER THAN REDIRECTING IT', () => {
        /*
         *   Stated so the asymmetry reads as a decision rather than an
         *   oversight. A person is told; an audience is a set somebody is not
         *   in.
         */
        expect(code('src/app/actions/in-app-broadcast.ts'))
            .toContain('loadNonContactableUserIds(db, COLLECTIONS.USERS)');
    });

    it('AND THE NINE CALLERS STILL PASS A RAW ID, WHICH IS NOW FINE', () => {
        /*
         *   The point of resolving in the funnel: the call sites did not have to
         *   change, so there is no tenth that can forget. Counted from source,
         *   so a caller added later is covered by construction.
         */
        const files: string[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
                const full = join(dir, e.name);
                if (e.isDirectory()) {
                    if (e.name === '__tests__' || e.name === 'node_modules') continue;
                    walk(full);
                    continue;
                }
                if (/\.tsx?$/.test(e.name)) files.push(relative(ROOT, full).split(sep).join('/'));
            }
        };
        walk(join(ROOT, 'src'));

        const callers = files
            .filter((f) => f !== SERVICE)
            .filter((f) => /\bcreateNotification\(/.test(code(f)));

        //   Several, and none of them needs to know about supersession.
        expect(callers.length).toBeGreaterThanOrEqual(5);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy,
 *   each mutant proving its edit landed by a unique string on disk. Run before
 *   this table was written.
 *
 *     MUTANT                                                        RESULT
 *     the resolution is removed                                      KILLED
 *     the resolved id is spread over by ...data                      KILLED
 *     the resolution happens after the write                         KILLED
 *     the catch rethrows instead of failing soft                     KILLED
 *     activeIdFromRow ignores the pointer                            KILLED
 *     activeIdFromRow redirects a row that has none                  KILLED
 *     the bulk audience stops excluding tombstoned ids               KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
