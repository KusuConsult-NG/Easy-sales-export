import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getDashboardStatsAction } from './src/app/actions/admin-analytics';

async function run() {
    try {
        console.log("Calling getDashboardStatsAction...");
        const result = await getDashboardStatsAction();
        console.log("Recent Transactions:", result?.recentTransactions);
    } catch(e) {
        console.error("Error:", e);
    }
}
run();
