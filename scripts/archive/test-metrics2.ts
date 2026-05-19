require("dotenv") from 'dotenv'
require("dotenv").config({ path: '.env.local' })
const { UserMetricsService } = require( './src/services/userMetrics.service'

async function run() {
    console.log("Fetching metrics...")
    const stats = await UserMetricsService.getCooperativeMemberMetrics()
    console.log("Coop Stats:", stats)
}

run().catch(console.error)
