export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { auth } from "@/lib/auth";
import { buildSystemPrompt, type ChatbotModule } from "@/lib/chatbot-knowledge";
import {
    detectEscalation,
    saveMessageAsync,
    createChatbotSession,
} from "@/lib/chatbot-db";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "@/lib/redis";
import { randomUUID } from "crypto";

// ─── Constants ──────────────────────────────────────────────────────────────
const VALID_MODULES: ChatbotModule[] = [
    "hub", "marketplace", "cooperative", "export", "academy", "wave", "farm-nation"
];

// 15 messages per user per hour (sliding window)
const chatbotRateLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(15, "1 h"),
    analytics: false,
    prefix: "chatbot:user",
});

// Rules-based fallback when API key is missing or OpenAI is down
const FALLBACK_RULES = [
    { keywords: ["register", "signup", "join", "start"], response: "To get started on Easy Sales, visit the platform, choose your preferred service, and fill in your details. Which module interests you most?" },
    { keywords: ["payment", "paid", "deducted", "failed", "refund"], response: "I'm sorry about that. Please keep your payment proof and contact our support team: 📧 info@easysalesexport.com | 📱 WhatsApp: 07076988080" },
    { keywords: ["cooperative", "coop"], response: "The Easy Sales Cooperative gives members access to ecosystem opportunities and community support. Registration involves filling the membership form and paying any applicable fee." },
    { keywords: ["export", "international", "window", "buyer"], response: "Easy Sales Export connects you to international trade and buyer linkage. Sign up and choose an export-related service to begin." },
    { keywords: ["academy", "course", "learn", "training"], response: "Easy Sales Academy offers practical training on export, business growth, and skill development. Visit the Academy section to browse available courses." },
    { keywords: ["wave", "women", "rh-wave"], response: "RH-WAVE 774 is a structured empowerment programme for women in agriculture — not a cash handout. Apply via the WAVE registration page." },
    { keywords: ["farm", "farming", "land", "agriculture"], response: "Farm Nation connects participants to practical farming, land access, and investment opportunities. Choose your participation type and complete registration." },
    { keywords: ["marketplace", "buy", "sell", "merchant", "product"], response: "The Easy Sales Marketplace connects buyers and sellers for agro-commerce. Merchants register by submitting store details and business documents for review." },
    { keywords: ["verify", "verification", "kyc", "nin", "bvn"], response: "Verification protects users and maintains platform trust. If unsuccessful, you may resubmit correct details or provide additional information for review." },
    { keywords: ["support", "help", "contact", "human", "agent"], response: "I'd like to connect you with our support team. Please contact: 📧 info@easysalesexport.com | 📱 WhatsApp: 07076988080 | ☎️ 02013309593" },
];

// ─── Feature Toggle Check ───────────────────────────────────────────────────
async function isAiAssistantEnabled(): Promise<boolean> {
    try {
        const db = getAdminDb();
        const doc = await db.collection(COLLECTIONS.FEATURE_TOGGLES).doc("ai_assistant").get();
        if (doc.exists) {
            return doc.data()?.enabled === true;
        }
        // Default to true if document doesn't exist yet (already enabled in code default)
        return true;
    } catch {
        return true; // Default open on DB failure — never silently disable the feature
    }
}

// ─── Route Handler ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    try {
        // 1. Auth guard
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }

        const userId = session.user.id;
        const userEmail = session.user.email ?? "unknown@easysalesexport.com";

        // 2. Feature toggle check
        const enabled = await isAiAssistantEnabled();
        if (!enabled) {
            return NextResponse.json(
                { error: "The AI assistant is temporarily unavailable. Please contact support at info@easysalesexport.com" },
                { status: 503 }
            );
        }

        // 3. Per-user rate limit: 15 messages/hour
        const { success: withinLimit, remaining } = await chatbotRateLimiter.limit(userId);
        if (!withinLimit) {
            logger.warn(`[chatbot] Rate limit hit for user: ${userId}`);
            return NextResponse.json(
                {
                    reply: "You've reached the chat limit for this hour. For urgent issues, please contact us at 📧 info@easysalesexport.com or 📱 WhatsApp: 07076988080.",
                    rateLimited: true,
                },
                { status: 200 } // 200 so widget shows the message gracefully rather than crashing
            );
        }

        // 4. Parse body
        const body = await req.json();
        const { message, module: rawModule, history, sessionId: clientSessionId } = body;

        if (!message?.trim()) {
            return NextResponse.json({ error: "Message required" }, { status: 400 });
        }

        const validModule: ChatbotModule = VALID_MODULES.includes(rawModule) ? rawModule : "hub";
        const sessionId: string = clientSessionId || randomUUID();
        const isNewSession = !clientSessionId;

        // 5. Create session in Firestore if this is the first message
        if (isNewSession) {
            await createChatbotSession(sessionId, userId, userEmail, validModule);
        }

        // 6. Detect escalation
        const isEscalation = detectEscalation(message);

        // 7. Build system prompt and call OpenAI
        const systemPrompt = buildSystemPrompt(validModule);
        const apiKey = process.env.OPENAI_API_KEY;
        let reply: string | null = null;

        if (apiKey) {
            try {
                const conversationMessages: { role: string; content: string }[] = [
                    { role: "system", content: systemPrompt },
                ];

                // Last 6 turns of context
                if (Array.isArray(history) && history.length > 0) {
                    for (const msg of history.slice(-6)) {
                        if (msg.role === "user" || msg.role === "assistant") {
                            conversationMessages.push({ role: msg.role, content: String(msg.content) });
                        }
                    }
                }
                conversationMessages.push({ role: "user", content: message });

                const oaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
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

                if (oaiRes.ok) {
                    const data = await oaiRes.json();
                    reply = data.choices?.[0]?.message?.content ?? null;
                } else {
                    logger.error("[chatbot] OpenAI API error:", await oaiRes.text());
                }
            } catch (apiErr) {
                logger.error("[chatbot] OpenAI request failed:", apiErr);
            }
        }

        // 8. Fallback to rules-based response
        if (!reply) {
            const lower = message.toLowerCase();
            reply = "I'm here to help! Ask me about registration, services, payments, or anything else about Easy Sales.";
            for (const rule of FALLBACK_RULES) {
                if (rule.keywords.some(k => lower.includes(k))) {
                    reply = rule.response;
                    break;
                }
            }
        }

        // 9. Persist messages (fire-and-forget — never blocks the response)
        const userMsgId = `${sessionId}_u_${Date.now()}`;
        const botMsgId = `${sessionId}_a_${Date.now() + 1}`;
        saveMessageAsync(userMsgId, sessionId, userId, "user", message, validModule, isEscalation);
        saveMessageAsync(botMsgId, sessionId, userId, "assistant", reply, validModule, false);

        return NextResponse.json({
            reply,
            module: validModule,
            sessionId,
            remaining: remaining ?? 0,
            escalated: isEscalation,
        });

    } catch (error: any) {
        logger.error("[chatbot] Route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
