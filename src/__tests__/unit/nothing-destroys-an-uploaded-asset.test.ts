/**
 * @jest-environment node
 */

/**
 *   #675 THE OWNER'S MOST EMPHATIC STANDING RULE WAS TRUE BY ACCIDENT.
 *
 *   The instruction this audit runs under, verbatim:
 *
 *       "you can't delete or destroy anything on cloudinary or anything that
 *        was wrongly programmed rather fix the errors and ensure all data are
 *        safe."
 *
 *   IT HOLDS. Swept today: no `uploader.destroy`, no `delete_resources`, no
 *   `api.delete`, and the Cloudinary SDK is NOT A DEPENDENCY of this project at
 *   all. Every asset call goes through one REST endpoint reached by `fetch`:
 *
 *       https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload
 *
 *   AND NOTHING WAS KEEPING IT TRUE. There is no test anywhere in this
 *   repository that asks whether an asset can be destroyed. The rule held
 *   because nobody had written such a call yet — which is a different thing
 *   from the rule being enforced, and the difference shows up the first time
 *   somebody implements "remove this photo" the obvious way.
 *
 *   That gap matters more here than it would elsewhere, because the codebase
 *   has ALREADY had to reason about it. #292 established that nothing removes
 *   an asset, and `module-application-erasure.ts` copies Cloudinary references
 *   INTO A RETENTION RECORD before clearing a field, on the explicit grounds
 *   that dropping the link without retaining it destroys the only record of
 *   whose the file was — "removing the evidence rather than the data". A rule
 *   with that much design resting on it should not be one careless import away
 *   from being gone.
 *
 * ── WHAT THIS DOES AND DOES NOT ASSERT ──────────────────────────────────────
 *
 *   It asserts that the APPLICATION contains no call that destroys a stored
 *   asset, by either shape it could take: the SDK, or a REST request to a
 *   destroying endpoint. It does not and cannot assert anything about what is
 *   done in the Cloudinary console by hand, or by another system holding the
 *   same credentials.
 *
 *   IT IS NOT A BAN ON THE FEATURE. If the owner ever asks for real deletion,
 *   this test is where the decision gets made explicitly — the name of the
 *   allowed call goes in the list below with a reason, and the retention rule
 *   above gets extended to cover it. What it forbids is the same thing arriving
 *   without anybody noticing.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();

/** Every application source file — not the tests, which discuss these calls. */
const sources = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (entry === 'node_modules' || entry === '__tests__' || entry === '.next') continue;
            if (statSync(full).isDirectory()) { walk(full); continue; }
            if (/\.(ts|tsx|js|mjs)$/.test(entry) && !/\.test\.|\.spec\./.test(entry)) out.push(full);
        }
    };
    for (const top of ['src', 'packages', 'scripts']) {
        try { walk(join(ROOT, top)); } catch { /* a tree that is not there is not a finding */ }
    }
    return out;
};

const FILES = sources();

/** Source with comments stripped — prose about `destroy` is not a call to it. */
const body = (file: string) =>
    stripComments(readFileSync(file, 'utf8'), { label: relative(ROOT, file) });

/**
 * The ways an uploaded asset could actually be removed.
 *
 * TWO SHAPES, because this project reaches Cloudinary by `fetch` and the SDK is
 * not a dependency — so a sweep for SDK method names alone would have been a
 * check that could not fail, and a sweep for REST alone would miss the day
 * somebody adds the package.
 */
const DESTRUCTIVE = [
    //   The SDK, should it ever be installed.
    { name: 'uploader.destroy', pattern: /\buploader\s*\.\s*destroy\s*\(/ },
    { name: 'api.delete_resources', pattern: /\bdelete_resources(_by_prefix|_by_tag)?\s*\(/ },
    { name: 'api.delete_folder', pattern: /\bdelete_folder\s*\(/ },
    { name: 'api.delete_derived_resources', pattern: /\bdelete_derived_resources\s*\(/ },
    //   The REST API, which is how this project talks to Cloudinary today.
    { name: 'a REST call to /destroy', pattern: /api\.cloudinary\.com\/[^"'`]*\/destroy/ },
    { name: 'a REST call to /resources (deletable)', pattern: /api\.cloudinary\.com\/[^"'`]*\/resources/ },
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#675 — nothing in this application destroys an uploaded asset', () => {
    it('THE SWEEP IS READING THE APPLICATION', () => {
        /*
         *   THE control, and the one that decides whether anything below means
         *   anything. Every assertion here is "no file matches", which an empty
         *   file list satisfies perfectly — a check that cannot fail, and the
         *   defect this audit has removed more often than any other.
         *
         *   Anchored on the file that actually uploads, so a reorganisation
         *   that moves the source tree fails here rather than silently reducing
         *   the sweep to nothing.
         */
        expect(FILES.length).toBeGreaterThan(500);
        expect(FILES.some((f) => f.endsWith(join('src', 'app', 'actions', 'upload.ts')))).toBe(true);
    });

    it('AND IT CAN SEE A CLOUDINARY CALL WHEN THERE IS ONE', () => {
        //   The second half of the control: proof the sweep would notice an
        //   asset call at all. The upload endpoint is reached by `fetch`, so a
        //   sweep looking only for SDK method names would find nothing here and
        //   report a clean bill of health for ever.
        const uploaders = FILES.filter((f) => /api\.cloudinary\.com/.test(body(f)));

        expect(uploaders.length).toBeGreaterThan(0);
        expect(uploaders.map((f) => relative(ROOT, f))).toContain(join('src', 'app', 'actions', 'upload.ts'));
    });

    it.each(DESTRUCTIVE)('NOTHING CALLS $name', ({ pattern }) => {
        const offenders = FILES
            .filter((f) => pattern.test(body(f)))
            .map((f) => relative(ROOT, f));

        //   Named, not counted: a count cannot be acted on (#658), and whoever
        //   meets this failure needs the file, not the number.
        expect({ offenders }).toEqual({ offenders: [] });
    });

    it('AND THE ONLY CLOUDINARY ENDPOINT REACHED IS THE UPLOAD ONE', () => {
        /*
         *   The catch-all above the per-pattern list. Cloudinary's REST surface
         *   is larger than the four destroying calls named above, and a future
         *   endpoint that removes something would not match any of them.
         *
         *   So the endpoints are enumerated instead: whatever this application
         *   asks Cloudinary to do is visible here, and adding a second one is a
         *   decision somebody has to write down.
         */
        const endpoints = new Set<string>();
        for (const file of FILES) {
            for (const m of body(file).matchAll(/api\.cloudinary\.com\/[^"'`\s)]*/g)) {
                endpoints.add(m[0]);
            }
        }

        expect([...endpoints]).toEqual([
            'api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload',
        ]);
    });

    it('AND THE SDK IS NOT A DEPENDENCY, SO THERE IS NO SECOND ROUTE IN', () => {
        /*
         *   The sweep above reads source. A dependency brings its own, and
         *   `cloudinary.v2.uploader.destroy` is one import away the moment the
         *   package is present. It is absent today; this says so, so that
         *   adding it is deliberate rather than incidental.
         */
        const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

        expect(Object.keys(deps)).not.toContain('cloudinary');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#675 — and the reference is retained before a field is cleared', () => {
    it('ERASURE COPIES DOCUMENT REFERENCES INTO A RETENTION RECORD FIRST', () => {
        /*
         *   The other half of the owner's rule, and the reason the sweep above
         *   is not the whole story: an asset that survives in Cloudinary but
         *   whose only reference has been deleted is not safe, it is
         *   unreachable. #292 settled that — "removing the evidence rather than
         *   the data" — and module-application-erasure.ts implements it.
         *
         *   Asserted here so the two halves of one rule live together, and so a
         *   change that kept the sweep green by dropping references instead
         *   fails.
         */
        const erasure = readFileSync(join(ROOT, 'src/lib/module-application-erasure.ts'), 'utf8');

        //   The CLAIM lives in a comment and is asserted against the raw file;
        //   the MECHANISM against the stripped one. The mirror of the
        //   comment-stripping rule, learned in #666.
        expect(erasure).toContain('COPIED INTO THE RETENTION RECORD');

        const code = stripComments(erasure, { label: 'module-application-erasure.ts' });
        expect(code).toContain('documentPaths');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE RULE: an uploader.destroy call is added                     KILLED
 *     a REST call to /destroy is added                                KILLED
 *     a REST call to /resources is added                              KILLED
 *     delete_resources_by_prefix is added                             KILLED
 *     the cloudinary SDK is added to package.json                     KILLED
 *     a second cloudinary endpoint is reached                         KILLED
 *     erasure stops retaining document references                     KILLED
 *     the file sweep is narrowed to nothing                           KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   The sweep reads every .ts/.tsx/.js/.mjs under src, packages and scripts
 *   except tests — 500+ files — with comments stripped, because this very file
 *   names all four SDK methods in its own prose and would otherwise report
 *   itself.
 */
