/**
 * @jest-environment node
 */

/**
 *   #639 THE SAME BLIND SPOT, IN THE SCANNER NEXT DOOR.
 *
 *   #638 found the ownership scanner deciding "does this function take a
 *   caller-supplied id?" by reading PARAMETERS — the whole story for a server
 *   action, half of it for a route handler, which takes `(req)` and reads the id
 *   out of the request. The obvious next question was whether its siblings had
 *   the same habit. One did, and it is the sharpest of them.
 *
 *   `fake-guard-scan` asks: is this authorisation check comparing a record
 *   against something the CALLER controls? Its reference defect is
 *
 *       async function _submitForVerificationAction(listingId, ownerId) {
 *           if (listingData.ownerId !== ownerId) return { error: "Unauthorized" };
 *
 *   — pass the real owner's id, readable from the public listing, and the check
 *   passes. Worse than no check at all, because it reads as one: a reviewer sees
 *   an `Unauthorized` branch and stops looking.
 *
 *   TWO THINGS WERE TRUE OF IT AND THE API SURFACE.
 *
 *     IT HAD NEVER BEEN RUN THERE. Its test pointed it at src/app/actions and
 *     nowhere else, so nothing was known about the 123 route files — the surface
 *     that faces the internet without a server action in front of it.
 *
 *     AND IT COULD NOT HAVE SEEN THEM. Its untrusted set was
 *     `parameterNames(fn)`. The route form of its own reference defect —
 *
 *         const { listingId, ownerId } = await req.json();
 *         if (listingData.ownerId !== ownerId) return 403;
 *
 *     — has no untrusted PARAMETER, so it was planted and reported clean.
 *
 *   Pointed at src/app/api it answered zero, and that zero meant nothing at all.
 *
 * ── THE VOCABULARY IS SHARED NOW, NOT CORRECTED TWICE ───────────────────────
 *
 *   #638 taught the ownership scanner four shapes: a binding destructured from
 *   `req.json()`, one from `await params`, `payload.get("x")`, and a payload
 *   bound to a name of its own. Teaching them to fake-guard-scan by writing them
 *   out again is the defect class this audit has found more often than any
 *   other — two hand-maintained copies of one contract, which drift, and whose
 *   drift is invisible until something they both decide comes apart.
 *
 *   `lib/testing/caller-supplied.ts` holds the definition and both scanners ask
 *   it. A third scanner asking a different question about the same values starts
 *   by importing it rather than by remembering which four shapes to match.
 *
 * ── AND THE ANSWER, WITH AN INSTRUMENT THAT CAN ANSWER ──────────────────────
 *
 *   ZERO fake guards, in src/app/actions and in src/app/api. Pinned here, so the
 *   number is a measurement rather than a silence.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { join } from 'path';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { scanForFakeGuards, scanFileForFakeGuards } from '@/lib/testing/fake-guard-scan';
import { callerSuppliedNames } from '@/lib/testing/caller-supplied';
import * as ts from 'typescript';

const ROOT = process.cwd();

/** Scan one sample handler, written to a throwaway directory. */
function scanRoute(code: string): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'fakeguard-'));
    try {
        mkdirSync(join(dir, 'api', 'thing'), { recursive: true });
        const file = join(dir, 'api', 'thing', 'route.ts');
        writeFileSync(file, code);
        return scanFileForFakeGuards(file, dir).map((l) => `${l.fn}:${l.code}`);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** The caller-supplied names of the first function in a snippet. */
function namesIn(code: string): string[] {
    const source = ts.createSourceFile('s.ts', code, ts.ScriptTarget.Latest, true);
    let found: Set<string> = new Set();
    const visit = (n: ts.Node) => {
        if (ts.isFunctionDeclaration(n) && found.size === 0) found = callerSuppliedNames(n);
        ts.forEachChild(n, visit);
    };
    visit(source);
    return [...found].sort();
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#639 — a fake guard in a route handler is a fake guard', () => {
    it('THE ROUTE FORM OF THE REFERENCE DEFECT IS FOUND', () => {
        //   The planted case that was reported clean. This is the whole finding.
        const leads = scanRoute(`
            export async function POST(req: Request) {
                const { session } = await requireSession();
                const { listingId, ownerId } = await req.json();
                const listingDoc = await db.collection("land").doc(listingId).get();
                const listingData = listingDoc.data();
                if (listingData.ownerId !== ownerId) {
                    return Response.json({ error: "Unauthorized" }, { status: 403 });
                }
                await listingDoc.ref.update({ status: "submitted" });
                return Response.json({ ok: true });
            }
        `);
        expect(leads).toHaveLength(1);
        expect(leads[0]).toContain('POST:');
        expect(leads[0]).toContain('listingData.ownerId !== ownerId');
    });

    it('AND SO IS ONE COMPARED AGAINST THE QUERY STRING', () => {
        const leads = scanRoute(`
            export async function GET(req: NextRequest) {
                const { session } = await requireSession();
                const sellerId = req.nextUrl.searchParams.get("sellerId");
                const order = await db.collection("orders").doc("o1").get();
                if (order.data().sellerId !== sellerId) {
                    return Response.json({ error: "Unauthorized" }, { status: 403 });
                }
                return Response.json({ ok: true });
            }
        `);
        expect(leads).toHaveLength(1);
    });

    it('AND THE PARAMETER FORM STILL IS — it was the half that worked', () => {
        const leads = scanRoute(`
            export async function submitForVerificationAction(listingId: string, ownerId: string) {
                const listingDoc = await db.collection("land").doc(listingId).get();
                if (listingDoc.data().ownerId !== ownerId) {
                    return { error: "Unauthorized" };
                }
                await listingDoc.ref.update({ status: "submitted" });
            }
        `);
        expect(leads).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#639 — and a real guard is still not a lead', () => {
    /*
     *   The half that matters more. This scanner ships as a LEAD LIST, and a
     *   lead list that flags correct code is one people learn to skip past —
     *   which is how the thing it is looking for gets through.
     */
    it('COMPARING THE RECORD TO THE SESSION IS A REAL GUARD', () => {
        expect(scanRoute(`
            export async function POST(req: Request) {
                const { session } = await requireSession();
                const { listingId } = await req.json();
                const listingDoc = await db.collection("land").doc(listingId).get();
                if (listingDoc.data().ownerId !== session.user.id) {
                    return Response.json({ error: "Unauthorized" }, { status: 403 });
                }
                await listingDoc.ref.update({ status: "submitted" });
                return Response.json({ ok: true });
            }
        `)).toEqual([]);
    });

    it('AND SO IS ONE PINNED TO THE SESSION EARLIER IN THE HANDLER', () => {
        /*
         *   The good idiom: pin the caller's value once, then use it freely.
         *   Reading comparisons in isolation flags the second line, which is
         *   what this scanner's first version did to two correct actions.
         */
        expect(scanRoute(`
            export async function POST(req: Request) {
                const { session } = await requireSession();
                const { userId, certId } = await req.json();
                if (session.user.id !== userId) {
                    return Response.json({ error: "Unauthorized" }, { status: 403 });
                }
                const cert = await db.collection("certs").doc(certId).get();
                if (cert.data().userId !== userId) {
                    return Response.json({ error: "Unauthorized" }, { status: 403 });
                }
                return Response.json({ ok: true });
            }
        `)).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#639 — one definition of "the caller chose this"', () => {
    it('IT KNOWS ALL FOUR DOORS', () => {
        expect(namesIn(`
            export async function POST(req: Request, { params }: { params: any }) {
                const { ownerId } = await req.json();
                const { courseId } = await params;
                const form = await req.formData();
                const memberId = form.get("memberId");
                const q = new URL(req.url).searchParams;
                const buyerId = q.get("buyerId");
            }
        `)).toEqual(['buyerId', 'courseId', 'form', 'memberId', 'ownerId', 'params', 'q', 'req']);
    });

    it('AND IT DOES NOT CLAIM A SESSION VALUE', () => {
        //   The line between the two sets. Everything here is derived from the
        //   session, and none of it is something the caller chose.
        expect(namesIn(`
            export async function POST(req: Request) {
                const { session } = await requireSession();
                const actorId = session.user.id;
                const roles = session.user.roles;
            }
        `)).toEqual(['req']);
    });

    it('AND BOTH SCANNERS ASK IT rather than keeping a copy', () => {
        //   The structural half of the fix: #638 taught these four shapes to one
        //   scanner, and writing them out again in the other is the defect class
        //   this audit has found most often.
        const { readFileSync } = jest.requireActual('fs') as typeof import('fs');
        const ownership = readFileSync(join(ROOT, 'src/lib/testing/ownership-scan.ts'), 'utf-8');
        const fakeGuard = readFileSync(join(ROOT, 'src/lib/testing/fake-guard-scan.ts'), 'utf-8');

        expect(ownership).toContain('from "./caller-supplied"');
        expect(fakeGuard).toContain('from "./caller-supplied"');

        //   And neither keeps its own copy of the source pattern.
        for (const src of [ownership, fakeGuard]) {
            expect(src).not.toMatch(/const CALLER_SUPPLIED_SOURCE\s*=/);
            expect(src).not.toMatch(/const ID_LIKE_NAME\s*=/);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#639 — and both surfaces are pinned at zero', () => {
    it('NO AUTHORISATION CHECK COMPARES A RECORD TO SOMETHING THE CALLER WROTE', () => {
        for (const dir of ['src/app/actions', 'src/app/api']) {
            const leads = scanForFakeGuards(join(ROOT, dir), join(ROOT, 'src'));
            expect({ dir, leads: leads.map((l) => `${l.file}:${l.fn}:${l.line}`) })
                .toEqual({ dir, leads: [] });
        }
    });

    it('AND THE SCAN ACTUALLY READ THEM — a positive control on the walk', () => {
        /*
         *   Without this, a walker that found no files would make the assertion
         *   above pass over 123 unread routes — which is, precisely, the defect
         *   this file is about, so it is not left to chance.
         *
         *   Measured on a THROWAWAY TREE shaped like the real one. The first
         *   version planted the probe inside src/app/api and deleted it
         *   afterwards; it passed alone and failed in the full run, because jest
         *   runs suites in parallel workers and a neighbour that scans the write
         *   surface counted the probe while it existed. A test that mutates the
         *   tree its neighbours are reading is a flake generator.
         */
        const dir = mkdtempSync(join(tmpdir(), 'fakeguard-walk-'));
        try {
            const api = join(dir, 'src', 'app', 'api', 'thing');
            mkdirSync(api, { recursive: true });
            writeFileSync(join(api, 'route.ts'), `
                export async function POST(req: Request) {
                    const { thingId, ownerId } = await req.json();
                    const doc = await db.collection("things").doc(thingId).get();
                    if (doc.data().ownerId !== ownerId) return Response.json({}, { status: 403 });
                    await doc.ref.update({ ok: true });
                    return Response.json({ ok: true });
                }
            `);
            const leads = scanForFakeGuards(join(dir, 'src/app/api'), join(dir, 'src'));
            expect(leads.map((l) => `${l.file}::${l.fn}`)).toEqual(['app/api/thing/route.ts::POST']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the untrusted set is parameters only again         KILLED
 *     the shared source pattern stops matching req.json()            KILLED
 *     the payload-name collection is removed                         KILLED
 *     a `.get("x")` result stops being caller-supplied               KILLED
 *     the source pattern claims a session value too                  KILLED
 *     pinning to the session stops making a comparison sound         KILLED
 *     the payload receiver set matches nothing                       KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   "The source pattern claims a session value too" is the one that would look
 *   like more thorough detection and is a worse defect: if `session` counted as
 *   caller-supplied, every correct guard in the codebase becomes a lead, and a
 *   lead list nobody can read finds nothing at all.
 *
 *   "Pinning to the session stops making a comparison sound" guards the same
 *   direction: the good idiom pins the caller's value once and then uses it
 *   freely, and flagging the second comparison is what this scanner's first
 *   version did to two correct actions.
 *
 * ── AND ONE SURVIVED FIRST ──────────────────────────────────────────────────
 *
 *   "The payload receiver set matches nothing" survived. Every case written
 *   bound the value to a variable first — `const q = …searchParams; q.get("x")`
 *   — and a variable's INITIALIZER is matched by the source pattern instead, so
 *   the receiver rule was doing no work in any test. It earns its place when
 *   there is no variable at all, which is how a one-line handler reads an id;
 *   that case is now in a-scan-that-read-half-the-doors.test.ts, and it kills
 *   the mutant.
 *
 *   Second time in two findings that a survivor was a missing case rather than
 *   a redundant rule. A surviving mutant is a question about the tests before it
 *   is a question about the code.
 */
