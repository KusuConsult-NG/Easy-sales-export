import { normalisePaymentStatus, PAYMENT_STATUS } from '../types/firestore';

describe('normalisePaymentStatus', () => {
    it('maps canonical values to themselves', () => {
        expect(normalisePaymentStatus('paid')).toBe(PAYMENT_STATUS.PAID);
        expect(normalisePaymentStatus('pending')).toBe(PAYMENT_STATUS.PENDING);
        expect(normalisePaymentStatus('failed')).toBe(PAYMENT_STATUS.FAILED);
        expect(normalisePaymentStatus('completed')).toBe(PAYMENT_STATUS.COMPLETED);
        expect(normalisePaymentStatus('processing')).toBe(PAYMENT_STATUS.PROCESSING);
        expect(normalisePaymentStatus('unpaid')).toBe(PAYMENT_STATUS.UNPAID);
    });

    describe('legacy variant mapping', () => {
        // 'successful' and 'success' → PAID (not COMPLETED)
        it('maps "successful" to PAID', () => {
            expect(normalisePaymentStatus('successful')).toBe(PAYMENT_STATUS.PAID);
        });
        it('maps "success" to PAID', () => {
            expect(normalisePaymentStatus('success')).toBe(PAYMENT_STATUS.PAID);
        });
        // 'successful_payment' and 'paid_completed' → COMPLETED
        it('maps "successful_payment" to COMPLETED', () => {
            expect(normalisePaymentStatus('successful_payment')).toBe(PAYMENT_STATUS.COMPLETED);
        });
        it('maps "paid_completed" to COMPLETED', () => {
            expect(normalisePaymentStatus('paid_completed')).toBe(PAYMENT_STATUS.COMPLETED);
        });
        // Failed variants
        it('maps "declined" to FAILED', () => {
            expect(normalisePaymentStatus('declined')).toBe(PAYMENT_STATUS.FAILED);
        });
        it('maps "failure" to FAILED', () => {
            expect(normalisePaymentStatus('failure')).toBe(PAYMENT_STATUS.FAILED);
        });
        // Pending variants
        it('maps "awaiting" to PENDING', () => {
            expect(normalisePaymentStatus('awaiting')).toBe(PAYMENT_STATUS.PENDING);
        });
        it('maps "pending_payment" to PENDING', () => {
            expect(normalisePaymentStatus('pending_payment')).toBe(PAYMENT_STATUS.PENDING);
        });
    });

    describe('case-insensitivity', () => {
        it('handles PAID (uppercase)', () => {
            expect(normalisePaymentStatus('PAID')).toBe(PAYMENT_STATUS.PAID);
        });
        it('handles Pending (mixed case)', () => {
            expect(normalisePaymentStatus('Pending')).toBe(PAYMENT_STATUS.PENDING);
        });
        it('handles SUCCESSFUL (uppercase) → PAID', () => {
            expect(normalisePaymentStatus('SUCCESSFUL')).toBe(PAYMENT_STATUS.PAID);
        });
        it('handles FAILED (uppercase)', () => {
            expect(normalisePaymentStatus('FAILED')).toBe(PAYMENT_STATUS.FAILED);
        });
    });

    describe('null / undefined / empty', () => {
        it('returns PENDING for null', () => {
            expect(normalisePaymentStatus(null)).toBe(PAYMENT_STATUS.PENDING);
        });
        it('returns PENDING for undefined', () => {
            expect(normalisePaymentStatus(undefined)).toBe(PAYMENT_STATUS.PENDING);
        });
        it('returns PENDING for empty string', () => {
            expect(normalisePaymentStatus('')).toBe(PAYMENT_STATUS.PENDING);
        });
    });

    describe('unknown / garbage strings', () => {
        it('returns PENDING for "banana"', () => {
            expect(normalisePaymentStatus('banana')).toBe(PAYMENT_STATUS.PENDING);
        });
        it('returns PENDING for "xyz123"', () => {
            expect(normalisePaymentStatus('xyz123')).toBe(PAYMENT_STATUS.PENDING);
        });
    });
});
