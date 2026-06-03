import { writeGuard, PaymentStatusWriteSchema } from '../write-guard';
import { PAYMENT_STATUS } from '../types/firestore';

const originalEnv = process.env.NODE_ENV;

describe('writeGuard', () => {
    afterEach(() => {
        Object.defineProperty(process.env, 'NODE_ENV', { value: originalEnv, writable: true });
    });

    it('returns validated data when schema passes', () => {
        const data = { paymentStatus: 'paid' };
        const result = writeGuard(PaymentStatusWriteSchema.partial(), data, 'test');
        expect(result.paymentStatus).toBe('paid');
    });

    it('throws in non-production when schema fails', () => {
        Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', writable: true });
        const badData = { paymentStatus: 'banana' };
        expect(() =>
            writeGuard(PaymentStatusWriteSchema, badData, 'test')
        ).toThrow(/writeGuard/);
    });

    it('allows all canonical PAYMENT_STATUS values', () => {
        Object.values(PAYMENT_STATUS).forEach(status => {
            const data = { paymentStatus: status };
            expect(() =>
                writeGuard(PaymentStatusWriteSchema.partial(), data, 'test')
            ).not.toThrow();
        });
    });
});
