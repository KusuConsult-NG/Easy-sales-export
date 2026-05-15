import { getCleanBroadcastListAction } from "../src/app/actions/broadcast";

async function run() {
    console.log("Testing csv_upload...");
    const res1 = await getCleanBroadcastListAction({
        audience: "csv_upload",
        csvEmails: ["test1@example.com", "test2@example.com"]
    });
    console.log("CSV Result:", JSON.stringify(res1, null, 2));

    console.log("\nTesting all...");
    const res2 = await getCleanBroadcastListAction({
        audience: "all"
    });
    console.log("All Result Success:", res2.success);
    if (!res2.success) console.log("All Result Error:", res2.error);
    else console.log("All Result Count:", res2.data?.count);
}

run().catch(console.error);
