/**
 *   #911 THIS SUITE ENUMERATED THE CONSTANT INSTEAD OF THE APPLICATION.
 *
 *   Eighteen cases, twenty-three assertions, all green, and it did not notice that
 *   normalisePaymentStatus answered `pending` for `paid_awaiting_refund`,
 *   `escrow_held`, `paid_to_seller` and `refunded` — four states where the money
 *   had already moved. Its first case is "maps canonical values to themselves"
 *   and it lists the six values PAYMENT_STATUS held; it asserts that `banana`
 *   and `xyz123` answer `pending`, which is right, and never asks what the seven
 *   values the application actually writes answer.
 *
 *   A list written beside the thing it checks agrees with it by construction.
 *   The derived sweep, and the seven cases this one was missing, are in
 *   __tests__/unit/a-vocabulary-that-called-itself-canonical.test.ts. Nothing
 *   here is wrong, so nothing here is changed — it is a narrower test than it
 *   reads as, and that is worth saying where somebody will see it.
 */

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
