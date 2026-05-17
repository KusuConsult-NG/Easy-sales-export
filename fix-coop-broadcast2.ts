import { getCleanBroadcastList } from './src/lib/broadcast-logic';
async function run() {
    console.log("Testing 'all'");
    const res1 = await getCleanBroadcastList({ audience: 'all' });
    console.log("All length:", res1.data?.recipients?.length);
    
    console.log("Testing 'all_except_approved_coop'");
    const res2 = await getCleanBroadcastList({ audience: 'all_except_approved_coop' });
    console.log("All except approved length:", res2.data?.recipients?.length);
}
run();
