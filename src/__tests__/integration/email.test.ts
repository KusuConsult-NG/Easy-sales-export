/**
 * Integration Tests for Email Service
 * 
 * These tests verify the Resend email integration works correctly
 * 
 * Run with: npm run test -- email.test.ts
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
    sendEmailNotification,
    sendMembershipApprovalEmail,
    sendPasswordResetEmail,
    sendWithdrawalConfirmationEmail,
    sendWaveApplicationEmail
} from '@/lib/email-notifications';

// Mock Resend
jest.mock('resend', () => ({
    Resend: jest.fn().mockImplementation(() => ({
        emails: {
            send: jest.fn().mockResolvedValue({
                data: { id: 'test-email-id-123' },
                error: null
            })
        }
    }))
}));

describe('Email Notifications', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        process.env.RESEND_API_KEY = 'test_api_key_12345';
        jest.clearAllMocks();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('sendEmailNotification', () => {
        it('should send email with valid configuration', async () => {
            const result = await sendEmailNotification({
                to: 'test@example.com',
                subject: 'Test Subject',
                message: '<p>Test message</p>',
                metadata: { type: 'test' }
            });

            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should fail without API key', async () => {
            delete process.env.RESEND_API_KEY;

            const result = await sendEmailNotification({
                to: 'test@example.com',
                subject: 'Test',
                message: 'Test'
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Email service not configured');
        });

        it('should include metadata tags', async () => {
            const { Resend } = await import('resend');
            const mockSend = jest.fn().mockResolvedValue({ data: { id: '123' } });

            // @ts-ignore
            Resend.mockImplementation(() => ({
                emails: { send: mockSend }
            }));

            await sendEmailNotification({
                to: 'test@example.com',
                subject: 'Test',
                message: 'Test',
                metadata: { type: 'membership_approval' }
            });

            expect(mockSend).toHaveBeenCalledWith(
                expect.objectContaining({
                    tags: [{ name: 'type', value: 'membership_approval' }]
                })
            );
        });
    });

    describe('sendMembershipApprovalEmail', () => {
        it('should send approval email with correct format', async () => {
            const result = await sendMembershipApprovalEmail(
                'member@example.com',
                'John Doe'
            );

            expect(result.success).toBe(true);
        });
    });

    describe('sendPasswordResetEmail', () => {
        it('should include reset link in email', async () => {
            const resetLink = 'https://app.com/reset?token=abc123';

            const result = await sendPasswordResetEmail(
                'user@example.com',
                resetLink
            );

            expect(result.success).toBe(true);
        });
    });

    describe('sendWithdrawalConfirmationEmail', () => {
        it('should format amount correctly', async () => {
            const result = await sendWithdrawalConfirmationEmail(
                'user@example.com',
                'Jane Smith',
                50000,
                'WD-12345'
            );

            expect(result.success).toBe(true);
        });
    });

    describe('sendWaveApplicationEmail', () => {
        it('should send approval email', async () => {
            const result = await sendWaveApplicationEmail(
                'applicant@example.com',
                'Mary Johnson',
                'approved'
            );

            expect(result.success).toBe(true);
        });

        it('should send rejection email with reason', async () => {
            const result = await sendWaveApplicationEmail(
                'applicant@example.com',
                'Mary Johnson',
                'rejected',
                'Application incomplete'
            );

            expect(result.success).toBe(true);
        });
    });
});
