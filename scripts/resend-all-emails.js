require('dotenv').config({ path: '.env.local' });
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

async function check() {
  const result = await resend.emails.list();
  if (result.error) return console.error(result.error);
  
  const emails = result.data.data;
  console.log(`Analyzing last ${emails.length} emails...`);
  let delivered = 0;
  let bounced = 0;
  let sent = 0;
  let other = 0;
  let subjects = {};

  for (const e of emails) {
    if (e.last_event === 'delivered') delivered++;
    else if (e.last_event === 'bounced') bounced++;
    else if (e.last_event === 'sent') sent++;
    else other++;

    if (!subjects[e.subject]) subjects[e.subject] = 1;
    else subjects[e.subject]++;
  }

  console.log({ delivered, bounced, sent, other });
  console.log("Subjects:", subjects);
}
check();
