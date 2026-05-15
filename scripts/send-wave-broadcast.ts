// @ts-nocheck
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load env files
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

import { sendBroadcastAction, previewBroadcastAction } from '../src/app/actions/broadcast';

async function previewAndSend() {
    const filters = { audience: "all" as const };
    const subject = "Welcome to the Easy Sales Export Ecosystem - WAVE Briefing";
    const body = `Welcome to the Easy Sales Export Ecosystem.

Your registration is being processed. The date for the WAVE Briefing will be communicated shortly.
Please ensure you complete your Seat Reservation here 👇 if you have not yet done so.
https://www.easysalesexport.com/wave/briefing

Thank you and welcome.`;

    console.log("--- Audience Preview ---");
    const preview = await previewBroadcastAction(filters);
    console.log(`Matched Recipients: ${preview.count}`);
    if (preview.error) {
        console.error("Error fetching preview:", preview.error);
        process.exit(1);
    }
    
    console.log("\n--- Sending Broadcast ---");
    console.log("Subject:", subject);
    console.log("Body:", body);
    
    const result = await sendBroadcastAction(filters, subject, body);
    console.log("Send Result:", result);
    
    console.log("\nCompleted broadcast execution.");
}

previewAndSend().catch(console.error).finally(() => process.exit(0));
