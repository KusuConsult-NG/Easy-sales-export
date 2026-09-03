/**
 * @jest-environment node
 */

/**
 *   #363 EIGHT REGISTERED npm ENTRY POINTS COULD NOT RUN, AND ONE OF THEM WAS
 *        A BULK DATA MIGRATION WITH A "ZERO-REGRESSION GUARANTEE".
 *
 *        #328 found that scripts/ was the one directory outside both the
 *        typechecker and eslint, and that the exemption had hidden
 *        scripts/firebase-schema-fix.ts — a script that crashed on its ninth
 *        line and had never done anything. It lifted both exclusions and
 *        migrated every .ts file in the directory.
 *
 *        tsconfig's `include` covers .ts and .tsx. The three .js files under
 *        scripts/ were never brought inside the typechecker, and eslint cannot
 *        see that a method does not exist on a shimmed module. Two of the three
 *        were still broken, in the same way, for the same reason.
 *
 *        WHAT COULD NOT RUN
 *        ------------------
 *          npm run seed                 scripts/seed.js
 *          npm run seed:products        scripts/seed.js products
 *          npm run seed:land            scripts/seed.js land
 *          npm run seed:wave            scripts/seed.js wave
 *          npm run seed:cooperatives    scripts/seed.js cooperatives
 *
 *        All five died on seed.js line 13, `require('./seed-database')`. There
 *        is no scripts/seed-database.js and no scripts/seed-database.ts in this
 *        repository. This is the SECOND time an entry point in this project has
 *        named a seeder that does not exist: scripts/seed-local.ts was written
 *        because e2e/global-setup.ts called `node scripts/seed-test-users.js`
 *        and `npx tsx scripts/setup-e2e-coop.ts`, neither of which existed
 *        either. That one was fixed for e2e and never swept for — hence the two
 *        ratchets in this file, which resolve every script target in
 *        package.json and every relative require inside scripts/.
 *
 *          npm run setup:firebase       scripts/setup-firebase.js
 *
 *        Exits 1 when FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /
 *        FIREBASE_PRIVATE_KEY are unset — three variables src/lib/firebase-admin.ts
 *        documents as no longer used. Past that, `require("firebase-admin")`
 *        resolves to src/lib/shims/firebase-admin, whose index.js is in full
 *        `module.exports = { auth: () => ({}) }`, so `admin.apps` is undefined
 *        and step 2 throws "Cannot read properties of undefined". It would also
 *        deploy firestore.rules and storage.rules — a security posture over a
 *        database that is now Postgres with RLS policies, and a storage bucket
 *        that is now Cloudinary.
 *
 *          npm run migrate:firebase     scripts/firebase-migrate.js
 *          npm run migrate:firebase:dry scripts/firebase-migrate.js --dry-run
 *
 *        Four faults, any one of them fatal: the same missing env vars; a
 *        `.orderBy("__name__").limit(...)` against a shim Query that implements
 *        only where() and get(); a `batch.update(...)` against a shim WriteBatch
 *        that implemented only delete(); and patches addressed to `doc.ref`,
 *        which that shim returns with a NULL collection name.
 *
 *        THE THING UNDERNEATH ALL OF IT
 *        ------------------------------
 *        src/lib/shims/firebase-admin/firestore.js is a SECOND DATABASE
 *        ADAPTER. package.json points `firebase-admin` at it, so
 *        getFirestore() handed back a working Supabase client that special-cases
 *        exactly one collection, `users`, and routes everything else to
 *        document_collections — ignoring the DEDICATED_TABLE_MAP that
 *        src/lib/supabase-db.ts uses for ten of them. A write through that door
 *        creates a shadow row the application never reads while the real row
 *        goes untouched; a read reports "does not exist" for a document that
 *        does. Its update() is an upsert where supabase-db.ts's is a no-op and
 *        real Firestore throws. Nothing in the running application reached it —
 *        firebase-admin.ts re-exports supabaseDb — but the broken migration
 *        script did, and it is the most reachable-looking door in the tree.
 *
 *        AND ONE MORE, IN THE CLIENT SHIM
 *        --------------------------------
 *        src/lib/shims/firebase/auth.js exported
 *        `signInWithEmailAndPassword: async () => ({ user: { uid: "mock-uid" } })`
 *        — a login that succeeds for any password — and a signOut() that
 *        reports success having done nothing. Its sibling firestore.js was
 *        hardened for exactly this reason and this file was missed. Not
 *        reachable today (the only importer is an integration-test helper
 *        behind a flag nothing sets), which is why it is a trap rather than a
 *        bypass: the first file to import the obvious name gets it.
 *
 *        WHAT WAS DONE
 *        -------------
 *        seed.js now delegates to scripts/seed-local.ts, the one working seeder,
 *        and inherits its refusal to write to any non-localhost database. The
 *        two Firebase scripts refuse with a message naming what replaced each
 *        check, behind FIREBASE_RESTORED=yes-firebase-is-back so the original
 *        bodies stay usable rather than being deleted. Both shims' entry points
 *        throw, in the style of the storage and messaging shims beside them.
 *
 *        OWNER DECISION: `npm run emulator` still runs `firebase emulators:start
 *        --only firestore,auth`. firebase-tools is not a dependency of this
 *        project and no code in it can address a Firestore emulator. Left alone
 *        because removing a package.json entry is the owner's call; recorded
 *        below so it is not found a third time.
 *
 *        OWNER DECISION: scripts/firebase-migrate.js's SCHEMAS table is a
 *        per-collection statement of required fields and canonical status
 *        values, and it is the only such statement in the repository. Rewrite
 *        the runner against supabaseDb, or retire the runner and keep SCHEMAS.
 */

import { describe, it, expect } from '@jest/globals';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { spawnSync } from 'child_process';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');
const code = (rel: string) => stripComments(read(rel));

const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

/** Every file path a package.json script names. */
function scriptTargets(): Array<{ script: string; target: string }> {
    const out: Array<{ script: string; target: string }> = [];
    for (const [name, body] of Object.entries(pkg.scripts)) {
        for (const m of body.matchAll(/[\w./@-]+\.(?:js|mjs|cjs|ts|tsx|sh)\b/g)) {
            const target = m[0];
            // Bare filenames are tool names or flags, not paths in this repo.
            if (!target.includes('/') || target.startsWith('http')) continue;
            out.push({ script: name, target });
        }
    }
    return out;
}

/** Every relative require/import inside the .js and .mjs files under scripts/. */
function scriptRelativeImports(): Array<{ file: string; spec: string }> {
    const out: Array<{ file: string; spec: string }> = [];
    for (const name of readdirSync(join(ROOT, 'scripts'))) {
        if (!/\.(js|mjs|cjs)$/.test(name)) continue;
        const file = `scripts/${name}`;
        // Comment-stripped, and that is load-bearing: the #363 write-up inside
        // scripts/seed.js quotes the very require that was removed, so a sweep
        // over raw source reports the defect it just fixed. Sixth time in this
        // audit that a tombstone comment has been mistaken for live code.
        for (const m of code(file).matchAll(/(?:require\(|from\s+)['"](\.[^'"]+)['"]/g)) {
            out.push({ file, spec: m[1] });
        }
    }
    return out;
}

function resolves(fromFile: string, spec: string): boolean {
    const base = resolve(ROOT, dirname(fromFile), spec);
    return [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.ts`, join(base, 'index.js')]
        .some((c) => existsSync(c));
}

/** Run an expression in a fresh node process, outside jest's module mocks. */
function node(expr: string): { status: number | null; out: string } {
    const r = spawnSync('node', ['-e', expr], { cwd: ROOT, encoding: 'utf-8' });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#363 — THE RATCHET: every npm script names a file that exists', () => {
    it('finds the scripts, so this is not vacuous', () => {
        expect(Object.keys(pkg.scripts).length).toBeGreaterThan(30);
        expect(scriptTargets().length).toBeGreaterThan(20);
    });

    it('EVERY FILE A PACKAGE.JSON SCRIPT NAMES IS ON DISK', () => {
        // Five entry points named scripts/seed-database, which has never
        // existed. e2e/global-setup.ts named two more before it.
        const missing = scriptTargets().filter(({ target }) => !existsSync(join(ROOT, target)));

        expect(missing).toEqual([]);
    });

    it('and every relative require inside scripts/ resolves', () => {
        const broken = scriptRelativeImports().filter(({ file, spec }) => !resolves(file, spec));

        expect(broken).toEqual([]);
    });

    it('the require sweep is measured on code, not on comments', () => {
        // Vacuity guard for the stripping above: seed.js's header quotes the
        // dead specifier, and the raw file therefore still contains it.
        expect(read('scripts/seed.js')).toContain('./seed-database');
        expect(code('scripts/seed.js')).not.toContain('./seed-database');
        expect(existsSync(join(ROOT, 'scripts/seed-database.js'))).toBe(false);
        expect(existsSync(join(ROOT, 'scripts/seed-database.ts'))).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#363 — npm run seed seeds, instead of crashing', () => {
    const seed = code('scripts/seed.js');

    it('delegates to the one seeder that exists', () => {
        expect(seed).toContain('seed-local.ts');
        expect(seed).toContain('spawnSync');
    });

    it('and that seeder still refuses a non-localhost database', () => {
        // The delegation is only safe because of this guard — .env.local in
        // this repository points at the production project.
        //
        // ASSERTED ON THE GUARD, NOT ON THE WORDS. Mutation M13 deleted the
        // condition and left the sentence in the error message that names the
        // override, so `toContain('SEED_ALLOW_REMOTE')` still passed with the
        // guard gone. The same shape as #362's M11: a substring assertion that
        // survives the removal of the thing it is about.
        const local = code('scripts/seed-local.ts');

        expect(local).toMatch(
            /!isLocal\s*&&\s*process\.env\.SEED_ALLOW_REMOTE\s*!==\s*'yes-seed-a-remote-database'/,
        );

        // And executed, because source text is not behaviour.
        const r = spawnSync('npx', ['tsx', 'scripts/seed-local.ts'], {
            cwd: ROOT,
            encoding: 'utf-8',
            env: {
                ...process.env,
                NEXT_PUBLIC_SUPABASE_URL: 'https://not-a-real-project.supabase.co',
                SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key',
                SEED_ALLOW_REMOTE: '',
            },
        });

        expect(r.status).toBe(1);
        expect(`${r.stdout}${r.stderr}`).toContain('Refusing to seed');
    }, 60_000);

    it('per-collection seeding says it is not implemented instead of pretending', () => {
        const r = spawnSync('node', ['scripts/seed.js', 'products'], { cwd: ROOT, encoding: 'utf-8' });

        expect(r.status).toBe(1);
        expect(`${r.stdout}${r.stderr}`).toContain('not implemented');
        expect(`${r.stdout}${r.stderr}`).toContain('seed:local');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#363 — the two Firebase scripts refuse, and say what replaced them', () => {
    it('setup-firebase refuses and names the real database, storage and stack', () => {
        const r = spawnSync('node', ['scripts/setup-firebase.js'], { cwd: ROOT, encoding: 'utf-8' });
        const out = `${r.stdout}${r.stderr}`;

        expect(r.status).toBe(1);
        expect(out).toContain('supabase/migrations');
        expect(out).toContain('storage-admin.ts');
        expect(out).toContain('seed:local');
    });

    it('firebase-migrate refuses and names the adapter it would have written through', () => {
        const r = spawnSync('node', ['scripts/firebase-migrate.js', '--dry-run'], { cwd: ROOT, encoding: 'utf-8' });
        const out = `${r.stdout}${r.stderr}`;

        expect(r.status).toBe(1);
        expect(out).toContain('DEDICATED_TABLE_MAP');
        expect(out).toContain('supabase-db.ts');
    });

    it('both keep their original bodies behind an explicit override', () => {
        // Nothing was deleted: the Firebase setup and migration code is still
        // there, and one variable restores it.
        for (const file of ['scripts/setup-firebase.js', 'scripts/firebase-migrate.js']) {
            expect(code(file)).toContain('yes-firebase-is-back');
        }
        expect(code('scripts/setup-firebase.js')).toContain('setCorsConfiguration');
        expect(code('scripts/firebase-migrate.js')).toContain('canonicalStatus');
    });

    it('and the SCHEMAS table the migration script exists for is untouched', () => {
        // The owner decision above rests on this being worth keeping.
        const migrate = code('scripts/firebase-migrate.js');

        for (const collection of ['users', 'cooperative_members', 'wave_applications', 'wave_withdrawals']) {
            expect(migrate).toContain(`collection: "${collection}"`);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#363 — the second database adapter refuses', () => {
    it('getFirestore().collection() throws, naming supabase-db', () => {
        const r = node(
            "const {getFirestore}=require('firebase-admin/firestore');" +
            "try{getFirestore().collection('marketplace_orders');console.log('NO THROW')}" +
            "catch(e){console.log(e.message)}"
        );

        expect(r.out).not.toContain('NO THROW');
        expect(r.out).toContain('DEDICATED_TABLE_MAP');
        expect(r.out).toContain('supabase-db');
    });

    it('so do doc() and batch()', () => {
        for (const call of ["doc('a/b')", 'batch()']) {
            const r = node(
                "const {getFirestore}=require('firebase-admin/firestore');" +
                `try{getFirestore().${call};console.log('NO THROW')}catch(e){console.log('THREW')}`
            );

            expect(r.out).toContain('THREW');
        }
    });

    it('and the write batch names its missing methods instead of being undefined', () => {
        // batch.update was `undefined`, so the caller got "is not a function"
        // — a TypeError that reads like a bug in the caller.
        const shim = code('src/lib/shims/firebase-admin/firestore.js');

        expect(shim).toContain('unsupported(\'batch.set()\')');
        expect(shim).toContain('unsupported(\'batch.update()\')');
    });

    it('the inert value objects still work — they cannot write anything', () => {
        // FieldValue is mocked against by several suites and used as a sentinel
        // by supabase-db.ts's detector. Refusing it would break the compat
        // layer without closing any door.
        const r = node(
            "const f=require('firebase-admin/firestore');" +
            "console.log(JSON.stringify(f.FieldValue.increment(2)), typeof f.FieldPath.documentId)"
        );

        expect(r.out).toContain('FieldValue.increment');
        expect(r.out).toContain('function');
    });

    it('nothing in the application reaches that door', () => {
        // The claim the refusal rests on. firebase-admin.ts re-exports
        // supabaseDb; the only production importer of the shim's firestore
        // entry point was the migration script.
        const hits: string[] = [];
        const walk = (dir: string) => {
            for (const name of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
                const rel = `${dir}/${name.name}`;
                if (name.isDirectory()) {
                    if (name.name === 'shims' || name.name === '__tests__') continue;
                    walk(rel);
                } else if (/\.(ts|tsx)$/.test(name.name)
                    && !name.name.endsWith('.d.ts')
                    && !name.name.includes('.test.')) {
                    if (/getFirestore|from ['"]firebase\/auth['"]/.test(code(rel))) hits.push(rel);
                }
            }
        };
        walk('src');

        expect(hits).toEqual([]);
    });

    it('and the one remaining mention is a type import that reaches no code', () => {
        // Excluded by name above rather than silently: src/types/global.d.ts
        // declares `var testDb: Firestore` and `var testAuth: Auth` for the
        // integration helpers. Both shims type those as `any`, and nothing in
        // the repository assigns either global — which is why the
        // signInWithEmailAndPassword call in the integration setup, guarded on
        // `if ((global as any).testAuth)`, has never run.
        const globals = code('src/types/global.d.ts');

        expect(globals).toContain("from 'firebase/auth'");
        expect(globals).toContain('var testAuth');

        const SELF = 'src/__tests__/unit/npm-scripts-can-actually-run.test.ts';
        const assignments = spawnSync('grep', ['-rn', '-e', 'testAuth =', '-e', 'testDb =', 'src', 'e2e', 'tests'],
            { cwd: ROOT, encoding: 'utf-8' })
            .stdout
            .split('\n')
            // This file names the pattern it is searching for, so it matches
            // itself. Seventh time an audit artefact has appeared in its own
            // sweep; excluded by path rather than by weakening the pattern.
            .filter((line) => line.trim() !== '' && !line.startsWith(SELF));

        expect(assignments).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#363 — the client auth shim no longer logs anybody in', () => {
    const shim = code('src/lib/shims/firebase/auth.js');

    it('signInWithEmailAndPassword throws rather than returning a user', () => {
        expect(shim).not.toContain('mock-uid');

        const r = node(
            "const a=require('firebase/auth');" +
            "try{a.signInWithEmailAndPassword({}, 'x@y.z', 'anything');console.log('LOGGED IN')}" +
            "catch(e){console.log(e.message)}"
        );

        expect(r.out).not.toContain('LOGGED IN');
        expect(r.out).toContain('NextAuth');
    });

    it('and so do the other three, including the sign-out that never signed out', () => {
        for (const fn of ['getAuth', 'signOut', 'signInWithCustomToken']) {
            const r = node(
                "const a=require('firebase/auth');" +
                `try{a.${fn}({});console.log('NO THROW')}catch(e){console.log('THREW')}`
            );

            expect(r.out).toContain('THREW');
        }
    });

    it('its already-hardened sibling is still hardened', () => {
        // firestore.js got this treatment earlier and auth.js was missed. If
        // that one regresses, the pair drifts apart again.
        expect(code('src/lib/shims/firebase/firestore.js')).toContain('not implemented');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#363 — recorded, not repaired', () => {
    it('npm run emulator boots an emulator nothing in this project can address', () => {
        // Left for the owner: removing a package.json entry is their call.
        // Pinned so the claim stays true or the test says otherwise.
        expect(pkg.scripts.emulator).toContain('firebase emulators:start');

        const deps = JSON.parse(read('package.json')) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };

        expect(deps.dependencies?.['firebase-tools']).toBeUndefined();
        expect(deps.devDependencies?.['firebase-tools']).toBeUndefined();
    });

    it('the .js files under scripts/ are still outside the typechecker', () => {
        // #328 lifted the exclusions; `allowJs` is on, but tsconfig's `include`
        // lists only .ts, .tsx and .mts globs, so no .js file is ever part of
        // the program. These four are covered by the ratchets in this file and
        // by eslint, not by tsc. Stated rather than assumed, because that gap
        // is why #363 exists.
        const tsconfig = read('tsconfig.json');
        const include: string[] = JSON.parse(
            stripComments(tsconfig).replace(/,(\s*[}\]])/g, '$1'),
        ).include;

        expect(include).toContain('**/*.ts');
        expect(include.filter((g) => g.endsWith('.js') || g.endsWith('.jsx'))).toEqual([]);
        expect(readdirSync(join(ROOT, 'scripts')).filter((f) => f.endsWith('.js')).sort())
            .toEqual(['convert-to-webp.js', 'firebase-migrate.js', 'seed.js', 'setup-firebase.js']);
    });
});
