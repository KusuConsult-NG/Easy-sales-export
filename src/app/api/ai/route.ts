export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { buildSystemPrompt, type ChatbotModule } from "@/lib/chatbot-knowledge";
import {
    detectEscalation,
    saveMessageAsync,
    createChatbotSession,
    getRecentSessionTurns,
    getSessionOwner,
} from "@/lib/chatbot-db";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { Ratelimit } from "@upstash/ratelimit";
import { redis, isRedisConfigured } from "@/lib/redis";
import { checkFallbackLimit } from "@/lib/rate-limiter-fallback";
import { randomUUID } from "crypto";

// ─── Constants ──────────────────────────────────────────────────────────────
const VALID_MODULES: ChatbotModule[] = [
    "hub", "marketplace", "cooperative", "export", "academy", "wave", "farm-nation"
];

/**
 * Longest message accepted, and the longest recalled turn.
 *
 * Neither had a bound. The rate limit caps requests at 15/hour and says nothing
 * about their size, so one caller could write fifteen arbitrarily large
 * documents an hour into CHATBOT_MESSAGES and send the same to OpenAI. 2000
 * characters is a long support question and a short essay.
 */
const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_CHARS = 2000;

// 15 messages per user per hour (sliding window)
const CHAT_MESSAGES_PER_HOUR = 15;
const CHAT_WINDOW_MS = 60 * 60 * 1000;

const chatbotRateLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(CHAT_MESSAGES_PER_HOUR, "1 h"),
    analytics: false,
    prefix: "chatbot:user",
});

/**
 * The rate-limit decision, which must not be able to take the chat down.
 *
 *   #707 THE ASSISTANT ANSWERED 500 TO EVERY MESSAGE ON A DEPLOYMENT WITH NO
 *        UPSTASH URL, WHICH IS THIS DEPLOYMENT.
 *
 *   lib/redis.ts hands back a FOUR-METHOD STUB — get, setex, del, keys — when
 *   UPSTASH_REDIS_REST_URL or _TOKEN is missing, cast `as unknown as Redis` so
 *   it type-checks as the real client. @upstash/ratelimit drives its sliding
 *   window through `evalsha`, which the stub does not have, so
 *   `chatbotRateLimiter.limit()` threw
 *
 *       TypeError: ctx.redis.evalsha is not a function
 *
 *   — measured, not inferred. The call sat unguarded at step 3 of this route,
 *   inside the outer try, so the throw landed in the catch at the foot of the
 *   file and became `{ error: "Internal Server Error" }, { status: 500 }`.
 *   EVERY message, for every user, from the first one.
 *
 *   THE PLATFORM ALREADY KNEW. redis.ts documents this exact TypeError and
 *   exports `isRedisConfigured` so callers can skip the stub, and says why the
 *   stub deliberately does not grow a no-op `evalsha`: "a no-op evalsha would
 *   make rate limiting silently allow everything, which is worse than
 *   throwing." lib/rate-limit.ts and lib/rate-limiter.ts both consult the flag.
 *   This route imported `redis` and not the flag — the only one of the three
 *   that builds a Ratelimit and does not ask.
 *
 *   WHY NO TEST CAUGHT IT: jest cannot even load @upstash/redis here — it is
 *   ESM and the transform rejects it with "SyntaxError: Unexpected token
 *   'export'" — so no suite imports this module, and the throw was invisible to
 *   the whole suite. That is recorded in the test for this finding, which
 *   asserts on the source rather than by execution for exactly that reason.
 *
 *   FAILS CLOSED, NOT OPEN. The in-memory fallback is the same one the login
 *   and API limiters use. It is per-container and resets on restart, which is
 *   weaker than Redis and is the deliberate trade #661 already settled: a
 *   weaker limit that works beats a perfect limit that returns 500.
 */
async function chatRateDecision(userId: string): Promise<{ success: boolean; remaining: number }> {
    const key = `chatbot:user:${userId}`;

    if (!isRedisConfigured) {
        return checkFallbackLimit(key, CHAT_MESSAGES_PER_HOUR, CHAT_WINDOW_MS);
    }

    try {
        const { success, remaining } = await chatbotRateLimiter.limit(userId);
        return { success, remaining };
    } catch (err) {
        //   A REAL Redis failure, now distinguishable from "none configured" —
        //   which is the other half of what isRedisConfigured bought.
        logger.error("[chatbot] rate limiter failed; falling back to in-memory", { err });
        return checkFallbackLimit(key, CHAT_MESSAGES_PER_HOUR, CHAT_WINDOW_MS);
    }
}

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
        const session = (await requireSession()).session;
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
        const { success: withinLimit, remaining } = await chatRateDecision(userId);
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
        // `history` is deliberately not destructured. Older widgets still send
        // it and are not broken by that — it is simply not read, because the
        // server rebuilds context from what it stored.
        const { message, module: rawModule, sessionId: clientSessionId } = body;

        if (!message?.trim()) {
            return NextResponse.json({ error: "Message required" }, { status: 400 });
        }

        if (message.length > MAX_MESSAGE_CHARS) {
            return NextResponse.json(
                { error: `Message too long (max ${MAX_MESSAGE_CHARS} characters)` },
                { status: 413 }
            );
        }

        const validModule: ChatbotModule = VALID_MODULES.includes(rawModule) ? rawModule : "hub";

        // 5. A supplied session id has to be one of yours.
        //
        // It was taken as given. Messages are written with the caller's userId
        // but the SUPPLIED sessionId, and getChatThread — what an admin reads —
        // selects purely on sessionId. So posting with somebody else's session
        // id put your messages in their transcript, incremented their
        // messageCount, could set escalated on their session, and arrayUnion'd
        // tags onto it.
        //
        // Session ids are randomUUID, so this needed one to be known rather
        // than guessed. That lowers the odds and does not make the check
        // optional — ids are handed to the client, and this costs one read.
        let sessionId: string;
        let isNewSession: boolean;

        if (clientSessionId) {
            const owner = await getSessionOwner(String(clientSessionId));
            if (owner && owner !== userId) {
                logger.warn("[chatbot] session id belongs to another user", {
                    userId,
                    sessionId: String(clientSessionId),
                });
                return NextResponse.json({ error: "Unknown session" }, { status: 403 });
            }
            sessionId = String(clientSessionId);
            // An id with no session behind it is a new session, not an orphan:
            // messages used to be written against a session document that had
            // never been created.
            isNewSession = owner === null;
        } else {
            sessionId = randomUUID();
            isNewSession = true;
        }

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

                // Context is read back from storage, not accepted from the caller.
                //
                // `history` came from the request body and entries with
                // role: "assistant" were passed through, so the caller wrote
                // what the assistant had previously said. That is prompt
                // injection with no cleverness required — a support bot can be
                // told it already agreed to a refund and asked to confirm — and
                // the reply is stored and read by staff.
                //
                // Reading the stored turns is the only version the caller
                // cannot author. Messages are saved after the reply, so the
                // current turn is not in storage yet; it is appended below,
                // which is where it belongs anyway.
                const priorTurns = isNewSession ? [] : await getRecentSessionTurns(sessionId, MAX_HISTORY_TURNS);
                for (const turn of priorTurns) {
                    conversationMessages.push({
                        role: turn.role,
                        content: turn.content.slice(0, MAX_HISTORY_CHARS),
                    });
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
        // The two halves of a turn carry DISTINCT timestamps (#248).
        //
        // Each call used to stamp its own Timestamp.now(), which has
        // millisecond precision, and the second runs microseconds after the
        // first — so both rows landed on the same millisecond and the readers,
        // which order on `timestamp`, left the tie to the database. An admin
        // could be shown the answer above the question, and the same order is
        // replayed to the model as history. The ids below already encoded the
        // sequence; now the stored rows do too.
        const askedAt = Date.now();
        const answeredAt = askedAt + 1;
        const userMsgId = `${sessionId}_u_${askedAt}`;
        const botMsgId = `${sessionId}_a_${answeredAt}`;
        saveMessageAsync(userMsgId, sessionId, userId, "user", message, validModule, isEscalation, askedAt, userEmail);
        saveMessageAsync(botMsgId, sessionId, userId, "assistant", reply, validModule, false, answeredAt, userEmail);

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
