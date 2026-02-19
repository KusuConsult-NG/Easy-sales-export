export enum EscrowStatus {
    PENDING = 'pending',
    FUNDED = 'funded',
    IN_TRANSIT = 'in_transit',
    DELIVERED = 'delivered',
    COMPLETED = 'completed',
    DISPUTED = 'disputed',
    CANCELLED = 'cancelled'
}

export interface EscrowTransaction {
    id: string;
    buyerId: string;
    buyerEmail?: string;
    sellerId: string;
    sellerEmail?: string;
    amount: number;
    productName: string;
    productDescription?: string;
    status: EscrowStatus;
    paymentReference?: string;

    // Dispute & Release logic
    releaseRequestedBy?: string;
    releaseRequestedAt?: Date;
    releasedBy?: string;
    releasedAt?: Date;

    disputeId?: string;
    refundedAt?: Date;
    refundedBy?: string;

    createdAt: Date;
    updatedAt: Date;
    paidAt?: Date;

    participants: string[];
}
