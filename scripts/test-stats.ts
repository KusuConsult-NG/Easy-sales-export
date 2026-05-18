import { config } from "dotenv";
config({ path: ".env.local" });
import { getCooperativeStatsAction } from "../src/app/actions/cooperative-admin";

async function main() {
    const res = await getCooperativeStatsAction();
    console.log(JSON.stringify(res, null, 2));
}

main().catch(console.error);
