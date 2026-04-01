const fs = require('fs');
const path = require('path');

const srcAppDir = path.join(process.cwd(), 'src/app');
const inventory = [];

function scanDir(dir) {
    const files = fs.readdirSync(dir);
    
    let hasPage = false;

    files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            scanDir(fullPath);
        } else {
            const ext = path.extname(file);
            if (['.tsx', '.ts'].includes(ext)) {
                if (['page.tsx', 'layout.tsx', 'loading.tsx', 'error.tsx', 'not-found.tsx', 'route.ts'].includes(file)) {
                    if (file === 'page.tsx' || file === 'route.ts') hasPage = true;
                    
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const relativePath = path.relative(srcAppDir, fullPath);
                    const routePath = '/' + path.dirname(relativePath).replace(/\\/g, '/');
                    
                    let routeType = 'Unknown';
                    if (file === 'page.tsx') routeType = 'Page';
                    if (file === 'layout.tsx') routeType = 'Layout';
                    if (file === 'loading.tsx') routeType = 'Loading';
                    if (file === 'error.tsx') routeType = 'Error';
                    if (file === 'not-found.tsx') routeType = 'Not Found';
                    if (file === 'route.ts') routeType = 'API Route';

                    const isDynamic = relativePath.includes('[');
                    if (isDynamic) routeType += ' (Dynamic)';

                    const isRouteGroup = relativePath.includes('(');
                    if (isRouteGroup) routeType += ' (Grouped)';

                    let cleanedRoutePath = routePath.replace(/\/\([^)]+\)/g, ''); // Remove route groups for URL
                    if (cleanedRoutePath === '/.') cleanedRoutePath = '/';

                    const usesServerAction = content.includes('import') && (content.includes('@/app/actions') || content.includes('../actions'));
                    const usesApiRoute = content.includes('fetch(') && content.includes('/api/');
                    const requiresAuth = content.includes('auth()') || content.includes('useSession') || content.includes('withAuth');

                    inventory.push({
                        routePath: cleanedRoutePath,
                        filePath: 'src/app/' + relativePath.replace(/\\/g, '/'),
                        routeType,
                        usesServerAction: usesServerAction ? 'Yes' : 'No',
                        usesApiRoute: usesApiRoute ? 'Yes' : 'No',
                        requiresAuth: requiresAuth ? 'Yes' : 'No'
                    });
                }
            }
        }
    });

    // Check for dead routes (folders with no page.tsx/route.ts but have other things)
    // Only check if it contains layout or something but no page.
    const hasOtherFiles = files.some(f => ['layout.tsx', 'loading.tsx', 'error.tsx'].includes(f));
    if (hasOtherFiles && !hasPage) {
        const relativePath = path.relative(srcAppDir, dir);
        if (relativePath && relativePath !== '.') {
             const routePath = ('/' + relativePath.replace(/\\/g, '/')).replace(/\/\([^)]+\)/g, '');
             inventory.push({
                 routePath: routePath || '/',
                 filePath: 'src/app/' + relativePath.replace(/\\/g, '/'),
                 routeType: 'DEAD ROUTE (Missing Page)',
                 usesServerAction: '-',
                 usesApiRoute: '-',
                 requiresAuth: '-'
             });
        }
    }
}

scanDir(srcAppDir);

let md = `# App Router Route Inventory\n\n`;
md += `| Route Path | File Path | Route Type | Server Action? | API Route? | Requires Auth? |\n`;
md += `|---|---|---|---|---|---|\n`;

inventory.sort((a, b) => a.filePath.localeCompare(b.filePath)).forEach(item => {
    md += `| ${item.routePath} | \`${item.filePath}\` | ${item.routeType} | ${item.usesServerAction} | ${item.usesApiRoute} | ${item.requiresAuth} |\n`;
});

fs.writeFileSync('route_inventory.md', md);
console.log('Inventory saved to route_inventory.md');
