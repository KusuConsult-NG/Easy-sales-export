import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getCleanBroadcastList } from '../src/lib/broadcast-logic';

async function test() {
    console.log('=== Simulating what the UI sends ===');
    
    // Exactly what buildFilters() produces in the page for cooperative_members + approved
    const filters = {
        audience: "cooperative_members" as const,
        state: undefined,
        sellerStatus: undefined,
        moduleStatus: "approved",
        farmNationRole: undefined,
        csvEmails: undefined,
        startDate: undefined,
        endDate: undefined,
    };
    
    console.log('Filters:', JSON.stringify(filters, null, 2));
    
    const res = await getCleanBroadcastList(filters);
    console.log('Result count:', res.data?.count);
    console.log('Original doc count:', res.data?.originalDocCount);
    console.log('Module stats:', res.data?.moduleStats);
    const sample = res.data?.recipients.slice(0, 5).map(r => r.email);
    console.log('Sample emails:', sample);
}

test().then(() => process.exit(0));
