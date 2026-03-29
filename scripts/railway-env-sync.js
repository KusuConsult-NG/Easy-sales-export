const fs = require('fs');
const { execSync } = require('child_process');

const envFile = process.argv[2] || '.env.production.local';

if (!fs.existsSync(envFile)) {
    console.error(`Environment file ${envFile} not found.`);
    process.exit(1);
}

const content = fs.readFileSync(envFile, 'utf8');
const lines = content.split('\n');

console.log(`Syncing variables from ${envFile} to Railway...`);

let successCount = 0;
let errorCount = 0;

for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) continue;

    const key = match[1].trim();
    let value = match[2].trim();

    if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.substring(1, value.length - 1);
    }

    if (key === 'VERCEL' || key.startsWith('VERCEL_')) continue;

    try {
        console.log(`Setting ${key}...`);
        execSync(`railway variable set --skip-deploys "${key}=${value}"`, { stdio: 'ignore' });
        successCount++;
    } catch (e) {
        console.error(`Failed to set ${key}. Check manually.`);
        errorCount++;
    }
}

console.log(`\nSync complete! Successfully synced ${successCount} variables (${errorCount} failed).`);
