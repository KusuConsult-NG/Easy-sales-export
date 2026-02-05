"use server";

import { z } from "zod";
import { collection, addDoc, getDocs, query, where, orderBy, serverTimestamp, Timestamp, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AuditActionType } from "@/types/strict";
import { createAuditLog } from "@/lib/audit-logger";
import { auth } from "@/lib/auth";

/**
 * Zod schema for AI chat message
 */
const aiChatMessageSchema = z.object({
    message: z.string().min(1, "Message required").max(2000, "Message too long"),
    context: z.object({
        currentPage: z.string().optional(),
        userRole: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    }).optional(),
});

/**
 * AI Chat message type
 */
export interface AIChatMessage {
    id: string;
    userId: string;
    message: string;
    response: string;
    context?: Record<string, unknown>;
    createdAt: Date;
}

/**
 * Send a message to AI and get response
 * Using OpenAI API (requires OPENAI_API_KEY environment variable)
 */
export async function sendAIMessage(
    data: z.infer<typeof aiChatMessageSchema>
) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized", response: null };
    }

    try {
        const validated = aiChatMessageSchema.parse(data);

        // Build context-aware system prompt
        const systemPrompt = buildSystemPrompt(validated.context, session.user.role);

        // Call OpenAI API
        const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content: systemPrompt,
                    },
                    {
                        role: "user",
                        content: validated.message,
                    },
                ],
                temperature: 0.7,
                max_tokens: 500,
            }),
        });

        if (!openaiResponse.ok) {
            throw new Error("OpenAI API request failed");
        }

        const aiData = await openaiResponse.json();
        const aiResponse = aiData.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";

        // Store chat history in Firestore
        const chatRef = await addDoc(collection(db, 'ai_chat_history'), {
            userId: session.user.id,
            message: validated.message,
            response: aiResponse,
            context: validated.context || {},
            createdAt: serverTimestamp(),
        });

        // Audit log
        await createAuditLog({
            userId: session.user.id,
            actionType: AuditActionType.USER_LOGIN, // Can add AI_CHAT to enum
            resourceId: chatRef.id,
            resourceType: 'ai_chat',
            metadata: {
                messageLength: validated.message.length,
                currentPage: validated.context?.currentPage,
            },
        });

        return {
            success: true,
            response: aiResponse,
            chatId: chatRef.id,
            userId: session.user.id,
        };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                success: false,
                error: "Validation error",
                response: null,
            };
        }
        console.error("AI Chat Error:", error);
        return {
            success: false,
            error: "Failed to get AI response. Please try again.",
            response: null,
        };
    }
}

/**
 * Get chat history for current user
 */
export async function getAIChatHistory(maxMessages: number = 20) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized", messages: [] };
    }

    try {
        const chatQuery = query(
            collection(db, 'ai_chat_history'),
            where('userId', '==', session.user.id),
            orderBy('createdAt', 'desc'),
            limit(maxMessages)
        );

        const snapshot = await getDocs(chatQuery);

        const messages = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                userId: data.userId,
                message: data.message,
                response: data.response,
                context: data.context,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
            } as AIChatMessage;
        }).reverse(); // Reverse to show oldest first

        return {
            success: true,
            messages,
        };
    } catch (error) {
        return { success: false, error: "Failed to fetch chat history", messages: [] };
    }
}

/**
 * Get context-aware suggestions based on current page
 */
export async function getAISuggestions(context: { currentPage: string; userRole: string }) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized", suggestions: [] };
    }

    // Generate contextual suggestions based on page
    const suggestions = generateSuggestions(context.currentPage, context.userRole);

    return {
        success: true,
        suggestions,
    };
}

/**
 * Build system prompt based on context
 */
function buildSystemPrompt(context: any, userRole: string): string {
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
            '/cooperatives': 'The user is in cooperatives section. Help with group farming, contributions, and member management.',
        };

        contextPrompt = pageContext[context.currentPage as keyof typeof pageContext] || '';
    }

    const rolePrompt = userRole === 'admin'
        ? '\n\nThe user is an admin. You can discuss admin features like user verification, content approval, and system management.'
        : userRole === 'seller'
            ? '\n\nThe user is a seller. Focus on helping them list products, manage inventory, and connect with buyers.'
            : '\n\nThe user is a regular user. Help them navigate the platform and find what they need.';

    return `${basePrompt}${contextPrompt ? '\n\n' + contextPrompt : ''}${rolePrompt}`;
}

/**
 * Generate context-aware suggestions
 */
function generateSuggestions(currentPage: string, userRole: string): string[] {
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
        ],
    };

    return suggestionMap[currentPage] || [
        "How does the platform work?",
        "What services are available?",
        "How do I get started?",
    ];
}
