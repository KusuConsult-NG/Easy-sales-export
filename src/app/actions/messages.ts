/**
 * Messaging Server Actions
 * 
 * Server-side functions for managing conversations and messages
 */

"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import type { Conversation, Message, UserSearchResult } from "@/lib/types/messages";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * Get all conversations for the current user
 */
export async function getConversationsAction() {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { error: "Not authenticated", conversations: [] };
        }

        const conversationsRef = db.collection(COLLECTIONS.CONVERSATIONS);
        const snapshot = await conversationsRef
            .where("participants", "array-contains", session.user.id)
            .orderBy("updatedAt", "desc")
            .limit(50)
            .get();

        const conversations = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as Conversation[];

        return { conversations, error: null };
    } catch (error) {
        logger.error("Get conversations error", error);
        return { error: "Failed to load conversations", conversations: [] };
    }
}

/**
 * Get messages for a specific conversation
 */
export async function getMessagesAction(conversationId: string, limit = 50) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { error: "Not authenticated", messages: [] };
        }

        // Verify user is participant
        const conversationDoc = await db.collection(COLLECTIONS.CONVERSATIONS).doc(conversationId).get();
        if (!conversationDoc.exists) {
            return { error: "Conversation not found", messages: [] };
        }

        const conversation = conversationDoc.data() as Conversation;
        if (!conversation.participants.includes(session.user.id)) {
            return { error: "Access denied", messages: [] };
        }

        // Get messages
        const messagesRef = conversationDoc.ref.collection("messages");
        const snapshot = await messagesRef
            .orderBy("timestamp", "desc")
            .limit(limit)
            .get();

        const messages = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as Message[];

        return { messages: messages.reverse(), error: null };
    } catch (error) {
        logger.error("Get messages error", error);
        return { error: "Failed to load messages", messages: [] };
    }
}

/**
 * Send a message in a conversation
 */
export async function sendMessageAction(conversationId: string, text: string) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { error: "Not authenticated", success: false };
        }

        const trimmedText = text.trim();
        if (!trimmedText) {
            return { error: "Message cannot be empty", success: false };
        }

        // Get conversation
        const conversationRef = db.collection(COLLECTIONS.CONVERSATIONS).doc(conversationId);
        const conversationDoc = await conversationRef.get();

        if (!conversationDoc.exists) {
            return { error: "Conversation not found", success: false };
        }

        const conversation = conversationDoc.data() as Conversation;
        if (!conversation.participants.includes(session.user.id)) {
            return { error: "Access denied", success: false };
        }

        // Add message
        const messageData = {
            senderId: session.user.id,
            senderName: session.user.name || "User",
            senderEmail: session.user.email || "",
            text: trimmedText,
            timestamp: FieldValue.serverTimestamp(),
            read: false,
            type: "text"
        };

        await conversationRef.collection("messages").add(messageData);

        // Update conversation's lastMessage and updatedAt
        await conversationRef.update({
            lastMessage: {
                text: trimmedText,
                senderId: session.user.id,
                timestamp: FieldValue.serverTimestamp()
            },
            updatedAt: FieldValue.serverTimestamp()
        });

        return { success: true, error: null };
    } catch (error) {
        logger.error("Send message error", error);
        return { error: "Failed to send message", success: false };
    }
}

/**
 * Mark messages as read in a conversation
 */
export async function markAsReadAction(conversationId: string) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { error: "Not authenticated", success: false };
        }

        const conversationRef = db.collection(COLLECTIONS.CONVERSATIONS).doc(conversationId);

        // Update lastRead timestamp for this user
        await conversationRef.update({
            [`participantDetails.${session.user.id}.lastRead`]: FieldValue.serverTimestamp()
        });

        return { success: true, error: null };
    } catch (error) {
        logger.error("Mark as read error", error);
        return { error: "Failed to mark as read", success: false };
    }
}

/**
 * Start a new conversation with a user
 */
export async function startConversationAction(participantUid: string) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { error: "Not authenticated", conversationId: null };
        }

        if (participantUid === session.user.id) {
            return { error: "Cannot message yourself", conversationId: null };
        }

        // Check if conversation already exists
        const existingSnapshot = await db.collection(COLLECTIONS.CONVERSATIONS)
            .where("participants", "array-contains", session.user.id)
            .get();

        for (const doc of existingSnapshot.docs) {
            const conversation = doc.data() as Conversation;
            if (conversation.participants.includes(participantUid) && conversation.participants.length === 2) {
                return { conversationId: doc.id, error: null };
            }
        }

        // Get participant details
        const participantDoc = await db.collection(COLLECTIONS.USERS).doc(participantUid).get();
        if (!participantDoc.exists) {
            return { error: "User not found", conversationId: null };
        }

        const participant = participantDoc.data();

        // Create new conversation
        const conversationData = {
            participants: [session.user.id, participantUid],
            participantDetails: {
                [session.user.id]: {
                    uid: session.user.id,
                    name: session.user.name || "User",
                    email: session.user.email || "",
                    lastRead: null
                },
                [participantUid]: {
                    uid: participantUid,
                    name: participant?.fullName || "User",
                    email: participant?.email || "",
                    lastRead: null
                }
            },
            lastMessage: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        };

        const newConversation = await db.collection(COLLECTIONS.CONVERSATIONS).add(conversationData);

        return { conversationId: newConversation.id, error: null };
    } catch (error) {
        logger.error("Start conversation error", error);
        return { error: "Failed to start conversation", conversationId: null };
    }
}

/**
 * Search for users to start a conversation with
 */
export async function searchUsersAction(query: string) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { error: "Not authenticated", users: [] };
        }

        const trimmedQuery = query.trim().toLowerCase();
        if (!trimmedQuery) {
            return { users: [], error: null };
        }

        // Get all users (we'll filter client-side for simplicity)
        // In production, use Algolia or similar for better search
        const usersSnapshot = await db.collection(COLLECTIONS.USERS)
            .limit(50)
            .get();

        const users: UserSearchResult[] = [];

        for (const doc of usersSnapshot.docs) {
            const userData = doc.data();
            if (doc.id === session.user.id) continue; // Exclude current user

            const fullName = (userData.fullName || "").toLowerCase();
            const email = (userData.email || "").toLowerCase();

            if (fullName.includes(trimmedQuery) || email.includes(trimmedQuery)) {
                users.push({
                    uid: doc.id,
                    fullName: userData.fullName || "User",
                    email: userData.email || "",
                    roles: userData.roles || []
                });
            }
        }

        return { users, error: null };
    } catch (error) {
        logger.error("Search users error", error);
        return { error: "Failed to search users", users: [] };
    }
}
