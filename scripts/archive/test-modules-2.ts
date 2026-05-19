import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getCleanBroadcastList } from './src/lib/broadcast-logic';

async function test() {
    const modules = [
        'academy_users',
        'export_users'
    ];
    for (const mod of modules) {
        console.log(`\nTesting ${mod} with status 'pending'...`);
        const resPending = await getCleanBroadcastList({ audience: mod as any, moduleStatus: 'pending' });
        console.log("Result (Pending):", resPending.data?.count);
        console.log("Module Stats:", resPending.data?.moduleStats);
    }
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
