/**
 * The Firestore-compat mock surface, in ONE place.
 *
 * jest.setup.js carried two byte-for-byte copies of this object — one for
 * `@/lib/firebase-admin`, one for `@/lib/supabase-db` — each about 130 lines,
 * each with the same long comments explaining the same past gaps. That is the
 * duplication this audit keeps finding on the wrong side of a fix: three of the
 * harness gaps recorded in those comments (collection().add(), docRef.set(),
 * batch.delete()) had to be fixed twice, and a fourth would have been fixed once.
 *
 * WHAT CHANGED BEYOND DEDUPLICATION
 * ---------------------------------
 * Each call now publishes a DESCRIPTOR of what is being accessed on
 * `global.__firestoreAccess` immediately before it calls the recorder:
 *
 *     { kind: 'doc',   collection: 'users', id: 'u1' }
 *     { kind: 'query', collection: 'users',
 *       query: { filters: [{ field: 'status', op: '==', value: 'active' }], ... } }
 *
 * That is what makes lib/testing/fake-db.ts possible: with the filters, the order
 * keys, the limit and the cursor reaching the implementation, a real in-memory
 * store can answer the query instead of a stub returning a canned snapshot.
 * Without it, `where()` is a no-op and no test can tell a query that filters
 * correctly from one that filters on the wrong field.
 *
 * A SIDE CHANNEL, NOT AN EXTRA ARGUMENT
 * -------------------------------------
 * The first version of this passed the descriptor as a trailing argument. It
 * broke 31 tests across 15 suites, all of them positive controls — the "and an
 * admin CAN do it, so the refusals are not vacuous" half. The reason is that
 * several suites read the write payload as `call[call.length - 1]`, and the
 * trailing descriptor became the last argument.
 *
 * That is worth recording rather than just fixing: those are exactly the tests
 * whose job is to prove the other tests are not vacuous, and a harness change
 * broke them while every refusal assertion stayed green. Had the positive
 * controls not existed, this refactor would have looked clean.
 *
 * So the recorded arguments are byte-identical to before. A global is safe here
 * because everything between publishing the descriptor and the recorder reading
 * it is synchronous.
 */

/** Builds the fluent `db` object. Call once per mocked module. */
function createMockDb() {
    /**
     * Publish what is being accessed, then call the recorder with exactly the
     * arguments it has always received.
     */
    const withAccess = (descriptor, call) => {
        global.__firestoreAccess = descriptor;
        try {
            return call();
        } finally {
            global.__firestoreAccess = undefined;
        }
    };

    const mockDb = {
        collection: (name) => makeQuery(name),

        // db.getAll(...refs) reads several documents at once. Unmocked, any
        // action using it threw before its first assertion.
        getAll: (...refs) => Promise.all(
            refs.flat().map((r) => withAccess(
                { kind: 'doc', collection: (r && r.__collection) || 'unknown', id: r && r.id },
                () => global.mockFirestoreGet(r && r.id ? r.id : 'getAll'),
            ))
        ),

        // A collection group reads one subcollection name across every parent.
        // Routed to the same recorder as collection() so its reads are asserted
        // on exactly like any other read, keyed by the group name.
        collectionGroup: (groupName) => mockDb.collection(groupName),

        batch: () => {
            global.mockFirestoreBatch();
            return {
                update: (ref, fields) => global.mockFirestoreBatchUpdate(ref, fields),
                delete: (ref) => global.mockFirestoreBatchDelete(ref),
                // Records through mockFirestoreSet, as it always has, so suites
                // asserting on batched writes keep working. The descriptor
                // carries `batched: true`, which is how a store defers it until
                // commit() — a batch that is never committed must write nothing,
                // or an action that forgets .commit() passes its tests.
                set: (ref, data, options) => withAccess(
                    { kind: 'doc', collection: ref && ref.__collection, id: ref && ref.id,
                      batched: true, merge: options && options.merge, ref },
                    () => global.mockFirestoreSet(ref, data),
                ),
                commit: () => global.mockFirestoreBatchCommit(),
            };
        },

        // NO LOCK, exactly like the real adapter: runTransaction calls the
        // callback and nothing else. Every money guarantee in this platform is a
        // Postgres CAS function precisely because of that, and a mock that
        // simulated isolation here would make an unguarded check-then-write look
        // safe. See lib/supabase-db.ts and supabase/migrations/007.
        runTransaction: (cb) => {
            const tx = {
                get: (ref) => global.mockFirestoreTxGet(ref),
                set: (ref, data, options) => withAccess(
                    { kind: 'doc', collection: ref && ref.__collection, id: ref && ref.id,
                      merge: options && options.merge },
                    // TWO arguments to the recorder, as always. Passing `options`
                    // as a third broke suites reading the payload as
                    // call[call.length - 1]; merge travels in the descriptor.
                    () => { global.mockFirestoreTxSet(ref, data); return Promise.resolve(); },
                ),
                update: (ref, fields) => {
                    global.mockFirestoreTxUpdate(ref, fields);
                    return Promise.resolve();
                },
                delete: (ref) => withAccess(
                    { kind: 'doc', collection: ref && ref.__collection, id: ref && ref.id },
                    () => { global.mockFirestoreDelete(ref && ref.id); return Promise.resolve(); },
                ),
            };
            return cb(tx);
        },
    };

    // `.doc()` with no id GENERATES one, the way the real adapter does. Several
    // write paths rely on it — the in-app broadcast creates a notification per
    // recipient with `db.collection(NOTIFICATIONS).doc()` — and a ref with an
    // undefined id silently drops every one of those writes.
    let generated = 0;

    /** A document handle. `__collection` is what lets a store resolve it. */
    function makeDocRef(collection, id) {
        if (id === undefined || id === null || id === '') id = `auto-${++generated}`;
        global.mockFirestoreDoc(id);
        const descriptor = { kind: 'doc', collection, id };
        return {
            id,
            __collection: collection,
            path: `${collection}/${id}`,
            get: () => withAccess(descriptor, () => global.mockFirestoreGet(id)),
            update: (fields) => withAccess(descriptor, () => global.mockFirestoreUpdate(id, fields)),
            set: (data, options) => withAccess(
                Object.assign({}, descriptor, { merge: options && options.merge }),
                () => { global.mockFirestoreSet(id, data); return Promise.resolve(); },
            ),
            // docRef.delete() was missing here originally, while existing on the
            // modular docRefFor() below, so `db.collection(x).doc(y).delete()`
            // threw "certRef.delete is not a function", the action's catch
            // swallowed it, and a generic failure came back. That made every
            // "refuses to delete" assertion vacuous: it passed whether the guard
            // was there or not, because the delete could never succeed either way.
            delete: () => withAccess(descriptor, () => global.mockFirestoreDelete(id)),
            // Subcollections. `doc(a).collection(b).doc(c)` addresses one
            // document; flattened to a compound collection name so a store can
            // hold it without modelling a tree.
            collection: (sub) => makeQuery(`${collection}/${id}/${sub}`),
        };
    }

    /**
     * A query builder that ACCUMULATES. Each chained call returns a new builder
     * carrying the state so far, which is how the real adapter behaves — `all()`
     * clones the query, sets _unbounded and returns it — and why production code
     * can write `.all().get()`.
     */
    function makeQuery(name, state) {
        // Recorded only when the collection is first addressed. A `.where()` is
        // not a second look at the collection, and counting it as one would break
        // any test asserting how many reads an action performs.
        if (!state) global.mockFirestoreCollection(name);
        const s = state || { filters: [], orders: [] };
        const next = (patch) => makeQuery(name, Object.assign({}, s, patch));

        const descriptorFor = (kind, extra) => Object.assign(
            { kind, collection: name, query: s }, extra);

        const q = {
            doc: (id) => makeDocRef(name, id),

            // A collection().add() had no stub at all originally, so every
            // action that creates a document this way threw before reaching its
            // later writes — which silently made some assertions vacuous.
            add: (data) => withAccess(
                { kind: 'add', collection: name }, () => global.mockFirestoreAdd(name, data)),
            create: (data) => withAccess(
                { kind: 'add', collection: name }, () => global.mockFirestoreAdd(name, data)),

            where: (field, op, value) => next({ filters: s.filters.concat([{ field, op, value }]) }),
            orderBy: (field, dir) => next({ orders: s.orders.concat([{ field, dir: dir || 'asc' }]) }),
            limit: (n) => next({ limit: n }),
            offset: (n) => next({ offset: n }),
            startAfter: (...values) => next({
                // startAfter(snapshot) and startAfter(...values) are both used.
                startAfterValues: values.length === 1 && values[0] && typeof values[0].data === 'function'
                    ? s.orders.map((o) => {
                        const d = values[0].data() || {};
                        return o.field.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), d);
                    })
                    : values,
            }),
            startAt: (...values) => next({ startAfterValues: values }),
            endAt: () => q,
            endBefore: () => q,

            // .select() narrows columns. The store returns whole documents, so
            // this is a pass-through — and that is a divergence worth knowing
            // about: a caller reading a field it did not select works here and
            // gets undefined in production.
            select: () => q,

            // .all() bypasses the default 5,000-row cap. A BUILDER, not an
            // executor: production writes `.all().get()`.
            all: () => next({ unbounded: true }),

            get: () => withAccess(descriptorFor('query'), () => global.mockFirestoreGet(name)),

            count: () => ({
                get: () => withAccess(descriptorFor('count'),
                    () => global.mockFirestoreGet(`${name}_count`)),
            }),

            aggregate: (spec) => ({
                get: () => withAccess(
                    descriptorFor('aggregate', { aggregate: normaliseAggregate(spec) }),
                    () => global.mockFirestoreGet(`${name}_aggregate`)),
            }),

            // stream() returns a real object-mode Readable, not a bare array or
            // async generator, because production uses BOTH shapes:
            // `for await (const doc of stream)` in the broadcast actions and
            // `.on("data", ...)` in broadcast-logic.ts. A stub supporting only
            // one would leave half the call sites untested.
            stream: () => {
                const { Readable } = require('stream');
                return Readable.from((async function* () {
                    const snap = await withAccess(descriptorFor('query'),
                        () => global.mockFirestoreGet(name));
                    for (const d of (snap && snap.docs) || []) yield d;
                })(), { objectMode: true });
            },
        };
        return q;
    }

    return mockDb;
}

/**
 * firebase-admin's AggregateField objects carry their own shape. Reduced to
 * `{ alias: { kind, field } }` so a store can compute them without importing
 * the SDK.
 */
function normaliseAggregate(spec) {
    const out = {};
    for (const [alias, field] of Object.entries(spec || {})) {
        if (!field || typeof field !== 'object') { out[alias] = { kind: 'count' }; continue; }
        const kind = field._aggregateType || field.aggregateType
            || (field._field !== undefined ? 'sum' : 'count');
        out[alias] = { kind, field: field._field || field.field };
    }
    return out;
}

/**
 * The modular compat helpers: doc/getDoc/setDoc/updateDoc/collection/
 * runTransaction and the FieldValue sentinels.
 *
 * src/lib/supabase-db.ts exports these alongside the fluent object and ten-odd
 * action files destructure them. They were `undefined` in the original mock, so
 * the first call threw "doc is not a function", the action's catch turned it into
 * a generic failure, and any assertion about what it wrote could never fail —
 * cooperative/_payment.ts could not be tested at all, and nothing said so.
 */
function createCompatHelpers(mockDb) {
    const sentinel = (methodName, elements, operand) => ({
        _methodName: methodName, _elements: elements, _operand: operand,
    });

    return {
        doc: (_db, path, ...segments) => {
            // doc(db, "users", "u1") and doc(db, "users/u1") are both used.
            const parts = segments.length ? [path].concat(segments) : String(path).split('/');
            const id = parts[parts.length - 1];
            const collection = parts.slice(0, -1).join('/') || path;
            return mockDb.collection(collection).doc(id);
        },
        collection: (_db, path) => mockDb.collection(path),
        getDoc: (ref) => ref.get(),
        setDoc: (ref, data, options) => ref.set(data, options),
        updateDoc: (ref, data) => ref.update(data),
        deleteDoc: (ref) => ref.delete(),
        runTransaction: (_db, cb) => mockDb.runTransaction(cb),
        increment: (n) => sentinel('FieldValue.increment', undefined, n),
        serverTimestamp: () => sentinel('FieldValue.serverTimestamp'),
        arrayUnion: (...elements) => sentinel('FieldValue.arrayUnion', elements),
        arrayRemove: (...elements) => sentinel('FieldValue.arrayRemove', elements),
        deleteField: () => sentinel('FieldValue.delete'),
    };
}

module.exports = { createMockDb, createCompatHelpers, normaliseAggregate };
