/**
 * Backfill: Send WhatsApp invite to WAVE registrants who have no invite token yet.
 * Finds registrations in wave_briefing_registrations that have NO corresponding
 * doc in whatsapp_invites, then generates + sends the invite for each.
 *
 * Run: node scripts/backfill-wave-whatsapp-invites.js
 */
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');
const { randomUUID } = require('crypto');
const { Resend } = require('resend');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey,
        }),
    });
}

const db = admin.firestore();
const resend = new Resend(process.env.RESEND_API_KEY);
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://easysalesexport.com';
const GROUP_URL = process.env.WAVE_WHATSAPP_GROUP_URL;

if (!GROUP_URL) {
    console.error('❌ WAVE_WHATSAPP_GROUP_URL is not set in .env.local');
    process.exit(1);
}

async function sendInviteEmail(email, name, inviteUrl) {
    return resend.emails.send({
        from: process.env.EMAIL_FROM || 'Easy Sales Export <noreply@easysalesexport.com>',
        to: email,
        subject: 'Your WAVE Briefing WhatsApp Group Access',
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
        <div style="background: #14532d; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 22px;">WAVE Briefing</h1>
          <p style="color: #bbf7d0; margin: 6px 0 0; font-size: 14px;">Women Agripreneurs Value-creation Empowerment</p>
        </div>
        <div style="padding: 32px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="font-size: 16px; margin: 0 0 12px;">Hello <strong>${name}</strong>,</p>
          <p style="font-size: 15px; color: #374151; margin: 0 0 8px;">
            Your seat for the <strong>WAVE National Awareness &amp; Opportunity Briefing</strong> has been confirmed.
          </p>
          <p style="font-size: 15px; color: #374151; margin: 0 0 28px;">
            Click the button below to join our exclusive WhatsApp group for event updates, venue details, and briefing materials.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${inviteUrl}"
               style="background-color: #16a34a; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold; display: inline-block;">
              Join WAVE WhatsApp Group &rarr;
            </a>
          </div>
          <div style="background: #fef9c3; border-left: 4px solid #ca8a04; padding: 12px 16px; border-radius: 4px; margin: 24px 0;">
            <p style="margin: 0; font-size: 13px; color: #92400e;">
              &#9888; <strong>Important:</strong> This button can only be clicked once. Do not forward this email &mdash; each registrant receives their own personal invite link.
            </p>
          </div>
          <p style="font-size: 13px; color: #6b7280; margin: 24px 0 0;">
            This link expires in 7 days. If you need a new invite, please contact our support team.
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="font-size: 12px; color: #9ca3af; margin: 0; text-align: center;">
            Easy Sales Export &mdash; Nigeria's Premier Agricultural Export Platform
          </p>
        </div>
      </div>
    `,
    });
}

async function run() {
    // 1. Get all registrations
    const regSnap = await db.collection('wave_briefing_registrations').get();
    console.log(`Total registrations: ${regSnap.size}`);

    // 2. Get all existing invite emails for wave_briefing
    const inviteSnap = await db.collection('whatsapp_invites')
        .where('groupType', '==', 'wave_briefing')
        .get();

    const alreadyInvited = new Set();
    inviteSnap.forEach(doc => alreadyInvited.add(doc.data().email));
    console.log(`Already have invite tokens: ${alreadyInvited.size}`);

    // 3. Find registrants with NO invite token
    const missing = [];
    regSnap.forEach(doc => {
        const d = doc.data();
        if (d.email && !alreadyInvited.has(d.email)) {
            missing.push({ email: d.email, name: d.fullName || d.email.split('@')[0] });
        }
    });

    console.log(`\nMissing invites: ${missing.length}`);
    if (missing.length === 0) {
        console.log('✅ All registrants already have invite tokens. Nothing to do.');
        process.exit(0);
    }

    missing.forEach(m => console.log(` - ${m.email}`));

    // 4. Generate token + send email for each missing registrant
    let sent = 0;
    let failed = 0;

    for (const { email, name } of missing) {
        try {
            const token = randomUUID();
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7);

            await db.collection('whatsapp_invites').doc(token).set({
                token,
                groupType: 'wave_briefing',
                email,
                name,
                userId: null,
                used: false,
                usedAt: null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt,
            });

            const inviteUrl = `${APP_URL}/api/whatsapp-invite?token=${token}`;
            const result = await sendInviteEmail(email, name, inviteUrl);

            if (result.error) {
                console.error(`  ❌ Email failed for ${email}:`, result.error);
                failed++;
            } else {
                console.log(`  ✅ Sent to ${email}`);
                sent++;
            }

            // Small delay to avoid Resend rate limiting
            await new Promise(r => setTimeout(r, 300));
        } catch (err) {
            console.error(`  ❌ Error for ${email}:`, err.message);
            failed++;
        }
    }

    console.log(`\n=== DONE: ${sent} sent, ${failed} failed ===`);
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
