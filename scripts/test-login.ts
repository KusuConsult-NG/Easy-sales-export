import { chromium } from 'playwright';

async function testAdminLogin() {
    console.log("Starting browser...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Mock an admin user account known to exist based on my earlier script
    const email = "steviekusu@gmail.com";
    const password = "Password123!"; // Password set in make-admin-direct.js

    try {
        console.log(`Navigating to login...`);
        await page.goto('http://localhost:3000/auth/login?callbackUrl=/admin');

        console.log(`Filling credentials...`);
        await page.fill('input[name="email"]', email);
        await page.fill('input[name="password"]', password);

        console.log(`Clicking sign in...`);
        await page.click('button[type="submit"]');

        console.log(`Waiting for navigation...`);

        try {
            await page.waitForNavigation({ timeout: 5000 });
        } catch (navErr) {
            console.log('Navigation timeout, checking for UI errors...');
            const errorText = await page.textContent('.text-red-500').catch(() => null);
            if (errorText) {
                console.error(`UI Error Found: ${errorText.trim()}`);
            } else {
                const fs = require('fs');
                const html = await page.content();
                fs.writeFileSync('scripts/debug-login.html', html);
                console.log('Saved page HTML to scripts/debug-login.html');
            }
        }

        console.log(`Current URL: ${page.url()}`);

        // Wait a bit to see if a redirect loop occurs
        await page.waitForTimeout(5000);

        console.log(`Final URL: ${page.url()}`);

    } catch (e) {
        console.error("Test error:", e);
    } finally {
        await browser.close();
    }
}

testAdminLogin();
