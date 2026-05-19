require('dotenv').config({ path: '.env.local' });
const { Resend } = require('resend');

async function test() {
    const resend = new Resend(process.env.RESEND_API_KEY);
    console.log('API KEY:', process.env.RESEND_API_KEY ? 'Set' : 'Not Set');

    try {
        const { data, error } = await resend.emails.send({
            from: 'Easy Sales Export <noreply@easysalesexport.com>',
            to: 'admin@easysalesexport.com',
            subject: 'Test Email',
            html: '<p>Test</p>'
        });
        
        console.log('Response:', { data, error });
    } catch (err) {
        console.error('Exception:', err);
    }
}
test();
