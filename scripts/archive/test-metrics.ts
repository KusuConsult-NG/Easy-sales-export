import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { UserMetricsService } from './src/services/userMetrics.service';

async function run() {
    console.log("Fetching metrics from UserMetricsService...");
    const stats = await UserMetricsService.getCooperativeMemberMetrics();
    console.log("UserMetricsService:", stats);
}

run().catch(console.error);
