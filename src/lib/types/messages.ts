/**
 * Message and Conversation Type Definitions
 * 
 * Defines the schema for the messaging system including
 * conversations between users and individual messages.
 */

import { Timestamp } from "firebase/firestore";

/**
 * Individual message in a conversation
 */
export interface Message {
    id: string;
    senderId: string;
    senderName: string;
    senderEmail: string;
    text: string;
    timestamp: Timestamp;
    read: boolean;
    type: "text" | "system";
}

/**
 * Participant info stored in conversation
 */
export interface ParticipantInfo {
    uid: string;
    name: string;
    email: string;
    lastRead: Timestamp | null;
}

/**
 * Last message preview for conversation list
 */
export interface LastMessage {
    text: string;
    senderId: string;
    timestamp: Timestamp;
}

/**
 * Conversation between two or more users
 */
export interface Conversation {
    id: string;
    participants: string[]; // Array of user UIDs
    participantDetails: Record<string, ParticipantInfo>;
    lastMessage: LastMessage | null;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    context?: string;
    orderId?: string;
    productId?: string;
}

/**
 * User search result
 */
export interface UserSearchResult {
    uid: string;
    fullName: string;
    email: string;
    roles: string[];
}

/**
 * Client-side conversation with unread count
 */
export interface ConversationWithUnread extends Conversation {
    unreadCount: number;
    otherParticipant: ParticipantInfo;
}
