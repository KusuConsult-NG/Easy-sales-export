/**
 * Admin Page: Orphaned User Management
 * 
 * Provides UI for detecting and repairing orphaned users
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

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
            console.error('Failed to detect orphaned users', error);
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
            console.error('Failed to repair orphaned users', error);
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
            console.error('Failed to repair user', error);
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
                <Button onClick={detectOrphaned} disabled={loading}>
                    {loading ? 'Scanning...' : 'Scan for Orphaned Users'}
                </Button>

                {orphanedUsers.length > 0 && (
                    <Button onClick={repairAll} disabled={repairing} variant="primary">
                        {repairing ? 'Repairing...' : `Repair All (${orphanedUsers.length})`}
                    </Button>
                )}
            </div>

            {results && (
                <Card className="mb-6 p-4 bg-green-50 border-green-200">
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
                </Card>
            )}

            {orphanedUsers.length === 0 && !loading && (
                <Card className="p-6 text-center text-gray-500">
                    No orphaned users detected
                </Card>
            )}

            {orphanedUsers.length > 0 && (
                <div className="space-y-3">
                    {orphanedUsers.map((user) => (
                        <Card key={user.uid} className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="font-mono text-sm text-gray-500">{user.uid}</div>
                                    <div className="font-semibold">{user.displayName || 'No name'}</div>
                                    <div className="text-sm text-gray-600">{user.email || 'No email'}</div>
                                    <div className="text-xs text-gray-400">Created: {user.createdAt}</div>
                                </div>
                                <Button
                                    onClick={() => repairSingle(user.uid)}
                                    disabled={repairing}
                                    size="sm"
                                >
                                    Repair
                                </Button>
                            </div>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
