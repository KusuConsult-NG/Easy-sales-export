/**
 * @jest-environment node
 */

/**
 * The test harness must implement everything the database adapter offers.
 *
 * WHY
 * ---
 * `jest.setup.js` hand-rolls a mock of `supabaseDb`. When the adapter gains a
 * method the mock does not have, code under test calls it and gets
 * `x is not a function`. Almost every action wraps its work in try/catch, so the
 * throw is swallowed, the action returns a generic failure, and any assertion
 * about what it should have written **can never fail**.
 *
 * That is not a hypothesis. Three of these surfaced by accident in a single day:
 *
 *   collection().add()   an action that created documents threw before its
 *                        later writes — noted in this file's own comments
 *   docRef.set()         stubbed as `() => Promise.resolve()`, recording
 *                        nothing, so the academy auto-enrol tests all passed
 *                        against a function that enrolled nobody
 *   batch.delete()       missing entirely; account deletion threw
 *                        `batch.delete is not a function`
 *
 * Each was found by a test failing for a confusing reason, not by looking. This
 * test looks.
 *
 * WHAT IT CANNOT PROVE
 * --------------------
 * That a stub BEHAVES correctly — only that it exists. `docRef.set()` existed
 * and recorded nothing, which this check would have passed. Presence is the
 * floor, not the ceiling: a stub that silently discards its arguments is still
 * a vacuum, and only a positive assertion in the test that uses it will catch
 * that.
 *
 * ONE FLAT NAMESPACE WAS NOT ENOUGH
 * ---------------------------------
 * A fourth gap got through this file: `docRef.delete()`. The mock defines
 * several distinct shapes — a query object, two `docObj` document refs, and the
 * modular `docRefFor` — and the check above collects method names from the WHOLE
 * file into one set. `delete:` existed on `docRefFor`, so `delete` was "present"
 * while both `docObj` shapes lacked it, and
 * `db.collection(x).doc(y).delete()` threw.
 *
 * The cost is the usual one: certificates.ts's delete returned a generic
 * failure, so every "refuses to delete" assertion passed whether the guard was
 * there or not. It was found by a VACUITY GUARD failing — "still deletes a
 * document the user uploaded" — and not by any of the refusals.
 *
 * So the document-ref shape is now checked on its own, per shape rather than
 * per file. The query surface is still checked flat; doing this properly for
 * every shape means parsing the mock, and the document ref is where actions
 * actually write.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { supabaseDb as db } from '@/lib/supabase-db';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { stripComments } from '@/lib/testing/strip-comments';

/** Method names the adapter exposes on a collection/query or on db itself. */
function adapterMethods(): Set<string> {
    const src = readFileSync(join(process.cwd(), 'src/lib/supabase-db.ts'), 'utf-8');
    const names = new Set<string>();

    // `  async foo(` and `  foo(` at class-member indentation.
    //
    // Control-flow keywords sit at the same indentation and match the same
    // shape, so they are excluded explicitly — the first version of this test
    // demanded the harness implement `.if()`, `.for()` and `.switch()`.
    const KEYWORD = new Set([
        'if', 'for', 'while', 'switch', 'catch', 'return', 'function',
        'do', 'else', 'try', 'typeof', 'await', 'new', 'super', 'this',
    ]);
    for (const m of src.matchAll(/^\s{2,4}(?:async\s+)?([a-zA-Z][a-zA-Z0-9_]*)\s*\(/gm)) {
        if (!KEYWORD.has(m[1])) names.add(m[1]);
    }
    return names;
}

/**
 * The harness is TWO files now.
 *
 * jest.setup.js used to carry the whole fluent surface twice over, once per
 * mocked module. It was deduplicated into src/lib/testing/firestore-mock-db.js,
 * so a check that reads only jest.setup.js now reads the wiring and not the
 * surface — and would report every method missing while the harness was
 * complete. Both files, always.
 */
const HARNESS_FILES = ['jest.setup.js', 'src/lib/testing/firestore-mock-db.js'];

function harnessSource(): string {
    return HARNESS_FILES
        .map((f) => readFileSync(join(process.cwd(), f), 'utf-8'))
        .join('\n');
}

/** Method names the mock implements, however they are written. */
function harnessMethods(): Set<string> {
    const src = harnessSource();
    const names = new Set<string>();

    // `foo: (` — arrow-style stubs, and `foo: docObj` — reference-style.
    for (const m of src.matchAll(/^\s+([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*[({[a-zA-Z]/gm)) {
        names.add(m[1]);
    }
    return names;
}

/**
 * Adapter members that are not part of the query surface a test would reach.
 * Kept short and justified — this list is where coverage goes to hide.
 */
const NOT_QUERY_SURFACE = new Set([
    'constructor',
    'Number',        // a numeric coercion helper, not a method on the fluent API
    'data',          // returned by a snapshot the test itself constructs
    'forEach',       // iterating a snapshot the test constructs
    'toDate',
]);

describe('the jest harness against the real adapter', () => {
    const adapter = adapterMethods();
    const harness = harnessMethods();

    it('can read both surfaces (sanity)', () => {
        // Without this, a rename or a moved file makes the assertion below pass
        // against two empty sets — the vacuity failure this whole file exists
        // to prevent, reproduced inside it.
        expect(adapter.size).toBeGreaterThan(15);
        expect(harness.size).toBeGreaterThan(10);
    });

    it('implements every method the adapter exposes', () => {
        const missing = [...adapter]
            .filter((m) => !NOT_QUERY_SURFACE.has(m))
            .filter((m) => !harness.has(m))
            .sort();

        if (missing.length > 0) {
            throw new Error(
                `\n\njest.setup.js is missing ${missing.length} adapter method(s):\n\n` +
                missing.map((m) => `  .${m}()`).join('\n') +
                `\n\nCode under test that calls one gets "x is not a function". Most\n` +
                `actions catch that, return a generic failure, and leave the test's\n` +
                `assertions unable to fail.\n\n` +
                `Add a stub — and make it RECORD its arguments. docRef.set() existed\n` +
                `as () => Promise.resolve() and recorded nothing, which passed this\n` +
                `check while making an entire suite vacuous.\n`
            );
        }
        expect(missing).toEqual([]);
    });

    it('gives every document-ref shape the full document-ref surface', () => {
        // Per shape, not per file. `delete` on one shape used to satisfy the
        // flat check above for all of them.
        //
        // These four are what an action reaches on a `db.collection(x).doc(y)`
        // handle. Anything missing throws, gets caught, and turns into a generic
        // failure that no assertion can distinguish from a refusal.
        const DOC_REF_SURFACE = ['get', 'set', 'update', 'delete'];

        const src = harnessSource();

        // Each document-ref shape, located by name so a new one has to be added
        // here deliberately. There used to be three — two copies of `docObj` and
        // the modular `docRefFor` — which is exactly why `delete` could be
        // missing from two of them while the flat check above saw it as covered.
        // Deduplicating them into `makeDocRef` is what removed that class of gap;
        // the older names stay in the pattern so re-introducing a second shape is
        // still caught.
        const shapes: Array<{ name: string; body: string }> = [];
        for (const m of src.matchAll(/(?:const (?:docObj|docRefFor) = \([^)]*\) =>|function (makeDocRef)\()/g)) {
            const start = m.index ?? 0;
            // Take the balanced body that follows.
            let depth = 0, end = start;
            for (let i = src.indexOf('{', start); i < src.length; i++) {
                if (src[i] === '{') depth++;
                else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
            }
            // Comment lines are stripped before matching.
            //
            // The first version of this check passed against a shape whose
            // `delete` had been deliberately removed, because the explanatory
            // comment sitting inside that shape contains the literal text
            // "delete:" while describing the bug. A check for what the CODE
            // implements has to read the code — the same trap the #105 ratchet
            // and the analytics paging test each hit.
            const body = src.slice(start, end)
                .split('\n')
                .filter((line) => {
                    const t = line.trim();
                    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
                })
                .join('\n');
            shapes.push({ name: `${m[1] ?? m[2] ?? 'shape'} @ line ${src.slice(0, start).split('\n').length}`, body });
        }

        // At least one shape must be found, or the loop below passes against
        // nothing — the vacuity failure this file exists to prevent.
        expect(shapes.length).toBeGreaterThanOrEqual(1);

        // And a SYNTHETIC POSITIVE CONTROL, because a count floor stops meaning
        // anything once the count is one. The detector is run over a planted
        // shape that is missing `delete`, and must flag it. If the regex ever
        // stops matching the real shape, this still fails.
        const planted = `function makeDocRef(collection, id) {
            return { get: () => 1, set: () => 2, update: () => 3 };
        }`;
        const plantedGaps = DOC_REF_SURFACE.filter(
            (m) => !new RegExp(`\\b${m}\\s*:`).test(planted));
        expect(plantedGaps).toEqual(['delete']);

        const gaps: string[] = [];
        for (const shape of shapes) {
            for (const method of DOC_REF_SURFACE) {
                if (!new RegExp(`\\b${method}\\s*:`).test(shape.body)) {
                    gaps.push(`${shape.name} — missing .${method}()`);
                }
            }
        }

        if (gaps.length > 0) {
            throw new Error(
                `\n\n${gaps.length} document-ref shape gap(s) in jest.setup.js:\n\n` +
                gaps.map((g) => `  ${g}`).join('\n') +
                `\n\ndocRef.delete() was missing from both docObj shapes while present\n` +
                `on docRefFor, so the flat check above saw it as covered. Actions\n` +
                `calling it threw, their catch returned a generic failure, and every\n` +
                `"refuses to delete" assertion passed with or without a guard.\n`
            );
        }
        expect(gaps).toEqual([]);
    });

    it('mocks every export of @/lib/firebase-admin', () => {
        // The third instance of one shape, and the reason this test exists at
        // all: `isAdmin: () => true` made every ownership guard untestable
        // (#142), a missing docRef.delete() made every "refuses to delete"
        // assertion vacuous (#144), and this mock returned two of the module's
        // seven exports.
        //
        // Anything importing getAdminAuth got undefined and threw on first use.
        // That is why all seven suites in src/__tests__/integration failed with
        // "getAdminAuth is not a function" — not stale tests, not missing
        // credentials, an incomplete mock nothing was checking. Those suites are
        // excluded from the default config and CI runs only that config, so the
        // gap was invisible from both directions.
        //
        // The supabase-db surface has been checked since #144. This module was
        // not, purely because the earlier failures happened to be there.
        const realSrc = readFileSync(join(process.cwd(), 'src/lib/firebase-admin.ts'), 'utf-8');
        const harnessSrc = harnessSource();

        const exported = [...realSrc.matchAll(/^export (?:async )?(?:function|const) ([a-zA-Z][a-zA-Z0-9_]*)/gm)]
            .map((m) => m[1]);

        // The mock factory only — a name appearing anywhere else in the setup
        // file does not make it an export of this module.
        const factoryStart = harnessSrc.indexOf("jest.mock('@/lib/firebase-admin'");
        const factoryEnd = harnessSrc.indexOf("jest.mock('@/lib/supabase-db'", factoryStart);
        const factory = harnessSrc.slice(factoryStart, factoryEnd);

        expect(exported.length).toBeGreaterThanOrEqual(5);
        expect(factoryStart).toBeGreaterThan(-1);
        expect(factoryEnd).toBeGreaterThan(factoryStart);

        const missing = exported
            .filter((name) => !new RegExp(`\\b${name}\\s*:`).test(factory))
            .sort();

        if (missing.length > 0) {
            throw new Error(
                `\n\njest.setup.js does not mock ${missing.length} export(s) of ` +
                `@/lib/firebase-admin:\n\n` +
                missing.map((m) => `  ${m}`).join('\n') +
                `\n\nAnything importing one gets undefined and throws on first use.\n` +
                `Most callers wrap that in try/catch, so it becomes a silent skip\n` +
                `no assertion can see — which is how seven integration suites sat\n` +
                `failing without anybody noticing.\n`
            );
        }
        expect(missing).toEqual([]);
    });

    it('gives the mocked auth handle the methods src calls on it', () => {
        // `adminAuth: {}` satisfies a presence check and throws on every call.
        // These are the methods actually reached from src.
        const harnessSrc = harnessSource();
        // Comment lines removed before matching.
        //
        // The comment explaining this fix quotes `adminAuth: {}` to say what was
        // wrong with it, so the assertion below matched the explanation. That is
        // the sixth assertion in this audit to trip over prose describing the
        // defect it checks for. A check about what the CODE does has to read the
        // code.
        const factory = harnessSrc
            .slice(
                harnessSrc.indexOf("jest.mock('@/lib/firebase-admin'"),
                harnessSrc.indexOf("jest.mock('@/lib/supabase-db'")
            )
            .split('\n')
            .filter((l) => {
                const t = l.trim();
                return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
            })
            .join('\n');

        for (const method of [
            'createCustomToken', 'createUser', 'deleteUser', 'deleteUsers',
            'getUser', 'getUserByEmail', 'listUsers', 'updateUser',
        ]) {
            expect(factory).toContain(`${method}:`);
        }

        // And it is not an empty object again.
        expect(factory).not.toMatch(/adminAuth:\s*\{\s*\}/);
    });

    it('exports every top-level helper the adapter exports', () => {
        // The fluent surface above is not the whole adapter. supabase-db.ts also
        // exports modular compat helpers — doc, getDoc, setDoc, updateDoc,
        // collection, increment, serverTimestamp, arrayUnion, arrayRemove,
        // deleteField, runTransaction — and ten-odd action files destructure
        // them:
        //
        //     const { supabaseDb: db, doc, getDoc, runTransaction } =
        //         await import('@/lib/supabase-db');
        //
        // The mock exported only supabaseDb, getAdminDb and getTableName. Every
        // one of those helpers was undefined, so the first call threw
        // "doc is not a function", the action's catch turned it into a generic
        // failure, and no assertion about what it wrote could fail.
        //
        // cooperative/_payment.ts — a money path — could not be tested at all,
        // and nothing said so. The check above passes happily, because it only
        // ever looked at class members.
        const adapterSrc = readFileSync(join(process.cwd(), 'src/lib/supabase-db.ts'), 'utf-8');
        const harnessSrc = harnessSource();

        const exported = [...adapterSrc.matchAll(/^export (?:async )?(?:function|const) ([a-zA-Z][a-zA-Z0-9_]*)/gm)]
            .map((m) => m[1]);

        // The mock declares them as object properties: `doc: (...)` etc.
        const missing = exported
            .filter((name) => !new RegExp(`\\b${name}\\s*:`).test(harnessSrc))
            .sort();

        expect(exported.length).toBeGreaterThan(5);
        if (missing.length > 0) {
            throw new Error(
                `\n\njest.setup.js does not export ${missing.length} adapter helper(s):\n\n` +
                missing.map((m) => `  ${m}()`).join('\n') +
                `\n\nCode that destructures one gets undefined and throws on the\n` +
                `first call. Most actions catch that and return a generic failure,\n` +
                `which leaves every assertion about their writes unable to fail.\n`
            );
        }
        expect(missing).toEqual([]);
    });

    it('records the writes it accepts, rather than swallowing them', () => {
        // The narrower lesson from docRef.set(). A write stub that returns a
        // resolved promise and calls no jest.fn() is indistinguishable from a
        // working one, right up until a test asserts on it.
        const src = harnessSource();
        const writeStubs = ['set', 'update', 'add', 'delete', 'create'];

        const lines = src.split('\n');
        const silent: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(/^\s+(set|update|add|delete|create):\s*\([^)]*\)\s*=>\s*(.*)$/);
            if (!m) continue;

            // A stub may be one line, or open a block and record several lines
            // down. Reading only the first line reported every multi-line stub as
            // silent, which is what the first version of this check did — and a
            // fixed four-line window then reported a correct stub as silent the
            // moment an explanatory comment sat between the arrow and the
            // recorder. Neither is a property of the stub.
            //
            // So the body is the whole property: everything up to the next line
            // indented no deeper than the stub itself. That is what "does this
            // stub record" is actually a question about.
            const indent = lines[i].match(/^\s*/)![0].length;
            const bodyLines = [m[2]];
            for (let j = i + 1; j < lines.length; j++) {
                const line = lines[j];
                if (line.trim().length > 0 && line.match(/^\s*/)![0].length <= indent) break;
                bodyLines.push(line);
            }
            const body = bodyLines.join(' ');
            // Any global recorder, not just the mockFirestore family.
            //
            // This tested /mockFirestore/, which was every recorder in the file
            // when it was written. Completing the firebase-admin mock added
            // mockAdminStorageFileDelete and mockAdminAuth*, and the check
            // reported a stub that records perfectly well as silent — a ratchet
            // failing on correct code, which is the thing that gets ratchets
            // deleted.
            if (!/global\.mock\w+\(/.test(body)) {
                silent.push(`${m[1]}: ${m[2].trim().slice(0, 40) || '(block)'}`);
            }
        }

        if (silent.length > 0) {
            throw new Error(
                `\n\nThese write stubs accept a call and record nothing:\n\n` +
                silent.map((x) => `  ${x}`).join('\n') +
                `\n\ndocRef.set() was exactly this — () => Promise.resolve() — and it\n` +
                `made every assertion about a .set() write unable to fail.\n`
            );
        }
        expect(silent).toEqual([]);
    });
});

/**
 * The fake must hand back what the ADAPTER hands back, not what was stored.
 *
 * supabase-db writes ISO strings into JSONB (convertTimestampsToStrings) and
 * revives them into Timestamp objects on every read
 * (convertStringsToTimestamps). So `doc.data().createdAt.toDate()` works in
 * production even though the column holds a string.
 *
 * The fake used to hand back the raw string, and that is a divergence in the
 * dangerous direction. This codebase is full of
 * `v?.toDate ? v.toDate() : new Date(v)`; with plain strings every one of those
 * took its FALLBACK arm, so a behavioural test could assert the fallback's
 * answer while the arm that actually runs in production went unexercised. The
 * cooperative ID card computes the card's issue and expiry dates through
 * exactly that shape.
 *
 * Both directions are gated here, because reproducing only the read would
 * round-trip a Timestamp object into the store and corrupt the document.
 */
describe('the fake hydrates dates the way the adapter does', () => {
    let store: FakeDbHandle;
    beforeEach(() => { store = installFakeDb(); });

    it('doc.data() gives a Timestamp for a stored ISO string', async () => {
        store.seed('x', 'a', { createdAt: '2026-01-02T03:04:05.000Z', name: 'ada' });

        const snap = await db.collection('x').doc('a').get();
        const data = snap.data() as Record<string, any>;

        expect(typeof data.createdAt.toDate).toBe('function');
        expect(data.createdAt.toDate().toISOString()).toBe('2026-01-02T03:04:05.000Z');
        expect(typeof data.createdAt.toMillis).toBe('function');
        expect(data.name).toBe('ada');
    });

    it('a query snapshot hydrates too, not only a document read', async () => {
        store.seed('x', 'a', { createdAt: '2026-01-02T03:04:05.000Z' });

        const snap = await db.collection('x')
            .where('createdAt', '==', '2026-01-02T03:04:05.000Z').get() as any;

        expect(snap.docs).toHaveLength(1);
        expect(typeof snap.docs[0].data().createdAt.toDate).toBe('function');
    });

    it('a Timestamp written back becomes an ISO string in the store', async () => {
        // Without this the JSON clone would put a Timestamp's internals into the
        // document, and the next read would hand back an object that is neither
        // a date nor a string.
        store.seed('x', 'a', { createdAt: '2026-01-02T03:04:05.000Z' });
        const read = (await db.collection('x').doc('a').get()).data() as Record<string, any>;

        await db.collection('x').doc('a').update({ copiedAt: read.createdAt });

        expect(store.get('x', 'a')!.copiedAt).toBe('2026-01-02T03:04:05.000Z');
    });

    it('a Date written straight in becomes an ISO string too', async () => {
        await db.collection('x').doc('a').set({ when: new Date('2026-05-06T07:08:09.000Z') });
        expect(store.get('x', 'a')!.when).toBe('2026-05-06T07:08:09.000Z');
    });

    it('and the FILTERS still compare the stored string, as Postgres does', async () => {
        // raw_data->>'k' is text. Hydration is a read-side concern only; if it
        // leaked into the query evaluation the comparisons would change meaning.
        store.seedAll('x', {
            a: { createdAt: '2026-01-01T00:00:00.000Z' },
            b: { createdAt: '2026-06-01T00:00:00.000Z' },
        });

        const snap = await db.collection('x')
            .where('createdAt', '>', '2026-03-01T00:00:00.000Z').get() as any;

        expect(snap.docs.map((d: any) => d.id)).toEqual(['b']);
    });

    it('a cursor taken from a SNAPSHOT still matches the stored value', async () => {
        // The trap hydration introduced: startAfter(snapshot) reads the order
        // key off `snapshot.data()`, which is hydrated, while the rows are
        // compared against the stored ISO string. Unflattened it stringifies to
        // "[object Object]", matches nothing, and every page is page one — a
        // paginated list that silently never advances. The adapter converts the
        // cursor the same way in buildCursorFilter.
        store.seedAll('x', {
            a: { createdAt: '2026-01-03T00:00:00.000Z' },
            b: { createdAt: '2026-01-02T00:00:00.000Z' },
            c: { createdAt: '2026-01-01T00:00:00.000Z' },
        });

        const cursorDoc = await db.collection('x').doc('b').get();
        const page = await db.collection('x')
            .orderBy('createdAt', 'desc').startAfter(cursorDoc).limit(2).get() as any;

        expect(page.docs.map((d: any) => d.id)).toEqual(['c']);
    });

    it('the cursor is resolved when the query RUNS, not when startAfter is called', async () => {
        // SupabaseQuery stores the snapshot in `_startAfterDoc` and reads it in
        // buildCursorFilter, so `.startAfter(doc)` BEFORE `.orderBy(...)` works.
        // Several actions are written that way — _mp_seller_dashboard.ts is —
        // and a fake resolving the cursor eagerly got an empty one and returned
        // page one forever, which is a "load more" button that never advances.
        store.seedAll('x', {
            a: { createdAt: '2026-01-03T00:00:00.000Z' },
            b: { createdAt: '2026-01-02T00:00:00.000Z' },
            c: { createdAt: '2026-01-01T00:00:00.000Z' },
        });

        const cursorDoc = await db.collection('x').doc('b').get();
        const page = await db.collection('x')
            .startAfter(cursorDoc)          // <- before the orderBy
            .orderBy('createdAt', 'desc')
            .limit(2)
            .get() as any;

        expect(page.docs.map((d: any) => d.id)).toEqual(['c']);
    });

    it('and a NON-snapshot cursor is ignored, as the adapter ignores it', async () => {
        // `startAfter(docOrValue)` records the cursor only when it is a
        // SupabaseDocumentSnapshot. Honouring a bare value would make a call
        // site look like it paginates when in production it pages nowhere.
        store.seedAll('x', {
            a: { createdAt: '2026-01-03T00:00:00.000Z' },
            b: { createdAt: '2026-01-02T00:00:00.000Z' },
        });

        const page = await db.collection('x')
            .orderBy('createdAt', 'desc')
            .startAfter('2026-01-03T00:00:00.000Z')
            .get() as any;

        expect(page.docs.map((d: any) => d.id)).toEqual(['a', 'b']);
    });

    it('leaves a string that merely starts with digits alone', async () => {
        store.seed('x', 'a', { name: '2026-not-a-date', code: '12345678901' });

        const data = (await db.collection('x').doc('a').get()).data() as Record<string, any>;

        expect(data.name).toBe('2026-not-a-date');
        expect(data.code).toBe('12345678901');
    });
});

/**
 * The transaction must behave like SupabaseTransaction, which is not the
 * intuitive thing.
 *
 * `t.get` is literally `refOrQuery.get()`, so it accepts a QUERY as well as a
 * document reference — academy's dedup guard reads a filtered query that way.
 * And `t.set` / `t.update` / `t.delete` push closures into `_pendingWrites`
 * that only run in `_commit()`, AFTER the callback returns.
 *
 * The fake used to accept only a ref (a query came back as a non-existent
 * document, and the action's catch turned the resulting throw into a generic
 * failure) and to apply writes immediately (so a callback that threw still left
 * writes in the store, and a read-after-write inside one callback saw the new
 * value where production sees the old).
 *
 * Still NO LOCK, which is the one thing that must not be simulated.
 */
describe('the fake transaction behaves like SupabaseTransaction', () => {
    let store: FakeDbHandle;
    beforeEach(() => { store = installFakeDb(); });

    it('t.get accepts a query, and the filters actually run', async () => {
        store.seedAll('x', {
            a: { status: 'open' },
            b: { status: 'closed' },
            c: { status: 'open' },
        });

        const rows = await db.runTransaction(async (t: any) => {
            const snap = await t.get(db.collection('x').where('status', '==', 'open'));
            return snap.docs.map((d: any) => d.id);
        });

        expect(rows.sort()).toEqual(['a', 'c']);
    });

    it('t.get still accepts a document reference', async () => {
        store.seed('x', 'a', { status: 'open' });

        const status = await db.runTransaction(async (t: any) => {
            const snap = await t.get(db.collection('x').doc('a'));
            return snap.data().status;
        });

        expect(status).toBe('open');
    });

    it('a callback that THROWS writes nothing', async () => {
        store.seed('x', 'a', { status: 'open' });

        await expect(db.runTransaction(async (t: any) => {
            t.update(db.collection('x').doc('a'), { status: 'closed' });
            throw new Error('refused');
        })).rejects.toThrow('refused');

        expect(store.get('x', 'a')!.status).toBe('open');
    });

    it('a read after a write, inside one callback, sees the OLD value', async () => {
        store.seed('x', 'a', { status: 'open' });

        const seen = await db.runTransaction(async (t: any) => {
            t.update(db.collection('x').doc('a'), { status: 'closed' });
            const snap = await t.get(db.collection('x').doc('a'));
            return snap.data().status;
        });

        expect(seen).toBe('open');
        // ...and the write does land, once the callback has returned.
        expect(store.get('x', 'a')!.status).toBe('closed');
    });

    it('the writes land in the order they were queued', async () => {
        await db.runTransaction(async (t: any) => {
            t.set(db.collection('x').doc('a'), { n: 1 });
            t.update(db.collection('x').doc('a'), { n: 2 });
        });

        expect(store.get('x', 'a')!.n).toBe(2);
    });

    it('and it still takes NO LOCK — which must never be simulated', () => {
        // Structural, because a single-threaded fake cannot demonstrate the
        // absence of locking by racing anything. Every money guarantee in this
        // platform is a Postgres CAS function BECAUSE this is true; a fake that
        // acquired a lock would make an unguarded check-then-write look safe.
        const raw = readFileSync(
            join(process.cwd(), 'src/lib/testing/firestore-mock-db.js'), 'utf8');
        // Comments stripped first — the block above this one SAYS "NO LOCK",
        // and a scan that reads its own documentation as an implementation is
        // the mistake finding #75 was about.
        const code = stripComments(raw);
        expect(code).not.toMatch(/\block\b|mutex|semaphore|acquire/i);
        expect(raw).toContain('NO LOCK');
    });
});
