/**
 * MarketplaceRouteGuard
 *
 * Previously redirected authenticated users away from the public Marketplace
 * landing page automatically. This caused a redirect cascade where users could
 * not read or interact with the landing page before being bounced.
 *
 * The guard has been neutralized. Navigation is now user-initiated only.
 * Authenticated users land on the public page and click through intentionally.
 * Protected routes inside /marketplace/(member)/ continue to enforce access
 * via the server-side layout guard.
 */
export default function MarketplaceRouteGuard() {
    return null;
}
