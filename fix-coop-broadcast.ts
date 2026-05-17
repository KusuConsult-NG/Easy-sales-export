import { getCleanBroadcastList } from './src/lib/broadcast-logic';
async function run() {
    const res = await getCleanBroadcastList({ audience: 'cooperative_members', moduleStatus: 'all' });
    console.log(res.data?.moduleStats);
}
run();
