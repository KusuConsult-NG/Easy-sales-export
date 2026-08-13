/**
 * Centralized Chatbot Infrastructure Service
 * 
 * Manages the OpenAI platform chat interface, history tracking, contextual prompts,
 * and contextual suggestion generation, strictly validating user roles server-side.
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { rateLimit } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { logger } from "@/lib/logger";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import type { ActionResponse } from "@/lib/safe-action";

export interface AIChatMessage {
    id: string;
    userId: string;
    message: string;
    response: string;
    context?: Record<string, unknown>;
    createdAt: string;
}

/**
 * Generates the context-aware system prompt, strictly enforcing server-side verified role boundaries.
 */
function buildSecureSystemPrompt(context: any, verifiedRoles: string[]): string {
    const basePrompt = `You are an AI assistant for the Easy Sales Export platform, a comprehensive agricultural export and marketplace system in Nigeria. You help users with:
- Farm Nation: Agricultural land listings, soil quality information, acreage calculations
- Marketplace: Product listings, pricing, buyer-seller connections
- Export Windows: International export processes, documentation, logistics
- Escrow System: Secure transactions, payment holding, dispute resolution
- LMS Academy: Agricultural courses, video tutorials, learning progress
- Loan Applications: Agricultural loans, collateral requirements, approval processes
- Cooperatives: Group farming, contributions, member management

You should provide helpful, concise, and accurate information. Always be professional and friendly.`;

    let contextPrompt = "";

    if (context?.currentPage) {
        const pageContext = {
            '/farm-nation': 'The user is viewing farm land listings. Help with land purchases, soil quality, acreage, and pricing.',
            '/marketplace': 'The user is in the marketplace. Help with product listings, pricing strategies, and connecting with buyers.',
            '/export': 'The user is managing exports. Help with international shipping, documentation, and export regulations.',
            '/escrow': 'The user is viewing escrow transactions. Help with secure payments, escrow status, and dispute resolution.',
            '/academy': 'The user is in the learning academy. Help with courses, video content, and agricultural education.',
            '/loans': 'The user is managing loan applications. Help with loan amounts, collateral, repayment terms, and approval process.',
            '/cooperatives': 'The user is in cooperatives section. Help with group farming, contributions, and member management.'
        };

        contextPrompt = pageContext[context.currentPage as keyof typeof pageContext] || '';
    }

    const isAdmin = verifiedRoles.some(r => r === "admin" || r === "super_admin" || r.endsWith("_admin"));
    const isSeller = verifiedRoles.includes("seller");

    const rolePrompt = isAdmin
        ? '\n\nThe user is verified as an Admin. You can discuss administrative controls like user verification, auditing logs, and content approvals.'
        : isSeller
            ? '\n\nThe user is verified as a Seller. Focus on helping them optimize product listings, track order status, and configure seller verification.'
            : '\n\nThe user is verified as a general participant. Assist them in registering, browsing catalogs, and completing course modules.';

    return `${basePrompt}${contextPrompt ? '\n\n' + contextPrompt : ''}${rolePrompt}`;
}

/** How many past messages one history request may read. */
const MAX_CHAT_HISTORY = 200;

const aiChatLimiter = rateLimit(rateLimitConfig.aiChat);

/**
 * Handles sending a message to OpenAI GPT-4 securely
 */
export async function sendSecureAIMessage(
    userId: string,
    verifiedRoles: string[],
    userName: string,
    message: string,
    context?: any
): Promise<ActionResponse<{ response: string; chatId: string }>> {
    try {
        const trimmedMessage = message.trim();
        if (!trimmedMessage) {
            return { success: false, error: "Message cannot be empty", data: null };
        }

        // Every call below is a GPT-4 completion, billed per token, and there
        // was no limit on it at all.
        //
        // The action in front of this requires a session and caps the message at
        // 2,000 characters, so it is not open to the world — but one
        // authenticated account could loop it as fast as the network allowed and
        // run an unbounded bill against the platform's OpenAI key. The codebase
        // already throttles KYC lookups for exactly this reason ("cost
        // optimization"), and the limiter is Redis-backed and distributed, so
        // the tool was there and unused.
        //
        // Keyed on the user: the endpoint is authenticated, the account is what
        // gets billed for, and an IP key would punish everyone behind a Nigerian
        // carrier NAT.
        const limit = await aiChatLimiter.check(userId);
        if (!limit.success) {
            logger.warn("[AI Chat] Rate limit reached", { userId, limit: limit.limit });
            return {
                success: false,
                error: "You have sent a lot of messages in a short time. Please wait a moment and try again.",
                data: null,
            };
        }

        // Build context system prompt strictly using server session roles
        const systemPrompt = buildSecureSystemPrompt(context, verifiedRoles);

        // Fetch OpenAI chat completion
        const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: trimmedMessage }
                ],
                temperature: 0.7,
                max_tokens: 500
            })
        });

        if (!openaiResponse.ok) {
            throw new Error(`OpenAI API responded with status: ${openaiResponse.status}`);
        }

        const aiData = await openaiResponse.json();
        const aiResponse = aiData.choices[0]?.message?.content || "I am sorry, I am currently unable to process your request.";

        // Store chat transaction history in Firestore
        const chatRef = await db.collection(COLLECTIONS.AI_CHAT_HISTORY).add({
            userId,
            message: trimmedMessage,
            response: aiResponse,
            context: context || {},
            createdAt: FieldValue.serverTimestamp()
        });

        // Generate platform audit log securely
        // `action: 'user_login'` with the comment "Map to general action for audit
        // log tracking schema" — so every AI message wrote an audit entry saying
        // the user had logged in.
        //
        // That is not a cosmetic mislabel. getAuditStatsAction counts by action
        // and reports the top ten, so chat volume was inflating login counts;
        // and anyone reading the audit trail during an investigation would find
        // logins that never happened, at times the person was not signing in.
        // An audit log that records the wrong verb is worse than one that
        // records nothing, because it is believed.
        //
        // The union in lib/audit-log.ts gained 'ai_chat_message'. The comment
        // suggests the mapping was a workaround for that type not having a
        // member to use; adding one costs nothing.
        await createAdminAuditLog({
            userId,
            action: 'ai_chat_message',
            targetId: chatRef.id,
            targetType: 'ai_chat',
            metadata: {
                messageLength: trimmedMessage.length,
                currentPage: context?.currentPage || "unknown"
            }
        });

        return { success: true, error: null, data: { response: aiResponse, chatId: chatRef.id } };
    } catch (error) {
        logger.error("Secure AI Chat Infrastructure Error:", error);
        return { success: false, error: "Failed to fetch response from AI assistant. Please try again.", data: null };
    }
}

/**
 * Gets secure chat history for a user
 */
export async function getSecureAIChatHistory(userId: string, maxMessages = 20): Promise<ActionResponse<{ messages: AIChatMessage[] }>> {
    try {
        // maxMessages arrived from the caller and went straight into .limit(),
        // so getAIChatHistory(1_000_000) read a million rows into memory. The
        // same shape as the audit statistics window bounded in #150.
        const boundedMax = Number.isFinite(Number(maxMessages))
            ? Math.min(MAX_CHAT_HISTORY, Math.max(1, Math.floor(Number(maxMessages))))
            : 20;

        const snapshot = await db.collection(COLLECTIONS.AI_CHAT_HISTORY)
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(boundedMax)
            .get();

        const messages = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                userId: data.userId,
                message: data.message,
                response: data.response,
                context: data.context,
                createdAt: (data.createdAt as Timestamp)?.toDate?.()?.toISOString?.() ?? new Date().toISOString()
            } as AIChatMessage;
        }).reverse();

        return { success: true, error: null, data: { messages } };
    } catch (error) {
        logger.error("Get AI Chat History Infrastructure Error:", error);
        return { success: false, error: "Failed to load chat history", data: null };
    }
}

/**
 * Generate suggestions for pages
 */
export function getContextSuggestions(currentPage: string, verifiedRoles: string[]): string[] {
    const suggestionMap: Record<string, string[]> = {
        '/farm-nation': [
            "How do I list my farmland?",
            "What soil quality is best for crops?",
            "How is land pricing calculated?",
        ],
        '/marketplace': [
            "How do I create a product listing?",
            "What are the best pricing strategies?",
            "How does escrow protect my transactions?",
        ],
        '/export': [
            "What documents do I need for export?",
            "How long does international shipping take?",
            "What are export regulations for agricultural products?",
        ],
        '/escrow': [
            "How does escrow work?",
            "What happens if there's a dispute?",
            "When are funds released?",
        ],
        '/academy': [
            "What courses are available?",
            "How do I track my learning progress?",
            "Are there certificates available?",
        ],
        '/loans': [
            "How much can I borrow?",
            "What collateral is required?",
            "How long is the approval process?",
        ],
        '/cooperatives': [
            "How do I join a cooperative?",
            "What are the benefits of cooperative farming?",
            "How are contributions tracked?",
        ]
    };

    return suggestionMap[currentPage] || [
        "How does the platform work?",
        "What services are available?",
        "How do I get started?",
    ];
}
