// @ts-nocheck
import { getDashboardStatsAction } from '../src/app/actions/admin-analytics';

async function test() {
    process.env.FIREBASE_PROJECT_ID = "easy-sales-hub";
    // mock auth
    jest = {} // whatever, let's just make it a raw node script that connects to firestore directly without next execution context
}
