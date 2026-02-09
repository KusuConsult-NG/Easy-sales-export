export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // No sidebar layout - just render children directly for website-style landing page
    return <>{children}</>;
}
