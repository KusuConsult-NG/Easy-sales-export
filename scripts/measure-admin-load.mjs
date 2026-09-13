/**
 * Measure what makes an admin page slow — bytes, or waiting?
 *
 *   #696 claims the admin panel is slow because whole JSONB documents are
 *   transferred, not because a query is slow. That claim was made from the code
 *   and from the 2026-08-10 audit's measurement; it has never been checked
 *   against the running site, because the audit environment's egress policy
 *   refuses every route to the production host.
 *
 *   This is that check, as a script the owner can run. It reports the one
 *   distinction that settles it:
 *
 *     DOWNLOAD-dominated  ->  payload size. #696 is the cause, and narrowing the
 *                             reads is the fix.
 *     WAITING-dominated   ->  the database or a cold start. #696 is NOT the
 *                             cause and the diagnosis needs reopening.
 *
 *   AND THE CACHE TELLS YOU THE SAME THING TWICE. getDashboardStats and
 *   getFinancialOverview both cache for 120 seconds, so a cold load and a warm
 *   one are measured separately below. A big gap means the cost is in producing
 *   the payload, which is what #696 addresses.
 *
 * ── RUNNING IT ──────────────────────────────────────────────────────────────
 *
 *     npx playwright install chromium          # once, if you have not
 *
 *     BASE_URL="https://www.easysalesexport.com" \
 *     ADMIN_EMAIL="you@example.com" \
 *     ADMIN_PASSWORD='...' \
 *       node scripts/measure-admin-load.mjs
 *
 *   NO CREDENTIAL IS WRITTEN OR PRINTED by this script — it reads them from the
 *   environment and never echoes them. Prefer a shell that does not record
 *   history for the line above, and rotate the password afterwards if in doubt.
 *
 *   It only READS pages. It submits the login form and navigates; it clicks
 *   nothing else and posts no data.
 */

import { chromium } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;

/** Pages to measure. Add any admin tab that feels slow. */
const PAGES = (process.env.PAGES || "/admin,/admin/finance").split(",").map((s) => s.trim());

if (!EMAIL || !PASSWORD) {
    console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment. They are never printed.");
    process.exit(1);
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const ms = (n) => `${Math.round(n)} ms`;

/** Attach a recorder to a page and return the collected rows. */
function record(page) {
    const rows = [];
    page.on("response", async (res) => {
        const req = res.request();
        //   Documents, server actions and data fetches. Static assets are not
        //   what this is about and only crowd the table.
        const type = req.resourceType();
        if (!["document", "fetch", "xhr"].includes(type)) return;

        let bytes = 0;
        try {
            const body = await res.body();
            bytes = body ? body.length : 0;
        } catch {
            //   A redirect or a stream that is already consumed. Timing is
            //   still worth having, so the row is kept with an unknown size.
            bytes = -1;
        }

        let waiting = 0;
        let download = 0;
        try {
            const t = req.timing();
            if (t && t.responseStart > 0) {
                waiting = t.responseStart - (t.requestStart >= 0 ? t.requestStart : 0);
                download = t.responseEnd > 0 ? t.responseEnd - t.responseStart : 0;
            }
        } catch { /* timing is best-effort */ }

        //   A Next.js server action is a POST back to the page's own URL.
        const isAction = req.method() === "POST" && Boolean(req.headers()["next-action"]);
        rows.push({
            label: isAction ? `action ${req.headers()["next-action"].slice(0, 8)}` : `${req.method()} ${new URL(res.url()).pathname}`,
            status: res.status(),
            bytes,
            waiting,
            download,
        });
    });
    return rows;
}

function summarise(title, rows, wallMs) {
    const known = rows.filter((r) => r.bytes >= 0);
    const totalBytes = known.reduce((a, r) => a + r.bytes, 0);
    const totalWait = rows.reduce((a, r) => a + r.waiting, 0);
    const totalDown = rows.reduce((a, r) => a + r.download, 0);

    console.log(`\n  ${title}`);
    console.log(`    wall clock          ${ms(wallMs)}`);
    console.log(`    requests measured   ${rows.length}`);
    console.log(`    bytes transferred   ${kb(totalBytes)}`);
    console.log(`    time WAITING        ${ms(totalWait)}   (server thinking)`);
    console.log(`    time DOWNLOADING    ${ms(totalDown)}   (payload size)`);

    const top = [...known].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
    if (top.length > 0) {
        console.log(`    largest responses:`);
        for (const r of top) {
            console.log(
                `      ${kb(r.bytes).padStart(10)}  wait ${ms(r.waiting).padStart(8)}`
                + `  down ${ms(r.download).padStart(8)}  ${r.label}`,
            );
        }
    }
    return { totalBytes, totalWait, totalDown };
}

/*
 *   CHROMIUM_PATH is an escape hatch, not the normal path. `npx playwright
 *   install chromium` is what most people want; this exists for a machine whose
 *   installed browser build does not match the pinned @playwright/test — which
 *   is the case in the audit sandbox, where verifying this script at all
 *   depended on it.
 */
const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext();
const page = await context.newPage();

try {
    console.log(`Measuring ${BASE_URL}`);

    await page.goto(`${BASE_URL}/auth/login`, { waitUntil: "load", timeout: 60000 });
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard|\/admin|\/auth\/get-started/, { timeout: 60000 });
    console.log("Signed in.");

    for (const path of PAGES) {
        console.log(`\n══ ${path} ══`);

        //   COLD: the 120-second cache is assumed expired. If you have just
        //   loaded this page, wait two minutes before believing this number.
        const coldPage = await context.newPage();
        const coldRows = record(coldPage);
        let t0 = Date.now();
        await coldPage.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle", timeout: 120000 });
        const cold = summarise("COLD (cache expired)", coldRows, Date.now() - t0);
        await coldPage.close();

        //   WARM: immediately again, inside the 120-second window.
        const warmPage = await context.newPage();
        const warmRows = record(warmPage);
        t0 = Date.now();
        await warmPage.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle", timeout: 120000 });
        const warm = summarise("WARM (within the 120s cache)", warmRows, Date.now() - t0);
        await warmPage.close();

        //   THE VERDICT, computed rather than eyeballed.
        const dominant = cold.totalDown > cold.totalWait ? "DOWNLOAD" : "WAITING";
        console.log(`\n    VERDICT for ${path}: ${dominant}-dominated on a cold load.`);
        if (dominant === "DOWNLOAD") {
            console.log(`      Consistent with #696 — the cost is payload size, which narrowing the reads addresses.`);
        } else {
            console.log(`      NOT consistent with #696 — the server is thinking, not sending.`);
            console.log(`      The diagnosis needs reopening: look at query time or cold starts.`);
        }
        console.log(`      cold ${kb(cold.totalBytes)} / warm ${kb(warm.totalBytes)}`);
    }
} finally {
    await browser.close();
}
