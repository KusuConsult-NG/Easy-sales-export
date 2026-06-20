import fs from 'fs';
import path from 'path';

// Load .env.production.local manually
try {
    const envPath = path.resolve(__dirname, '../.env.production.local');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = match[2] || '';
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.substring(1, value.length - 1);
                } else if (value.startsWith("'") && value.endsWith("'")) {
                    value = value.substring(1, value.length - 1);
                }
                value = value.replace(/\\n/g, '\n');
                process.env[key] = value;
            }
        });
        console.log("Loaded .env.production.local successfully.");
    }
} catch (e) {
    console.error("Failed to load environment:", e);
}

import { preValidateLoginAction } from '../src/app/actions/auth';

async function test() {
    console.log("Running preValidateLoginAction for hackbabvo@gmail.com...");
    try {
        const res = await preValidateLoginAction({
            email: 'hackbabvo@gmail.com',
            password: 'incorrectpassword'
        });
        console.log("Response:", res);
    } catch (e: any) {
        console.error("Execution crashed:", e);
    }
}

test().catch(console.error);
