import { getCleanBroadcastList } from "../src/lib/broadcast-logic";

async function run() {
    const res = await getCleanBroadcastList({ audience: "cooperative_members", moduleStatus: "all" });
    console.log(`Original Doc Count: ${res.data?.originalDocCount}`);
    console.log(`Final Recipients: ${res.data?.count}`);
}

run().catch(console.error).finally(() => process.exit(0));
