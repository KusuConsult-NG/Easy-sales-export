import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';
import { getCleanBroadcastList } from '../src/lib/broadcast-logic';

async function test() {
    console.log("Testing marketplace_onboarded with status 'approved'...");
    const res1 = await getCleanBroadcastList({ audience: 'marketplace_onboarded' as any, moduleStatus: 'approved' });
    console.log(JSON.stringify(res1.data, null, 2));

    console.log("Testing buyers with status 'approved'...");
    const res2 = await getCleanBroadcastList({ audience: 'buyers' as any, moduleStatus: 'approved' });
    console.log(JSON.stringify(res2.data, null, 2));
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
