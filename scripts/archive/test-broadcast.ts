import { getCleanBroadcastList } from "./src/lib/broadcast-logic";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function run() {
    console.log("Testing CSV Upload");
    const csvResult = await getCleanBroadcastList({
        audience: "csv_upload",
        csvEmails: ["test1@example.com", "test2@example.com"]
    } as any);
    console.log("CSV:", csvResult.success ? csvResult.data?.count : csvResult.error);

    console.log("Testing Abandoned/Failed");
    const failedResult = await getCleanBroadcastList({
        audience: "abandoned_failed_transactions"
    } as any);
    console.log("Failed:", failedResult.success ? failedResult.data?.count : failedResult.error);
    process.exit(0);
}
run();
