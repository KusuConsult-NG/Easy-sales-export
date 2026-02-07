/**
 * Server Actions for Messaging System
 */

"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import {
    collection,
    query,
    where,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    doc,
    orderBy,
    limit,
    serverTimestamp,
    Timestamp,
    writeBatch,
} from "firebase/firestore";
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
        const q = query(
            collection(db, COLLECTIONS.CONVERSATIONS),
            where("participants", "array-contains", userId)
        );

        const snapshot = await getDocs(q);
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

        const conversationRef = await addDoc(
            collection(db, COLLECTIONS.CONVERSATIONS),
            conversationData
        );

        return {
            success: true,
            conversationId: conversationRef.id,
            existing: false,
        };
    } catch (error: any) {
        console.error("Create conversation error:", error);
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
        const conversationDoc = await getDoc(
            doc(db, COLLECTIONS.CONVERSATIONS, conversationId)
        );

        if (!conversationDoc.exists()) {
            return { success: false, error: "Conversation not found" };
        }

        const conversation = conversationDoc.data() as Conversation;
        if (!conversation.participants.includes(userId)) {
            return { success: false, error: "Not authorized" };
        }

        // Get recipient ID
        const recipientId = conversation.participants.find(id => id !== userId);

        // Create message in subcollection
        const messageData = {
            senderId: userId,
            recipientId,
            content,
            read: false,
            createdAt: new Date(),
        };

        await addDoc(
            collection(db, COLLECTIONS.CONVERSATIONS, conversationId, "messages"),
            messageData
        );

        // Update conversation
        const updateData: any = {
            lastMessage: content.substring(0, 100), // Truncate preview
            lastMessageAt: new Date(),
            updatedAt: new Date(),
        };

        // Increment unread count for recipient
        if (recipientId) {
            updateData[`unreadCount.${recipientId}`] = (conversation.unreadCount?.[recipientId] || 0) + 1;
        }

        await updateDoc(
            doc(db, COLLECTIONS.CONVERSATIONS, conversationId),
            updateData
        );

        return { success: true };
    } catch (error: any) {
        console.error("Send message error:", error);
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
        const conversationDoc = await getDoc(
            doc(db, COLLECTIONS.CONVERSATIONS, conversationId)
        );

        if (!conversationDoc.exists()) {
            return { success: false, error: "Conversation not found" };
        }

        const conversation = conversationDoc.data() as Conversation;
        if (!conversation.participants.includes(userId)) {
            return { success: false, error: "Not authorized" };
        }

        // Get unread messages sent to this user
        const messagesQuery = query(
            collection(db, COLLECTIONS.CONVERSATIONS, conversationId, "messages"),
            where("recipientId", "==", userId),
            where("read", "==", false)
        );

        const messagesSnapshot = await getDocs(messagesQuery);

        // Batch update messages
        const batch = writeBatch(db);

        messagesSnapshot.docs.forEach(messageDoc => {
            batch.update(messageDoc.ref, {
                read: true,
                readAt: new Date(),
            });
        });

        // Reset unread count for this user
        batch.update(doc(db, COLLECTIONS.CONVERSATIONS, conversationId), {
            [`unreadCount.${userId}`]: 0,
        });

        await batch.commit();

        return { success: true };
    } catch (error: any) {
        console.error("Mark messages as read error:", error);
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

        const q = query(
            collection(db, COLLECTIONS.CONVERSATIONS),
            where("participants", "array-contains", userId),
            orderBy("lastMessageAt", "desc"),
            limit(50)
        );

        const snapshot = await getDocs(q);
        const conversations: Conversation[] = snapshot.docs.map(doc => ({
            ...doc.data(),
            id: doc.id,
            createdAt: doc.data().createdAt?.toDate(),
            updatedAt: doc.data().updatedAt?.toDate(),
            lastMessageAt: doc.data().lastMessageAt?.toDate(),
        })) as Conversation[];

        return { success: true, conversations };
    } catch (error: any) {
        console.error("Get conversations error:", error);
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
        const conversationDoc = await getDoc(
            doc(db, COLLECTIONS.CONVERSATIONS, conversationId)
        );

        if (!conversationDoc.exists()) {
            return { success: false, error: "Conversation not found" };
        }

        const conversation = conversationDoc.data() as Conversation;
        if (!conversation.participants.includes(userId)) {
            return { success: false, error: "Not authorized" };
        }

        const q = query(
            collection(db, COLLECTIONS.CONVERSATIONS, conversationId, "messages"),
            orderBy("createdAt", "desc"),
            limit(limitCount)
        );

        const snapshot = await getDocs(q);
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
        console.error("Get messages error:", error);
        return { success: false, error: error.message };
    }
}
