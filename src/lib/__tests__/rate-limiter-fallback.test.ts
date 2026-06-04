import { checkFallbackLimit } from '../rate-limiter-fallback';

describe('checkFallbackLimit', () => {
    const testKey = 'test-ip-address';

    beforeEach(() => {
        // Since store is module-scoped, we use different keys or wait
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('allows requests up to the maxRequests limit', () => {
        const key = `${testKey}-1`;
        // 1st request
        const res1 = checkFallbackLimit(key, 3, 60000);
        expect(res1.success).toBe(true);
        expect(res1.remaining).toBe(2);

        // 2nd request
        const res2 = checkFallbackLimit(key, 3, 60000);
        expect(res2.success).toBe(true);
        expect(res2.remaining).toBe(1);

        // 3rd request
        const res3 = checkFallbackLimit(key, 3, 60000);
        expect(res3.success).toBe(true);
        expect(res3.remaining).toBe(0);

        // 4th request (exceeds limit)
        const res4 = checkFallbackLimit(key, 3, 60000);
        expect(res4.success).toBe(false);
        expect(res4.remaining).toBe(0);
    });

    it('resets the limit once the window has expired', () => {
        const key = `${testKey}-2`;
        
        // Exceed limit
        checkFallbackLimit(key, 2, 10000);
        checkFallbackLimit(key, 2, 10000);
        const resBlock = checkFallbackLimit(key, 2, 10000);
        expect(resBlock.success).toBe(false);

        // Advance time by 11 seconds (window is 10s)
        jest.advanceTimersByTime(11000);

        // Should be allowed again
        const resAllow = checkFallbackLimit(key, 2, 10000);
        expect(resAllow.success).toBe(true);
        expect(resAllow.remaining).toBe(1);
    });
});
