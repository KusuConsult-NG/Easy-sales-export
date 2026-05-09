import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "http://localhost:3000";
const APP_DIR = path.join(process.cwd(), "src/app");

function getRoutes(dir: string, baseRoute = "/"): string[] {
    const routes: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    let hasPage = false;

    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (entry.name.startsWith("[") || entry.name.startsWith("(")) continue; // Skip dynamic/group routes for now
            routes.push(...getRoutes(path.join(dir, entry.name), path.join(baseRoute, entry.name)));
        } else if (entry.name === "page.tsx") {
            hasPage = true;
        }
    }

    if (hasPage) {
        routes.push(baseRoute);
    }

    return routes;
}

async function auditRuntime() {
    console.log("🖥️  Starting Runtime Error Audit...");
    console.log("=".repeat(60));

    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    const routes = getRoutes(APP_DIR);
    const errors: { route: string; message: string; type: string }[] = [];

    page.on("console", msg => {
        if (msg.type() === "error") {
            errors.push({ route: page.url(), message: msg.text(), type: "console-error" });
        }
    });

    page.on("pageerror", err => {
        errors.push({ route: page.url(), message: err.message, type: "runtime-exception" });
    });

    page.on("requestfailed", req => {
        errors.push({ route: page.url(), message: `${req.method()} ${req.url()} failed`, type: "network-failure" });
    });

    for (const route of routes) {
        const url = `${BASE_URL}${route}`;
        console.log(`🌐 Auditing: ${route}...`);
        try {
            await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
            await page.waitForTimeout(1000); // Wait for hydration
        } catch (e: any) {
            errors.push({ route, message: e.message, type: "timeout-or-crash" });
        }
    }

    await browser.close();

    console.log("\n" + "=".repeat(60));
    console.log(`✅ Audited ${routes.length} routes.`);
    console.log(`⚠️  Found ${errors.length} total runtime issues.`);

    if (errors.length > 0) {
        console.log("\n🚩 Runtime Issues Detected:");
        errors.forEach(e => {
            console.log(`- [${e.type}] at ${e.route}: ${e.message.slice(0, 100)}...`);
        });
    }

    if (errors.filter(e => e.type !== "console-error").length === 0) {
        console.log("\n✨ SUCCESS: No critical runtime exceptions or network failures detected.");
    } else {
        console.log("\n❌ FAILURE: Critical runtime issues found. Remediate before production.");
    }
}

auditRuntime().catch(console.error);
