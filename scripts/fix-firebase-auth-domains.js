#!/usr/bin/env node
/**
 * fix-firebase-auth-domains.js
 *
 * Adds easysalesexport.com and www.easysalesexport.com to the Firebase project's
 * authorized domains list using the Identity Toolkit Admin API.
 *
 * Run: node scripts/fix-firebase-auth-domains.js
 */

require("dotenv").config({ path: ".env.local" });

const https = require("https");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "easy-sales-hub";
const DOMAINS_TO_ADD = [
    "easysalesexport.com",
    "www.easysalesexport.com",
    "easy-sales-export-nextjs.vercel.app",
];

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";

function ok(msg) { console.log(`${GREEN}✅ ${msg}${RESET}`); }
function fail(msg) { console.log(`${RED}❌ ${msg}${RESET}`); }
function info(msg) { console.log(`${BLUE}ℹ️  ${msg}${RESET}`); }
function warn(msg) { console.log(`${YELLOW}⚠️  ${msg}${RESET}`); }

// ── Get OAuth2 token from service account (no external deps needed) ──────────
async function getAccessToken() {
    const { GoogleAuth } = require("google-auth-library");
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

    if (!privateKey || !clientEmail) {
        throw new Error("FIREBASE_PRIVATE_KEY or FIREBASE_CLIENT_EMAIL missing");
    }

    const auth = new GoogleAuth({
        credentials: { private_key: privateKey, client_email: clientEmail },
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    return tokenResponse.token;
}

// ── REST helper ───────────────────────────────────────────────────────────────
function apiRequest(method, path, token, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const options = {
            hostname: "identitytoolkit.googleapis.com",
            path,
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
            },
        };

        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function main() {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  FIREBASE AUTH DOMAIN FIX`);
    console.log(`  Project: ${PROJECT_ID}`);
    console.log(`${"═".repeat(60)}\n`);

    // 1. Get access token
    info("Getting OAuth2 access token from service account...");
    let token;
    try {
        token = await getAccessToken();
        ok("Access token obtained");
    } catch (err) {
        fail(`Failed to get access token: ${err.message}`);
        fail("Ensure google-auth-library is installed: npm install google-auth-library");
        process.exit(1);
    }

    // 2. Fetch current config
    info("Fetching current Firebase project config...");
    const getRes = await apiRequest(
        "GET",
        `/admin/v2/projects/${PROJECT_ID}/config`,
        token
    );

    if (getRes.status !== 200) {
        fail(`Failed to fetch config: HTTP ${getRes.status}`);
        console.error(getRes.body);
        process.exit(1);
    }

    const currentDomains = getRes.body?.signIn?.authorizedDomains || [];
    info(`Current authorized domains (${currentDomains.length}):`);
    currentDomains.forEach((d) => info(`  - ${d}`));

    // 3. Merge new domains
    const merged = Array.from(new Set([...currentDomains, ...DOMAINS_TO_ADD]));
    const added = merged.filter((d) => !currentDomains.includes(d));

    if (added.length === 0) {
        ok("All required domains are already authorized. Nothing to do.");
        return;
    }

    warn(`Adding ${added.length} new domain(s): ${added.join(", ")}`);

    // 4. PATCH config with merged list
    const patchRes = await apiRequest(
        "PATCH",
        `/admin/v2/projects/${PROJECT_ID}/config?updateMask=signIn.authorizedDomains`,
        token,
        { signIn: { authorizedDomains: merged } }
    );

    if (patchRes.status === 200) {
        ok("Firebase config updated successfully!");
        const updatedDomains = patchRes.body?.signIn?.authorizedDomains || [];
        info(`Updated authorized domains (${updatedDomains.length}):`);
        updatedDomains.forEach((d) => {
            const isNew = added.includes(d);
            console.log(`  ${isNew ? GREEN + "  [NEW]" : "       "} ${d}${RESET}`);
        });
    } else {
        fail(`PATCH failed: HTTP ${patchRes.status}`);
        console.error(JSON.stringify(patchRes.body, null, 2));

        // ── Fallback guidance ────────────────────────────────────────────────
        console.log(`\n${YELLOW}Manual fallback — add these domains in the Firebase Console:${RESET}`);
        console.log(`  URL: https://console.firebase.google.com/project/${PROJECT_ID}/authentication/settings`);
        DOMAINS_TO_ADD.forEach((d) => console.log(`  ${YELLOW}+ ${d}${RESET}`));
        process.exit(1);
    }

    console.log(`\n${"═".repeat(60)}`);
    console.log("  Done. Try logging in at https://www.easysalesexport.com/auth/login");
    console.log(`${"═".repeat(60)}\n`);
}

main().catch((err) => {
    fail(`Script crashed: ${err.message}`);
    console.error(err);
    process.exit(1);
});
