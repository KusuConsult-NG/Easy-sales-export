/**
 * @jest-environment node
 */

/**
 *   #638 THE OWNERSHIP SCAN COULD SEE ONE OF THE TWO WAYS AN ID REACHES A ROUTE.
 *
 *   The ownership scanner asks the question after "is there a guard?": having
 *   established who the caller is, does the function use the answer? It was
 *   written for `src/app/actions` and has been run there. This audit pointed it
 *   at `src/app/api` — 123 route files it had never been asked about — and it
 *   answered ZERO LEADS.
 *
 *   That number was not believed, and it should not have been. A route of
 *   exactly the shape the scanner exists to find:
 *
 *       export async function POST(req: Request) {
 *           const { session } = await requireSession();
 *           const { userId } = await req.json();
 *           await db.collection("wallets").doc(userId)
 *               .update({ balance: 0, updatedBy: session.user.id });
 *       }
 *
 *   was planted and also reported clean. `takesId` read PARAMETERS, which is the
 *   whole story for a server action and half of it for a route handler: a route
 *   takes `(req)` and the caller's id arrives in the BODY.
 *
 *   A dynamic route WAS visible, because `{ params }: { params: Promise<{ userId:
 *   string }> }` puts the word in a parameter. So the scan saw one of the two
 *   doors, reported nothing for the other, and nothing distinguished "there is
 *   nothing here" from "I cannot read this" — over every API route this platform
 *   has. "Could not tell" answering as "no", for the fifth time in this audit and
 *   the first time inside an instrument built to prevent it.
 *
 * ── WHAT THE REPAIRED SCAN FOUND ────────────────────────────────────────────
 *
 *   Still zero, across all 123 route files — and that is now a MEASUREMENT
 *   rather than a silence, so it is pinned at zero here. The scan is a lead list
 *   over src/app/actions because a 20% hit rate would be intolerable as a build
 *   gate; over src/app/api the rate is zero, and zero is the moment a lead list
 *   can become a ratchet at no cost to anybody.
 *
 * ── AND THE LEADS OVER src/app/actions, READ ────────────────────────────────
 *
 *   Recorded so the absence of a finding is a measurement and the next person
 *   does not re-read them:
 *
 *     completeCourse                 KNOWN FALSE POSITIVE. The progress key is
 *                                    `${session.user.id}_${courseId}`, so the
 *                                    caller's id addresses their own row.
 *     _getSellerReviewSummaryAction  KNOWN FALSE POSITIVE, documented in
 *                                    ownership-scan.test.ts.
 *     joinVillageMarketEventAction   READ HERE, FALSE POSITIVE. `eventId` is
 *                                    caller-supplied and addresses the event;
 *                                    the value WRITTEN is
 *                                    `arrayUnion(userId)` where userId is
 *                                    session-derived, and the action first
 *                                    requires the caller's own
 *                                    sellerVerificationStatus to be approved.
 *                                    Joining an event is open to any approved
 *                                    seller — there is no ownership question to
 *                                    answer. Not rewritten into a rule: the
 *                                    general shape "addresses somebody else's
 *                                    document, writes only session values"
 *                                    is too broad to encode without hiding real
 *                                    defects.
 *     setSellerBadge                 WAS A LEAD, NOW IS NOT. It asks
 *                                    `callerHasPermission(actorId,
 *                                    "marketplace:approve_sellers")` — the
 *                                    shared permission matrix — and that name
 *                                    was missing from ROLE_CHECKS. A scan whose
 *                                    false positives are correct code asking
 *                                    the right question trains people to stop
 *                                    reading it, so the name was added rather
 *                                    than the lead explained away.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { join } from 'path';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { scanForOwnership, scanFileForOwnership } from '@/lib/testing/ownership-scan';

const ROOT = process.cwd();

/** Scan one sample handler, written to a throwaway directory. */
function scanRoute(code: string): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'ownroute-'));
    try {
        mkdirSync(join(dir, 'api', 'thing'), { recursive: true });
        const file = join(dir, 'api', 'thing', 'route.ts');
        writeFileSync(file, code);
        return scanFileForOwnership(file, dir).map((l) => l.name).sort();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const GUARD = 'const { session } = await requireSession();';

// ─────────────────────────────────────────────────────────────────────────────
describe('#638 — a route handler is a door the scan can read', () => {
    it('AN ID FROM THE REQUEST BODY IS A CALLER-SUPPLIED ID', () => {
        //   The planted case that was reported clean. This is the whole finding.
        expect(scanRoute(`
            export async function POST(req: Request) {
                ${GUARD}
                const { userId } = await req.json();
                await db.collection("wallets").doc(userId)
                    .update({ balance: 0, updatedBy: session.user.id });
                return Response.json({ ok: true });
            }
        `)).toEqual(['POST']);
    });

    it('AND SO IS ONE FROM THE QUERY STRING', () => {
        expect(scanRoute(`
            export async function GET(req: NextRequest) {
                ${GUARD}
                const sellerId = req.nextUrl.searchParams.get("sellerId");
                await db.collection("payouts").doc(sellerId)
                    .update({ held: true, updatedBy: session.user.id });
                return Response.json({ ok: true });
            }
        `)).toEqual(['GET']);
    });

    it('AND SO IS ONE FROM A QUERY STRING GIVEN ITS OWN NAME', () => {
        /*
         *   Added because a mutant survived. Dropping `searchParams` from the
         *   caller-supplied-source pattern changed nothing in any test here —
         *   every query-string case written was `…searchParams.get("x")`, which
         *   the receiver rule catches by the word `searchParams` itself.
         *
         *   The pattern earns its place on the ALIASED shape: once the params
         *   object is bound to a name of its own, only the source pattern knows
         *   that name holds something the caller supplied. A mutant that
         *   survives is a case nobody wrote, not always a rule nobody needs.
         */
        expect(scanRoute(`
            export async function GET(req: NextRequest) {
                ${GUARD}
                const q = new URL(req.url).searchParams;
                const buyerId = q.get("buyerId");
                await db.collection("orders").doc(buyerId)
                    .update({ cancelled: true, updatedBy: session.user.id });
                return Response.json({ ok: true });
            }
        `)).toEqual(['GET']);
    });

    it('AND SO IS ONE FROM A FORM PAYLOAD', () => {
        expect(scanRoute(`
            export async function POST(req: Request) {
                ${GUARD}
                const form = await req.formData();
                const memberId = form.get("memberId");
                await db.collection("members").doc(memberId)
                    .update({ suspended: true, updatedBy: session.user.id });
                return Response.json({ ok: true });
            }
        `)).toEqual(['POST']);
    });

    it('AND THE DYNAMIC-SEGMENT DOOR STILL WORKS — it was the half that did', () => {
        expect(scanRoute(`
            export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
                ${GUARD}
                const { userId } = await params;
                await db.collection("wallets").doc(userId)
                    .update({ balance: 0, updatedBy: session.user.id });
                return Response.json({ ok: true });
            }
        `)).toEqual(['POST']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#638 — and it still says nothing about a handler that decides', () => {
    /*
     *   The half that matters more than the detection. A scan that flags correct
     *   code is a scan people learn to ignore, and this one is already shipped
     *   as a lead list precisely because that is the failure mode.
     */
    it('COMPARING THE BODY ID TO THE SESSION IS DECIDING', () => {
        expect(scanRoute(`
            export async function POST(req: Request) {
                ${GUARD}
                const { userId } = await req.json();
                if (userId !== session.user.id) {
                    return Response.json({ error: "no" }, { status: 403 });
                }
                await db.collection("wallets").doc(userId).update({ balance: 0 });
                return Response.json({ ok: true });
            }
        `)).toEqual([]);
    });

    it('AND SO IS A ROLE CHECK — an admin route is legitimately not owner-scoped', () => {
        expect(scanRoute(`
            export async function POST(req: Request) {
                ${GUARD}
                if (!isAdmin(session.user.roles)) {
                    return Response.json({ error: "no" }, { status: 403 });
                }
                const { userId } = await req.json();
                await db.collection("wallets").doc(userId).update({ balance: 0 });
                return Response.json({ ok: true });
            }
        `)).toEqual([]);
    });

    it('AND SO IS THE PERMISSION MATRIX, which it did not used to know', () => {
        /*
         *   setSellerBadge's shape. `callerHasPermission` was missing from
         *   ROLE_CHECKS, so an action asking the shared matrix — the RIGHT way
         *   to ask — was a lead while four hand-written role lists were not.
         */
        expect(scanRoute(`
            export async function POST(req: Request) {
                ${GUARD}
                const actorId = session.user.id;
                if (!(await callerHasPermission(actorId, "marketplace:approve_sellers"))) {
                    return Response.json({ error: "no" }, { status: 403 });
                }
                const { userId } = await req.json();
                await db.collection("users").doc(userId).update({ isVerifiedBadge: true });
                return Response.json({ ok: true });
            }
        `)).toEqual([]);
    });

    it('AND A HANDLER THAT TAKES NO ID AT ALL IS NOT A LEAD', () => {
        //   Otherwise "flags the vulnerable shapes" would also be true of a scan
        //   that flags everything.
        expect(scanRoute(`
            export async function GET(req: Request) {
                ${GUARD}
                const rows = await db.collection("wallets")
                    .where("userId", "==", session.user.id).get();
                return Response.json({ rows: rows.docs.length });
            }
        `)).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#638 — and the API surface is pinned at zero', () => {
    const apiLeads = scanForOwnership(join(ROOT, 'src/app/api'), join(ROOT, 'src'));

    it('NO ROUTE HANDLER WRITES TO A CALLER-SUPPLIED ID WITHOUT DECIDING', () => {
        /*
         *   A RATCHET, not a lead list. Over src/app/actions the hit rate is
         *   ~20% and a build gate there would train people to silence it; over
         *   src/app/api it is zero, and zero is the moment a lead list becomes a
         *   ratchet at no cost to anybody.
         */
        expect(apiLeads.map((l) => `${l.file}:${l.name}`)).toEqual([]);
    });

    it('AND THE SCAN ACTUALLY READ THEM — a positive control on the walk', () => {
        /*
         *   Without this, a walker that found no files would make the assertion
         *   above pass over 123 unread routes, which is a more thorough version
         *   of the defect this file is about.
         */
        const everyFunction = scanForOwnership(join(ROOT, 'src/app'), join(ROOT, 'src'));
        //   src/app/actions still produces its known leads, through the same
        //   walk and the same analyser.
        expect(everyFunction.length).toBeGreaterThan(0);
        expect(everyFunction.every((l) => l.file.startsWith('app/actions/'))).toBe(true);
    });

    it('AND THE LEADS OVER src/app/actions ARE THE ONES READ IN THIS FILE\'S HEADER', () => {
        //   Pinned so a new one cannot appear unnoticed — the list is short
        //   enough to name, and each name here has been read.
        const actionLeads = scanForOwnership(join(ROOT, 'src/app/actions'), join(ROOT, 'src'));
        expect(actionLeads.map((l) => l.name).sort()).toEqual([
            '_getSellerReviewSummaryAction',
            'completeCourse',
            'joinVillageMarketEventAction',
        ]);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: takesId reads parameters only again                KILLED
 *     the body-source pattern stops matching req.json()              KILLED
 *     the body-source pattern stops matching searchParams            KILLED
 *     the payload-name pre-pass is removed                           KILLED
 *     the id-name pattern matches everything                         KILLED
 *     callerHasPermission stops counting as a decision               KILLED
 *     a role check stops counting as a decision                      KILLED
 *     an identity comparison stops counting as a decision            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   "The id-name pattern matches everything" is the guard against the cheap way
 *   to pass the detection half: a scan that flags every function finds every
 *   defect and is read by nobody. It is killed by the two negative controls —
 *   the handler that compares, and the handler that takes no id at all.
 *
 * ── AND ONE SURVIVED FIRST, WHICH WAS A GAP AND NOT A SPARE RULE ────────────
 *
 *   "The body-source pattern stops matching searchParams" survived. Every
 *   query-string case written here was `…searchParams.get("x")`, which the
 *   RECEIVER rule catches by the word `searchParams` itself — so the source
 *   pattern's clause was doing nothing in any test.
 *
 *   It is not redundant. Once the params object is bound to a name of its own —
 *   `const q = new URL(req.url).searchParams; q.get("buyerId")` — only the
 *   source pattern knows that `q` holds something the caller supplied. The case
 *   was missing, not the rule. A surviving mutant is a question about the tests
 *   before it is a question about the code.
 */
