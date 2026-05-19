import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getCleanBroadcastList } from './src/lib/broadcast-logic';

async function run() {
    console.log("Running...");
    const res = await getCleanBroadcastList({ audience: 'cooperative_members', moduleStatus: 'all' } as any);
    console.log(JSON.stringify(res.data?.moduleStats, null, 2));
}

run().catch(console.error);
