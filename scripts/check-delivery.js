require('dotenv').config({ path: '.env.local' });
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

async function check() {
  console.log("Fetching emails...");
  const result = await resend.emails.list();
  if (result.error) return console.error(result.error);
  if (!result.data || !result.data.data) {
      console.log("No data returned:", result);
      return;
  }
  const emails = result.data.data;
  console.log("Emails count:", emails.length);
  if (emails.length > 0) {
      console.log("First email keys:", Object.keys(emails[0]));
      console.log("First email:", emails[0]);
  }
}
check();
