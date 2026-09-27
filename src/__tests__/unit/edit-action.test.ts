/**
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Import the action under test
import { editApplicationAction } from '@/app/actions/admin';
import { logger } from '@/lib/logger';



describe('editApplicationAction Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Mock the global firestore get call to return a mock document snapshot
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true,
            data: () => ({
                userId: "test-user-id",
                firstName: "Ada",
                lastName: "Okonkwo",
                /*
                 *   #963 — the door asks users:update of the caller's ROW now, not of
                 *   the roles on the session, so the row has to carry them or an
                 *   administrator is refused.
                 *
                 *   Put here rather than behind a module mock for two reasons. The row
                 *   IS what the door reads, so this is the honest fixture. And a
                 *   jest.mock() would not have worked in this file at all: `jest` is
                 *   imported from '@jest/globals' above, and babel-plugin-jest-hoist
                 *   only lifts calls on the GLOBAL jest — so the factory would have
                 *   registered after editApplicationAction was already imported and
                 *   done nothing, which is exactly what it did on the first attempt.
                 */
                roles: ["admin"],
            })
        }));

        // Mock requireSession to resolve successfully with admin session
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: {
                user: {
                    id: "admin-id",
                    roles: ["admin"],
                    email: "admin@example.com",
                    name: "Admin User",
                }
            },
            error: null
        }));

        // Mock cache invalidation & audit log to resolve
        (global as any).mockInvalidateUserCache.mockImplementation(() => Promise.resolve());
        (global as any).mockCreateAdminAuditLog.mockImplementation(() => Promise.resolve());
    });

    it('should successfully edit and propagate profile changes across modules for a valid user ID', async () => {
        const result = await editApplicationAction({
            collection: "users",
            docId: "test-user-id",
            fields: {
                firstName: "Adanna",
                lastName: "Obi",
                phone: "08099998888",
                email: "ada@example.com",
                "bankDetails.accountNumber": "0123456789",
                "bankDetails.bankName": "Access Bank"
            },
            editNote: "Correction of name and bank details due to typo"
        });

        // 1. Check success
        if (!result.success) {
            console.log("TEST FAILURE RESULT:", result);
        }
        expect(result.success).toBe(true);

        // 2. Check batch update was executed
        expect((global as any).mockFirestoreBatch).toHaveBeenCalled();
        expect((global as any).mockFirestoreBatchUpdate).toHaveBeenCalled();

        // 3. Verify Cache Invalidation was triggered
        expect((global as any).mockInvalidateUserCache).toHaveBeenCalledWith("test-user-id");

        // 4. Verify Audit Log was recorded
        expect((global as any).mockCreateAdminAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({
                action: "admin_edit_application",
                userId: "admin-id",
                targetId: "test-user-id",
                targetType: "users"
            })
        );
    });

    it('should reject requests with invalid fields or missing reason', async () => {
        const result = await editApplicationAction({
            collection: "users",
            docId: "test-user-id",
            fields: {
                invalidField: "hack"
            } as any,
            editNote: "Short" // too short
        });

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });
});
