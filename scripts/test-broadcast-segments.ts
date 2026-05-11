import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';
import { getCleanBroadcastList } from '../src/lib/broadcast-logic';

async function test() {
    console.log("Testing farm_nation_users with status 'all'...");
    const resAll = await getCleanBroadcastList({ audience: 'farm_nation_users', moduleStatus: 'all' });
    console.log("Result (All):", resAll.data?.count);
    console.log("Module Stats:", resAll.data?.moduleStats);

    console.log("\nTesting farm_nation_users with status 'pending'...");
    const resPending = await getCleanBroadcastList({ audience: 'farm_nation_users', moduleStatus: 'pending' });
    console.log("Result (Pending):", resPending.data?.count);
    console.log("Module Stats:", resPending.data?.moduleStats);
    
    console.log("\nTesting marketplace_onboarded with status 'all'...");
    const resMarketplace = await getCleanBroadcastList({ audience: 'marketplace_onboarded', moduleStatus: 'all' });
    console.log("Result (All):", resMarketplace.data?.count);
    console.log("Module Stats:", resMarketplace.data?.moduleStats);
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
