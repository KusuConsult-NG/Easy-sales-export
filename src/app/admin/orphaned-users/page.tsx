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
    // How much of Firebase Auth the last scan actually covered. Without this the
    // screen said "No orphaned users detected" after looking at the first 1,000
    // accounts of 41,105.
    const [scan, setScan] = useState<{ scanned: number; complete: boolean } | null>(null);

    /**
     *   #296 A REFUSAL RENDERED AS A CLEAN BILL OF HEALTH.
     *
     *        /api/admin/orphaned-users answers a non-super-admin with
     *        `{ error: 'Unauthorized' }` and a 403, and any fault with
     *        `{ error }` and a 500. There is no `success` field, so
     *        `response.ok` is the ONLY signal — and none of the three handlers
     *        looked at it.
     *
     *        detectOrphaned did:
     *
     *            const data = await response.json();
     *            setOrphanedUsers(data.users || []);
     *            setScan({ scanned: data.scanned ?? 0,
     *                      complete: data.complete !== false });
     *
     *        On a 403 that is an empty list and `complete: true` — because
     *        `undefined !== false` — so the screen printed
     *
     *            "No orphaned users among all 0 Auth accounts"
     *
     *        An admin whose session had expired, or who lacked the role, was
     *        told the platform was healthy. This screen's own header records
     *        the LAST time it said "no orphaned users" when it had not looked:
     *        that was a partial scan presented as a total. Same sentence, a
     *        different door.
     *
     *        And a throw left the previous list on screen with no message at
     *        all, so a failed rescan after a repair looked like a successful
     *        one.
     *
     *        repairAll rendered the error body as Repair Results — `Total:
     *        undefined, Repaired: undefined` in a green panel — and then
     *        refreshed the list, which came back empty for the same reason,
     *        making a repair that never ran look complete.
     *
     *        repairSingle discarded the response entirely.
     */
    const [error, setError] = useState<string | null>(null);

    /** The one place that turns a Response into either data or a reason. */
    const readJson = async (response: Response): Promise<{ ok: true; data: any } | { ok: false; reason: string }> => {
        let data: any = null;
        try {
            data = await response.json();
        } catch {
            return { ok: false, reason: `The response was not readable (HTTP ${response.status})` };
        }
        if (!response.ok) {
            return { ok: false, reason: String(data?.error || `Request failed (HTTP ${response.status})`) };
        }
        return { ok: true, data };
    };

    const detectOrphaned = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await readJson(await fetch('/api/admin/orphaned-users'));
            if (!result.ok) {
                // Leave the list and the scan summary ALONE. Replacing them
                // with zeroes is what produced "no orphaned users among all 0".
                setError(result.reason);
                return;
            }
            const data = result.data;
            setOrphanedUsers(data.users || []);
            setScan({ scanned: data.scanned ?? 0, complete: data.complete !== false });
        } catch (err) {
            logger.error('Failed to detect orphaned users', err);
            setError(err instanceof Error ? err.message : 'The scan could not be run.');
        } finally {
            setLoading(false);
        }
    };

    const repairAll = async () => {
        if (!confirm(`Repair ${orphanedUsers.length} orphaned users?`)) return;

        setRepairing(true);
        setError(null);
        try {
            const result = await readJson(await fetch('/api/admin/orphaned-users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            }));
            if (!result.ok) {
                setError(result.reason);
                return;
            }
            setResults(result.data);

            // Refresh list
            await detectOrphaned();
        } catch (err) {
            logger.error('Failed to repair orphaned users', err);
            setError(err instanceof Error ? err.message : 'The repair could not be run.');
        } finally {
            setRepairing(false);
        }
    };

    const repairSingle = async (uid: string) => {
        if (!confirm('Repair this user?')) return;

        setRepairing(true);
        setError(null);
        try {
            const result = await readJson(await fetch('/api/admin/orphaned-users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid }),
            }));
            if (!result.ok) {
                setError(result.reason);
                return;
            }

            // Refresh list
            await detectOrphaned();
        } catch (err) {
            logger.error('Failed to repair user', err);
            setError(err instanceof Error ? err.message : 'The repair could not be run.');
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
                    {results.complete === false && (
                        <p className="mt-2 text-sm text-amber-800">
                            Partial: {results.scanned?.toLocaleString()} Auth accounts were scanned and
                            there are more. Run again with the returned pageToken to continue.
                        </p>
                    )}
                    {results.errors?.length > 0 && (
                        <details className="mt-2">
                            <summary className="cursor-pointer text-red-600">Show Errors</summary>
                            <pre className="mt-2 text-xs">{JSON.stringify(results.errors, null, 2)}</pre>
                        </details>
                    )}
                </div>
            )}

            {scan && !scan.complete && (
                <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-md text-sm">
                    <h3 className="font-semibold mb-1">This is a partial scan</h3>
                    <p className="text-amber-900">
                        {scan.scanned.toLocaleString()} Firebase Auth accounts were checked, and there
                        are more. Anything below — including <strong>Repair All</strong> — covers only
                        those accounts. Continue with{' '}
                        <code className="font-mono">?pageToken=</code> from the API response.
                    </p>
                </div>
            )}

            {/* #296. A failure is not a result. */}
            {error && (
                <div role="alert" className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-md">
                    <h3 className="font-semibold text-rose-900">The scan did not run</h3>
                    <p className="mt-1 text-sm text-rose-800">{error}</p>
                    <p className="mt-1 text-xs text-rose-700">
                        Nothing below reflects this attempt — it is whatever the last successful scan
                        found, or nothing at all.
                    </p>
                </div>
            )}

            {orphanedUsers.length === 0 && !loading && !error && (
                <div className="p-6 text-center text-gray-500 bg-white border border-gray-200 rounded-md">
                    {scan
                        ? scan.complete
                            ? `No orphaned users among all ${scan.scanned.toLocaleString()} Auth accounts`
                            : `None among the ${scan.scanned.toLocaleString()} accounts scanned so far`
                        : 'No orphaned users detected'}
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
