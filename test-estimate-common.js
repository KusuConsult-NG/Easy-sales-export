require("dotenv") from 'dotenv'
require("dotenv").config({ path: '.env.local' })
const { getCleanBroadcastList } = require( './src/lib/broadcast-logic'

async function run() {
    console.log("Running...")
    const res = await getCleanBroadcastList({ audience: 'cooperative_members', moduleStatus: 'all' } as any)
    console.log(JSON.stringify(res.data?.moduleStats, null, 2))
}

run().catch(console.error)
