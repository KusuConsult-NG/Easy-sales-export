import { config } from "dotenv";
config({ path: ".env.local" });
import { _getCooperativeStatsAction } from "../src/app/actions/cooperative-admin";

async function main() {
    const stats = await _getCooperativeStatsAction();
    console.log("DASHBOARD WILL SHOW:");
    console.log(stats);
}
main().catch(console.error);
