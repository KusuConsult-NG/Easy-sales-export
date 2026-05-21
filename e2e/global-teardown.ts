import { FullConfig } from '@playwright/test';

/**
 * Playwright Global Teardown
 *
 * Runs ONCE after all e2e tests complete. Currently a no-op placeholder
 * since test users are intentionally persistent across runs (to avoid
 * the cost of re-creating them on every CI run).
 *
 * If you need to clean up test data between runs, add cleanup logic here.
 * Example: delete Firestore docs created during tests, reset user state.
 */
export default async function globalTeardown(config: FullConfig) {
    console.log('\n🧹 Playwright Global Teardown complete (test users preserved for reuse)\n');
}
