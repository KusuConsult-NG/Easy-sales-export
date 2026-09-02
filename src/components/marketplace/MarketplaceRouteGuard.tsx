/**
 * MarketplaceRouteGuard
 *
 * Previously redirected authenticated users away from the public Marketplace
 * landing page automatically. This caused a redirect cascade where users could
 * not read or interact with the landing page before being bounced.
 *
 * The guard has been neutralized. Navigation is now user-initiated only.
 * Authenticated users land on the public page and click through intentionally.
 *
 * #337. This used to say access was still enforced "inside
 * /marketplace/(member)/". THERE IS NO (member) SEGMENT under /marketplace —
 * so anyone checking whether the marketplace was still protected would look
 * for that route group, fail to find it, and be left with a neutralized guard
 * and no visible replacement.
 *
 * The enforcement is real, and it is in two server layouts that DO exist:
 *
 *   marketplace/seller/layout.tsx  requireHubRegistration, then
 *                                  checkModuleAccess(..., "marketplace"), then
 *                                  the seller's approval status — redirecting
 *                                  to onboarding/pending/rejected. Fails CLOSED
 *                                  on a database error.
 *   marketplace/buyer/layout.tsx   requireHubRegistration, then
 *                                  checkModuleAccess. Fails CLOSED to
 *                                  /auth/login.
 *
 * Named here because a comment that points at a path which does not exist is
 * indistinguishable from one that points at nothing.
 */
export default function MarketplaceRouteGuard() {
    return null;
}
