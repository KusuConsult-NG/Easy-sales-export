import { Timestamp } from "firebase/firestore";

export type EscrowStatus = "pending" | "funded" | "in_transit" | "delivered" | "completed" | "disputed" | "cancelled";

export interface EscrowTransaction {
    id?: string;
    buyerId: string;
    buyerEmail: string;
    sellerId: string;
    sellerEmail: string;
    amount: number;
    productName: string;
    productDescription: string;
    status: EscrowStatus;
    paymentReference?: string;
    createdAt: Timestamp | Date;
    paidAt?: Timestamp | Date;
    releasedAt?: Timestamp | Date;
    refundedAt?: Timestamp | Date;
    releaseRequestedAt?: Timestamp | Date;
    releaseRequestedBy?: string;
    releasedBy?: string;
    updatedAt?: Timestamp | Date;
}
