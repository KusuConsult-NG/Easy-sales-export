/**
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
//   #750 — this suite drives an action that now asks the LIVE gate.
//   The mock decides (roles still matter); see lib/testing/require-admin-mock.
jest.mock('@/lib/require-admin', () =>
    require('@/lib/testing/require-admin-mock').requireAdminMock());

//   IMPORTED LAZILY. `jest` comes from '@jest/globals' in this file, and
//   babel-plugin-jest-hoist does NOT hoist jest.mock when it does — so a
//   top-level `import { getUsersAction }` resolves @/lib/require-admin to
//   the real module before the mock above is ever registered. The factory
//   simply never ran, and the action met a gate that calls auth() — which
//   this harness resolves to null — so every call returned Unauthenticated.
const actions = () => import('@/app/actions/admin');


describe('getUsersAction Search and Sort Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        // Mock requireSession to resolve successfully with admin session
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: {
                user: {
                    id: "admin-id",
                    roles: ["admin", "super_admin"],
                    email: "admin@example.com",
                    name: "Admin User",
                }
            },
            error: null
        }));
    });

    it('should query Firestore with FieldPath.documentId() when search option is provided', async () => {
        // Setup mock for firestore.get to return a list of users
        const mockUsers = [
            { id: "uid-1", email: "user1@example.com", fullName: "Fatima Sama'ila", roles: ["user"], createdAt: new Date() },
            { id: "uid-2", email: "user2@example.com", fullName: "Grace Okon", roles: ["user"], createdAt: new Date() }
        ];

        (global as any).mockFirestoreGet.mockImplementation((name: string) => {
            if (name.endsWith("_count")) {
                return Promise.resolve({
                    data: () => ({ count: mockUsers.length })
                });
            }
            return Promise.resolve({
                docs: mockUsers.map(u => ({
                    id: u.id,
                    data: () => u
                })),
                empty: false
            });
        });

        const { getUsersAction } = await actions();
        const result = await getUsersAction({ search: "Fatima" });

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        // The mock query should have been called
        expect((global as any).mockFirestoreGet).toHaveBeenCalled();
    });

    it('should sort users by gender in-memory and return them correctly', async () => {
        const mockUsers = [
            { id: "uid-1", email: "user1@example.com", fullName: "User A", roles: ["user"], gender: "female", createdAt: new Date(2026, 1, 1) },
            { id: "uid-2", email: "user2@example.com", fullName: "User B", roles: ["user"], gender: "male", createdAt: new Date(2026, 1, 2) },
            { id: "uid-3", email: "user3@example.com", fullName: "User C", roles: ["user"], gender: "", createdAt: new Date(2026, 1, 3) }
        ];

        (global as any).mockFirestoreGet.mockImplementation((name: string) => {
            if (name.endsWith("_count")) {
                return Promise.resolve({
                    data: () => ({ count: mockUsers.length })
                });
            }
            return Promise.resolve({
                docs: mockUsers.map(u => ({
                    id: u.id,
                    data: () => u
                })),
                empty: false
            });
        });

        const { getUsersAction } = await actions();

        // Sort descending: Z-A (male, female, empty)
        const resultDesc = await getUsersAction({ sortBy: "gender", sortOrder: "desc" });
        expect(resultDesc.success).toBe(true);
        const dataDesc = resultDesc.data as any[];
        expect(dataDesc[0].gender).toBe("male");
        expect(dataDesc[1].gender).toBe("female");
        expect(dataDesc[2].gender).toBe("");

        // Sort ascending: A-Z (empty, female, male)
        const resultAsc = await getUsersAction({ sortBy: "gender", sortOrder: "asc" });
        expect(resultAsc.success).toBe(true);
        const dataAsc = resultAsc.data as any[];
        expect(dataAsc[0].gender).toBe("");
        expect(dataAsc[1].gender).toBe("female");
        expect(dataAsc[2].gender).toBe("male");
    });
});
