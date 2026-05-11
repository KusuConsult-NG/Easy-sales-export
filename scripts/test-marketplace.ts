import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getCleanBroadcastList } from '../src/lib/broadcast-logic';

async function testMarketplace() {
    console.log("Testing marketplace_onboarded with status 'all'...");
    const resAll = await getCleanBroadcastList({ audience: 'marketplace_onboarded', moduleStatus: 'all' });
    console.log(`Result (All): ${resAll.data?.count}`);
    console.log(`Module Stats:`, resAll.data?.moduleStats);
}

testMarketplace().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
