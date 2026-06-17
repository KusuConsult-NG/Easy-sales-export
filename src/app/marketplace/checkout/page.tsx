"use client";

import { useState, useEffect, useRef } from "react";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { ShoppingCart, CreditCard, ArrowLeft, Loader2, CheckCircle, X, Store, Plus, Minus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { MarketplaceErrorBoundary } from "@/components/marketplace/MarketplaceErrorBoundary";
import { initializeOrderPaymentAction, calculateDeliveryAction } from "@/app/actions/marketplace";
import { useToast } from "@/contexts/ToastContext";
import PhoneInput, { isValidNigerianPhone } from "@/components/ui/PhoneInput";
import type { Product, CartItem } from "@/lib/types/marketplace";
import { NIGERIAN_LOCATIONS } from "@/lib/locations";
import { getUserProfileAction } from "@/app/actions/profile";

// Disable static generation for this page - must be client-only due to Paystack
export const dynamic = 'force-dynamic';

interface LocalCartItem extends Product {
    quantity: number;
}

function estimateCartWeight(items: any[]): number {
    return items.reduce((total, item) => {
        const unit = (item.unit || "").toLowerCase().trim();
        let itemWeight = 1; // Default to 1kg per item unit if not specified
        if (unit === "kg") {
            itemWeight = 1;
        } else if (unit === "ton" || unit === "tonne" || unit === "tons" || unit === "tonnes") {
            itemWeight = 1000;
        } else if (unit.includes("50kg")) {
            itemWeight = 50;
        } else if (unit.includes("25kg")) {
            itemWeight = 25;
        } else if (unit.includes("10kg")) {
            itemWeight = 10;
        } else if (unit.includes("5kg")) {
            itemWeight = 5;
        } else if (unit.includes("bag")) {
            itemWeight = 50;
        }
        return total + (itemWeight * item.quantity);
    }, 0);
}

export default function CheckoutPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const { showToast } = useToast();
    const [cart, setCart] = useState<LocalCartItem[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<"paystack">("paystack");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [phoneError, setPhoneError] = useState<string>("");
    
    const [recipientName, setRecipientName] = useState("");
    const [deliveryAddress, setDeliveryAddress] = useState({
        street: "",
        city: "",
        state: "",
        lga: "",
    });
    const [distance, setDistance] = useState<number>(10);
    const [weight, setWeight] = useState<number>(0);
    const [isWithinCityCenter, setIsWithinCityCenter] = useState<boolean>(true);
    const [savedAddress, setSavedAddress] = useState<{
        street: string;
        city: string;
        state: string;
        lga: string;
    } | null>(null);

    const [deliveryFee, setDeliveryFee] = useState<number>(0);
    const [isCalculatingFee, setIsCalculatingFee] = useState(true);
    const [isClient, setIsClient] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [isAddressVerified, setIsAddressVerified] = useState(false);
    const [isGeocoding, setIsGeocoding] = useState(false);
    const [verificationError, setVerificationError] = useState<string | null>(null);

    const [mapsLoaded, setMapsLoaded] = useState(false);
    const [productCoords, setProductCoords] = useState<Record<string, { lat: number; lng: number }>>({});
    const [destinationCoords, setDestinationCoords] = useState<{ lat: number; lng: number } | null>(null);

    const calculateHaversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
        const R = 6371; // Radius of the Earth in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const d = R * c;
        return Math.round(d * 10) / 10; // Round to 1 decimal place
    };

    // Geocode product locations when maps script loads and cart changes
    useEffect(() => {
        if (!isClient || !mapsLoaded || !(window as any).google || cart.length === 0) return;

        const geocoder = new (window as any).google.maps.Geocoder();
        const newCoords = { ...productCoords };
        let updated = false;

        const geocodePromises = cart.map((item) => {
            const locKey = `${item.location?.lga || ""}, ${item.location?.state || ""}`.trim();
            if (!locKey || productCoords[item.id]) return Promise.resolve();

            const addressStr = `${item.location?.lga ? item.location.lga + ", " : ""}${item.location?.state || ""}, Nigeria`;
            
            return new Promise<void>((resolve) => {
                geocoder.geocode({ address: addressStr, componentRestrictions: { country: "ng" } }, (results: any, status: any) => {
                    if (status === "OK" && results && results[0] && results[0].geometry) {
                        const loc = results[0].geometry.location;
                        newCoords[item.id] = { lat: loc.lat(), lng: loc.lng() };
                        updated = true;
                    } else {
                        console.error(`Geocoding failed for product ${item.id} (${addressStr}):`, status);
                    }
                    resolve();
                });
            });
        });

        Promise.all(geocodePromises).then(() => {
            if (updated) {
                setProductCoords(newCoords);
            }
        });
    }, [mapsLoaded, cart, isClient, productCoords]);

    // Initialize Google Places Autocomplete
    useEffect(() => {
        if (!mapsLoaded || !(window as any).google) return;

        const inputEl = document.getElementById("delivery-street-input") as HTMLInputElement;
        if (!inputEl) return;

        const autocomplete = new (window as any).google.maps.places.Autocomplete(inputEl, {
            componentRestrictions: { country: "ng" },
            fields: ["address_components", "geometry"],
        });

        autocomplete.addListener("place_changed", () => {
            const place = autocomplete.getPlace();
            if (!place.geometry || !place.geometry.location) {
                showToast("No geometry details available for the selected place.", "warning");
                return;
            }

            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();
            setDestinationCoords({ lat, lng });
            setIsAddressVerified(true);
            setVerificationError(null);
            
            // Extract address components
            let street = "";
            let city = "";
            let state = "";
            let lga = "";

            const components = place.address_components || [];
            
            components.forEach((c: any) => {
                const types = c.types;
                if (types.includes("street_number")) {
                    street = c.long_name + " " + street;
                } else if (types.includes("route")) {
                    street = street + c.long_name;
                } else if (types.includes("locality") || types.includes("sublocality")) {
                    city = c.long_name;
                } else if (types.includes("administrative_area_level_1")) {
                    state = c.long_name.replace(/\s*state$/i, "").trim();
                } else if (types.includes("administrative_area_level_2")) {
                    lga = c.long_name;
                }
            });

            if (!street) {
                street = inputEl.value.split(",")[0] || "";
            }

            setDeliveryAddress({
                street: street.trim(),
                city: city || lga || "",
                state: state,
                lga: lga,
            });
        });
    }, [mapsLoaded, showToast]);

    // Manual geocoding function for input addresses
    const geocodeManualAddress = () => {
        if (!deliveryAddress.street.trim() || !(window as any).google || !mapsLoaded) return;

        setIsGeocoding(true);
        setVerificationError(null);

        const addressStr = `${deliveryAddress.street}, ${deliveryAddress.city || ""}, ${deliveryAddress.state}, Nigeria`;

        const geocoder = new (window as any).google.maps.Geocoder();
        geocoder.geocode({ address: addressStr, componentRestrictions: { country: "ng" } }, (results: any, status: any) => {
            setIsGeocoding(false);
            if (status === "OK" && results && results[0] && results[0].geometry) {
                const loc = results[0].geometry.location;
                setDestinationCoords({ lat: loc.lat(), lng: loc.lng() });
                setIsAddressVerified(true);
                setVerificationError(null);
                showToast("Location successfully verified on Google Maps!", "success");
            } else {
                console.error("Geocoding failed for manual address:", status);
                setDestinationCoords(null);
                setIsAddressVerified(false);
                setVerificationError("Google Places could not find this location. Try selecting from dropdown.");
                showToast("Could not verify address. Please use the dropdown options.", "error");
            }
        });
    };

    // Recalculate distance when destination or product coordinates change
    useEffect(() => {
        if (!destinationCoords || cart.length === 0) return;

        let maxDistance = 0;
        let validCalculations = 0;

        cart.forEach((item) => {
            const coords = productCoords[item.id];
            if (coords) {
                const dist = calculateHaversineDistance(coords.lat, coords.lng, destinationCoords.lat, destinationCoords.lng);
                if (dist > maxDistance) {
                    maxDistance = dist;
                }
                validCalculations++;
            }
        });

        if (validCalculations > 0) {
            const finalDistance = Math.max(1, Math.round(maxDistance));
            setDistance(finalDistance);
        }
    }, [destinationCoords, productCoords, cart]);

    const handleUseSavedAddress = () => {
        if (!savedAddress) return;
        setDeliveryAddress({
            street: savedAddress.street,
            city: savedAddress.city,
            state: savedAddress.state,
            lga: savedAddress.lga,
        });

        // Geocode the saved address
        const fullAddressStr = `${savedAddress.street}, ${savedAddress.city || ""}, ${savedAddress.state}, Nigeria`;
        if ((window as any).google && mapsLoaded) {
            const geocoder = new (window as any).google.maps.Geocoder();
            geocoder.geocode({ address: fullAddressStr, componentRestrictions: { country: "ng" } }, (results: any, status: any) => {
                if (status === "OK" && results && results[0] && results[0].geometry) {
                    const loc = results[0].geometry.location;
                    setDestinationCoords({ lat: loc.lat(), lng: loc.lng() });
                    setIsAddressVerified(true);
                    setVerificationError(null);
                } else {
                    console.error("Geocoding failed for saved address:", status);
                    setIsAddressVerified(false);
                    setVerificationError("Saved address could not be verified by Google Places.");
                }
            });
        }
        showToast("Address populated from your profile!", "success");
    };

    useEffect(() => {
        setIsClient(true);
        if (session?.user?.email) setEmail(session.user.email);
        if (session?.user?.name) setRecipientName(session.user.name);

        // Use user-scoped cart key to match what product page sets
        const userId = session?.user?.id;
        const cartKey = userId ? `marketplace_cart_${userId}` : "marketplace_cart";

        // Migrate guest cart to user-scoped cart if logged in
        if (userId) {
            const guestCart = localStorage.getItem("marketplace_cart");
            if (guestCart) {
                try {
                    const parsedGuestCart = JSON.parse(guestCart);
                    if (Array.isArray(parsedGuestCart) && parsedGuestCart.length > 0) {
                        localStorage.setItem(cartKey, guestCart);
                    }
                } catch (e) {
                    console.error("Failed to parse guest cart:", e);
                }
                localStorage.removeItem("marketplace_cart");
            }
        }

        const savedCart = localStorage.getItem(cartKey);
        if (savedCart) {
            const parsedCart = JSON.parse(savedCart);
            setCart(parsedCart);
            setWeight(estimateCartWeight(parsedCart));
        } else {
            router.push("/marketplace");
        }
    }, [router, session]);

    useEffect(() => {
        async function loadProfileAddress() {
            try {
                const res = await getUserProfileAction();
                if (res.success && res.data?.profile) {
                    const prof = res.data.profile;
                    if (prof.address?.street || prof.address?.state) {
                        setSavedAddress({
                            street: prof.address.street || "",
                            city: prof.address.city || "",
                            state: prof.address.state || "",
                            lga: prof.address.lga || "",
                        });
                    } else if (prof.residentialAddress) {
                        setSavedAddress({
                            street: prof.residentialAddress,
                            city: prof.city || "",
                            state: prof.state || "",
                            lga: prof.lga || "",
                        });
                    }
                }
            } catch (err) {
                console.error("Failed to load user profile address:", err);
            }
        }
        if (session) {
            loadProfileAddress();
        }
    }, [session]);
 
    const handleUpdateQuantity = (productId: string, newQty: number) => {
        const item = cart.find(i => i.id === productId);
        if (!item) return;

        const minQty = item.minimumOrderQuantity || 1;
        if (newQty < minQty) {
            showToast(`Minimum order quantity for this item is ${minQty}`, "warning");
            return;
        }

        const updated = cart.map(i => {
            if (i.id === productId) {
                return { ...i, quantity: newQty };
            }
            return i;
        });
        setCart(updated);
        setWeight(estimateCartWeight(updated));
        const userId = session?.user?.id;
        const cartKey = userId ? `marketplace_cart_${userId}` : "marketplace_cart";
        localStorage.setItem(cartKey, JSON.stringify(updated));
    };

    const handleRemoveProduct = (productId: string) => {
        const updated = cart.filter(i => i.id !== productId);
        setCart(updated);
        setWeight(estimateCartWeight(updated));
        const userId = session?.user?.id;
        const cartKey = userId ? `marketplace_cart_${userId}` : "marketplace_cart";
        if (updated.length === 0) {
            localStorage.removeItem(cartKey);
            router.push("/marketplace");
        } else {
            localStorage.setItem(cartKey, JSON.stringify(updated));
        }
        showToast("Product removed from cart", "success");
    };

    // Calculate delivery fee when cart is loaded or details change
    useEffect(() => {
        async function fetchFee() {
            if (cart.length === 0) return;
            setIsCalculatingFee(true);
            try {
                const cartItems: CartItem[] = cart.map(item => ({
                    id: item.id,
                    title: item.title,
                    sellerId: item.sellerId,
                    price: item.pricingTiers[0]?.price || 0,
                    quantity: item.quantity,
                    unit: item.unit,
                    selectedTier: item.pricingTiers[0]?.type || "retail",
                    addedAt: new Date(),
                }));
                const res = await calculateDeliveryAction(cartItems, {
                    distance,
                    weight,
                    isWithinCityCenter
                });
                if (res.success && res.data) {
                    setDeliveryFee(res.data.fee);
                } else {
                    setDeliveryFee(0);
                    showToast(res.error || "Failed to calculate delivery fee", "error");
                }
            } catch (err) {
                setDeliveryFee(0);
                showToast("Error calculating delivery fee", "error");
            } finally {
                setIsCalculatingFee(false);
            }
        }
        fetchFee();
    }, [cart, distance, weight, isWithinCityCenter, showToast]);

    const subtotal = cart.reduce((sum, item) => sum + (item.pricingTiers[0]?.price || 0) * item.quantity, 0);

    async function handlePaystackCheckout() {
        if (!session) {
            router.push("/auth/register?callbackUrl=/marketplace/checkout");
            return;
        }

        if (!email || !phone) {
            setError("Please provide your email and phone number");
            return;
        }

        // Validate phone number
        if (!isValidNigerianPhone(phone)) {
            setPhoneError("Please enter a valid Nigerian phone number");
            return;
        }

        if (!recipientName) {
            setError("Please provide the recipient's name");
            return;
        }

        if (!deliveryAddress.street || !deliveryAddress.city || !deliveryAddress.state || !deliveryAddress.lga) {
            setError("Please fill out all delivery address fields");
            return;
        }

        if (!isAddressVerified || !destinationCoords) {
            setError("Please verify your address using Google Places before proceeding. Select from the dropdown or click 'Verify Address'.");
            showToast("Address verification required.", "error");
            return;
        }

        if (cart.length === 0) {
            setError("Your cart is empty");
            return;
        }

        setIsProcessing(true);
        setError(null);
        setPhoneError("");

        try {
            // Prepare cart items for payment
            const cartItems: CartItem[] = cart.map(item => ({
                id: item.id,
                title: item.title,
                sellerId: item.sellerId,
                price: item.pricingTiers[0]?.price || 0,
                quantity: item.quantity,
                unit: item.unit,
                selectedTier: item.pricingTiers[0]?.type || "retail",
                addedAt: new Date(),
            }));

            // Initialize payment
            const result = await initializeOrderPaymentAction(
                cartItems,
                email,
                phone,
                deliveryFee,
                {
                    recipientName,
                    recipientPhone: phone,
                    street: deliveryAddress.street,
                    city: deliveryAddress.city,
                    state: deliveryAddress.state,
                    lga: deliveryAddress.lga,
                    distance,
                    weight,
                    isWithinCityCenter
                }
            );

            if (result.success ) {
                // Redirect to Paystack for payment
                if (result.data?.authorizationUrl) {
                    window.location.href = result.data.authorizationUrl;
                } else {
                    setError("Failed to initialize payment: No authorization URL");
                    setIsProcessing(false);
                }
            } else {
                setError(result.error || "Failed to initialize payment");
                setIsProcessing(false);
            }
        } catch (err) {
            setError("An error occurred while processing your payment");
            setIsProcessing(false);
        }
    };



    if (!isClient || cart.length === 0) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
                    <p className="text-slate-600">Loading checkout...</p>
                </div>
            </div>
        );
    }

    return (
        <MarketplaceErrorBoundary>
            <div className="min-h-screen bg-slate-50 py-8 px-4">
                <div className="max-w-6xl mx-auto">
                    {/* Header */}
                    <button
                        onClick={() => router.back()}
                        className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6 transition"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        Back to Marketplace
                    </button>

                    <h1 className="text-3xl font-bold text-slate-900 mb-8">
                        Checkout
                    </h1>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Order Summary */}
                        <div className="lg:col-span-2 space-y-6">
                            {/* Cart Items */}
                            <div className="bg-white rounded-2xl p-6">
                                <h2 className="text-xl font-bold text-slate-900 mb-4">
                                    Order Summary
                                </h2>
                                <div className="space-y-4">
                                    {cart.map((item) => {
                                        const price = item.pricingTiers[0]?.price || 0;
                                        return (
                                            <div
                                                key={item.id}
                                                className="flex items-start gap-4 pb-4 border-b border-slate-200 last:border-0"
                                            >
                                                <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-slate-100">
                                                    {item.images[0] ? (
                                                        <Image
                                                            src={item.images[0]}
                                                            alt={item.title}
                                                            fill
                                                            className="object-cover"
                                                        />
                                                    ) : (
                                                        <Store className="w-8 h-8 text-gray-400 mx-auto mt-6" />
                                                    )}
                                                </div>
                                                <div className="flex-1">
                                                    <h3 className="font-bold text-slate-900">
                                                        {item.title}
                                                    </h3>
                                                    <p className="text-sm text-slate-600 mb-2">
                                                        {formatCurrency(price)} per {item.unit}
                                                    </p>
                                                    <div className="flex items-center gap-4">
                                                        <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden bg-slate-50">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleUpdateQuantity(item.id, item.quantity - 1)}
                                                                className="px-2.5 py-1.5 hover:bg-slate-200 text-slate-600 transition"
                                                            >
                                                                <Minus className="w-3.5 h-3.5" />
                                                            </button>
                                                            <span className="px-3 font-semibold text-slate-900 min-w-[32px] text-center text-sm">
                                                                {item.quantity}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleUpdateQuantity(item.id, item.quantity + 1)}
                                                                className="px-2.5 py-1.5 hover:bg-slate-200 text-slate-600 transition"
                                                            >
                                                                <Plus className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveProduct(item.id)}
                                                            className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-lg transition"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                                <p className="font-bold text-primary">
                                                    {formatCurrency(price * item.quantity)}
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Contact Information */}
                            <div className="bg-white rounded-2xl p-6">
                                <h2 className="text-xl font-bold text-slate-900 mb-4">
                                    Contact Information
                                </h2>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            Email Address
                                        </label>
                                        <input
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder="your.email@example.com"
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary"
                                            required
                                        />
                                    </div>
                                    <PhoneInput
                                        label="Phone Number"
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        error={phoneError}
                                        required
                                    />
                                </div>
                            </div>

                            {/* Delivery Address & Details */}
                            <div className="bg-white rounded-2xl p-6">
                                <div className="flex justify-between items-start flex-wrap gap-4 mb-4">
                                    <h2 className="text-xl font-bold text-slate-900">
                                        Delivery Address
                                    </h2>
                                    {savedAddress && (
                                        <button
                                            type="button"
                                            onClick={handleUseSavedAddress}
                                            className="text-xs font-semibold text-primary hover:text-primary/80 flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 rounded-lg border border-primary/20 transition"
                                        >
                                            📋 Use saved profile address
                                        </button>
                                    )}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="md:col-span-2">
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            Recipient's Name
                                        </label>
                                        <input
                                            type="text"
                                            value={recipientName}
                                            onChange={(e) => setRecipientName(e.target.value)}
                                            placeholder="e.g. John Doe"
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary"
                                            required
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            Street Address
                                        </label>
                                        <input
                                            type="text"
                                            id="delivery-street-input"
                                            value={deliveryAddress.street}
                                            onChange={(e) => {
                                                setDeliveryAddress({ ...deliveryAddress, street: e.target.value });
                                                setIsAddressVerified(false);
                                                setDestinationCoords(null);
                                                setVerificationError(null);
                                            }}
                                            onBlur={geocodeManualAddress}
                                            placeholder="e.g. 123 Main Street"
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary"
                                            required
                                        />
                                        <div className="mt-2 flex items-center justify-between flex-wrap gap-2 text-xs">
                                            <div>
                                                {isGeocoding ? (
                                                    <span className="text-blue-600 font-medium flex items-center gap-1 animate-pulse">
                                                        🌀 Locating address via Google Places...
                                                     </span>
                                                ) : isAddressVerified && destinationCoords ? (
                                                    <span className="text-green-600 font-semibold flex items-center gap-1">
                                                        🟢 Address verified (Distance: {distance} km)
                                                    </span>
                                                ) : (
                                                    <span className="text-amber-600 font-medium flex items-center gap-1">
                                                        🟡 Address unverified. Select from suggestions or click verify.
                                                    </span>
                                                )}
                                                {verificationError && (
                                                    <p className="text-red-500 mt-1 font-medium">{verificationError}</p>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={geocodeManualAddress}
                                                disabled={isGeocoding || !deliveryAddress.street.trim()}
                                                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-semibold rounded-lg border border-slate-300 transition-colors shrink-0"
                                            >
                                                Verify Address
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            City
                                        </label>
                                        <input
                                            type="text"
                                            value={deliveryAddress.city}
                                            onChange={(e) => {
                                                setDeliveryAddress({ ...deliveryAddress, city: e.target.value });
                                                setIsAddressVerified(false);
                                                setDestinationCoords(null);
                                                setVerificationError(null);
                                            }}
                                            onBlur={geocodeManualAddress}
                                            placeholder="e.g. Ikeja"
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            State
                                        </label>
                                        <select
                                            value={deliveryAddress.state}
                                            onChange={(e) => {
                                                const selectedState = e.target.value;
                                                setDeliveryAddress({
                                                    ...deliveryAddress,
                                                    state: selectedState,
                                                    lga: "" // Reset LGA when state changes
                                                });
                                                setIsAddressVerified(false);
                                                setDestinationCoords(null);
                                                setVerificationError(null);
                                            }}
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary"
                                            required
                                        >
                                            <option value="">Select State</option>
                                            {Object.keys(NIGERIAN_LOCATIONS).map((st) => (
                                                <option key={st} value={st}>{st}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                                            Local Government Area (LGA)
                                        </label>
                                        <select
                                            value={deliveryAddress.lga}
                                            onChange={(e) => {
                                                setDeliveryAddress({ ...deliveryAddress, lga: e.target.value });
                                                setIsAddressVerified(false);
                                                setDestinationCoords(null);
                                                setVerificationError(null);
                                            }}
                                            disabled={!deliveryAddress.state}
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                                            required
                                        >
                                            <option value="">Select LGA</option>
                                            {deliveryAddress.state && NIGERIAN_LOCATIONS[deliveryAddress.state]?.map((lga) => (
                                                <option key={lga} value={lga}>{lga}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Delivery Options & Calculator Parameters */}
                            <div className="bg-white rounded-2xl p-6 space-y-6">
                                <h2 className="text-xl font-bold text-slate-900">
                                    Delivery Customizations
                                </h2>
                                <p className="text-sm text-slate-600">
                                    Adjust distance and weight options below to estimate accurate delivery costs.
                                </p>
                                
                                <div className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                                    {/* Calculated Delivery Distance Info Card */}
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-sm font-semibold text-slate-900">
                                                Calculated Delivery Distance
                                            </span>
                                            <span className="text-sm font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-lg">
                                                {distance} KM
                                            </span>
                                        </div>
                                        <div className="bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-600 shadow-sm">
                                            <p className="font-semibold text-slate-700 mb-1">
                                                {distance <= 10 
                                                    ? "Within base delivery distance (10KM included in flat rate)." 
                                                    : `Additional ${(distance - 10)} KM calculated automatically based on product and delivery locations.`}
                                            </p>
                                            <p>
                                                This distance is computed using the exact coordinates of the sellers' warehouses and your delivery address.
                                            </p>
                                        </div>
                                    </div>

                                    {/* Weight manual override */}
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <label className="text-sm font-semibold text-slate-900">
                                                Total Estimated Weight (kg)
                                            </label>
                                            <span className="text-xs text-slate-600">(5kg included in flat rate)</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="number"
                                                min="0.1"
                                                step="0.1"
                                                value={weight}
                                                onChange={(e) => setWeight(Math.max(0.1, Number(e.target.value)))}
                                                className="w-32 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary text-sm font-semibold"
                                            />
                                            <span className="text-sm text-slate-600">kg</span>
                                        </div>
                                    </div>

                                    {/* City Center toggle */}
                                    <div className="pt-2 border-t border-slate-200">
                                        <label className="flex items-start gap-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={isWithinCityCenter}
                                                onChange={(e) => setIsWithinCityCenter(e.target.checked)}
                                                className="rounded text-primary focus:ring-primary w-5 h-5 mt-0.5"
                                            />
                                            <div>
                                                <span className="text-sm font-semibold text-slate-900">Within City Center</span>
                                                <p className="text-xs text-slate-600">Flat rate of ₦2,000 applies to deliveries within the city center.</p>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Order Total */}
                        <div className="lg:col-span-1">
                            <div className="bg-white rounded-2xl p-6 sticky top-8">
                                <h2 className="text-xl font-bold text-slate-900 mb-4">
                                    Order Total
                                </h2>
                                <div className="space-y-3 mb-6">
                                    <div className="flex justify-between text-slate-600">
                                        <span>Subtotal</span>
                                        <span>{formatCurrency(subtotal)}</span>
                                    </div>
                                    <div className="flex justify-between text-slate-600">
                                        <span>Delivery Fee</span>
                                        <span>
                                            {isCalculatingFee ? (
                                                <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                                            ) : (
                                                formatCurrency(deliveryFee)
                                            )}
                                        </span>
                                    </div>
                                    <div className="pt-3 border-t border-slate-200 flex justify-between text-lg font-bold">
                                        <span className="text-slate-900">Total</span>
                                        <span className="text-primary">
                                            {isCalculatingFee ? (
                                                <span className="text-sm font-normal text-slate-400">Calculating...</span>
                                            ) : (
                                                formatCurrency(subtotal + deliveryFee)
                                            )}
                                        </span>
                                    </div>
                                </div>


                                <div className="mb-6">
                                    <label className="block text-sm font-semibold text-slate-900 mb-3">
                                        Payment Method
                                    </label>
                                    <div className="p-4 border-2 border-primary bg-primary/10 rounded-xl flex items-center gap-3">
                                        <CreditCard className="w-6 h-6 text-primary" />
                                        <div>
                                            <p className="font-semibold text-slate-900">Card Payment (Paystack)</p>
                                            <p className="text-xs text-slate-600">Pay securely with your debit or credit card</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Error Display */}
                                {error && (
                                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
                                        <p className="text-sm text-red-600">{error}</p>
                                    </div>
                                )}

                                <button
                                    onClick={handlePaystackCheckout}
                                    disabled={isProcessing || isCalculatingFee || !email || !phone}
                                    className="w-full px-6 py-4 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {isProcessing ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            <CreditCard className="w-5 h-5" />
                                            Complete Payment
                                        </>
                                    )}
                                </button>

                                <p className="text-xs text-center text-slate-500 mt-4">
                                    All payments are escrow-protected for your security
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
                <Script
                    src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}&libraries=places`}
                    onLoad={() => setMapsLoaded(true)}
                    strategy="afterInteractive"
                />
            </div>
        </MarketplaceErrorBoundary>
    );
}
