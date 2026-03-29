export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { auth } from "@/lib/auth";
import { buildSystemPrompt, type ChatbotModule } from "@/lib/chatbot-knowledge";

const VALID_MODULES: ChatbotModule[] = [
    "hub", "marketplace", "cooperative", "export", "academy", "wave", "farm-nation"
];

// Fallback rules-based responses when AI is unavailable
const FALLBACK_RULES = [
    { keywords: ["register", "signup", "join", "start"], response: "To get started on Easy Sales, visit the platform, choose your preferred service, and fill in your details. I can guide you step by step — which module interests you most?" },
    { keywords: ["payment", "paid", "deducted", "failed"], response: "I'm sorry about that. Please keep your payment proof and contact support with your name, phone number, transaction reference, amount paid, and service name so the issue can be reviewed." },
    { keywords: ["cooperative", "coop"], response: "The Easy Sales Cooperative gives members structured access to ecosystem opportunities, community support, and selected business benefits. Registration involves filling the membership form and paying any applicable fee." },
    { keywords: ["export", "international", "window"], response: "Easy Sales Export connects you to international trade opportunities, buyer linkage, and export readiness guidance. Sign up on the platform and choose an export-related service to begin." },
    { keywords: ["academy", "course", "learn", "training"], response: "Easy Sales Academy offers practical training courses on export, business growth, and skill development. Visit the Academy section to browse available courses and enrol." },
    { keywords: ["wave", "women", "rh-wave"], response: "RH-WAVE 774 is a structured empowerment programme for women in agriculture and value chain participation — not a cash handout. Apply via the WAVE registration page to get started." },
    { keywords: ["farm", "farming", "land", "agriculture"], response: "Farm Nation connects participants to practical farming, land access, value chain integration, and investment opportunities. Choose your participation type and complete the registration form." },
    { keywords: ["marketplace", "buy", "sell", "merchant"], response: "The Easy Sales Marketplace connects buyers and sellers for agro-commerce. Merchants can register by submitting store details and business documents for review." },
    { keywords: ["verify", "verification", "kyc"], response: "Verification helps protect users and maintain platform trust. If verification is unsuccessful, you may resubmit correct details or provide additional information for review." },
    { keywords: ["refund"], response: "Payments for processed or consumed services may not be refundable unless otherwise stated. For duplicate payments or failed processing, please contact support with your transaction reference." },
    { keywords: ["support", "help", "contact", "human"], response: "I'd like to connect you with our support team so this can be handled properly. Please contact support with your full name, phone number, and a brief description of your issue." },
];

export async function POST(req: Request) {
    try {
        // Require authenticated user to prevent API abuse
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }

        const body = await req.json();
        const { message, module: rawModule, history } = body;

        if (!message?.trim()) {
            return NextResponse.json({ error: "Message required" }, { status: 400 });
        }

        // Validate and default the module
        const module: ChatbotModule = VALID_MODULES.includes(rawModule) ? rawModule : "hub";
        const systemPrompt = buildSystemPrompt(module);
        const apiKey = process.env.OPENAI_API_KEY;

        if (apiKey) {
            try {
                // Build conversation history for context
                const conversationMessages: { role: string; content: string }[] = [
                    { role: "system", content: systemPrompt },
                ];

                // Include up to last 6 messages for context
                if (Array.isArray(history) && history.length > 0) {
                    const recentHistory = history.slice(-6);
                    for (const msg of recentHistory) {
                        if (msg.role === "user" || msg.role === "assistant") {
                            conversationMessages.push({ role: msg.role, content: msg.content });
                        }
                    }
                }

                conversationMessages.push({ role: "user", content: message });

                const response = await fetch("https://api.openai.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model: "gpt-3.5-turbo",
                        messages: conversationMessages,
                        temperature: 0.7,
                        max_tokens: 300,
                    }),
                });

                if (response.ok) {
                    const data = await response.json();
                    const reply = data.choices?.[0]?.message?.content;
                    if (reply) {
                        return NextResponse.json({ reply, module });
                    }
                } else {
                    const errorText = await response.text();
                    logger.error("OpenAI API Error:", errorText);
                }
            } catch (apiError) {
                logger.error("OpenAI Request Failed:", apiError);
            }
        } else {
            logger.warn("OPENAI_API_KEY not found, using fallback rules.");
        }

        // Fallback: rules-based response
        const userMessage = message.toLowerCase();
        let reply = "I'm here to help! You can ask me about registration, our services, payments, verification, or anything else about Easy Sales. What would you like to know?";

        for (const rule of FALLBACK_RULES) {
            if (rule.keywords.some(k => userMessage.includes(k))) {
                reply = rule.response;
                break;
            }
        }

        return NextResponse.json({ reply, module });

    } catch (error: any) {
        logger.error("AI Route Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
