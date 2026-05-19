import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getCleanBroadcastList } from './src/lib/broadcast-logic';

async function test() {
    const modules = [
        'cooperative_members',
        'wave_applicants',
        'academy_users',
        'export_users',
        'farm_nation_users'
    ];
    for (const mod of modules) {
        console.log(`\nTesting ${mod} with status 'all'...`);
        const resAll = await getCleanBroadcastList({ audience: mod as any, moduleStatus: 'all' });
        console.log("Result (All):", resAll.data?.count);
        console.log("Module Stats:", resAll.data?.moduleStats);
    }
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
