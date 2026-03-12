import { config } from 'dotenv';
import { Resend } from 'resend';

config({ path: '.env.local' });

const resend = new Resend(process.env.RESEND_API_KEY);

async function checkDelivery() {
  console.log('Fetching recent emails from Resend...');
  const result = await resend.emails.list();
  
  if (result.error) {
    console.error('Error fetching emails:', result.error);
    return;
  }
  
  const emails = result.data?.data || [];
  console.log(`Fetched ${emails.length} recent emails.`);
  
  const statusCounts: Record<string, number> = {};
  
  emails.forEach(email => {
    const status = email.status;
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });
  
  console.log('--- Delivery Metrics ---');
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`${status.toUpperCase()}: ${count}`);
  }
  
  if (statusCounts['bounced']) {
      console.log('Found bounced emails:', emails.filter(e => e.status === 'bounced').map(e => e.to).join(', '));
  }
}

checkDelivery();
