/**
 * Admin Page: Orphaned User Management
 * 
 * Provides UI for detecting and repairing orphaned users
 */

'use client';

import { useState } from 'react';
import { logger } from '@/lib/logger';

interface OrphanedUser {
    uid: string;
    email?: string;
    displayName?: string;
    createdAt: string;
}

export default function OrphanedUsersPage() {
    const [orphanedUsers, setOrphanedUsers] = useState<OrphanedUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [repairing, setRepairing] = useState(false);
    const [results, setResults] = useState<any>(null);

    const detectOrphaned = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/admin/orphaned-users');
            const data = await response.json();
            setOrphanedUsers(data.users || []);
        } catch (error) {
            logger.error('Failed to detect orphaned users', error);
        } finally {
            setLoading(false);
        }
    };

    const repairAll = async () => {
        if (!confirm(`Repair ${orphanedUsers.length} orphaned users?`)) return;

        setRepairing(true);
        try {
            const response = await fetch('/api/admin/orphaned-users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const data = await response.json();
            setResults(data);

            // Refresh list
            await detectOrphaned();
        } catch (error) {
            logger.error('Failed to repair orphaned users', error);
        } finally {
            setRepairing(false);
        }
    };

    const repairSingle = async (uid: string) => {
        if (!confirm('Repair this user?')) return;

        setRepairing(true);
        try {
            const response = await fetch('/api/admin/orphaned-users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid }),
            });
            await response.json();

            // Refresh list
            await detectOrphaned();
        } catch (error) {
            logger.error('Failed to repair user', error);
        } finally {
            setRepairing(false);
        }
    };

    return (
        <div className="container mx-auto p-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold mb-2">Orphaned User Management</h1>
                <p className="text-gray-600">
                    Detect and repair users who exist in Firebase Auth but are missing Firestore profiles
                </p>
            </div>

            <div className="flex gap-4 mb-6">
                <button
                    onClick={detectOrphaned}
                    disabled={loading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading ? 'Scanning...' : 'Scan for Orphaned Users'}
                </button>

                {orphanedUsers.length > 0 && (
                    <button
                        onClick={repairAll}
                        disabled={repairing}
                        className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {repairing ? 'Repairing...' : `Repair All (${orphanedUsers.length})`}
                    </button>
                )}
            </div>

            {results && (
                <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-md">
                    <h3 className="font-semibold mb-2">Repair Results</h3>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>Total: {results.total}</div>
                        <div className="text-green-600">Repaired: {results.repaired}</div>
                        <div className="text-red-600">Failed: {results.failed}</div>
                    </div>
                    {results.errors?.length > 0 && (
                        <details className="mt-2">
                            <summary className="cursor-pointer text-red-600">Show Errors</summary>
                            <pre className="mt-2 text-xs">{JSON.stringify(results.errors, null, 2)}</pre>
                        </details>
                    )}
                </div>
            )}

            {orphanedUsers.length === 0 && !loading && (
                <div className="p-6 text-center text-gray-500 bg-white border border-gray-200 rounded-md">
                    No orphaned users detected
                </div>
            )}

            {orphanedUsers.length > 0 && (
                <div className="space-y-3">
                    {orphanedUsers.map((user) => (
                        <div key={user.uid} className="p-4 bg-white border border-gray-200 rounded-md">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="font-mono text-sm text-gray-500">{user.uid}</div>
                                    <div className="font-semibold">{user.displayName || 'No name'}</div>
                                    <div className="text-sm text-gray-600">{user.email || 'No email'}</div>
                                    <div className="text-xs text-gray-400">Created: {user.createdAt}</div>
                                </div>
                                <button
                                    onClick={() => repairSingle(user.uid)}
                                    disabled={repairing}
                                    className="px-3 py-1 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Repair
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
