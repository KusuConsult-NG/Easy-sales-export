import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getCleanBroadcastList } from '../src/lib/broadcast-logic';

async function test() {
    const res = await getCleanBroadcastList({ audience: "all", moduleStatus: "approved" });
    console.log(`[all] Count: ${res.data?.count}, Original: ${res.data?.originalDocCount}, Approved: ${res.data?.moduleStats?.approved}`);
}

test().then(() => process.exit(0));
