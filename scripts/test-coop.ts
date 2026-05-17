import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getCleanBroadcastList } from '../src/lib/broadcast-logic';

async function test() {
    const filters = { audience: 'cooperative_members', moduleStatus: 'pending' };
    const res = await getCleanBroadcastList(filters);
    console.log(`res:`, res);
}

test().then(() => process.exit(0)).catch(console.error);
