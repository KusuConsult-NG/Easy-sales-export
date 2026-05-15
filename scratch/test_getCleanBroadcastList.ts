import { config } from "dotenv";
config({ path: ".env.local" });
import { getCleanBroadcastList } from "../src/lib/broadcast-logic";

async function run() {
    console.log("Testing 'abandoned_failed_transactions' directly...");
    try {
        const res2 = await getCleanBroadcastList({
            audience: "abandoned_failed_transactions"
        });
        console.log("All Result Success:", res2.success);
        if (!res2.success) console.log("All Result Error:", res2.error);
        else console.log("All Result Count:", res2.data?.count);
    } catch (e) {
        console.error("FATAL ERROR:", e);
    }
}

run().then(() => process.exit(0)).catch(console.error);
