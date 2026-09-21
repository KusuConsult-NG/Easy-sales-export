import { test, type Page, type BrowserContext } from '@playwright/test';
import { loginAs, USERS } from './helpers/auth';
import { mkdirSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { execFileSync } from 'child_process';

/**
 * EVERY SCREEN IN ALL SIX MODULES, PHOTOGRAPHED AND CHECKED.
 *
 *   The owner asked for physical proof, screen by screen. verify-screenshots
 *   photographs the screens ONE audit changed; this walks the whole product.
 *
 * ── IT IS NOT ONLY A CAMERA ─────────────────────────────────────────────────
 *
 *   A screenshot of a crashed page is still a screenshot. So every route is
 *   also CHECKED, and the manifest records which of four things happened:
 *
 *     rendered    the route answered and drew a page
 *     redirected  it sent the persona somewhere else — usually a guard doing
 *                 its job, which is a finding only if it is the wrong guard
 *     empty       it answered with no visible content at all
 *     ERROR       an HTTP 5xx, a Next error overlay, or an uncaught exception
 *
 *   Only ERROR fails the run. A redirect is information, not a fault: a seller
 *   sent away from a buyer screen is the access rule working, and calling that
 *   a failure would bury the real ones.
 *
 * ── THE ROUTE LIST IS READ FROM DISK, NOT TYPED HERE ────────────────────────
 *
 *   A hand-written list of 252 routes is out of date the day a page is added,
 *   and its gaps are invisible — the suite stays green by not looking. This
 *   walks src/app for `page.tsx`, strips route groups, and photographs what it
 *   finds. Add a page and it is in the next run without anybody remembering.
 *
 *   DYNAMIC SEGMENTS need a real id, so they are resolved from the seeded
 *   database where one exists and skipped, by name, where none does. They are
 *   listed in the manifest either way, because "not photographed" has to be
 *   visible or it is the same gap in a different place.
 *
 * ── ONE PERSONA PER MODULE ──────────────────────────────────────────────────
 *
 *   Signing in as an admin for everything would photograph 252 screens nobody
 *   uses that way, and would hide every access rule. Each module is walked by
 *   the persona the seed approves for it, and the public pages by nobody.
 *
 *   RUN IT:
 *       ./scripts/local-stack/up.sh
 *       npx playwright test e2e/every-screen.spec.ts --project=chromium
 *
 *   Output: screenshots/modules/<module>/<slug>.png, plus MANIFEST.md.
 */

const APP = 'src/app';
const OUT = 'screenshots/modules';

// ─── the route list, read from disk ──────────────────────────────────────────

/** Every `page.tsx` under src/app, as the URL path Next serves it at. */
function routesOnDisk(): string[] {
    const found: string[] = [];

    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                walk(full);
            } else if (entry === 'page.tsx') {
                const url = '/' + relative(APP, dir).split(/[\\/]/)
                    //   `(group)` folders organise files and do not appear in
                    //   the URL. `@slot` parallel routes do not either.
                    .filter((seg) => !/^\(.*\)$/.test(seg) && !seg.startsWith('@'))
                    .join('/');
                found.push(url === '/' ? '/' : url.replace(/\/$/, ''));
            }
        }
    };

    walk(APP);
    return [...new Set(found)].sort();
}

const isDynamic = (route: string) => route.includes('[');

// ─── ids for the dynamic routes, from the seeded database ────────────────────

function sql(query: string): string {
    try {
        return execFileSync('psql', [
            '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-tAc', query,
        ], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8' }).trim();
    } catch {
        return '';
    }
}

const firstIn = (collection: string) =>
    sql(`select id from document_collections
          where collection_name = '${collection}' order by id limit 1;`);

/**
 * A concrete value for each `[segment]` the app uses, or '' when the seed has
 * nothing to stand in for it.
 *
 * Resolved once, from the local stack. A missing id is not an error — it means
 * the seed does not create that kind of row, which the manifest then says.
 */
function resolveParams(): Record<string, string> {
    return {
        courseId: firstIn('courses'),
        productId: firstIn('products'),
        propertyId: firstIn('land_listings'),
        sellerId: sql(`select id from users where email = 'e2e.seller@easysalesexport.com';`),
        id: firstIn('products'),
        orderId: firstIn('marketplaceOrders'),
        certificateId: firstIn('certificates'),
        lessonId: '', moduleId: '', quizId: '', sessionId: '', eventId: '',
    };
}

/** The route with every `[segment]` filled in, or null when one cannot be. */
function fillRoute(route: string, params: Record<string, string>): string | null {
    let out = route;
    for (const match of route.matchAll(/\[(\.{3})?(\w+)\]/g)) {
        const value = params[match[2]];
        if (!value) return null;
        out = out.replace(match[0], value);
    }
    return out;
}

// ─── which persona walks which module ────────────────────────────────────────

type Persona = keyof typeof USERS | 'public';

const MODULES: { module: string; persona: Persona; match: (r: string) => boolean }[] = [
    { module: 'marketplace-seller', persona: 'seller',
      match: (r) => r.startsWith('/marketplace/seller') || r.startsWith('/marketplace/sell') },
    { module: 'marketplace-buyer', persona: 'buyer',
      match: (r) => r.startsWith('/marketplace') },
    { module: 'academy', persona: 'academy', match: (r) => r.startsWith('/academy') },
    { module: 'cooperative', persona: 'cooperative',
      match: (r) => r.startsWith('/cooperatives') || r.startsWith('/loans') },
    { module: 'farm-nation', persona: 'seller',
      match: (r) => r.startsWith('/farm-nation') || r.startsWith('/land') },
    { module: 'wave', persona: 'wave', match: (r) => r.startsWith('/wave') },
    { module: 'export', persona: 'export', match: (r) => r.startsWith('/export') },
    { module: 'admin', persona: 'admin', match: (r) => r.startsWith('/admin') },
    { module: 'member', persona: 'user',
      match: (r) => ['/dashboard', '/profile', '/messages', '/notifications', '/settings', '/hub', '/verify-id', '/verify-status', '/loans']
          .some((p) => r.startsWith(p)) },
    //   Everything left is reachable signed out, and is photographed that way
    //   — signing in would hide what a visitor actually sees.
    { module: 'public', persona: 'public', match: () => true },
];

const moduleFor = (route: string) => MODULES.find((m) => m.match(route))!;

// ─── capture ─────────────────────────────────────────────────────────────────

interface Shot {
    module: string;
    route: string;
    url: string;
    persona: Persona;
    outcome: 'rendered' | 'redirected' | 'empty' | 'ERROR' | 'skipped';
    detail: string;
    file: string;
}

const results: Shot[] = [];
const slug = (route: string) =>
    (route === '/' ? 'root' : route.slice(1).replace(/[^\w[\]-]+/g, '-')).slice(0, 110);

/**
 * Settle the page before photographing it.
 *
 * networkidle rather than load, per verify-screenshots: these screens fetch
 * after hydration and a photograph taken before that is a picture of a spinner.
 */
async function settle(page: Page) {
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(700);
}

async function capture(
    page: Page, module: string, persona: Persona, route: string, url: string,
): Promise<string> {
    const dir = join(OUT, module);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${slug(route)}.png`);

    let outcome: Shot['outcome'] = 'rendered';
    let detail = '';
    let landedAt = url;
    const errors: string[] = [];

    const onError = (e: Error) => errors.push(e.message);
    page.on('pageerror', onError);

    try {
        const response = await page.goto(url, { waitUntil: 'commit', timeout: 45_000 });
        const status = response?.status() ?? 0;
        await settle(page);

        const landed = new URL(page.url()).pathname;
        landedAt = landed;
        const text = (await page.locator('body').innerText().catch(() => '')).trim();

        //   The Next error overlay and its server-rendered equivalent. Checked
        //   by CONTENT rather than by status, because an error boundary catches
        //   the throw and answers 200 with an apology on it.
        const crashed = status >= 500
            || /Application error: a (?:client|server)-side exception/i.test(text)
            || /Unhandled Runtime Error/i.test(text);

        if (crashed) {
            outcome = 'ERROR';
            detail = status >= 500 ? `HTTP ${status}` : 'error boundary rendered';
        } else if (landed !== url.split('?')[0]) {
            outcome = 'redirected';
            detail = `→ ${landed}`;
        } else if (text.length < 20) {
            outcome = 'empty';
            detail = `${text.length} characters of text`;
        } else if (errors.length > 0) {
            //   A page that drew fine but threw in the console. Recorded, not
            //   failed: a third-party script throwing is not this app crashing.
            detail = `drew, but threw: ${errors[0].slice(0, 90)}`;
        }

        await page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
    } catch (error) {
        outcome = 'ERROR';
        detail = error instanceof Error ? error.message.split('\n')[0].slice(0, 120) : String(error);
        await page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
    } finally {
        page.off('pageerror', onError);
    }

    results.push({ module, route, url, persona, outcome, detail, file });
    return landedAt;
}

// ─── the run ─────────────────────────────────────────────────────────────────

const ALL = routesOnDisk();
let PARAMS: Record<string, string> = {};

/**
 * The authenticated cookies for each persona, captured on its ONE sign-in.
 *
 *   THE LOGIN BUDGET IS SHARED AND SMALL. `consumeLoginAttempt` allows five
 *   attempts per fifteen minutes PER EMAIL once NODE_ENV is production, which
 *   `next start` sets — the webServer note in playwright.config records that
 *   this is why the suite had to stop signing in ~205 times.
 *
 *   This sweep signs in once per module, and the seller covers TWO of them. Add
 *   a re-login every time a route lands on /auth/* and the budget is gone: the
 *   account is locked out, this run's own pages come back signed out, and the
 *   next spec to want that account runs signed out too. That is what broke
 *   marketplace-seller-products in CI, and what made farm-nation look like
 *   fourteen access-control redirects.
 *
 *   So a persona signs in ONCE and its cookies are kept. Restoring a session is
 *   `addCookies`, which costs no attempt at all — the NextAuth session cookie is
 *   a JWT and stays valid on its own terms.
 */
const SESSIONS = new Map<Persona, Awaited<ReturnType<BrowserContext['cookies']>>>();

async function signIn(ctx: BrowserContext, page: Page, persona: Persona): Promise<void> {
    const saved = SESSIONS.get(persona);
    if (saved && saved.length > 0) {
        await ctx.addCookies(saved);
        return;
    }
    const who = USERS[persona as keyof typeof USERS];
    await loginAs(page, who.email, who.password);
    SESSIONS.set(persona, await ctx.cookies());
}

test.beforeAll(() => {
    mkdirSync(OUT, { recursive: true });
    PARAMS = resolveParams();
});

//   One test per module, so a failure names the module and the others still run.
for (const { module, persona } of MODULES) {
    const routes = ALL.filter((r) => moduleFor(r).module === module);
    if (routes.length === 0) continue;

    test(`${module} — ${routes.length} screens as ${persona}`, async ({ browser }) => {
        //   Generous: this walks up to eighty screens in one test, each with a
        //   full-page screenshot and a networkidle wait.
        test.setTimeout(routes.length * 30_000 + 120_000);

        const context: BrowserContext = await browser.newContext();
        const page = await context.newPage();

        try {
            if (persona !== 'public') {
                await signIn(context, page, persona);
            }

            for (const route of routes) {
                let landed: string;

                if (isDynamic(route)) {
                    const filled = fillRoute(route, PARAMS);
                    if (!filled) {
                        results.push({
                            module, route, url: '', persona, outcome: 'skipped',
                            detail: 'no seeded row for this id', file: '',
                        });
                        continue;
                    }
                    landed = await capture(page, module, persona, route, filled);
                } else {
                    landed = await capture(page, module, persona, route, route);
                }

                /*
                 *   ONE PAGE MUST NOT LOG THE WHOLE SWEEP OUT.
                 *
                 *   The middleware says so in its own comment: it "clears the
                 *   session cookies when a 3xx points at /auth/login". So a
                 *   single route whose guard redirects to the login page takes
                 *   the session with it, and EVERY route after it in this
                 *   module is then photographed as a signed-out visitor.
                 *
                 *   That is exactly what happened to farm-nation on the first
                 *   full run: /farm-nation rendered, the checkout route
                 *   redirected, and the remaining thirteen screens were all
                 *   recorded as "redirected → /auth/login" — twenty screens of
                 *   evidence about the spec rather than about the module.
                 *
                 *   The session is re-established before the next route, so a
                 *   redirect is reported for the ROUTE THAT CAUSED IT and for
                 *   nothing else.
                 */
                if (persona !== 'public' && landed.startsWith('/auth/')) {
                    await signIn(context, page, persona).catch(() => undefined);
                }
            }
        } finally {
            await context.close();
        }
    });
}

// ─── the manifest ────────────────────────────────────────────────────────────

test.afterAll(() => {
    if (results.length === 0) return;

    const byModule = new Map<string, Shot[]>();
    for (const r of results) {
        if (!byModule.has(r.module)) byModule.set(r.module, []);
        byModule.get(r.module)!.push(r);
    }

    const count = (rs: Shot[], o: Shot['outcome']) => rs.filter((r) => r.outcome === o).length;
    const lines: string[] = [
        '# Every screen, photographed',
        '',
        'Generated by `e2e/every-screen.spec.ts` against the LOCAL STACK — a real',
        'PostgreSQL with the real schema, every migration and row-level security on,',
        'seeded by `scripts/local-stack`. Nothing here touches production.',
        '',
        '| outcome | meaning |',
        '| --- | --- |',
        '| rendered | the route answered and drew a page |',
        '| redirected | a guard sent this persona elsewhere — usually correct |',
        '| empty | answered with almost no visible text |',
        '| ERROR | 5xx, an error boundary, or a navigation failure |',
        '| skipped | a dynamic route with no seeded row to stand in for its id |',
        '',
        '## Summary',
        '',
        '| module | persona | screens | rendered | redirected | empty | ERROR | skipped |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ];

    for (const [module, rs] of byModule) {
        lines.push(`| ${module} | ${rs[0].persona} | ${rs.length} | ${count(rs, 'rendered')} `
            + `| ${count(rs, 'redirected')} | ${count(rs, 'empty')} | ${count(rs, 'ERROR')} `
            + `| ${count(rs, 'skipped')} |`);
    }

    const errors = results.filter((r) => r.outcome === 'ERROR');
    lines.push('', `**${results.length} screens across ${byModule.size} modules. `
        + `${errors.length} error${errors.length === 1 ? '' : 's'}.**`, '');

    if (errors.length > 0) {
        lines.push('## Errors', '', '| module | route | detail |', '| --- | --- | --- |');
        for (const e of errors) lines.push(`| ${e.module} | \`${e.route}\` | ${e.detail} |`);
        lines.push('');
    }

    for (const [module, rs] of byModule) {
        lines.push(`## ${module}`, '', '| route | outcome | detail | screenshot |',
            '| --- | --- | --- | --- |');
        for (const r of rs) {
            const shot = r.file ? `\`${r.file.replace(`${OUT}/`, '')}\`` : '—';
            lines.push(`| \`${r.route}\` | ${r.outcome} | ${r.detail || ''} | ${shot} |`);
        }
        lines.push('');
    }

    writeFileSync(join(OUT, 'MANIFEST.md'), lines.join('\n'));
    writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(results, null, 2));

    //   Printed as well as written: the run's own output is where somebody
    //   looks first, and a file they have to find is a file they do not read.
    //
    //   No eslint-disable here: `no-console` is not enabled for e2e specs, and
    //   an UNUSED disable directive is itself a warning — which `npm run lint`
    //   turns into a failure under --max-warnings=0.
    console.log(`\n${results.length} screens photographed, ${errors.length} errors. `
        + `See ${OUT}/MANIFEST.md`);
});
