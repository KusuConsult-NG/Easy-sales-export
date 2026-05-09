import { runSystemHealthDiagnostic } from '@/app/actions/health';
import { adminDb } from '@/lib/firebase-admin';

// Mock the dependencies
jest.mock('@/lib/firebase-admin', () => ({
    adminDb: {
        collection: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        count: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
            data: () => ({ count: 10 }),
            size: 10
        }),
    }
}));

jest.mock('@/app/actions/auth', () => ({
    verifyAdminSession: jest.fn().mockResolvedValue({ success: true, user: { role: 'admin' } })
}));

describe('runSystemHealthDiagnostic Server Action', () => {
    
    it('should aggregate infrastructure and integrity data', async () => {
        const result = await runSystemHealthDiagnostic();
        
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        
        const report = result.data!;
        
        // Check infrastructure keys
        expect(report.infrastructure).toBeDefined();
        expect(report.infrastructure.redis).toBeDefined();
        expect(report.infrastructure.firestore).toBeDefined();
        expect(report.infrastructure.paystack).toBeDefined();
        expect(report.infrastructure.resend).toBeDefined();
        
        // Check integrity keys
        expect(report.integrity).toBeDefined();
        expect(report.integrity.orphanedApplications).toBeDefined();
        expect(report.integrity.desyncedRegistrations).toBeDefined();
        
        // Check features
        expect(report.features).toBeDefined();
    });

    it('should correctly identify infrastructure availability', async () => {
        // We can mock process.env for this test
        const originalEnv = process.env;
        process.env = { ...originalEnv, UPSTASH_REDIS_REST_URL: 'test-url' };
        
        const result = await runSystemHealthDiagnostic();
        expect(result.data?.infrastructure.redis.status).toBe('healthy');
        
        process.env = { ...originalEnv, UPSTASH_REDIS_REST_URL: '' };
        const result2 = await runSystemHealthDiagnostic();
        expect(result2.data?.infrastructure.redis.status).toBe('risk');
        
        process.env = originalEnv;
    });
});
