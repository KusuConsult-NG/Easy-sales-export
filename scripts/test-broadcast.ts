import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load env files
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

import { sendEmailNotification } from '../src/lib/email-notifications';

const TARGET_EMAIL = 'easysalesexporthq@gmail.com';
const TARGET_NAME = 'Admin Test Broadcast';

async function testBroadcastPush() {
    console.log(`Sending Broadcast email to ${TARGET_EMAIL} using anti-spam headers...`);
    
    // Simulate what broadcast.ts now does:
    const subject = "Test: Exclusive Broadcast Preview";
    const bodyText = `Hello ${TARGET_NAME},\nThis is a strict test of the new Anti-Spam broadcast system.\nPlease check if this arrives in your primary inbox!\nRegards,\nTech Team`;
    
    // Simple inline HTML compilation for test
    const htmlBody = bodyText
        .split("\n")
        .map((line) => (line.trim() === "" ? "<br/>" : `<p style="margin:0 0 12px">${line}</p>`))
        .join("");

    const unsubscribeFooter = `<p style="font-size:12px;color:#9ca3af;margin:16px 0 0;text-align:center"><a href="mailto:unsubscribe@easysalesexport.com?subject=unsubscribe%20${encodeURIComponent(TARGET_EMAIL)}" style="color:#9ca3af;text-decoration:underline">Unsubscribe from these emails</a></p>`;

    const finalHtml = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a">
      <div style="background:#16a34a;padding:24px 32px;border-radius:12px 12px 0 0">
        <h1 style="color:#fff;margin:0;font-size:22px">Easy Sales Export</h1>
        <p style="color:#bbf7d0;margin:4px 0 0;font-size:13px">Nigeria's Premier Agricultural Platform</p>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:32px">
        <h2 style="font-size:20px;color:#111827;margin:0 0 20px">${subject}</h2>
        <div style="font-size:15px;color:#374151;line-height:1.7">${htmlBody}</div>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0"/>
        <p style="font-size:12px;color:#9ca3af;margin:0;text-align:center">
          Easy Sales Export · <a href="https://easysalesexport.com" style="color:#16a34a">easysalesexport.com</a>
        </p>
        ${unsubscribeFooter}
      </div>
    </div>`;

    try {
        const result = await sendEmailNotification({
            to: TARGET_EMAIL,
            subject: subject,
            message: finalHtml,
            metadata: { type: "admin_broadcast" },
            // THer anti-spam headers we added today
            headers: {
                "List-Unsubscribe": `<mailto:unsubscribe@easysalesexport.com?subject=unsubscribe%20${encodeURIComponent(TARGET_EMAIL)}>`,
                "Precedence": "bulk"
            }
        });
        
        if (result.success) {
            console.log('✅ Broadcast Test Email sent successfully to Resend API.');
            console.log('Now check the inbox (easysalesexporthq@gmail.com).');
        } else {
            console.error('❌ Failed to send:', result.error);
        }
    } catch (err) {
        console.error("Critical error:", err);
    }
}

testBroadcastPush().catch(console.error).finally(() => process.exit(0));
