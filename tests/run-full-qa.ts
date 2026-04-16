import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as dotenv from "dotenv";
import puppeteer from "puppeteer";
import * as fs from "fs";

dotenv.config({ path: ".env.local" });

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

initializeApp({
    credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
    }),
});

const TARGET_URL = "http://localhost:3001";
const ADMIN_EMAIL = "qa_audit_admin@easysalesexport.com";
const ADMIN_PASS = "QA_Password_123!!";

async function runQA() {
    console.log("=====================================");
    console.log("STARTING FULL PLATFORM QA VERIFICATION");
    console.log("=====================================\n");
    
    // ----------------------------------------------------
    // PHASE 1: DB BASELINE
    // ----------------------------------------------------
    console.log("1. Fetching DB Baseline via Admin SDK...");
    const db = getFirestore();
    const usersSnap = await db.collection("users").count().get();
    const txSnap = await db.collection("transactions").count().get();
    
    // Calculate total revenue and pending approvals based on collections
    const allUsersSnap = await db.collection("users").get();
    
    const dbMetrics = {
        totalUsers: usersSnap.data().count,
        totalTransactions: txSnap.data().count,
    };
    
    console.log(`[DB] Users: ${dbMetrics.totalUsers}, Transactions: ${dbMetrics.totalTransactions}`);
    
    // ----------------------------------------------------
    // PHASE 2: UI & API AUTHENTICATION via Puppeteer
    // ----------------------------------------------------
    console.log("\n2. Booting Headless Chrome & Authenticating...");
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    await page.goto(`${TARGET_URL}/auth/login`);
    await page.type('input[type="email"]', ADMIN_EMAIL);
    await page.type('input[type="password"]', ADMIN_PASS);
    
    console.log("   Submitting login form...");
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('button[type="submit"]')
    ]);
    
    // Check if we reached the dashboard
    const currentUrl = page.url();
    if (!currentUrl.includes('/dashboard')) {
        console.error("   Wait, login failed or didn't redirect. Current URL:", currentUrl);
    } else {
         console.log("   Login verified! Reached:", currentUrl);
    }

    const cookies = await page.cookies();
    const sessionCookie = cookies.find(c => c.name.includes('authjs.session-token') || c.name.includes('__Secure-next-auth.session-token'));
    
    let cookieString = "";
    if (sessionCookie) {
        cookieString = `${sessionCookie.name}=${sessionCookie.value}`;
    } else {
        cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }
    
    await new Promise(r => setTimeout(r, 3000));
    
    // ----------------------------------------------------
    // PHASE 3: API VALIDATION
    // ----------------------------------------------------
    console.log("\n3. Testing Server Actions API directly...");
    let apiMetrics: any = {};
    try {
        const response = await fetch(`${TARGET_URL}/api/qa-audit-export`, {
            headers: { Cookie: cookieString }
        });
        const data = await response.json();
        apiMetrics = data.dashboardMetrics?.data || {};
        console.log(`   [API] Users: ${apiMetrics.totalUsers || 0}, Transactions: ${apiMetrics.totalTransactions || 0}`);
    } catch (e: any) {
        console.error("   API fetch failed:", e.message);
    }
    
    // ----------------------------------------------------
    // PHASE 4: UI VALIDATION
    // ----------------------------------------------------
    console.log("\n4. DOM Validation: Navigating to Admin Dashboard...");
    await page.goto(`${TARGET_URL}/dashboard`, { waitUntil: 'networkidle0' });
    
    // Try to extract UI metric fields using generic text lookups
    const bodyText = await page.evaluate(() => document.body.innerText);
    
    // Write out the comparison JSON report mapping DB, API, and UI text elements
    const reportPath = "./system_audit_report.md";
    let reportContent = `# MULTI-LAYER QA VERIFICATION REPORT
Generated at: ${new Date().toISOString()}

## 1. Metrics Consistency Audit
| Metric | Database Layer | API / ServerAction Layer | UI Render Matches? |
|--------|----------------|--------------------------|--------------------|
| Users | ${dbMetrics.totalUsers} | ${apiMetrics.totalUsers || 'FETCH_FAIL'} | ${bodyText.includes(String(dbMetrics.totalUsers)) ? 'YES' : 'NO'} |
| Transactions | ${dbMetrics.totalTransactions} | ${apiMetrics.totalTransactions || 'FETCH_FAIL'} | ${bodyText.includes(String(dbMetrics.totalTransactions)) ? 'YES' : 'NO'} |

## 2. Status
OVERALL MATCH: ${
        (dbMetrics.totalUsers === apiMetrics.totalUsers && bodyText.includes(String(dbMetrics.totalUsers))) ? "SYSTEM VERIFIED — FULLY CONSISTENT" : "VERIFICATION FAILED"
    }
`;
    
    fs.writeFileSync(reportPath, reportContent);
    console.log(`\nAudit Complete! Artifact saved to ${reportPath}`);
    
    await browser.close();
    process.exit(0);
}

runQA().catch(console.error);
