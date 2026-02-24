import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { sendBriefing24HourReminderEmail } from '../src/lib/email-notifications';

const TARGET_EMAIL = 'kusuconsult@gmail.com';
const TARGET_NAME = 'Eric Narabi';

async function testSecondEmail() {
    console.log(`Sending 24-hour reminder email to \${TARGET_EMAIL}...`);
    try {
        const result = await sendBriefing24HourReminderEmail(TARGET_EMAIL, TARGET_NAME);
        if (result.success) {
            console.log('✅ Email sent successfully to Resend API.');
        } else {
            console.error('❌ Failed to send:', result.error);
        }
    } catch (err) {
        console.error("Critical error:", err);
    }
}

testSecondEmail().catch(console.error).finally(() => process.exit(0));
