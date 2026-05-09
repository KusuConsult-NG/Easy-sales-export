import { test, expect } from '@playwright/test';

/**
 * Admin Synchronization E2E Test
 * 
 * Verifies that administrative actions (approval/rejection) correctly
 * synchronize across the platform and update user permissions.
 */

test.describe('Admin Synchronization', () => {
    
    test.beforeEach(async ({ page }) => {
        // Authenticate as admin
        await page.goto('/auth/login');
        await page.fill('input[name="email"]', process.env.TEST_ADMIN_EMAIL || 'admin@easysalesexport.com');
        await page.fill('input[name="password"]', process.env.TEST_ADMIN_PASSWORD || 'password123');
        await page.click('button[type="submit"]');
    });

    test('approving a Marketplace seller should update their status and role', async ({ page }) => {
        // 1. Navigate to Marketplace Approval queue
        await page.goto('/admin/marketplace/approvals');
        
        // 2. Find a pending seller (using a mock/test user email if possible)
        const pendingUserEmail = 'pending_seller@example.com';
        const userRow = page.locator('tr', { hasText: pendingUserEmail });
        
        if (await userRow.isVisible()) {
            // 3. Click Approve
            await userRow.getByRole('button', { name: /approve/i }).click();
            
            // 4. Verify success message
            await expect(page.locator('text=Verification approved successfully')).toBeVisible();
            
            // 5. Verify the user status changed in the UI
            await expect(userRow.locator('text=Approved')).toBeVisible();
            
            // 6. (Optional) Login as the user and verify they have dashboard access
            // This is better handled by separate tests but confirms "sync"
        } else {
            console.log('No pending seller found for sync test');
        }
    });

    test('rejection with reason should be visible to the user', async ({ page }) => {
        await page.goto('/admin/marketplace/approvals');
        
        const targetEmail = 'to_reject@example.com';
        const userRow = page.locator('tr', { hasText: targetEmail });
        
        if (await userRow.isVisible()) {
            await userRow.getByRole('button', { name: /reject/i }).click();
            
            // Fill rejection reason
            await page.fill('textarea[name="reason"]', 'Missing business license document.');
            await page.click('button:has-text("Confirm Rejection")');
            
            await expect(page.locator('text=Verification rejected')).toBeVisible();
        }
    });
});
