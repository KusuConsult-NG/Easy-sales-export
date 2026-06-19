/**
 * Village Market Event Detail Page
 * /marketplace/village-market/[id]
 *
 * Shows products and merchants for a specific event
 */

"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";
import {
    MapPin, Clock, Zap, Users, ExternalLink, ShoppingBag,
    ArrowLeft, Loader2, Camera, X,
} from "lucide-react";
import {
    getVillageMarketEventAction,
    joinVillageMarketEventAction,
    addFlashSaleProductAction,
} from "@/app/actions/village-market";
import type { VillageMarketEvent, FlashSaleProduct, ExternalMerchant } from "@/lib/types/marketplace";
import { useToast } from "@/contexts/ToastContext";
import { formatCurrency } from "@/lib/utils";

const fmtDate = (val: any) => {
    if (!val) return "—";
    const d = val?.toDate ? val.toDate() : new Date(val);
    return new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(d);
};

function isEventLive(event: VillageMarketEvent) {
    const now = new Date();
    const start = (event.startTime as any)?.toDate ? (event.startTime as any).toDate() : new Date(event.startTime as any);
    const end = (event.endTime as any)?.toDate ? (event.endTime as any).toDate() : new Date(event.endTime as any);
    return now >= start && now <= end;
}

export default function VillageMarketEventPage() {
    const params = useParams();
    const router = useRouter();
    const { showToast } = useToast();
    const eventId = params.id as string;
    const { data: session } = useSession();

    const [event, setEvent] = useState<VillageMarketEvent | null>(null);
    const [products, setProducts] = useState<FlashSaleProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [joining, setJoining] = useState(false);
    const [showAddProduct, setShowAddProduct] = useState(false);
    const [addingProduct, setAddingProduct] = useState(false);
    const [customUnit, setCustomUnit] = useState("");
    const [productForm, setProductForm] = useState({ title: "", price: "", flashPrice: "", unit: "Kwanu", availableQuantity: "" });
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);

    async function loadEvent() {
        setLoading(true);
        const res = await getVillageMarketEventAction(eventId);
        setEvent(res.event);
        setProducts(res.products);
        setLoading(false);
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { loadEvent(); }, [eventId]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setImagePreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleClearImage = () => {
        setSelectedFile(null);
        setImagePreview(null);
    };

    const handleBuyProduct = (p: FlashSaleProduct) => {
        try {
            const userId = session?.user?.id;
            const cartKey = userId ? `marketplace_cart_${userId}` : "marketplace_cart";
            
            const savedCart = localStorage.getItem(cartKey);
            const cart: any[] = savedCart ? JSON.parse(savedCart) : [];

            const existingItemIndex = cart.findIndex(item => item.id === p.id);

            if (existingItemIndex > -1) {
                cart[existingItemIndex].quantity += 1;
            } else {
                cart.push({
                    id: p.id,
                    title: p.title,
                    description: p.description || "",
                    sellerId: p.sellerId,
                    images: p.imageUrl ? [p.imageUrl] : [],
                    pricingTiers: [{ type: "retail", price: p.flashPrice || p.price, minQuantity: 1 }],
                    availableQuantity: p.availableQuantity ?? 999,
                    unit: p.unit || "unit",
                    location: {
                        state: event?.state || "Nigeria",
                        lga: event?.lga || "",
                    },
                    status: "active",
                    isFlashSale: true,
                    eventId: p.eventId,
                    originalPrice: p.price,
                    flashPrice: p.flashPrice,
                    quantity: 1
                });
            }

            localStorage.setItem(cartKey, JSON.stringify(cart));
            showToast("Added to checkout cart!", "success");
            router.push("/marketplace/checkout");
        } catch (err) {
            showToast("Failed to add product to checkout", "error");
        }
    };

    async function handleJoin() {
        setJoining(true);
        const res = await joinVillageMarketEventAction(eventId);
        setJoining(false);
        if (res.success) {
            showToast("You've joined this Village Market event!", "success");
            const currentUserId = (session?.user as any)?.id || session?.user?.id;
            if (currentUserId) {
                setEvent(prev => {
                    if (!prev) return null;
                    const ids = prev.participantSellerIds || [];
                    return {
                        ...prev,
                        participantSellerIds: ids.includes(currentUserId) ? ids : [...ids, currentUserId]
                    };
                });
            }
            loadEvent();
        } else {
            showToast(res.error || "Failed to join event", "error");
        }
    };

    async function handleAddProduct() {
        if (!productForm.title || !productForm.price) return showToast("Title and price are required", "error");
        setAddingProduct(true);
        
        let uploadedUrl: string | undefined = undefined;
        if (selectedFile) {
            try {
                const formData = new FormData();
                formData.append("file", selectedFile);
                formData.append("folder", "flash-sale-products");
                formData.append("documentType", "product-image");
                
                const uploadRes = await fetch("/api/upload", {
                    method: "POST",
                    body: formData
                });
                
                if (!uploadRes.ok) {
                    throw new Error("Failed to upload image to service");
                }
                
                const uploadData = await uploadRes.json();
                if (uploadData.success && uploadData.url) {
                    uploadedUrl = uploadData.url;
                } else {
                    throw new Error(uploadData.error || "Failed to upload image");
                }
            } catch (err: any) {
                setAddingProduct(false);
                return showToast(err.message || "Failed to upload product image", "error");
            }
        }

        const finalUnit = productForm.unit === "other units" ? customUnit : productForm.unit;
        const res = await addFlashSaleProductAction({
            eventId,
            title: productForm.title,
            price: Number(productForm.price),
            flashPrice: productForm.flashPrice ? Number(productForm.flashPrice) : undefined,
            unit: finalUnit || undefined,
            availableQuantity: productForm.availableQuantity ? Number(productForm.availableQuantity) : undefined,
            imageUrl: uploadedUrl,
        });
        setAddingProduct(false);
        if (res.success) {
            showToast("Product listed for this event!", "success");
            setShowAddProduct(false);
            setProductForm({ title: "", price: "", flashPrice: "", unit: "Kwanu", availableQuantity: "" });
            setCustomUnit("");
            setSelectedFile(null);
            setImagePreview(null);
            loadEvent();
        } else {
            showToast(res.error || "Failed to add product", "error");
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
            </div>
        );
    }

    if (!event) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
                <p className="text-slate-500 text-lg">Event not found</p>
                <Link href="/marketplace/village-market" className="text-emerald-600 font-semibold hover:underline">← Back to Village Market</Link>
            </div>
        );
    }

    const live = isEventLive(event);
    const userId = (session?.user as any)?.id || session?.user?.id;
    const hasJoined = !!(userId && event.participantSellerIds?.includes(userId));

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className={`relative overflow-hidden text-white ${live ? "bg-linear-to-br from-green-600 to-emerald-700" : "bg-linear-to-br from-slate-700 to-slate-800"}`}>
                <div className="max-w-5xl mx-auto px-6 py-10">
                    <Link href="/marketplace/village-market" className="inline-flex items-center gap-1.5 text-white/70 hover:text-white text-sm mb-6 transition">
                        <ArrowLeft className="w-4 h-4" /> Back to Village Market
                    </Link>

                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                            {live && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-yellow-400 text-yellow-900 text-xs font-bold rounded-full mb-3 animate-pulse">
                                    <Zap className="w-3 h-3" /> LIVE NOW
                                </span>
                            )}
                            <h1 className="text-3xl font-extrabold mb-2">{event.title}</h1>
                            {event.description && <p className="text-white/80 max-w-xl">{event.description}</p>}
                        </div>
                        <button
                            onClick={handleJoin}
                            disabled={joining || hasJoined}
                            className={`px-5 py-2.5 font-bold rounded-xl transition shadow flex items-center gap-2 shrink-0 ${
                                hasJoined
                                    ? "bg-emerald-100 text-emerald-800 cursor-default shadow-none"
                                    : "bg-white text-emerald-700 hover:bg-emerald-50"
                            }`}
                        >
                            {joining ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : hasJoined ? (
                                <span className="flex items-center gap-1">✓ Joined</span>
                            ) : (
                                <Users className="w-4 h-4" />
                            )}
                            {!joining && !hasJoined && "Join as Seller"}
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-4 mt-6 text-white/80 text-sm">
                        <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" />{event.location}, {event.state}</span>
                        <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" />{fmtDate(event.startTime)} — {fmtDate(event.endTime)}</span>
                        <span className="flex items-center gap-1.5"><Users className="w-4 h-4" />{event.participantSellerIds?.length || 0} sellers joined</span>
                    </div>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-6 py-8">
                {/* Add Product Banner */}
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-8 flex items-center justify-between gap-4 flex-wrap">
                    <div>
                        <p className="font-semibold text-emerald-900">Are you participating in this event?</p>
                        <p className="text-sm text-emerald-700">List your products to appear in this flash sale.</p>
                    </div>
                    <button
                        onClick={() => setShowAddProduct(true)}
                        className="px-4 py-2 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition text-sm flex items-center gap-2"
                    >
                        <ShoppingBag className="w-4 h-4" /> Add Product
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Flash Sale Products */}
                    <div className="lg:col-span-2">
                        <h2 className="text-xl font-bold text-slate-900 mb-4">Flash Sale Products</h2>
                        {products.length === 0 ? (
                            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                                <ShoppingBag className="w-14 h-14 text-slate-300 mx-auto mb-3" />
                                <p className="text-slate-500">No products listed yet for this event</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {products.map((p) => (
                                    <div key={p.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-md transition">
                                        <Link href={`/marketplace/products/${p.id}`} className="block h-36 bg-slate-100 relative overflow-hidden">
                                            {p.imageUrl ? (
                                                <Image src={p.imageUrl} alt={p.title} fill sizes="300px" className="object-cover hover:scale-105 transition duration-300" />
                                            ) : (
                                                <div className="w-full h-full bg-linear-to-br from-slate-100 to-slate-200/60 flex flex-col items-center justify-center gap-2 select-none">
                                                    <div className="w-12 h-12 bg-white/80 rounded-full flex items-center justify-center shadow-xs">
                                                        <Camera className="w-5 h-5 text-slate-400" />
                                                    </div>
                                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">No Image</span>
                                                </div>
                                            )}
                                        </Link>
                                        <div className="p-4">
                                            <Link href={`/marketplace/products/${p.id}`}>
                                                <h3 className="font-bold text-slate-900 text-sm mb-1 line-clamp-1 hover:text-red-600 transition-colors">{p.title}</h3>
                                            </Link>
                                            <div className="flex items-center gap-2">
                                                {p.flashPrice ? (
                                                    <>
                                                        <span className="text-red-600 font-bold">{formatCurrency(p.flashPrice)}</span>
                                                        <span className="text-slate-400 text-xs line-through">{formatCurrency(p.price)}</span>
                                                        <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-xs font-bold rounded">FLASH</span>
                                                    </>
                                                ) : (
                                                    <span className="text-slate-900 font-bold">{formatCurrency(p.price)}</span>
                                                )}
                                                {p.unit && <span className="text-xs text-slate-400">/ {p.unit}</span>}
                                            </div>
                                            {p.availableQuantity != null && (
                                                <p className="text-xs text-slate-400 mt-1">{p.availableQuantity} available</p>
                                            )}
                                            <button
                                                onClick={() => handleBuyProduct(p)}
                                                className="mt-3 w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition shadow-sm"
                                            >
                                                <Zap className="w-3.5 h-3.5" /> Buy Now
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* External Merchants */}
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 mb-4">Market Merchants</h2>
                        {!event.externalMerchants || event.externalMerchants.length === 0 ? (
                            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
                                <ExternalLink className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                                <p className="text-slate-500 text-sm">No external merchants for this event</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {event.externalMerchants.map((m: ExternalMerchant) => (
                                    <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-4">
                                        <div className="flex items-start gap-3">
                                            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0 text-amber-700 font-bold text-sm">
                                                {m.displayName.charAt(0)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h3 className="font-bold text-slate-900 text-sm">{m.displayName}</h3>
                                                {m.businessName && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{m.businessName}</p>}
                                                {m.productsDescription && <p className="text-xs text-emerald-700 mt-1 font-medium">{m.productsDescription}</p>}
                                                {m.phone && (
                                                    <a href={`tel:${m.phone}`} className="text-xs text-blue-600 hover:underline mt-1 block">{m.phone}</a>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Add Product Modal */}
            {showAddProduct && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowAddProduct(false)}>
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-xl font-bold text-slate-900 mb-5">List a Flash Sale Product</h3>
                        <div className="space-y-4">
                            {[
                                { label: "Product Title *", key: "title", placeholder: "e.g. Fresh Tomatoes" },
                                { label: "Regular Price (₦) *", key: "price", placeholder: "e.g. 3000", type: "number" },
                                { label: "Flash Sale Price (₦)", key: "flashPrice", placeholder: "Lower than regular price", type: "number" },
                            ].map(({ label, key, placeholder, type = "text" }) => (
                                <div key={key}>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
                                    <input
                                        type={type}
                                        value={productForm[key as keyof typeof productForm]}
                                        onChange={(e) => setProductForm(f => ({ ...f, [key]: e.target.value }))}
                                        placeholder={placeholder}
                                        className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                                    />
                                </div>
                            ))}

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Unit *</label>
                                <select
                                    value={productForm.unit}
                                    onChange={(e) => setProductForm(f => ({ ...f, unit: e.target.value }))}
                                    className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white outline-none"
                                >
                                    {[
                                        "Kwanu",
                                        "mudu/darica",
                                        "basket(small)",
                                        "basket(medium)",
                                        "basket(big)",
                                        "small painter bucket",
                                        "big painter bucket",
                                        "small carton",
                                        "big carton",
                                        "other units"
                                    ].map(u => (
                                        <option key={u} value={u}>{u}</option>
                                    ))}
                                </select>
                                {productForm.unit === "other units" && (
                                    <input
                                        type="text"
                                        value={customUnit}
                                        onChange={(e) => setCustomUnit(e.target.value)}
                                        placeholder="Enter custom unit"
                                        className="mt-2 w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                                    />
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Available Quantity</label>
                                <input
                                    type="number"
                                    value={productForm.availableQuantity}
                                    onChange={(e) => setProductForm(f => ({ ...f, availableQuantity: e.target.value }))}
                                    placeholder="e.g. 50"
                                    className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Product Image</label>
                                {imagePreview ? (
                                    <div className="relative h-44 w-full rounded-xl overflow-hidden border border-slate-200 shadow-sm">
                                        <Image src={imagePreview} alt="Preview" fill className="object-cover" />
                                        <button
                                            type="button"
                                            onClick={handleClearImage}
                                            className="absolute top-2.5 right-2.5 p-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full transition shadow-md hover:scale-105"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <label className="border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition bg-slate-50 hover:bg-emerald-50/20 group">
                                        <Camera className="w-8 h-8 text-slate-400 mb-2 group-hover:text-emerald-500 transition" />
                                        <span className="text-sm font-medium text-slate-600 group-hover:text-emerald-600 transition">Click to upload image</span>
                                        <span className="text-xs text-slate-400 mt-1">PNG, JPG up to 5MB</span>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            onChange={handleFileChange}
                                            className="hidden"
                                        />
                                    </label>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-3 mt-6">
                            <button onClick={() => setShowAddProduct(false)} className="flex-1 py-3 border border-slate-300 rounded-xl text-slate-700 font-semibold hover:bg-slate-50 transition">Cancel</button>
                            <button
                                onClick={handleAddProduct}
                                disabled={addingProduct}
                                className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {addingProduct ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingBag className="w-4 h-4" />}
                                List Product
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
