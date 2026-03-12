import { getBroadcastHistoryAction } from "./src/app/actions/broadcast";

async function run() {
    console.log("Calling getBroadcastHistoryAction...");
    const result = await getBroadcastHistoryAction();
    console.log("Result:", result);
}

run().catch(console.error);
