import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getCleanBroadcastList } from '../src/lib/broadcast-logic';

async function test() {
    const audiences = [
        "all", "all_except_approved_coop", "buyers", "sellers", "wholesale_sellers",
        "retail_sellers", "marketplace_onboarded", "cooperative_members",
        "wave_applicants", "wave_briefing_registrants", "academy_users",
        "export_users", "farm_nation_users", "pending_applicants", "unpaid_applicants",
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
