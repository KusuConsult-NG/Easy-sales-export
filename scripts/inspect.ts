import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function check() {
    const statusCounts: Record<string, number> = {};
    
    console.log("Fetching stream...");
    const stream = db.collection("users").select("serviceRegistrations").stream();
    for await (const chunk of stream) {
        const d: any = chunk;
        const u = d.data();
        
        const mReg = u.serviceRegistrations?.marketplace;
        if (mReg) {
            const status = mReg.status;
            if (status) {
                statusCounts[status] = (statusCounts[status] || 0) + 1;
            } else {
                statusCounts["<no_status>"] = (statusCounts["<no_status>"] || 0) + 1;
            }
        } else {
             statusCounts["<no_marketplace_reg>"] = (statusCounts["<no_marketplace_reg>"] || 0) + 1;
        }
    }
    
    console.log("Status counts:", statusCounts);
}
check().then(() => process.exit(0));
