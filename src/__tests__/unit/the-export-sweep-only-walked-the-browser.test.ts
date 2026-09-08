/**
 * @jest-environment node
 */

/**
 *   #528 #309's SWEEP FOUND THE FOURTEEN SCREENS THAT BUILD A CSV IN THE
 *        BROWSER. IT COULD NOT SEE THE THREE THAT BUILD ONE ON THE SERVER, AND
 *        THOSE ARE THE BIGGEST.
 *
 *   #309 is one of this audit's better instruments. It does not hand-list the
 *   screens — a hand-written list is exactly what left twelve of fourteen
 *   unrecorded — it walks the tree and finds them:
 *
 *       walk(join(process.cwd(), 'src/app/admin'));   // .tsx files only
 *       if (src.includes('text/csv')) out.push(...)
 *
 *   A route handler is a `.ts` file under `src/app/api`. NO SERVER ROUTE COULD
 *   EVER APPEAR IN THAT LIST, however many spreadsheets of people it writes. A
 *   sweep is only as wide as its walk, and this one's walk stopped at the
 *   directory where downloads are CLICKED rather than the one where they are
 *   MADE. Derived beats hand-listed, and it is still not the same as complete.
 *
 *   The three it could not reach:
 *
 *       /api/admin/export/users               every profile — .all() over USERS
 *       /api/admin/export/cooperative-members every cooperative member
 *       /api/admin/wave/reports/export        every WAVE applicant
 *
 *   The first is the platform's most complete copy of its own membership: id,
 *   name, email, phone, gender, roles, whether a BVN/NIN/TIN/CAC is on file, KYC
 *   status, state, LGA and join date, for every user. Its calling page reaches
 *   it with
 *
 *       window.location.href = "/api/admin/export/users";
 *
 *   — a plain GET, which an admin can equally perform by typing the URL — and
 *   neither that page nor the cooperative one contains a single recordExport
 *   call. Nothing anywhere recorded that either file had been taken.
 *
 * ── AND ON THE THIRD, #309 RECORDED THE WRONG SIDE OF THE SAME EXPORT ───────
 *
 *   wave/compliance/page.tsx IS in #309's list of fourteen, and it does not
 *   build a CSV. It matched the walk on this line:
 *
 *       const extension = contentType.includes("text/csv") ? "csv" : ...
 *
 *   which sniffs the type of a file the ROUTE made. So the recordExport went to
 *   the page that consumes the export while the route that authors it recorded
 *   nothing, and a direct POST — this is a POST endpoint, callable without the
 *   page — left no trace at all.
 *
 *   The page's own call is deliberately left in place. It fires when a download
 *   reaches a browser; the new one fires whenever the file is produced. Where a
 *   missing record is a defect, a duplicated true record is not.
 *
 * ── WHY THE RECORD BELONGS ON THE SERVER ────────────────────────────────────
 *
 *   #309 stated its own honest limit: "It cannot prevent an export … an export
 *   performed by calling the action directly still leaves no trace." For a route
 *   that limit lifts. The server is the party producing the file, so the row can
 *   be written where navigating to the URL cannot skip it, and it carries what
 *   the browser never knew — the true row count, the filters, whether the sweep
 *   was truncated, and the address the file went to.
 *
 * ── WHAT WAS CHECKED AND IS NOT CLAIMED ─────────────────────────────────────
 *
 *   THE FAKE DATABASE CANNOT REPORT TRUNCATION. querySnapshot in lib/testing
 *   returns { docs, empty, size, forEach } and no `truncated`, while the real
 *   SupabaseQuerySnapshot carries it. So `if (snapshot.truncated)` is `undefined`
 *   in every test in this repository and those branches have never been
 *   executed by one. The flag is therefore covered at the RULE below, where it
 *   can be passed directly, and not through the routes — stated rather than
 *   quietly skipped. Teaching the fake to report it is a harness change with its
 *   own blast radius and is not made here.
 *
 *   /api/admin/documents/[docId] hands over a member's scanned identity document
 *   and writes no audit row. It is RETIRED — flag-gated behind
 *   LEGACY_DOCUMENT_FALLBACK and 410 by default, reading a collection that has
 *   no writer anywhere (#431) — so a control added there would be a control on
 *   dead code. The sweep below asserts the retirement instead, so it cannot come
 *   back unrecorded without failing.
 *
 *   /api/id-card/pdf serves the CALLER their own card. That is not an export of
 *   other people and is excluded on that basis, asserted rather than assumed.
 *
 *   NO RATE LIMIT WAS ADDED. The users route .all()s the whole USERS table on
 *   every GET and nothing throttles it, which is real. It is a different finding
 *   with a different risk — #527's reasoning applies, and a limit that refuses a
 *   legitimate admin export is worse than the cost it saves — so it is recorded
 *   here and not fixed under this one.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the record removed from the users route         KILLED
 *     the record removed from the cooperative route   KILLED
 *     the record removed from the wave route          KILLED
 *     the dataset check dropped from the shared rule  KILLED
 *     the count passed as the unfiltered snapshot     KILLED
 *     reword this header                              SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { EXPORTABLE_DATASETS } from '@/lib/server-action-values';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: p });

const mockAudit = (globalThis as any).mockCreateAdminAuditLog as jest.Mock<any>;
const mockRequireSession = (globalThis as any).mockRequireSession as jest.Mock<any>;

const ADMIN = 'admin-1';
let store: FakeDbHandle;

/** The three server routes that author a file of people. */
const SERVER_EXPORTS = [
    'src/app/api/admin/export/users/route.ts',
    'src/app/api/admin/export/cooperative-members/route.ts',
    'src/app/api/admin/wave/reports/export/route.ts',
];

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    store = installFakeDb();
    mockAudit.mockImplementation(() => Promise.resolve());
    mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: ADMIN, email: 'admin@example.com', roles: ['super_admin'] } },
        error: null,
    }));
});

const auditRows = () => mockAudit.mock.calls.map((c: any[]) => c[0]);
const exportRows = () => auditRows().filter((r: any) => r?.action === 'data_export');

// ─────────────────────────────────────────────────────────────────────────────
describe('#528 — the instrument, before the measurement', () => {
    /** #309's own walk, reproduced exactly. */
    function csvScreens(): string[] {
        const out: string[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(dir)) {
                const full = join(dir, e);
                if (statSync(full).isDirectory()) walk(full);
                else if (full.endsWith('.tsx') && readFileSync(full, 'utf-8').includes('text/csv')) {
                    out.push(full.slice(ROOT.length + 1));
                }
            }
        };
        walk(join(ROOT, 'src/app/admin'));
        return out.sort();
    }

    it('#309 STILL FINDS ITS FOURTEEN SCREENS', () => {
        //   The baseline. If this stopped finding them the finding below would
        //   be about a different sweep than the one that exists.
        expect(csvScreens().length).toBeGreaterThanOrEqual(14);
    });

    it('AND NOT ONE OF THE THREE SERVER ROUTES IS IN THE LIST', () => {
        //   THE finding, as a measurement rather than a claim: a `.ts` file
        //   under src/app/api cannot appear in a walk of `.tsx` files under
        //   src/app/admin, whatever it writes.
        for (const route of SERVER_EXPORTS) {
            expect(csvScreens()).not.toContain(route);
        }
    });

    it('AND ALL THREE OF THEM DO BUILD A FILE OF PEOPLE', () => {
        //   The other half, so the exclusion above is about a real omission and
        //   not three files that never exported anything.
        for (const route of SERVER_EXPORTS) {
            expect(code(route)).toMatch(/Content-Disposition/);
        }
        expect(code(SERVER_EXPORTS[0])).toContain('COLLECTIONS.USERS');
        expect(code(SERVER_EXPORTS[0])).toContain('.all().get()');
    });

    it('and the wave screen it DID find never builds a CSV — it sniffs one', () => {
        //   #309 recorded the page that consumes the export and missed the
        //   route that authors it. The match was on a content-type test.
        const page = code('src/app/admin/wave/compliance/page.tsx');

        expect(page).toContain('contentType.includes("text/csv")');
        expect(page).not.toMatch(/new Blob\(\[[^\]]*\], \{ type: "text\/csv/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#528 — every user on the platform, recorded', () => {
    const callUsers = async () => {
        const mod = await import('@/app/api/admin/export/users/route');
        return mod.GET(new NextRequest('https://example.com/api/admin/export/users'));
    };

    it('THE EXPORT WRITES A data_export ROW NAMING THE ADMIN AND THE COUNT', async () => {
        //   THE test. This route handed over every profile the platform has and
        //   nothing anywhere recorded that anybody had.
        store.seed(COLLECTIONS.USERS, 'u1', { fullName: 'Ada Obi', email: 'ada@e.com', phone: '08030000001' });
        store.seed(COLLECTIONS.USERS, 'u2', { fullName: 'Bola Eze', email: 'bola@e.com' });

        const res = await callUsers();

        expect(res.status).toBe(200);
        expect(exportRows()).toHaveLength(1);
        expect(exportRows()[0]).toMatchObject({
            action: 'data_export',
            userId: ADMIN,
            targetId: 'platform_users',
            targetType: 'export',
        });
        expect(exportRows()[0].metadata).toMatchObject({ dataset: 'platform_users', count: 2 });
    });

    it('AND THE FILE IS STILL PRODUCED', async () => {
        //   The vacuity guard. A "fix" that broke the export would satisfy every
        //   assertion about records and destroy the feature.
        store.seed(COLLECTIONS.USERS, 'u1', { fullName: 'Ada Obi', email: 'ada@e.com' });

        const res = await callUsers();
        const body = await res.text();

        expect(res.headers.get('Content-Type')).toContain('text/csv');
        expect(body).toContain('ada@e.com');
    });

    it('AND THE ROW CARRIES THE REQUEST, so the record can name an address', async () => {
        //   Something only a server-side record can have. The shared mock
        //   returns {} for the context, so what is pinned is that the route
        //   HANDS OVER the headers rather than what is derived from them.
        store.seed(COLLECTIONS.USERS, 'u1', { email: 'ada@e.com' });

        await callUsers();

        //   Resolved AFTER the route ran, not at the top of the file:
        //   jest.resetModules() in beforeEach gives each test a fresh registry,
        //   so a reference captured at import time belongs to a different copy
        //   of the mock and reads zero calls against a route that made one.
        const { getSecurityContextFromHeaders } = await import('@/lib/audit-log');
        const passed = (getSecurityContextFromHeaders as unknown as jest.Mock).mock.calls[0]?.[0];
        expect(passed).toBeInstanceOf(Headers);
    });

    it('and a caller without users:export gets no file AND no row', async () => {
        //   #64's gate must still be the first thing that happens: a refused
        //   caller must not leave a row saying they exported anything.
        mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: 'support-1', email: 's@e.com', roles: ['support'] } },
            error: null,
        }));
        store.seed(COLLECTIONS.USERS, 'u1', { email: 'ada@e.com' });

        const res = await callUsers();

        expect(res.status).toBe(403);
        expect(exportRows()).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#528 — the cooperative members export', () => {
    const callMembers = async (qs = '') => {
        const mod = await import('@/app/api/admin/export/cooperative-members/route');
        return mod.GET(new NextRequest(`https://example.com/api/admin/export/cooperative-members${qs}`));
    };

    it('RECORDS THE EXPORT WITH THE FILTERS THAT NARROWED IT', async () => {
        //   A row that says only "an export happened" cannot answer the question
        //   an audit log exists for. The filters are what the admin asked FOR.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm1', {
            userId: 'm1', fullName: 'Ada Obi', email: 'ada@e.com', state: 'Lagos', lga: 'Ikeja',
        });

        const res = await callMembers('?state=Lagos&search=ada');

        expect(res.status).toBe(200);
        expect(exportRows()[0].metadata).toMatchObject({
            dataset: 'cooperative_members',
            count: 1,
            filters: expect.objectContaining({ state: 'Lagos', search: 'ada' }),
        });
    });

    it('AND THE COUNT IS THE ROWS IN THE FILE, NOT THE ROWS THE QUERY RETURNED', async () => {
        //   The state, lga and search filters are applied in memory AFTER the
        //   query. Recording the snapshot size would overstate what was taken,
        //   which is a record that reads as evidence and is wrong.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm1', { userId: 'm1', fullName: 'Ada Obi', state: 'Lagos' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm2', { userId: 'm2', fullName: 'Bola Eze', state: 'Kano' });

        await callMembers('?state=Lagos');

        expect(exportRows()[0].metadata.count).toBe(1);
    });

    it('and the file still contains the member', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm1', { userId: 'm1', fullName: 'Ada Obi', email: 'ada@e.com' });

        expect(await (await callMembers()).text()).toContain('ada@e.com');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#528 — the WAVE compliance export', () => {
    const callWave = async (qs: string) => {
        const mod = await import('@/app/api/admin/wave/reports/export/route');
        return mod.POST(new NextRequest(`https://example.com/api/admin/wave/reports/export${qs}`, { method: 'POST' }));
    };

    beforeEach(() => {
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w1', {
            userId: 'u1', fullName: 'Ada Obi', email: 'ada@e.com', status: 'approved',
        });
    });

    it('A DIRECT POST IS RECORDED — the page is not what makes the record', async () => {
        //   THE point of moving it to the server. The browser-side recordExport
        //   on the compliance page only fires when a download reaches a browser.
        const res = await callWave('?format=csv&timeframe=all');

        expect(res.status).toBe(200);
        expect(exportRows()[0]).toMatchObject({ targetId: 'wave_compliance' });
        expect(exportRows()[0].metadata).toMatchObject({
            count: 1, filters: { timeframe: 'all', format: 'csv' },
        });
    });

    it('AND SO IS THE OTHER FORMAT, which is people too', async () => {
        //   `format=pdf` renders an HTML report carrying fifty applicants'
        //   names, states and occupations. It is an export either way.
        const res = await callWave('?format=pdf&timeframe=year');

        expect(res.status).toBe(200);
        expect(exportRows()[0].metadata.filters).toMatchObject({ format: 'pdf' });
    });

    it('AND A FORMAT THE ROUTE REFUSES RECORDS NOTHING', async () => {
        //   No file leaves, so no row. A record of an export that did not happen
        //   is the same failure as a missing one, pointing the other way.
        const res = await callWave('?format=xlsx');

        expect(res.status).toBe(400);
        expect(exportRows()).toHaveLength(0);
    });

    it('and the compliance page keeps its own call', async () => {
        //   Left alone on purpose: it records a different moment — the download
        //   arriving — and a duplicated true record is not a defect.
        expect(code('src/app/admin/wave/compliance/page.tsx')).toContain('recordExport("wave_compliance")');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#528 — one rule, not four copies of it', () => {
    const write = async (entry: any) =>
        (await import('@/lib/data-export-record')).writeDataExportRecord(entry);

    it('AN UNKNOWN DATASET IS REFUSED RATHER THAN FILED', async () => {
        //   The rule logAcademyExportAction had to be fixed for once already:
        //   "A record anybody can write to is not evidence."
        const out = await write({ dataset: 'anything_i_like', userId: ADMIN, count: 1 });

        expect(out).toEqual({ recorded: false, reason: 'unknown_dataset' });
        expect(mockAudit).not.toHaveBeenCalled();
    });

    it('AND THE TRUNCATION FLAG REACHES THE ROW AND THE PROSE', async () => {
        //   Covered here rather than through a route: the fake database's
        //   querySnapshot has no `truncated`, so the routes' own flag is
        //   `undefined` in every test in this repository. See the header.
        await write({ dataset: 'platform_users', userId: ADMIN, count: 5000, truncated: true });

        expect(exportRows()[0].metadata).toMatchObject({ truncated: true });
        expect(String(exportRows()[0].details)).toContain('incomplete');
    });

    it('AND A COUNT THAT IS NOT A NUMBER IS STORED AS null, NOT NaN', async () => {
        await write({ dataset: 'audit_logs', userId: ADMIN, count: 'lots' as any });

        expect(exportRows()[0].metadata.count).toBeNull();
    });

    it('AND THE SERVER ACTION #309 BUILT NOW GOES THROUGH THE SAME RULE', async () => {
        //   The delegation, executed. Two hand-maintained copies of one contract
        //   is this audit's other repeated finding; the routes and the screens
        //   share one.
        const { recordDataExportAction } = await import('@/app/actions/data-export-audit');

        expect(await recordDataExportAction('marketplace_sellers', { count: 42 }))
            .toMatchObject({ success: true });
        expect(exportRows()[0]).toMatchObject({ targetId: 'marketplace_sellers' });

        expect(await recordDataExportAction('anything_i_like', { count: 1 }))
            .toMatchObject({ success: false, error: 'Unknown dataset' });
    });

    it('and both new dataset names are on the closed list', () => {
        for (const d of ['platform_users', 'cooperative_members']) {
            expect(EXPORTABLE_DATASETS as readonly string[]).toContain(d);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#528 — the ratchet, walked where the files are made', () => {
    /**
     * Every API route that hands a file back, found rather than listed.
     *
     * This is #309's idea applied to the half of the tree it could not reach.
     * The predicate is Content-Disposition — a route that sets it is sending a
     * file to be saved, whatever its content type.
     */
    function fileServingRoutes(): string[] {
        const out: string[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(dir)) {
                const full = join(dir, e);
                if (statSync(full).isDirectory()) walk(full);
                else if (e === 'route.ts' && readFileSync(full, 'utf-8').includes('Content-Disposition')) {
                    out.push(full.slice(ROOT.length + 1));
                }
            }
        };
        walk(join(ROOT, 'src/app/api'));
        return out.sort();
    }

    it('THE WALK FINDS THE THREE, and enough else to be a real walk', () => {
        //   #484's shape — a control that reads as present and is none. An empty
        //   or mistyped walk makes everything below pass for ever.
        const found = fileServingRoutes();

        expect(found.length).toBeGreaterThanOrEqual(5);
        for (const route of SERVER_EXPORTS) expect(found).toContain(route);
    });

    it('EVERY ROUTE THAT EXPORTS OTHER PEOPLE RECORDS IT', () => {
        //   The ratchet. A fourth server export cannot arrive unrecorded — it
        //   either writes the record or it fails here.
        const EXCUSED: Record<string, RegExp> = {
            //   Retired (#431): flag-gated, 410 by default, and it reads a
            //   collection with no writer anywhere. A control on dead code is
            //   not a control — but the retirement is pinned, so it cannot come
            //   back unrecorded without failing this.
            'src/app/api/admin/documents/[docId]/route.ts': /legacyDocumentFallbackEnabled\(\)/,
            //   The caller's OWN card. getCooperativeMemberIdCardAction takes
            //   no arguments and derives every field from the session, so this
            //   route cannot render anybody else's card — that is the excuse,
            //   and it is asserted rather than asserted-about.
            'src/app/api/id-card/pdf/route.ts': /getCooperativeMemberIdCardAction\(\)/,
        };

        const silent: string[] = [];
        for (const route of fileServingRoutes()) {
            const body = code(route);
            if (body.includes('writeDataExportRecord(')) continue;
            const excuse = EXCUSED[route];
            if (excuse && excuse.test(body)) continue;
            silent.push(route);
        }

        expect(silent).toEqual([]);
    });

    it('AND EVERY EXCUSE IS STILL TRUE OF A FILE THAT EXISTS', () => {
        //   An excuse list rots silently: a renamed or rewritten route leaves a
        //   stale entry excusing nothing, and a real one slips past under it.
        for (const [route, excuse] of Object.entries({
            'src/app/api/admin/documents/[docId]/route.ts': /legacyDocumentFallbackEnabled\(\)/,
            'src/app/api/id-card/pdf/route.ts': /getCooperativeMemberIdCardAction\(\)/,
        })) {
            const body = code(route);
            expect({ route, len: body.length > 500, excused: excuse.test(body) })
                .toEqual({ route, len: true, excused: true });
        }
    });
});
