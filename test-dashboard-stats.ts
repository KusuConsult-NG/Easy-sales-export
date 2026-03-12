import { getDashboardStatsAction } from "./src/app/actions/admin-analytics";

async function main() {
    process.env.FIREBASE_PROJECT_ID = "easysales-export"; // replace with actual
    // Need a fake session?
    // Let's just bypass session if we can, or just mock requireSession
    // Actually simpler to just run the query logic directly without session.
}
main();
