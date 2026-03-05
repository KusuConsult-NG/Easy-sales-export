/**
 * Cooperative Re-Engagement Campaign Script
 * target: ~500+ users who abandoned their cooperative registration payment.
 */
import { getAdminDb } from '../src/lib/firebase-admin';
import { Resend } from 'resend';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables (.env.local for standard Next.js secrets)
dotenv.config({ path: '.env.local' });

// Setup clients
const db = getAdminDb();
const resend = new Resend(process.env.RESEND_API_KEY);

if (!process.env.RESEND_API_KEY) {
    console.error("❌ Fatal: Missing RESEND_API_KEY in environment variables.");
    process.exit(1);
}

// ----------------------------------------------------
// REQUIRED DRAFT: EMAIL TEMPLATE
// ----------------------------------------------------
const EMAIL_SUBJECT = "Complete your Easy Sales Cooperative Registration!";
const EMAIL_HTML_TEMPLATE = (userName: string) => `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
    <h2 style="color: #059669;">Hello ${userName || 'there'},</h2>
    
    <p>We noticed that you started your registration for the <strong>Easy Sales Cooperative</strong> but did not complete the payment process.</p>
    
    <p>Joining the cooperative is the first step to unlocking significant benefits, including:</p>
    <ul>
        <li>Access to agricultural loans and funding</li>
        <li>Subsidized marketplace listings</li>
        <li>Priority access to the WAVE and Export platforms</li>
        <li>High-yield fixed savings options</li>
    </ul>

    <p>We've made a recent update to our system to ensure a smoother checkout experience. We invite you to return and complete your application to secure your cooperative positioning.</p>

    <div style="text-align: center; margin: 30px 0;">
        <a href="https://easysalesexport.com/cooperatives/onboarding" 
           style="background-color: #059669; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
           Resume Registration
        </a>
    </div>

    <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin-top: 30px;">
        <h3 style="margin-top: 0; color: #1f2937;">Need Assistance?</h3>
        <p>If you encountered an error during payment or have any questions about how the cooperative works, our support team is ready to help you directly:</p>
        <p style="margin-bottom: 5px;">📞 <strong>Call Us:</strong> <a href="tel:02013309593" style="color: #059669;">02013309593</a></p>
        <p style="margin-top: 0;">📱 <strong>WhatsApp:</strong> <a href="https://wa.me/2347076988080" style="color: #059669;">07076988080</a></p>
    </div>

    <p style="margin-top: 30px; font-size: 12px; color: #6b7280; text-align: center;">
        Easy Sales Export Team
    </p>
</div>
`;

// ----------------------------------------------------
// CAMPAIGN DISPATCH RUNNER
// ----------------------------------------------------
async function runCampaign() {
    console.log("-----------------------------------------");
    console.log("Cooperative Re-Engagement Campaign");
    console.log("-----------------------------------------\n");

    try {
        console.log("Loading targeted abandoned users from Paystack recovery...");

        const rawData = fs.readFileSync('paystack-abandoned-targets.json', 'utf8');
        const validTargets = JSON.parse(rawData);

        console.log(`Loaded ${validTargets.length} abandoned users.`);
        console.log("Dispatching emails...\n");

        if (validTargets.length === 0) {
            console.log("No targets found. Exiting.");
            return;
        }

        // 3. Dispatch Emails
        let successCount = 0;
        let failCount = 0;

        // BATCH SENDER: Resend allows max 100 emails per API call, or we can send 1-by-1 to avoid rate limits
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        for (let i = 0; i < validTargets.length; i++) {
            const target = validTargets[i];

            try {
                await resend.emails.send({
                    from: "Easy Sales Cooperative <noreply@easysalesexport.com>",
                    to: target.email,
                    subject: EMAIL_SUBJECT,
                    html: EMAIL_HTML_TEMPLATE(target.email.split('@')[0])
                });
                console.log(`[${i + 1}/${validTargets.length}] \x1b[32mSuccess\x1b[0m -> ${target.email}`);
                successCount++;
            } catch (err: any) {
                console.log(`[${i + 1}/${validTargets.length}] \x1b[31mFailed\x1b[0m -> ${target.email}: ${err.message}`);
                failCount++;
            }

            // Delay 100ms between sends to prevent hitting rapid rate limits
            // 20 requests per second is Resend's default limit, 100ms = 10 requests per second, very safe.
            await sleep(100);
        }

        console.log("\n=========================");
        console.log("CAMPAIGN COMPLETE");
        console.log(`Successfully Sent: ${successCount}`);
        console.log(`Failed to Send: ${failCount}`);
        console.log("=========================");

    } catch (e: any) {
        console.error("Fatal Campaign Error:", e);
    }
}

// Run the script if executed directly
if (require.main === module) {
    runCampaign().then(() => process.exit(0));
}
