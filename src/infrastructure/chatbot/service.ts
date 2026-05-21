/**
 * Centralized Chatbot Infrastructure Service
 * 
 * Manages the OpenAI platform chat interface, history tracking, contextual prompts,
 * and contextual suggestion generation, strictly validating user roles server-side.
 */

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
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
        await createAdminAuditLog({
            userId,
            action: 'user_login', // Map to general action for audit log tracking schema
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
        const snapshot = await db.collection(COLLECTIONS.AI_CHAT_HISTORY)
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(maxMessages)
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
