"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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

const NIGERIAN_STATE_COORDINATES: Record<string, { lat: number; lng: number }> = {
    "Abia": { lat: 5.5249, lng: 7.4898 },
    "Adamawa": { lat: 9.3265, lng: 12.3984 },
    "Akwa Ibom": { lat: 5.0389, lng: 7.9092 },
    "Anambra": { lat: 6.2209, lng: 7.0670 },
    "Bauchi": { lat: 10.3158, lng: 9.8442 },
    "Bayelsa": { lat: 4.9267, lng: 6.2676 },
    "Benue": { lat: 7.3333, lng: 8.8833 },
    "Borno": { lat: 11.8311, lng: 13.1509 },
    "Cross River": { lat: 5.9631, lng: 8.3300 },
    "Delta": { lat: 5.7040, lng: 5.9789 },
    "Ebonyi": { lat: 6.2649, lng: 8.0874 },
    "Edo": { lat: 6.3350, lng: 5.6037 },
    "Ekiti": { lat: 7.6306, lng: 5.2194 },
    "Enugu": { lat: 6.4584, lng: 7.5464 },
    "FCT": { lat: 9.0765, lng: 7.3986 },
    "Abuja": { lat: 9.0765, lng: 7.3986 },
    "Gombe": { lat: 10.2796, lng: 11.1686 },
    "Imo": { lat: 5.4854, lng: 7.0357 },
    "Jigawa": { lat: 12.1852, lng: 9.7742 },
    "Kaduna": { lat: 10.5105, lng: 7.4165 },
    "Kano": { lat: 12.0022, lng: 8.5919 },
    "Katsina": { lat: 12.9856, lng: 7.6171 },
    "Kebbi": { lat: 11.4942, lng: 4.1950 },
    "Kogi": { lat: 7.7969, lng: 6.7406 },
    "Kwara": { lat: 8.4833, lng: 4.5417 },
    "Lagos": { lat: 6.5244, lng: 3.3792 },
    "Nasarawa": { lat: 8.4907, lng: 7.7212 },
    "Niger": { lat: 9.5833, lng: 6.5000 },
    "Ogun": { lat: 7.1583, lng: 3.3500 },
    "Ondo": { lat: 7.2500, lng: 5.2000 },
    "Osun": { lat: 7.5629, lng: 4.5200 },
    "Oyo": { lat: 7.9700, lng: 3.5900 },
    "Plateau": { lat: 9.8965, lng: 8.8583 },
    "Rivers": { lat: 4.8156, lng: 7.0498 },
    "Sokoto": { lat: 13.0622, lng: 5.2439 },
    "Taraba": { lat: 8.0000, lng: 10.5000 },
    "Yobe": { lat: 12.0000, lng: 11.5000 },
    "Zamfara": { lat: 12.1222, lng: 6.2236 }
};

import dynamicImport from "next/dynamic";

const CheckoutMapFallback = dynamicImport(
    () => import("@/components/marketplace/CheckoutMapFallback"),
    {
        ssr: false,
        loading: () => (
            <div className="h-[300px] w-full bg-slate-100 animate-pulse rounded-xl flex items-center justify-center text-slate-500 text-sm">
                Loading route map...
            </div>
        )
    }
);

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
    const [mapsError, setMapsError] = useState(false);
    const [productCoords, setProductCoords] = useState<Record<string, { lat: number; lng: number }>>({});
    const [destinationCoords, setDestinationCoords] = useState<{ lat: number; lng: number } | null>(null);

    // Set mapsLoaded if google is already defined on mount (handles Next.js Script caching)
    useEffect(() => {
        if (typeof window !== "undefined" && (window as any).google) {
            setMapsLoaded(true);
        }
    }, []);

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
        if (!isClient || cart.length === 0) return;

        // If Google Maps is loaded, use it. Otherwise, use our local fallback coordinates.
        if (mapsLoaded && (window as any).google?.maps?.Geocoder) {
            try {
                const geocoder = new (window as any).google.maps.Geocoder();
                const newCoords = { ...productCoords };
                let updated = false;

                const geocodePromises = cart.map((item) => {
                    const lga = item.location?.lga && item.location.lga.toLowerCase() !== "unknown" ? item.location.lga : "";
                    const state = item.location?.state && item.location.state.toLowerCase() !== "unknown" ? item.location.state : "Lagos";
                    
                    const locKey = `${lga}, ${state}`.trim();
                    if (!locKey || productCoords[item.id]) return Promise.resolve();

                    const addressStr = `${lga ? lga + ", " : ""}${state}, Nigeria`;
                    
                    return new Promise<void>((resolve) => {
                        geocoder.geocode({ address: addressStr, componentRestrictions: { country: "ng" } }, (results: any, status: any) => {
                            if (status === "OK" && results && results[0] && results[0].geometry) {
                                const loc = results[0].geometry.location;
                                newCoords[item.id] = { lat: loc.lat(), lng: loc.lng() };
                                updated = true;
                            } else {
                                console.error(`Geocoding failed for product ${item.id} (${addressStr}):`, status);
                                // Fallback locally for this item
                                const matchedState = Object.keys(NIGERIAN_STATE_COORDINATES).find(
                                    s => s.toLowerCase() === state.toLowerCase()
                                );
                                if (matchedState) {
                                    newCoords[item.id] = NIGERIAN_STATE_COORDINATES[matchedState];
                                    updated = true;
                                }
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
            } catch (e) {
                console.error("Failed to geocode product locations with Google Maps:", e);
            }
        } else {
            // Local geocoding fallback
            const newCoords = { ...productCoords };
            let updated = false;
            cart.forEach((item) => {
                if (productCoords[item.id]) return;
                const state = item.location?.state && item.location.state.toLowerCase() !== "unknown" ? item.location.state : "Lagos";
                const matchedState = Object.keys(NIGERIAN_STATE_COORDINATES).find(
                    s => s.toLowerCase() === state.toLowerCase()
                );
                if (matchedState) {
                    newCoords[item.id] = NIGERIAN_STATE_COORDINATES[matchedState];
                    updated = true;
                }
            });
            if (updated) {
                setProductCoords(newCoords);
            }
        }
    }, [mapsLoaded, cart, isClient, productCoords]);

    // Initialize Google Places Autocomplete
    useEffect(() => {
        if (!mapsLoaded || !(window as any).google) return;

        try {
            const inputEl = document.getElementById("delivery-street-input") as HTMLInputElement;
            if (!inputEl) return;

            if (!(window as any).google.maps?.places?.Autocomplete) {
                console.warn("Google Places Autocomplete library is not loaded yet.");
                return;
            }

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
                let rawState = "";
                let rawLga = "";

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
                        rawState = c.long_name.replace(/\s*state$/i, "").trim();
                    } else if (types.includes("administrative_area_level_2")) {
                        rawLga = c.long_name;
                    }
                });

                if (!street) {
                    street = inputEl.value.split(",")[0] || "";
                }

                // Robust state matching
                let matchedState = "";
                const stateKey = Object.keys(NIGERIAN_LOCATIONS).find(
                    (s) => s.toLowerCase() === rawState.toLowerCase()
                );
                if (stateKey) {
                    matchedState = stateKey;
                } else if (rawState.toLowerCase() === "federal capital territory" || rawState.toLowerCase() === "abuja") {
                    matchedState = "FCT";
                }

                // Robust LGA matching
                let matchedLga = "";
                if (matchedState && NIGERIAN_LOCATIONS[matchedState]) {
                    const lgaList = NIGERIAN_LOCATIONS[matchedState];
                    const lgaLower = rawLga.toLowerCase();
                    const directLgaMatch = lgaList.find(
                        (l) => l.toLowerCase() === lgaLower
                    );
                    if (directLgaMatch) {
                        matchedLga = directLgaMatch;
                    } else {
                        // Find partial match
                        const partialLgaMatch = lgaList.find(
                            (l) => l.toLowerCase().includes(lgaLower) || lgaLower.includes(l.toLowerCase())
                        );
                        if (partialLgaMatch) {
                            matchedLga = partialLgaMatch;
                        }
                    }
                }

                setDeliveryAddress({
                    street: street.trim(),
                    city: city || rawLga || "",
                    state: matchedState,
                    lga: matchedLga,
                });
            });
        } catch (e) {
            console.error("Failed to initialize Google Places Autocomplete:", e);
        }
    }, [mapsLoaded, showToast]);

    // Manual geocoding function for input addresses
    const geocodeManualAddress = useCallback((force = false) => {
        if (!deliveryAddress.street.trim() || !deliveryAddress.city.trim() || !deliveryAddress.state) {
            // Do not geocode automatically if required fields are missing
            if (force === true) {
                showToast("Please fill street, city, and state first.", "warning");
            }
            return;
        }

        setIsGeocoding(true);
        setVerificationError(null);

        const addressStr = `${deliveryAddress.street}, ${deliveryAddress.city}, ${deliveryAddress.state}, Nigeria`;

        // Check if Google Maps Geocoder is available
        const hasGoogleGeocoder = typeof window !== "undefined" && (window as any).google?.maps?.Geocoder;

        if (hasGoogleGeocoder) {
            try {
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
                        // Local geocoding fallback
                        const matchedState = Object.keys(NIGERIAN_STATE_COORDINATES).find(
                            s => s.toLowerCase() === deliveryAddress.state.toLowerCase()
                        );
                        if (matchedState) {
                            setDestinationCoords(NIGERIAN_STATE_COORDINATES[matchedState]);
                            setIsAddressVerified(true);
                            setVerificationError(null);
                            showToast(`Address verified using local ${matchedState} state coordinates fallback.`, "success");
                        } else {
                            setDestinationCoords(null);
                            setIsAddressVerified(false);
                            let errMsg = `Google Places could not find this location (Status: ${status}). Try selecting from the dropdown or click 'Use Address Anyway' to bypass.`;
                            if (status === "REQUEST_DENIED") {
                                errMsg = "Google Maps API request was denied. This usually means the Geocoding API or Places API is not enabled in your Google Cloud Console, or billing is not linked to your project. Please verify your Google Developer Console settings, or click 'Use Address Anyway' to bypass.";
                            }
                            setVerificationError(errMsg);
                            showToast(status === "REQUEST_DENIED" ? "Maps API request denied. See details below." : "Could not verify address. Please use the dropdown options or bypass.", "error");
                        }
                    }
                });
            } catch (e: any) {
                console.error("Error in Google geocodeManualAddress:", e);
                // Local geocoding fallback on catch
                const matchedState = Object.keys(NIGERIAN_STATE_COORDINATES).find(
                    s => s.toLowerCase() === deliveryAddress.state.toLowerCase()
                );
                if (matchedState) {
                    setDestinationCoords(NIGERIAN_STATE_COORDINATES[matchedState]);
                    setIsAddressVerified(true);
                    setVerificationError(null);
                    showToast(`Address verified using local ${matchedState} state coordinates fallback.`, "success");
                } else {
                    setIsGeocoding(false);
                    setDestinationCoords(null);
                    setIsAddressVerified(false);
                    setVerificationError(e?.message || "Google Maps could not be loaded. Please check your connection or use the bypass below.");
                    showToast("Address verification failed.", "error");
                }
            }
        } else {
            // No Google Maps geocoder available, use local state coordinates
            const matchedState = Object.keys(NIGERIAN_STATE_COORDINATES).find(
                s => s.toLowerCase() === deliveryAddress.state.toLowerCase()
            );
            setIsGeocoding(false);
            if (matchedState) {
                setDestinationCoords(NIGERIAN_STATE_COORDINATES[matchedState]);
                setIsAddressVerified(true);
                setVerificationError(null);
                showToast(`Address verified using local ${matchedState} state coordinates fallback.`, "success");
            } else {
                setDestinationCoords(null);
                setIsAddressVerified(false);
                setVerificationError("Google Maps is not loaded and the selected state is invalid. Please select a valid state.");
                showToast("State coordinates not found.", "error");
            }
        }
    }, [deliveryAddress, showToast]);

    // Auto-geocode when fields change and are complete, debounced by 1000ms
    useEffect(() => {
        if (isAddressVerified) return;
        if (!deliveryAddress.street.trim() || !deliveryAddress.city.trim() || !deliveryAddress.state) {
            return;
        }
        const timer = setTimeout(() => {
            geocodeManualAddress(false);
        }, 1000);
        return () => clearTimeout(timer);
    }, [deliveryAddress.street, deliveryAddress.city, deliveryAddress.state, deliveryAddress.lga, isAddressVerified, geocodeManualAddress]);

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
        try {
            if (typeof window !== "undefined" && (window as any).google?.maps?.Geocoder) {
                const geocoder = new (window as any).google.maps.Geocoder();
                geocoder.geocode({ address: fullAddressStr, componentRestrictions: { country: "ng" } }, (results: any, status: any) => {
                    if (status === "OK" && results && results[0] && results[0].geometry) {
                        const loc = results[0].geometry.location;
                        setDestinationCoords({ lat: loc.lat(), lng: loc.lng() });
                        setIsAddressVerified(true);
                        setVerificationError(null);
                    } else {
                        console.error("Geocoding failed for saved address:", status);
                        // Fallback locally
                        const matchedState = Object.keys(NIGERIAN_STATE_COORDINATES).find(
                            s => s.toLowerCase() === savedAddress.state.toLowerCase()
                        );
                        if (matchedState) {
                            setDestinationCoords(NIGERIAN_STATE_COORDINATES[matchedState]);
                            setIsAddressVerified(true);
                            setVerificationError(null);
                        } else {
                            setIsAddressVerified(false);
                            let errMsg = `Saved address could not be verified by Google Places (Status: ${status}).`;
                            if (status === "REQUEST_DENIED") {
                                errMsg = "Google Maps API request was denied for your saved address. This usually means the Geocoding API is not enabled in Google Cloud Console, or billing is not linked to your project. Click 'Verify Address' to retry or click 'Use Address Anyway' below.";
                            }
                            setVerificationError(errMsg);
                        }
                    }
                });
            } else {
                console.error("Google Maps Geocoder is not loaded yet. Falling back to local state coordinates.");
                const matchedState = Object.keys(NIGERIAN_STATE_COORDINATES).find(
                    s => s.toLowerCase() === savedAddress.state.toLowerCase()
                );
                if (matchedState) {
                    setDestinationCoords(NIGERIAN_STATE_COORDINATES[matchedState]);
                    setIsAddressVerified(true);
                    setVerificationError(null);
                } else {
                    setIsAddressVerified(false);
                    setVerificationError("Google Maps Geocoder is not loaded yet. Click 'Verify Address' when loaded or use the bypass below.");
                }
            }
        } catch (e: any) {
            console.error("Error in handleUseSavedAddress geocoding:", e);
            // Fallback locally
            const matchedState = Object.keys(NIGERIAN_STATE_COORDINATES).find(
                s => s.toLowerCase() === savedAddress.state.toLowerCase()
            );
            if (matchedState) {
                setDestinationCoords(NIGERIAN_STATE_COORDINATES[matchedState]);
                setIsAddressVerified(true);
                setVerificationError(null);
            } else {
                setIsAddressVerified(false);
                setVerificationError(e?.message || "An error occurred during saved address geocoding.");
            }
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
            console.log("[CheckoutPage] fetchFee called, cart length:", cart.length, "distance:", distance, "weight:", weight, "isWithinCityCenter:", isWithinCityCenter);
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
            setError("Address verification is required. If Google Places cannot locate your address, click the 'Use Address Anyway' option under the Street Address field to proceed.");
            showToast("Address verification required.", "error");
            if (!verificationError) {
                setVerificationError("Google Places verification is required. If your address is not found, click 'Use Address Anyway' below to proceed.");
            }
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
                                            onBlur={() => geocodeManualAddress(false)}
                                            placeholder="e.g. 123 Main Street"
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary"
                                            required
                                        />
                                        <div className="mt-2 space-y-2">
                                            <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                                                <div>
                                                    {isGeocoding ? (
                                                        <span className="text-blue-600 font-medium flex items-center gap-1 animate-pulse">
                                                            🌀 Locating address via Google Places...
                                                         </span>
                                                    ) : mapsError ? (
                                                        <span className="text-red-600 font-medium flex items-center gap-1">
                                                            🔴 Google Maps failed to load. Please use the bypass below.
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
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => geocodeManualAddress(true)}
                                                    disabled={isGeocoding || !deliveryAddress.street.trim()}
                                                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-semibold rounded-lg border border-slate-300 transition-colors shrink-0"
                                                >
                                                    Verify Address
                                                </button>
                                            </div>

                                            {isAddressVerified && destinationCoords && (
                                                <div className="mt-3">
                                                    <CheckoutMapFallback
                                                        destination={destinationCoords}
                                                        products={cart.map(item => ({
                                                            id: item.id,
                                                            name: item.title,
                                                            coords: productCoords[item.id] || null,
                                                            locationName: `${item.location?.lga || ""}, ${item.location?.state || ""}`
                                                        }))}
                                                    />
                                                </div>
                                            )}

                                            {verificationError && (
                                                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-4 text-xs">
                                                    <div className="text-amber-800 font-medium leading-relaxed">
                                                        <p className="font-bold mb-0.5">Address Verification Notice</p>
                                                        <p className="mb-1">{verificationError}</p>
                                                        <p>You can proceed anyway, but shipping fees will be estimated using a standard base rate.</p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setIsAddressVerified(true);
                                                            setDestinationCoords({ lat: 6.5244, lng: 3.3792 }); // Lagos default coordinates
                                                            setDistance(10);
                                                            setVerificationError(null);
                                                            showToast("Proceeding with manual address (standard shipping rate applied).", "info");
                                                        }}
                                                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg transition shrink-0"
                                                    >
                                                        Use Address Anyway
                                                    </button>
                                                </div>
                                            )}
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
                                            onBlur={() => geocodeManualAddress(false)}
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
                                    Review the automatically calculated distance and adjust weight parameters below to estimate accurate delivery costs.
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
                    onError={() => {
                        console.error("Google Maps Script failed to load");
                        setMapsError(true);
                        setVerificationError("Google Maps library failed to load. Please check your internet connection or click 'Use Address Anyway' below to bypass.");
                    }}
                    strategy="afterInteractive"
                />
            </div>
        </MarketplaceErrorBoundary>
    );
}
