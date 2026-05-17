import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getCleanBroadcastList } from '../src/lib/broadcast-logic';

async function test() {
    const audiences = [
        "abandoned_failed_transactions", "stalled_users", "ghost_users", "pending_users", "active_users"
    ];

    for (const aud of audiences) {
        try {
            const res = await getCleanBroadcastList({ audience: aud as any, moduleStatus: 'approved' });
            console.log(`[${aud}] Count: ${res.data?.count}, Original: ${res.data?.originalDocCount}, Approved: ${res.data?.moduleStats?.approved}`);
        } catch (e) {}
    }
}

test().then(() => process.exit(0));
