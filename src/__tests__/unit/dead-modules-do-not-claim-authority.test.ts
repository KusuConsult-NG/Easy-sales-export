/**
 * @jest-environment node
 */

/**
 *   #355 TWO MODULES NAMED THEMSELVES THE AUTHORITY, AND NOTHING IMPORTS
 *        EITHER OF THEM.
 *
 *        This is #353(b) again, found by the same measurement. Working the
 *        0%-coverage list turned up eight lib modules with no importers at
 *        all. Six are harmless — URL builders, unused zod schemas, a re-export
 *        shim for imports that do not exist. Two are not, because they claim
 *        in their own headers to be the thing the codebase should be using.
 *
 *        (a) lib/canonical/sync-engine.ts said "Enforces atomic writes to the
 *            Single Source of Truth". BOTH HALVES ARE FALSE.
 *
 *            It is not atomic. `db.runTransaction` here is not a database
 *            transaction — supabase-db.ts:2156 is the entire implementation:
 *
 *                const tx = new SupabaseTransaction();
 *                const result = await fn(tx);
 *                await tx._commit();
 *
 *            A queue, a callback, a flush. No lock, no isolation, no rollback.
 *            That is precisely why every money path in this application uses a
 *            CAS Postgres function in lib/wallet-ledger.ts instead. So
 *            syncCanonicalUser is an unguarded read-modify-write, and two
 *            concurrent calls lose one another's updates.
 *
 *            A module named "sync engine" that promises atomicity and delivers
 *            none is worse than no module: it is the reason somebody would
 *            stop looking for the CAS function they actually need. #245's
 *            shape — a control that reads as present and is none — in the file
 *            that names itself the enforcement.
 *
 *            And it is not the source of truth either. One export, zero
 *            callers.
 *
 *        (b) lib/verification-canonical.ts said "This module provides the
 *            authoritative way to read and write user verification data. It
 *            abstracts away the fragmented legacy collections."
 *
 *            The intent is sound and the fragmentation is real — #25 found
 *            verificationStatus written as a string by four callers and as an
 *            object by three. But this module was never adopted, so that
 *            fragmentation is still there and this is the authoritative way to
 *            do nothing.
 *
 *        (c) A CORRECTION TO MY OWN FIRST PASS. I also wrote lib/canonical/
 *            schemas.ts up as dead. IT IS NOT. lib/canonical/normalizer.ts
 *            imports it and normalizer has eight live importers. Two faults in
 *            the reachability helper below both pointed the same way, and are
 *            described where they were made.
 *
 *            Measured properly, schemas.ts has a different defect and it is
 *            the more interesting one: it is the READ half of a model whose
 *            WRITE half is dead. LATEST_SCHEMA_VERSION reaches a stored
 *            document through sync-engine only — the module with zero callers
 *            — so no row in this database carries `schemaVersion`, while
 *            scripts/repair-schemas.ts writes `_schemaVersion` instead. That
 *            is recorded in its header and pinned below.
 *
 *        All three are KEPT, per the standing instruction to fix rather than
 *        delete. Their headers now say what they are. This file holds them
 *        there, and generalises: a module may be unreachable, and a module may
 *        call itself canonical, but not both silently.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, dirname, resolve } from 'path';
import { execSync } from 'child_process';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const SYNC = 'src/lib/canonical/sync-engine.ts';
const VERIF = 'src/lib/verification-canonical.ts';
const SCHEMAS = 'src/lib/canonical/schemas.ts';

// ─────────────────────────────────────────────────────────────────────────────
// REACHABILITY
//
// The first version of this helper was a grep, and it was wrong in three
// different ways — twice calling a live module dead, once calling a dead one
// live. All three are written down because each one produced a finding I had
// to retract:
//
//   1. It searched `src` only. lib/savings-repair-plan.ts is imported by
//      scripts/repair-savings-balance.ts, which its own header says in the
//      first paragraph. Searching src alone called a live module dead.
//   2. It matched only the `@/lib/...` alias, so sibling files importing each
//      other relatively were missed. The fix for that over-corrected and
//      matched any path ENDING in the basename, reading
//      `@/lib/types/marketplace-escrow` as an importer of
//      `lib/validations/escrow.ts`.
//   3. Even anchored, a basename match cannot tell `./schemas` in lib/auth.ts
//      (which is lib/schemas.ts) from `./schemas` in lib/canonical/
//      sync-engine.ts (which is lib/canonical/schemas.ts). That one had me
//      publish a wrong write-up on schemas.ts — see (c) above.
//
// So it no longer greps. It parses every specifier out of every source file
// and RESOLVES it against the importing file's own directory, exactly as the
// bundler would. And it walks the graph transitively, because being imported
// by a dead module is not being used.
// ─────────────────────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full) && !/\.d\.ts$/.test(full)) out.push(full);
    }
    return out;
}

const ROOT = process.cwd();

/** Every non-test source file, repo-relative. */
const ALL_FILES: string[] = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))]
    .map((f) => relative(ROOT, f))
    .filter((f) => !f.includes('__tests__') && !f.includes('/testing/'));

/** Resolve one import specifier to a repo-relative file, or null if external. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith('@/')) base = join(ROOT, 'src', spec.slice(2));
    else if (spec.startsWith('.')) base = resolve(ROOT, dirname(fromFile), spec);
    else return null;                                    // node_modules, "server-only", …

    for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (existsSync(cand) && statSync(cand).isFile()) return relative(ROOT, cand);
    }
    return null;
}

/** importee → the files that import it. */
const IMPORTERS: Map<string, Set<string>> = (() => {
    const map = new Map<string, Set<string>>();
    for (const file of ALL_FILES) {
        const code = stripComments(readFileSync(join(ROOT, file), 'utf-8'));
        const specs = [
            ...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
            ...code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
            ...code.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
        ].map((m) => m[1]);

        for (const spec of specs) {
            const target = resolveSpecifier(file, spec);
            if (!target || target === file) continue;
            if (!map.has(target)) map.set(target, new Set());
            map.get(target)!.add(file);
        }
    }
    return map;
})();

/**
 * Is this module reachable from the running application?
 *
 * An importer that lives outside src/lib is a live root — a route, an action,
 * a component, a script. An importer inside src/lib only counts if IT is
 * reachable. That transitive step is the whole point: schemas.ts survives it
 * (normalizer.ts is imported by eight action files), sync-engine.ts does not.
 */
function isReachable(rel: string, seen: Set<string> = new Set()): boolean {
    if (seen.has(rel)) return false;                      // cycle: no live root this way
    seen.add(rel);

    for (const importer of IMPORTERS.get(rel) ?? []) {
        if (!importer.startsWith('src/lib/')) return true;
        if (isReachable(importer, seen)) return true;
    }
    return false;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#355 — the reachability helper itself', () => {
    // Tested first, because three of my retractions came from trusting it.

    it('finds the whole source tree, so nothing below is vacuous', () => {
        expect(ALL_FILES.length).toBeGreaterThan(500);
        expect(IMPORTERS.size).toBeGreaterThan(200);
    });

    it('RESOLVES ./schemas DIFFERENTLY IN TWO DIRECTORIES', () => {
        // The fault that produced a wrong write-up. Both files import
        // "./schemas" and they are not the same file.
        expect(resolveSpecifier('src/lib/auth.ts', './schemas')).toBe('src/lib/schemas.ts');
        expect(resolveSpecifier('src/lib/canonical/sync-engine.ts', './schemas')).toBe(SCHEMAS);
    });

    it('does not confuse a basename that merely matches', () => {
        // `@/lib/types/marketplace-escrow` is not `lib/validations/escrow.ts`.
        expect(resolveSpecifier('src/lib/x.ts', '@/lib/types/marketplace-escrow'))
            .not.toBe('src/lib/validations/escrow.ts');
    });

    it('counts scripts/ as a live root, which the first version did not', () => {
        // lib/savings-repair-plan.ts is imported by a maintenance script only.
        expect(isReachable('src/lib/savings-repair-plan.ts')).toBe(true);
    });

    it('and it agrees with the obvious cases in both directions', () => {
        expect(isReachable('src/lib/wallet-ledger.ts')).toBe(true);
        expect(isReachable('src/lib/admin-permissions.ts')).toBe(true);
        expect(isReachable('src/lib/external-domains.ts')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#355 — the sync engine does not claim to be atomic', () => {
    const raw = readFileSync(SYNC, 'utf-8');

    it('THE "Enforces atomic writes" CLAIM IS GONE', () => {
        // THE test. It promised isolation the adapter does not provide.
        expect(raw).not.toMatch(/^\s*\*\s*Enforces atomic writes to the Single Source of Truth\.\s*$/m);
        expect(raw).toMatch(/IT ENFORCES NOTHING, AND NOTHING CALLS IT/);
    });

    it('and the reason is stated, not just the retraction', () => {
        expect(raw).toMatch(/NO LOCK, no isolation and no rollback/);
        expect(raw).toMatch(/wallet-ledger/);
    });

    it('THE ADAPTER REALLY DOES NOT LOCK — the claim, measured', () => {
        // Pinned against supabase-db itself, so this cannot go stale. If
        // runTransaction ever gains real isolation, this fails and the header
        // can be rewritten.
        const adapter = source('src/lib/supabase-db.ts');
        const impl = adapter.slice(adapter.indexOf('async runTransaction<T>('));
        const body = impl.slice(0, impl.indexOf('batch(): SupabaseWriteBatch'));

        expect(body).toContain('const tx = new SupabaseTransaction();');
        expect(body).toContain('const result = await fn(tx);');
        expect(body).toContain('await tx._commit();');
        // Nothing that would acquire a lock.
        expect(body).not.toMatch(/BEGIN|SELECT .* FOR UPDATE|advisory_lock|rpc\(/i);
    });

    it('and it still uses runTransaction, so the warning is not hypothetical', () => {
        // Vacuity guard: the header describes THIS code.
        expect(source(SYNC)).toContain('db.runTransaction(');
    });

    it('IT IS STILL UNREACHABLE — transitively, not just one hop', () => {
        expect(isReachable(SYNC)).toBe(false);
        expect(IMPORTERS.get(SYNC) ?? new Set()).toEqual(new Set());
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#355 — the verification module does not claim to be canonical', () => {
    const raw = readFileSync(VERIF, 'utf-8');

    it('THE "authoritative way" CLAIM IS GONE', () => {
        expect(raw).not.toMatch(/^\s*\*\s*This module provides the authoritative way to read and write/m);
        expect(raw).toMatch(/it is the authoritative way to do\s*\n\s*\*\s*NOTHING/i);
    });

    it('and it points at the fragmentation that is still real', () => {
        expect(raw).toMatch(/#25/);
    });

    it('the fragmentation it names really does still exist', () => {
        // Measured. verificationStatus is still written in more than one shape,
        // which is what this module was built to end and did not.
        const writers: string = execSync(
            "grep -rn 'verificationStatus' --include='*.ts' src/app/actions src/app/api "
            + "| grep -v __tests__ || true",
            { encoding: 'utf-8' },
        );

        expect(writers.split('\n').filter(Boolean).length).toBeGreaterThan(3);
    });

    it('and it is still unreachable', () => {
        expect(isReachable(VERIF)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#355 — schemas.ts: the read half of a model whose write half is dead', () => {
    const raw = readFileSync(SCHEMAS, 'utf-8');

    it('MY FIRST WRITE-UP CALLED THIS FILE DEAD AND IT IS NOT', () => {
        // The retraction, pinned. normalizer.ts imports it and normalizer has
        // eight live importers, so these types are in the running application.
        expect(isReachable(SCHEMAS)).toBe(true);
        expect(IMPORTERS.get(SCHEMAS)).toContain('src/lib/canonical/normalizer.ts');
        expect(isReachable('src/lib/canonical/normalizer.ts')).toBe(true);

        const normalizerCallers = [...(IMPORTERS.get('src/lib/canonical/normalizer.ts') ?? [])];
        expect(normalizerCallers.length).toBeGreaterThanOrEqual(8);

        expect(raw).toMatch(/A CORRECTION TO MY OWN FIRST WRITE-UP, WHICH SAID THIS FILE WAS DEAD/);
    });

    it('THE "All modules must normalize" CLAIM IS NO LONGER MADE, ONLY QUOTED', () => {
        // Scoped, because the retraction quotes the sentence it retracts and a
        // bare negative match hits my own tombstone — the same trap #350 fell
        // into. The claim must appear exactly once, inside `Its header said`.
        expect(raw.match(/All modules must normalize/g) ?? []).toHaveLength(1);
        expect(raw).toMatch(/Its header said "This file defines the platform-wide SINGLE SOURCE OF/);
        expect(raw).toMatch(/LATEST_SCHEMA_VERSION HAS NEVER BEEN STORED ON A SINGLE\s+DOCUMENT/);
    });

    it('LATEST_SCHEMA_VERSION REACHES A WRITE THROUGH THE DEAD MODULE ONLY', () => {
        // The finding, measured. Every file that mentions the constant, and
        // what it does with it.
        const users = [...(IMPORTERS.get(SCHEMAS) ?? [])];

        expect(users.sort()).toEqual([
            'src/lib/canonical/normalizer.ts',
            'src/lib/canonical/sync-engine.ts',
        ]);

        // sync-engine writes it — and sync-engine has no callers.
        expect(source(SYNC)).toContain('schemaVersion: LATEST_SCHEMA_VERSION');
        expect(isReachable(SYNC)).toBe(false);

        // normalizer sets it on a returned view object that nobody persists.
        const marketplace = source('src/app/actions/admin/_marketplace.ts');
        expect(marketplace).toContain('const normalized = normalizeAggressive(');
        expect(marketplace).not.toMatch(/\.(update|set)\([^)]*\bnormalized\b/);
    });

    it('so NOTHING REACHABLE WRITES schemaVersion, and nothing reads it', () => {
        const hits: string = execSync(
            "grep -rn '\\bschemaVersion\\b' --include='*.ts' --include='*.tsx' src scripts "
            + '| grep -v __tests__ || true',
            { encoding: 'utf-8' },
        );
        const files = new Set(hits.split('\n').filter(Boolean).map((l) => l.split(':')[0]));

        // Only the canonical trio. No route, no action, no query filters on it.
        expect([...files].sort()).toEqual([
            'src/lib/canonical/normalizer.ts',
            'src/lib/canonical/schemas.ts',
            'src/lib/canonical/sync-engine.ts',
        ]);
    });

    it('while the repair script writes a DIFFERENTLY NAMED field', () => {
        // _schemaVersion = 2, not schemaVersion = 8. A migration keyed on
        // either would find no rows.
        const repair = source('scripts/repair-schemas.ts');

        expect(repair).toContain('_schemaVersion = 2');
        expect(repair).not.toContain('LATEST_SCHEMA_VERSION');
        expect(source(SCHEMAS)).toContain('export const LATEST_SCHEMA_VERSION = 8');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#355 — the ratchet: unreachable, or canonical, but not both silently', () => {
    const libFiles = ALL_FILES.filter((f) => f.startsWith('src/lib/'));

    it('finds the lib modules, so this is not vacuous', () => {
        expect(libFiles.length).toBeGreaterThan(50);
    });

    it('NO MODULE CALLS ITSELF THE AUTHORITY WITHOUT EITHER A CALLER OR A CORRECTION', () => {
        // Derived, because two of the eight unreachable modules had this and
        // the difference between them and the harmless six was exactly this
        // claim. A file may be unreachable. A file may call itself canonical.
        // A file that does both, with nothing saying so, is the trap.
        const CLAIM = /\b(authoritative|single source of truth|canonical way|source of truth)\b/i;
        const offenders: string[] = [];

        for (const f of libFiles) {
            const raw = readFileSync(join(ROOT, f), 'utf-8');
            if (!CLAIM.test(raw)) continue;
            if (isReachable(f)) continue;                     // it is used; fine
            if (/#355|NOTHING IMPORTS|nothing calls it/i.test(raw)) continue;  // corrected

            offenders.push(f);
        }

        // Was: lib/canonical/sync-engine.ts and lib/verification-canonical.ts.
        // (The first run of this ratchet also named lib/savings-repair-plan.ts
        // and cleared lib/canonical/schemas.ts, both faults in the helper
        // above rather than in the modules — see the note there.)
        expect(offenders).toEqual([]);
    });

    it('RECORDED: the harmless unreachable modules, so the list is not rediscovered', () => {
        // Named rather than left to the next sweep. None of these claims
        // authority; each is dead code that would work if wired up.
        for (const f of [
            // auth-redirect.ts was on this list and is DELETED — #445, owner
            // decision. Its absence is pinned in dead-module-authority.test.ts.
            'src/lib/external-domains.ts',
            'src/lib/paystack-fulfillment.ts',
            'src/lib/validations/escrow.ts',
            'src/lib/validations/cooperative.ts',
        ]) {
            expect(isReachable(f)).toBe(false);
        }
    });
});
