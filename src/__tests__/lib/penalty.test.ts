/**
 * @jest-environment node
 */

import { calculatePenalty } from '@/lib/calculatePenalty';

describe('Loan Penalty Calculation', () => {
    describe('calculatePenalty', () => {
        it('should return 0 penalty within grace period (0-7 days)', () => {
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() - 5); // 5 days ago

            const result = calculatePenalty(dueDate, 10000);

            expect(result.penalty).toBe(0);
            expect(result.daysOverdue).toBe(0);
        });

        it('should return 0 penalty on exactly day 7', () => {
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() - 7); // 7 days ago

            const result = calculatePenalty(dueDate, 10000);

            expect(result.penalty).toBe(0);
            expect(result.daysOverdue).toBe(0);
        });

        it('should calculate penalty correctly after grace period', () => {
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() - 12); // 12 days ago

            const result = calculatePenalty(dueDate, 10000);

            // Days overdue = 12 - 7 = 5 days
            // Penalty = 10000 * 0.001 * 5 = 50
            expect(result.daysOverdue).toBe(5);
            expect(result.penalty).toBe(50);
        });

        it('should calculate penalty for 20 days overdue', () => {
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() - 27); // 27 days ago

            const result = calculatePenalty(dueDate, 50000);

            // Days overdue = 27 - 7 = 20 days
            // Penalty = 50000 * 0.001 * 20 = 1000
            expect(result.daysOverdue).toBe(20);
            expect(result.penalty).toBe(1000);
        });

        it('should handle future due dates (not yet due)', () => {
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 5); // 5 days in future

            const result = calculatePenalty(dueDate, 10000);

            expect(result.penalty).toBe(0);
            expect(result.daysOverdue).toBe(0);
        });

        it('should round penalty to nearest whole number', () => {
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() - 10); // 10 days ago

            const result = calculatePenalty(dueDate, 12345);

            // Days overdue = 10 - 7 = 3 days
            // Penalty = 12345 * 0.001 * 3 = 37.035, rounded to 37
            expect(result.daysOverdue).toBe(3);
            expect(result.penalty).toBe(37);
        });

        it('should handle zero  amount', () => {
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() - 15);

            const result = calculatePenalty(dueDate, 0);

            expect(result.penalty).toBe(0);
        });

        it('should handle large amounts correctly', () => {
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() - 37); // 37 days ago

            const result = calculatePenalty(dueDate, 1000000);

            // Days overdue = 37 - 7 = 30 days
            // Penalty = 1000000 * 0.001 * 30 = 30000
            expect(result.daysOverdue).toBe(30);
            expect(result.penalty).toBe(30000);
        });
    });
});
