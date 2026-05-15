const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  const baseUrl = 'http://localhost:54321';
  
  const routes = [
    { path: '/', name: '01_Home' },
    { path: '/marketplace', name: '02_Marketplace' },
    { path: '/farm-nation', name: '03_FarmNation' },
    { path: '/export', name: '04_Export' },
    { path: '/academy', name: '05_Academy' },
    { path: '/wave', name: '06_Wave' },
    { path: '/dashboard', name: '07_Dashboard' },
    { path: '/cooperatives', name: '08_Cooperatives' }
  ];

  const dir = path.join(process.cwd(), 'screenshots');
  if (!fs.existsSync(dir)){
      fs.mkdirSync(dir);
  }

  console.log('Taking screenshots...');
  for (const route of routes) {
    try {
      console.log(`Navigating to ${route.path}...`);
      await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'networkidle', timeout: 15000 });
      // wait a bit for any dynamic content/animations to settle
      await page.waitForTimeout(2000);
      const filePath = path.join(dir, `${route.name}.png`);
      await page.screenshot({ path: filePath, fullPage: true });
      console.log(`Saved screenshot to ${filePath}`);
    } catch (err) {
      console.error(`Failed to screenshot ${route.path}:`, err.message);
    }
  }

  await browser.close();
  console.log('Done!');
})();
