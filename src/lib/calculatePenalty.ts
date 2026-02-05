/**
 * Calculate penalty for overdue payment (7-day grace period)
 * Extracted from loans.ts for testing
 */
export function calculatePenalty(dueDate: Date, totalAmount: number): { penalty: number; daysOverdue: number } {
    const now = new Date();
    const gracePeriodDays = 7;
    const penaltyRatePerDay = 0.001; // 0.1% per day after grace period

    const daysDiff = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff <= gracePeriodDays) {
        return { penalty: 0, daysOverdue: 0 };
    }

    const daysOverdue = daysDiff - gracePeriodDays;
    const penalty = totalAmount * penaltyRatePerDay * daysOverdue;

    return { penalty: Math.round(penalty), daysOverdue };
}
