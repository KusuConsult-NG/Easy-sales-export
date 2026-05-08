import os
import re

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions/vendor-dashboard.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Fix _getVendorSalesStatsAction - stats is correct here
# content = content.replace('data: stats', 'data: stats') 

# Fix _getVendorRevenueTrendsAction - trends is correct here
# content = content.replace('data: trends', 'data: trends')

# Fix _getTopSellingProductsAction - should be products
content = content.replace('async function _getTopSellingProductsAction(limit: number = 5) { let sessionResult;\n    try {\n        sessionResult = await requireSession();\n        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error, data: null };\n        const { session } = sessionResult;\n        if (!session?.user?.id) return { success: false as const, error: "Unauthorized", data: null };\n\n        const vendorId = session.user.id;\n        const ordersSnapshot = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)\n            .where("vendorId", "==", vendorId)\n            .where("paymentStatus", "==", "paid")\n            .get();\n\n        const productStats: Record<string, { name: string; sold: number; revenue: number }> = {};\n\n        ordersSnapshot.docs.forEach(doc => { const data = doc.data();\n            const items = data.items || [];\n\n            items.forEach((item: any) => {\n                if (!productStats[item.productId]) {\n                    productStats[item.productId] = {\n                        name: item.productName || "Unknown Product",\n                        sold: 0,\n                        revenue: 0 };\n                }\n\n                productStats[item.productId].sold += item.quantity || 0;\n                productStats[item.productId].revenue += (item.price || 0) * (item.quantity || 0);\n            });\n        });\n\n        const products = Object.entries(productStats)\n            .map(([productId, stats]) => ({ productId,\n                productName: stats.name,\n                totalSold: stats.sold,\n                totalRevenue: stats.revenue }))\n            .sort((a, b) => b.totalRevenue - a.totalRevenue)\n            .slice(0, limit);\n\n        return { success: true as const, error: null, data: stats };', 'async function _getTopSellingProductsAction(limit: number = 5) { let sessionResult;\n    try {\n        sessionResult = await requireSession();\n        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error, data: null };\n        const { session } = sessionResult;\n        if (!session?.user?.id) return { success: false as const, error: "Unauthorized", data: null };\n\n        const vendorId = session.user.id;\n        const ordersSnapshot = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)\n            .where("vendorId", "==", vendorId)\n            .where("paymentStatus", "==", "paid")\n            .get();\n\n        const productStats: Record<string, { name: string; sold: number; revenue: number }> = {};\n\n        ordersSnapshot.docs.forEach(doc => { const data = doc.data();\n            const items = data.items || [];\n\n            items.forEach((item: any) => {\n                if (!productStats[item.productId]) {\n                    productStats[item.productId] = {\n                        name: item.productName || "Unknown Product",\n                        sold: 0,\n                        revenue: 0 };\n                }\n\n                productStats[item.productId].sold += item.quantity || 0;\n                productStats[item.productId].revenue += (item.price || 0) * (item.quantity || 0);\n            });\n        });\n\n        const products = Object.entries(productStats)\n            .map(([productId, stats]) => ({ productId,\n                productName: stats.name,\n                totalSold: stats.sold,\n                totalRevenue: stats.revenue }))\n            .sort((a, b) => b.totalRevenue - a.totalRevenue)\n            .slice(0, limit);\n\n        return { success: true as const, error: null, data: products };')

# Fix _getVendorInventoryStatsAction - should be stats
content = content.replace('        return { error: null, success: true as const, data: trends };', '        return { error: null, success: true as const, data: stats };')

# Fix _getVendorActivityFeedAction - should be activities.slice(0, limit)
content = content.replace('        return { error: null, success: true as const, data: trends };', '        return { error: null, success: true as const, data: activities.slice(0, limit) };')

with open(filepath, 'w') as f:
    f.write(content)

print("Repaired vendor-dashboard.ts again")
