import * as fs from "fs";
import * as path from "path";

const APP_DIR = path.join(process.cwd(), "src/app");

interface RouteInfo {
    path: string;
    isPlaceholder: boolean;
    hasLoading: boolean;
    hasError: boolean;
    issues: string[];
}

const PLACEHOLDER_STRINGS = [
    "Coming Soon",
    "TBD",
    "Placeholder",
    "To be implemented",
    "Work in progress",
    "// TODO",
];

function scanRoutes(dir: string, baseRoute = "/"): RouteInfo[] {
    const results: RouteInfo[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    let hasPage = false;
    let hasLoading = false;
    let hasError = false;
    let pageContent = "";

    for (const entry of entries) {
        if (entry.isDirectory()) {
            // Skip group routes and dynamic routes for recursion but track them
            const subRoute = entry.name.startsWith("(") ? baseRoute : path.join(baseRoute, entry.name);
            results.push(...scanRoutes(path.join(dir, entry.name), subRoute));
        } else if (entry.name === "page.tsx") {
            hasPage = true;
            pageContent = fs.readFileSync(path.join(dir, entry.name), "utf-8");
        } else if (entry.name === "loading.tsx") {
            hasLoading = true;
        } else if (entry.name === "error.tsx") {
            hasError = true;
        }
    }

    if (hasPage) {
        const issues: string[] = [];
        const isPlaceholder = PLACEHOLDER_STRINGS.some(s => pageContent.toLowerCase().includes(s.toLowerCase()));

        if (isPlaceholder) issues.push("Contains placeholder text");
        if (pageContent.length < 500) issues.push("Page content suspiciously short (potential skeleton)");

        results.push({
            path: baseRoute,
            isPlaceholder,
            hasLoading,
            hasError,
            issues,
        });
    }

    return results;
}

async function runRouteAudit() {
    console.log("🛣️  Starting Route Integrity Audit...");
    console.log("=".repeat(60));

    const routes = scanRoutes(APP_DIR);
    const placeholders = routes.filter(r => r.isPlaceholder);
    const missingLoading = routes.filter(r => !r.hasLoading);

    console.log(`✅ Scanned ${routes.length} total routes.`);
    console.log(`⚠️  Found ${placeholders.length} placeholder routes.`);
    console.log(`ℹ️  Found ${missingLoading.length} routes without loading states.`);

    if (placeholders.length > 0) {
        console.log("\n🚩 Placeholder Routes Detected:");
        placeholders.forEach(r => {
            console.log(`- ${r.path}: ${r.issues.join(", ")}`);
        });
    }

    console.log("\n" + "=".repeat(60));
    if (placeholders.length === 0) {
        console.log("✨ SUCCESS: No placeholder routes found in production-critical paths.");
    } else {
        console.log("❌ FAILURE: Placeholder routes must be remediated or gated before release.");
    }
}

runRouteAudit().catch(console.error);
