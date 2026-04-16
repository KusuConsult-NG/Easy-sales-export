import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

// Mock session required for getDashboardStatsAction
jest = require("jest-mock");
const sessionGuard = require("./src/lib/session-guard");
sessionGuard.requireSession = jest.fn().mockResolvedValue({
    session: { user: { id: "G7tQGmdl1ThZPsybhjcpnKrIlwB2", roles: ["admin", "super_admin"] } }
});

const { getDashboardStatsAction, getFinancialOverviewAction } = require("./src/app/actions/admin-analytics");

async function run() {
    console.log("Fetching getDashboardStatsAction...");
    const stats = await getDashboardStatsAction();
    console.log("Dashboard Stats:", JSON.stringify(stats, null, 2));

    console.log("Fetching getFinancialOverviewAction...");
    const fin = await getFinancialOverviewAction();
    console.log("Finance Fin:", JSON.stringify(fin, null, 2));
}

run().catch(console.error);
