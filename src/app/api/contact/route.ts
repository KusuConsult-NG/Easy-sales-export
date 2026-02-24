import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { Resend } from "resend";
import { COMPANY_INFO } from "@/lib/constants";

// If RESEND_API_KEY is missing, every send will fail silently — surface it as a clear config error
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { name, email, subject, message } = body;

        // Validate required fields
        if (!name || !email || !subject || !message) {
            return NextResponse.json(
                { success: false, error: "All fields are required" },
                { status: 400 }
            );
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return NextResponse.json(
                { success: false, error: "Invalid email address" },
                { status: 400 }
            );
        }

        // Guard: email service not configured
        if (!resend) {
            logger.error("RESEND_API_KEY is not set — contact form emails will not be delivered.");
            return NextResponse.json(
                { success: false, error: "Email service is currently unavailable. Please contact us directly at support@easysalesexport.com." },
                { status: 503 }
            );
        }

        // Send email to admin
        const { data, error } = await resend.emails.send({
            from: "Easy Sales Export Contact Form <noreply@easysalesexport.com>",
            to: COMPANY_INFO.contact.general.email,
            replyTo: email,
            subject: `[Contact Form] ${subject}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #2E519F;">New Contact Form Submission</h2>
                    
                    <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <p><strong>Name:</strong> ${name}</p>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Subject:</strong> ${subject}</p>
                    </div>
                    
                    <div style="background: white; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                        <h3 style="color: #333; margin-top: 0;">Message:</h3>
                        <p style="color: #666; line-height: 1.6; white-space: pre-wrap;">${message}</p>
                    </div>
                    
                    <div style="margin-top: 20px; padding: 15px; background: #e8f4f8; border-left: 4px solid #2E519F; border-radius: 4px;">
                        <p style="margin: 0; color: #555; font-size: 14px;">
                            <strong>Reply To:</strong> You can reply directly to this email to respond to ${name}
                        </p>
                    </div>
                    
                    <hr style="margin: 30px 0; border: none; border-top: 1px solid #e0e0e0;" />
                    
                    <p style="color: #999; font-size: 12px; text-align: center;">
                        This message was sent from the Easy Sales Export contact form
                    </p>
                </div>
            `,
        });

        if (error) {
            logger.error("Failed to send contact email:", error);
            return NextResponse.json(
                { success: false, error: "Failed to send message. Please try again." },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            message: "Your message has been sent successfully!",
        });
    } catch (error) {
        logger.error("Contact form error:", error);
        return NextResponse.json(
            { success: false, error: "An unexpected error occurred" },
            { status: 500 }
        );
    }
}
