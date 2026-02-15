import { NextResponse } from "next/server";
import { logger } from '@/lib/logger';

/**
 * Marketplace Products API
 * Returns agricultural products for sale
 */

export interface MarketplaceProduct {
    id: string;
    name: string;
    description: string;
    category: string;
    price: number;
    unit: string;
    inStock: boolean;
    quantity: number;
    images: string[];
    sellerId: string;
    sellerName: string;
    sellerLocation: string;
    rating: number;
    reviews: number;
    verified: boolean;
}

// Mock products for development
const mockProducts: MarketplaceProduct[] = [
    {
        id: "1",
        name: "Premium Cashew Nuts",
        description: "High-quality cashew nuts from Kogi state. Freshly harvested and processed with strict quality control.",
        category: "nuts",
        price: 8500,
        unit: "kg",
        inStock: true,
        quantity: 500,
        images: ["/images/logo.jpg"],
        sellerId: "seller-1",
        sellerName: "Adebayo Farms",
        sellerLocation: "Kogi State",
        rating: 4.8,
        reviews: 127,
        verified: true,
    },
    {
        id: "2",
        name: "Organic Shea Butter",
        description: "Pure unrefined shea butter from Northern Nigeria. Perfect for cosmetics and skincare products.",
        category: "cosmetics",
        price: 12000,
        unit: "kg",
        inStock: true,
        quantity: 200,
        images: ["/images/logo.jpg"],
        sellerId: "seller-2",
        sellerName: "Zainab Exports",
        sellerLocation: "Kaduna State",
        rating: 4.9,
        reviews: 89,
        verified: true,
    },
    {
        id: "3",
        name: "Dried Hibiscus Flowers (Zobo)",
        description: "Premium quality dried hibiscus flowers. Rich in antioxidants and perfect for beverages.",
        category: "herbs",
        price: 3500,
        unit: "kg",
        inStock: true,
        quantity: 1000,
        images: ["/images/logo.jpg"],
        sellerId: "seller-3",
        sellerName: "Northern Agro",
        sellerLocation: "Kano State",
        rating: 4.7,
        reviews: 156,
        verified: true,
    },
    {
        id: "4",
        name: "Fresh Ginger Roots",
        description: "Fresh ginger roots harvested this season. High oil content and strong aroma.",
        category: "spices",
        price: 4200,
        unit: "kg",
        inStock: true,
        quantity: 800,
        images: ["/images/logo.jpg"],
        sellerId: "seller-4",
        sellerName: "Plateau Harvest",
        sellerLocation: "Plateau State",
        rating: 4.6,
        reviews: 95,
        verified: false,
    },
    {
        id: "5",
        name: "Raw Honey",
        description: "Pure natural honey from Oyo state. No additives or preservatives. Rich golden color.",
        category: "honey",
        price: 6500,
        unit: "liter",
        inStock: true,
        quantity: 150,
        images: ["/images/logo.jpg"],
        sellerId: "seller-5",
        sellerName: "Honey Haven",
        sellerLocation: "Oyo State",
        rating: 4.9,
        reviews: 203,
        verified: true,
    },
    {
        id: "6",
        name: "Dried Tiger Nuts",
        description: "Premium quality tiger nuts. Rich in fiber and perfect for making tiger nut milk.",
        category: "nuts",
        price: 5000,
        unit: "kg",
        inStock: true,
        quantity: 600,
        images: ["/images/logo.jpg"],
        sellerId: "seller-6",
        sellerName: "Delta Produce",
        sellerLocation: "Delta State",
        rating: 4.5,
        reviews: 72,
        verified: true,
    },
    {
        id: "7",
        name: "Palm Kernel Oil",
        description: "Pure palm kernel oil extracted using traditional methods. Ideal for cooking and industrial use.",
        category: "oils",
        price: 15000,
        unit: "25L",
        inStock: true,
        quantity: 100,
        images: ["/images/logo.jpg"],
        sellerId: "seller-7",
        sellerName: "Rivers Palm Ltd",
        sellerLocation: "Rivers State",
        rating: 4.8,
        reviews: 134,
        verified: true,
    },
    {
        id: "8",
        name: "Sesame Seeds",
        description: "High-grade white sesame seeds. Cleaned and ready for export or local processing.",
        category: "seeds",
        price: 7800,
        unit: "kg",
        inStock: false,
        quantity: 0,
        images: ["/images/logo.jpg"],
        sellerId: "seller-8",
        sellerName: "Benue Seeds Co",
        sellerLocation: "Benue State",
        rating: 4.7,
        reviews: 98,
        verified: true,
    },
    {
        id: "9",
        name: "Dried Pepper (Ata Rodo)",
        description: "Spicy dried red peppers. Perfect for making pepper sauce and spice blends.",
        category: "spices",
        price: 9000,
        unit: "kg",
        inStock: true,
        quantity: 400,
        images: ["/images/logo.jpg"],
        sellerId: "seller-9",
        sellerName: "Lagos Spice Hub",
        sellerLocation: "Lagos State",
        rating: 4.6,
        reviews: 112,
        verified: false,
    },
    {
        id: "10",
        name: "Moringa Leaf Powder",
        description: "100% organic moringa leaf powder. Rich in vitamins and minerals. Perfect for health supplements.",
        category: "herbs",
        price: 18000,
        unit: "kg",
        inStock: true,
        quantity: 80,
        images: ["/images/logo.jpg"],
        sellerId: "seller-10",
        sellerName: "Green Life Organics",
        sellerLocation: "Ogun State",
        rating: 4.9,
        reviews: 167,
        verified: true,
    },
];

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const category = searchParams.get("category");
        const search = searchParams.get("search");
        const minPrice = searchParams.get("minPrice");
        const maxPrice = searchParams.get("maxPrice");

        let products = [...mockProducts];

        // Apply filters
        if (category && category !== "all") {
            products = products.filter(p => p.category === category);
        }

        if (search) {
            const searchLower = search.toLowerCase();
            products = products.filter(p =>
                p.name.toLowerCase().includes(searchLower) ||
                p.description.toLowerCase().includes(searchLower) ||
                p.sellerName.toLowerCase().includes(searchLower)
            );
        }

        if (minPrice) {
            products = products.filter(p => p.price >= parseInt(minPrice));
        }

        if (maxPrice) {
            products = products.filter(p => p.price <= parseInt(maxPrice));
        }

        return NextResponse.json({
            success: true,
            products,
            total: products.length,
        });
    } catch (error: any) {
        logger.error("Marketplace products API error:", error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
