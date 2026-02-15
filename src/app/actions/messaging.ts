/**
 * Server Actions for Messaging System
 */

"use server";

import { auth } from "@/lib/auth";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Conversation, Message } from "@/lib/types/marketplace";

/**
 * Create or get existing conversation between two users
 */
export async function createConversationAction(params: {
    recipientId: string;
    productId?: string;
    orderId?: string;
}) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;
        const { recipientId, productId, orderId } = params;

        // Check if conversation already exists between these users
        const snapshot = await db.collection(COLLECTIONS.CONVERSATIONS)
            .where("participants", "array-contains", userId)
            .get();

        const existingConversation = snapshot.docs.find(doc => {
            const data = doc.data();
            return data.participants.includes(recipientId);
        });

        if (existingConversation) {
            return {
                success: true,
                conversationId: existingConversation.id,
                existing: true,
            };
        }

        // Create new conversation
        const conversationData: Partial<Conversation> = {
            participants: [userId, recipientId],
            productId,
            orderId,
            lastMessage: "",
            lastMessageAt: new Date(),
            unreadCount: {
                [userId]: 0,
                [recipientId]: 0,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const conversationRef = await db.collection(COLLECTIONS.CONVERSATIONS).add(conversationData);

        return {
            success: true,
            conversationId: conversationRef.id,
            existing: false,
        };
    } catch (error: any) {
        logger.error("Create conversation error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Send a message in a conversation
 */
export async function sendMessageAction(
    conversationId: string,
    content: string
) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        // Verify user is participant
        const conversationRef = db.collection(COLLECTIONS.CONVERSATIONS).doc(conversationId);
        const conversationDoc = await conversationRef.get();

        if (!conversationDoc.exists) {
            return { success: false, error: "Conversation not found" };
        }

        const conversation = conversationDoc.data() as Conversation;
        if (!conversation.participants.includes(userId)) {
            return { success: false, error: "Not authorized" };
        }

        // Validate content length (max 5000 characters)
        if (!content || content.trim().length === 0) {
            return { success: false, error: "Message cannot be empty" };
        }

        if (content.length > 5000) {
            return { success: false, error: "Message too long (max 5000 characters)" };
        }

        // Basic HTML sanitization: strip script tags and dangerous attributes
        const sanitizedContent = content
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
            .replace(/javascript:/gi, '')
            .trim();

        // Get recipient ID
        const recipientId = conversation.participants.find(id => id !== userId);

        // Create message in subcollection
        const messageData = {
            senderId: userId,
            recipientId,
            content: sanitizedContent,
            read: false,
            createdAt: new Date(),
        };

        await conversationRef.collection("messages").add(messageData);

        // Update conversation
        const updateData: any = {
            lastMessage: content.substring(0, 100), // Truncate preview
            lastMessageAt: new Date(),
            updatedAt: new Date(),
        };

        // Increment unread count for recipient
        if (recipientId) {
            updateData[`unreadCount.${recipientId}`] = FieldValue.increment(1);
        }

        await conversationRef.update(updateData);

        return { success: true };
    } catch (error: any) {
        logger.error("Send message error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Mark all messages in a conversation as read
 */
export async function markMessagesAsReadAction(conversationId: string) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        // Verify user is participant
        const conversationRef = db.collection(COLLECTIONS.CONVERSATIONS).doc(conversationId);
        const conversationDoc = await conversationRef.get();

        if (!conversationDoc.exists) {
            return { success: false, error: "Conversation not found" };
        }

        const conversation = conversationDoc.data() as Conversation;
        if (!conversation.participants.includes(userId)) {
            return { success: false, error: "Not authorized" };
        }

        // Get unread messages sent to this user
        const messagesSnapshot = await conversationRef.collection("messages")
            .where("recipientId", "==", userId)
            .where("read", "==", false)
            .get();

        // Batch update messages
        const batch = db.batch();

        messagesSnapshot.docs.forEach(messageDoc => {
            batch.update(messageDoc.ref, {
                read: true,
                readAt: new Date(),
            });
        });

        // Reset unread count for this user
        batch.update(conversationRef, {
            [`unreadCount.${userId}`]: 0,
        });

        await batch.commit();

        return { success: true };
    } catch (error: any) {
        logger.error("Mark messages as read error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get all conversations for the current user
 */
export async function getConversationsAction() {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        const snapshot = await db.collection(COLLECTIONS.CONVERSATIONS)
            .where("participants", "array-contains", userId)
            .orderBy("lastMessageAt", "desc")
            .limit(50)
            .get();

        const conversations: Conversation[] = snapshot.docs.map(doc => ({
            ...doc.data(),
            id: doc.id,
            createdAt: doc.data().createdAt?.toDate(),
            updatedAt: doc.data().updatedAt?.toDate(),
            lastMessageAt: doc.data().lastMessageAt?.toDate(),
        })) as Conversation[];

        return { success: true, conversations };
    } catch (error: any) {
        logger.error("Get conversations error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get messages for a conversation (initial load, real-time via client)
 */
export async function getConversationMessagesAction(
    conversationId: string,
    limitCount: number = 50
) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        // Verify user is participant
        const conversationRef = db.collection(COLLECTIONS.CONVERSATIONS).doc(conversationId);
        const conversationDoc = await conversationRef.get();

        if (!conversationDoc.exists) {
            return { success: false, error: "Conversation not found" };
        }

        const conversation = conversationDoc.data() as Conversation;
        if (!conversation.participants.includes(userId)) {
            return { success: false, error: "Not authorized" };
        }

        const snapshot = await conversationRef.collection("messages")
            .orderBy("createdAt", "desc")
            .limit(limitCount)
            .get();

        const messages = snapshot.docs.map(doc => ({
            ...doc.data(),
            id: doc.id,
            createdAt: doc.data().createdAt?.toDate(),
            readAt: doc.data().readAt?.toDate(),
        })) as Message[];

        return {
            success: true,
            messages: messages.reverse(), // Oldest first for display
        };
    } catch (error: any) {
        logger.error("Get messages error:", error);
        return { success: false, error: error.message };
    }
}
