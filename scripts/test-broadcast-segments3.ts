import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getCleanBroadcastList } from '../src/lib/broadcast-logic';

async function test() {
    console.log("Testing sellers with status 'approved'...");
    const res = await getCleanBroadcastList({ audience: 'sellers' as any, moduleStatus: 'approved' });
    console.log(`Recipients: ${res.data?.count}`);
    console.log(`Original Doc Count: ${res.data?.originalDocCount}`);
    console.log(JSON.stringify(res.data?.moduleStats, null, 2));
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
