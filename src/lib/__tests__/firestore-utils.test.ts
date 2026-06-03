// Mock firebase-admin modules so Jest doesn't try to load the native SDK
jest.mock('firebase-admin/app', () => ({}));
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: jest.fn(),
    FieldValue: { serverTimestamp: jest.fn() },
}));
jest.mock('@/lib/firebase-admin', () => ({
    getAdminDb: jest.fn(),
    db: {},
}));

import { withSafeLimit } from '../firestore-utils';

describe('withSafeLimit', () => {
    it('adds .limit() to a query that has no limit', () => {
        const mockLimit = jest.fn().mockReturnThis();
        const mockQuery = { limit: mockLimit } as any;
        withSafeLimit(mockQuery, 200);
        expect(mockLimit).toHaveBeenCalledWith(200);
    });

    it('uses default limit of 500 when not specified', () => {
        const mockLimit = jest.fn().mockReturnThis();
        const mockQuery = { limit: mockLimit } as any;
        withSafeLimit(mockQuery);
        expect(mockLimit).toHaveBeenCalledWith(500);
    });
});

