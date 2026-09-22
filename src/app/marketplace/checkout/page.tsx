"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
import { toCartItems } from "@/lib/marketplace-checkout-cart";
import { NIGERIAN_LOCATIONS } from "@/lib/locations";
import { getUserProfileAction } from "@/app/actions/profile";
/**
 *   THE OWNER: "For delivery address, we want to use openstreet map instead of
 *   google map."
 *
 *   The route map below this field has been Leaflet over OpenStreetMap all
 *   along. What was Google is the ADDRESS: an Autocomplete on the street input
 *   and two geocoders. All three now go through api/geocode — see
 *   lib/nominatim for why the call is made on the server.
 */
import { geocodeAddress, type GeocodeResult } from "@/lib/geocode-request";
import { SEARCH_DEBOUNCE_MS } from "@/lib/nominatim";

// Disable static generation for this page - must be client-only due to Paystack
export const dynamic = 'force-dynamic';

interface LocalCartItem extends Product {
    quantity: number;
    /**
     *   #873 An accepted quote this line was added from.
     *
     *   `agreedPrice` is DISPLAY ONLY and is never sent anywhere: the checkout
     *   shows the buyer what they negotiated so the total on the screen matches
     *   the total they are charged, and the charge itself is derived on the
     *   server from the quote row. If the two ever disagree, the server's figure
     *   is the one that is right and the screen is the thing to fix.
     */
    quoteId?: string;
    agreedPrice?: number;
    /**
     *   WHICH COLLECTION THIS LINE CAME FROM.
     *
     *   A village-market line is a row in FLASH_SALE_PRODUCTS, not PRODUCTS,
     *   and `validateCartItems` picks the collection to read from this flag
     *   alone. Add-to-cart writes it — BuyerProductsClient and
     *   VillageMarketEventClient both set `isFlashSale: true` — but `Product`
     *   does not declare it, so inside this file it was invisible to
     *   TypeScript, and `CartItem.isFlashSale` is optional, so the two
     *   `cart.map` calls below could drop it without a compile error.
     *
     *   They did. The server then looked a village-market id up in PRODUCTS,
     *   found nothing, and refused the checkout with "Product not found:
     *   <title>" — the listing existed the whole time, in the other table.
     */
    isFlashSale?: boolean;
    eventId?: string;
}

/** What this line actually costs per unit: the negotiated price, or the list. */
function unitPriceOf(item: LocalCartItem): number {
    const agreed = Number(item.agreedPrice);
    if (item.quoteId && Number.isFinite(agreed) && agreed > 0) return agreed;
    return item.pricingTiers?.[0]?.price || 0;
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


import dynamicImport from "next/dynamic";
import { stateCentroid } from "@/lib/locations";
import { firstImageSrc } from "@/lib/first-image";

/*
 *   #821 IS RESOLVED BY DELETION, NOT BY A BETTER KEY.
 *
 *   That issue found checkout loading Google Maps with a Firebase key — not a
 *   Maps key, so Google served the script, refused the key and painted its own
 *   grey box while `onLoad` fired and the app believed Maps was working. It was
 *   fixed by loading Google ONLY with a real Maps key and falling back to
 *   Leaflet/OpenStreetMap otherwise.
 *
 *   The owner has now asked for OpenStreetMap outright, so the key, the loader,
 *   the `gm_authFailure` handler and the two `mapsLoaded`/`mapsError` states are
 *   gone with it. There is one path instead of two, and it needs no key, no
 *   billing account and no Google Cloud project — which is also the end of the
 *   whole class of defect #821 was about, where a deployment's configuration
 *   decided whether a buyer could enter an address.
 */

/**
 *   The route map. RENAMED FROM CheckoutMapFallback, because it is not one:
 *   with Google gone there is no primary for it to be the fallback to, and a
 *   name that says "fallback" invites the next reader to wonder what the real
 *   map is. Leaflet over OpenStreetMap is the real map.
 */
const CheckoutRouteMap = dynamicImport(
    () => import("@/components/marketplace/CheckoutRouteMap"),
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

    const [productCoords, setProductCoords] = useState<Record<string, { lat: number; lng: number }>>({});
    const [destinationCoords, setDestinationCoords] = useState<{ lat: number; lng: number } | null>(null);

    /*
     *   The suggestion list that replaces Google Places Autocomplete.
     *
     *   NOT SEARCH-AS-YOU-TYPE. Nominatim's usage policy forbids autocomplete,
     *   and the control this replaces fired a request per keystroke. A search
     *   happens after typing stops for SEARCH_DEBOUNCE_MS, or when Search is
     *   pressed — see lib/nominatim.
     */
    const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [searchNotice, setSearchNotice] = useState<string | null>(null);
    const searchAbort = useRef<AbortController | null>(null);

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

    /*
     *   Where each cart item ships FROM, for the route line and the distance
     *   the delivery fee is priced on.
     *
     *   ONE LOOKUP PER DISTINCT LGA, not per item. The Google version geocoded
     *   every line in the cart, so three bags of rice from the same farm cost
     *   three requests. Nominatim is a donated service with a ceiling this
     *   platform does not control (see lib/nominatim), and an LGA does not move
     *   — so the key is the place, the answer is cached upstream for a day, and
     *   a cart of ten items from two farms spends two lookups.
     *
     *   THE STATE CENTROID REMAINS THE FALLBACK. It is what ran on every
     *   deployment without a Maps key already, and it is what runs when the
     *   service is unreachable. A coarse origin prices a slightly wrong
     *   distance; no origin draws no route at all.
     */
    useEffect(() => {
        if (!isClient || cart.length === 0) return;

        let cancelled = false;

        const named = (value?: string): string =>
            value && value.toLowerCase() !== "unknown" ? value : "";

        //   Every item still needing a pin, grouped by the place it comes from.
        const byPlace = new Map<string, { lga: string; state: string; ids: string[] }>();
        for (const item of cart) {
            if (productCoords[item.id]) continue;
            const lga = named(item.location?.lga);
            const state = named(item.location?.state) || "Lagos";
            const key = `${lga}|${state}`;
            const group = byPlace.get(key);
            if (group) group.ids.push(item.id);
            else byPlace.set(key, { lga, state, ids: [item.id] });
        }
        if (byPlace.size === 0) return;

        //   The centroids first, synchronously, so the map draws immediately
        //   and the lookups below only ever improve on it.
        const seeded: Record<string, { lat: number; lng: number }> = {};
        for (const { state, ids } of byPlace.values()) {
            const centroid = stateCentroid(state);
            if (!centroid) continue;
            for (const id of ids) seeded[id] = centroid;
        }
        if (Object.keys(seeded).length > 0) {
            setProductCoords(prev => ({ ...seeded, ...prev }));
        }

        (async () => {
            for (const { lga, state, ids } of byPlace.values()) {
                if (cancelled) return;
                if (!lga) continue; // The state centroid is already the best answer.

                const { results } = await geocodeAddress(`${lga}, ${state}, Nigeria`, { limit: 1 });
                if (cancelled || results.length === 0) continue;

                const { lat, lng } = results[0];
                setProductCoords(prev => {
                    const next = { ...prev };
                    for (const id of ids) next[id] = { lat, lng };
                    return next;
                });
            }
        })();

        return () => { cancelled = true; };
        //   `productCoords` is deliberately NOT a dependency: this effect
        //   writes it, and reading it here through the setter's callback is
        //   what keeps that from being a loop. The guard above reads the
        //   render's snapshot only to decide what still needs looking up.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cart, isClient]);

    /**
     * Fill the whole address from a place the buyer picked.
     *
     *   The Google version unpacked `address_components` inside its own
     *   listener, and the state/LGA reconciliation — "Federal Capital
     *   Territory" means FCT, "Jos North Local Government Area" means
     *   "Jos North" — lived only there. So the MANUAL path, which is the one
     *   most buyers take, reconciled nothing and left the dependent selects
     *   empty. That rule is now in lib/nominatim and both paths use it.
     */
    const applySuggestion = useCallback((place: GeocodeResult) => {
        setDestinationCoords({ lat: place.lat, lng: place.lng });
        setIsAddressVerified(true);
        setVerificationError(null);
        setSuggestions([]);
        setSearchNotice(null);
        setDeliveryAddress({
            street: place.street,
            city: place.city,
            state: place.state,
            lga: place.lga,
        });
    }, []);

    /**
     * Look the typed street up and offer what came back.
     *
     *   CALLED ON A PAUSE OR A PRESS, never per keystroke — Nominatim's usage
     *   policy forbids autocomplete and the Google control this replaces fired
     *   on every character. See lib/nominatim.
     */
    const searchAddress = useCallback(async (query: string, announce: boolean): Promise<GeocodeResult[]> => {
        const trimmed = query.trim();
        if (trimmed.length < 3) {
            setSuggestions([]);
            if (announce) showToast("Type a little more of the address first.", "warning");
            return [];
        }

        //   One search at a time: a newer one replaces the one in flight, so a
        //   slow answer cannot land on top of a faster, later one.
        searchAbort.current?.abort();
        const controller = new AbortController();
        searchAbort.current = controller;

        setIsSearching(true);
        setSearchNotice(null);

        //   The state gives the search somewhere to look when the buyer has
        //   already chosen one, which is most of the difference between
        //   "Main Street" finding the right road and finding forty.
        const scoped = [trimmed, deliveryAddress.city, deliveryAddress.state, "Nigeria"]
            .filter(Boolean).join(", ");

        const { results, error } = await geocodeAddress(scoped, { signal: controller.signal });
        if (controller.signal.aborted) return [];

        setIsSearching(false);
        setSuggestions(results);

        if (error) {
            //   A failed lookup is not "no such address". Saying so would send
            //   a buyer to correct an address that is already right.
            setSearchNotice(error);
            if (announce) showToast(error, "error");
            return [];
        }
        if (results.length === 0) {
            setSearchNotice("No match on the map. Check the spelling, or use Verify Address to place it by state.");
            if (announce) showToast("No matching address found.", "warning");
        }
        return results;
    }, [deliveryAddress.city, deliveryAddress.state, showToast]);

    /**
     * Place the pin at the middle of the state — the answer when the map has none.
     *
     *   Still the last resort rather than the first: it prices a delivery from
     *   the centre of a state, which is approximately right everywhere and
     *   exactly right nowhere.
     *
     *   LIFTED OUT OF geocodeManualAddress, because the SEARCH path needs it
     *   too and I had left it without one. The bypass below the field
     *   ("Use Address Anyway") renders only when `verificationError` is set, and
     *   the old 1000ms auto-geocode set it on every failure — so replacing that
     *   with a search that set only a quiet notice left a buyer whose address
     *   the map does not know with NO visible way forward until she pressed
     *   Complete Payment and was refused. That is the silent-refusal shape this
     *   audit keeps finding, introduced while fixing something else.
     */
    const fallbackToState = useCallback((reason: string | null, announce: boolean) => {
        const centroid = stateCentroid(deliveryAddress.state);

        if (centroid) {
            setDestinationCoords(centroid);
            setIsAddressVerified(true);
            setVerificationError(null);
            setSearchNotice(null);
            if (announce) {
                showToast(`Address placed using ${deliveryAddress.state} state coordinates.`, "success");
            }
            return;
        }

        setDestinationCoords(null);
        setIsAddressVerified(false);
        setVerificationError(reason
            || "We could not place this address. Please check the state, or continue anyway.");
        if (announce) showToast("Could not verify address.", "error");
    }, [deliveryAddress.state, showToast]);

    // Manual geocoding function for input addresses
    const geocodeManualAddress = useCallback(async (force = false) => {
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

        const { results, error } = await geocodeAddress(addressStr, { limit: 1 });
        setIsGeocoding(false);

        if (results.length > 0) {
            setDestinationCoords({ lat: results[0].lat, lng: results[0].lng });
            setIsAddressVerified(true);
            setVerificationError(null);
            showToast("Address located on the map.", "success");
            return;
        }

        //   A SERVICE FAILURE AND A GENUINE MISS ARE DIFFERENT THINGS and the
        //   Google version collapsed them, telling a buyer her address could
        //   not be found when the API key had been refused.
        fallbackToState(error
            ? `${error} Your address has been placed by state instead.`
            : null, true);
    }, [deliveryAddress, fallbackToState, showToast]);

    /*
     *   ── ONE LOOKUP PER PAUSE, NOT TWO ──────────────────────────────────────
     *
     *   This replaced two debounced effects, and for a while during the change
     *   it WAS two: a suggestion search at 800ms and the original auto-verify
     *   at 1000ms, both firing on the same typing. That is twice the request
     *   rate against a ceiling this platform does not control, for one buyer
     *   typing one address.
     *
     *   So there is one search, and the auto-verify rides the results it
     *   already has. It sets the COORDINATES only and leaves the typed city and
     *   state alone, exactly as the version before it did — filling the fields
     *   in is what picking a suggestion does, and doing it silently would
     *   overwrite what the buyer typed with the geocoder's spelling of it.
     *
     *   Nominatim's policy is the reason for the wait, and lib/nominatim owns
     *   the number so it cannot be tuned down from here.
     */
    useEffect(() => {
        if (isAddressVerified) return;

        const street = deliveryAddress.street.trim();
        if (street.length < 3) {
            setSuggestions([]);
            return;
        }

        const timer = setTimeout(async () => {
            const results = await searchAddress(street, false);

            //   Nothing is auto-placed until the address is complete enough to
            //   place. A half-typed one just shows its suggestions.
            if (!deliveryAddress.city.trim() || !deliveryAddress.state) return;

            if (results.length > 0) {
                setDestinationCoords({ lat: results[0].lat, lng: results[0].lng });
                setIsAddressVerified(true);
                setVerificationError(null);
                return;
            }

            //   No match, or the service did not answer. The auto-verify this
            //   replaced placed the pin by state here rather than leaving the
            //   buyer with nothing — and the bypass button renders off
            //   `verificationError`, which only this sets. Quiet, because the
            //   buyer did not ask for it: no toast on a keystroke-driven path.
            fallbackToState(null, false);
        }, SEARCH_DEBOUNCE_MS);

        return () => clearTimeout(timer);
    }, [
        deliveryAddress.street, deliveryAddress.city, deliveryAddress.state,
        isAddressVerified, searchAddress, fallbackToState,
    ]);

    //   Nothing in flight outlives the page.
    useEffect(() => () => { searchAbort.current?.abort(); }, []);

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

    const handleUseSavedAddress = async () => {
        if (!savedAddress) return;
        setDeliveryAddress({
            street: savedAddress.street,
            city: savedAddress.city,
            state: savedAddress.state,
            lga: savedAddress.lga,
        });
        setSuggestions([]);
        setSearchNotice(null);
        showToast("Address populated from your profile!", "success");

        /*
         *   THE SAME PLACEMENT AS THE TYPED PATH, through the same door.
         *
         *   This was seventy lines of Google Geocoder with three fallback
         *   branches that each rebuilt the state-centroid lookup, and the
         *   messages it could reach named the Google Cloud Console and a
         *   billing account — to a buyer, on a checkout screen, as an
         *   explanation of why her own saved address would not verify.
         */
        setIsGeocoding(true);
        const fullAddress = `${savedAddress.street}, ${savedAddress.city || ""}, ${savedAddress.state}, Nigeria`;
        const { results } = await geocodeAddress(fullAddress, { limit: 1 });
        setIsGeocoding(false);

        if (results.length > 0) {
            setDestinationCoords({ lat: results[0].lat, lng: results[0].lng });
            setIsAddressVerified(true);
            setVerificationError(null);
            return;
        }

        const centroid = stateCentroid(savedAddress.state);

        if (centroid) {
            setDestinationCoords(centroid);
            setIsAddressVerified(true);
            setVerificationError(null);
            return;
        }

        setIsAddressVerified(false);
        setVerificationError(
            "We could not place your saved address. Check the state on it, or continue anyway.");
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
            // #347 getItem itself throws where site data is blocked, and it sat
            // outside the try below.
            let guestCart: string | null = null;
            try { guestCart = localStorage.getItem("marketplace_cart"); } catch { /* no store */ }
            if (guestCart) {
                try {
                    const parsedGuestCart = JSON.parse(guestCart);
                    if (Array.isArray(parsedGuestCart) && parsedGuestCart.length > 0) {
                        localStorage.setItem(cartKey, guestCart);
                    }
                } catch (e) {
                    console.error("Failed to parse guest cart:", e);
                }
                try { localStorage.removeItem("marketplace_cart"); } catch { /* no store */ }
            }
        }

        /**
         *   #347 THE CHECKOUT PAGE, TAKEN DOWN BY ITS OWN CART.
         *
         *        `JSON.parse(savedCart)` here was unguarded — in an effect, so
         *        a throw unmounts to the error boundary and the buyer gets the
         *        error page instead of checkout, on every visit, until they
         *        clear site data.
         *
         *        The guest-cart migration TWELVE LINES ABOVE is wrapped in a
         *        try/catch and checks Array.isArray. The author knew; the guard
         *        went on the less important half. And a non-array that parses
         *        cleanly ("5", {}) reaches estimateCartWeight, which iterates
         *        it — a second throw the shape check now prevents.
         *
         *        An unreadable cart is an EMPTY cart, which this page already
         *        knows how to handle: it sends the buyer back to the
         *        marketplace. That is the fallback, and the bad value is
         *        dropped so the next visit starts clean.
         */
        let parsedCart: unknown = null;
        try {
            const savedCart = localStorage.getItem(cartKey);
            if (savedCart) parsedCart = JSON.parse(savedCart);
        } catch (e) {
            console.error("Failed to read the saved cart:", e);
            try { localStorage.removeItem(cartKey); } catch { /* storage is gone entirely */ }
        }

        if (Array.isArray(parsedCart) && parsedCart.length > 0) {
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
                const cartItems: CartItem[] = toCartItems(cart);
                const res = await calculateDeliveryAction(cartItems, {
                    /*
                     *   A DISTANCE WE ACTUALLY MEASURED, OR NONE AT ALL.
                     *
                     *   `distance` starts at 10 and is only recomputed by the
                     *   effect above once `destinationCoords` exists. So an
                     *   address that was never placed on the map still sent
                     *   "10", and the server priced a ten-kilometre delivery
                     *   from it — for a buyer who might be four hundred away.
                     *
                     *   destinationCoords is null exactly when nothing placed
                     *   the address: neither the geocoder nor the state
                     *   centroid. Sending no distance in that case is the
                     *   honest answer, and deliveryFeeFor already handles it —
                     *   an absent distance falls back to `freeDistanceKm`, so
                     *   no distance surcharge is applied. That IS the "standard
                     *   base rate" the screen promises when it cannot verify an
                     *   address; it was simply never what the code did.
                     */
                    distance: destinationCoords ? distance : undefined,
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
        //   destinationCoords is read inside now: the quote must change when the
        //   address becomes placed or unplaced, because that is exactly when the
        //   distance surcharge starts or stops applying.
    }, [cart, distance, weight, isWithinCityCenter, destinationCoords, showToast]);

    const subtotal = cart.reduce((sum, item) => sum + unitPriceOf(item) * item.quantity, 0);

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
            setError("Address verification is required. If the map cannot locate your address, click the 'Use Address Anyway' option under the Street Address field to proceed.");
            showToast("Address verification required.", "error");
            if (!verificationError) {
                setVerificationError("Address verification is required. If your address is not found, click 'Use Address Anyway' below to proceed.");
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
            const cartItems: CartItem[] = toCartItems(cart);

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
                    //   Measured, or absent. See the note at the fee preview.
                    distance: destinationCoords ? distance : undefined,
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
                                        const price = unitPriceOf(item);
                                        //   #873 What it would have cost without the negotiation.
                                        const listPrice = item.pricingTiers?.[0]?.price || 0;
                                        const negotiated = !!item.quoteId && price < listPrice;
                                        return (
                                            <div
                                                key={item.id}
                                                className="flex items-start gap-4 pb-4 border-b border-slate-200 last:border-0"
                                            >
                                                <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-slate-100">
                                                    {firstImageSrc(item.images) ? (
                                                        <Image
                                                            src={firstImageSrc(item.images)!}
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
                                                        {negotiated && (
                                                            <>
                                                                {" "}
                                                                <span className="line-through text-slate-400">
                                                                    {formatCurrency(listPrice)}
                                                                </span>
                                                                <span className="ml-2 inline-block px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                                                                    Agreed price
                                                                </span>
                                                            </>
                                                        )}
                                                    </p>
                                                    <div className="flex items-center gap-4">
                                                        {/*
                                                          *   #873 A NEGOTIATED LINE'S QUANTITY IS FIXED.
                                                          *
                                                          *   The agreed price was agreed for this many —
                                                          *   a volume price is cheap because of the
                                                          *   volume — so the server refuses any other
                                                          *   number. Showing a stepper that produces a
                                                          *   refusal at the last step is worse than
                                                          *   showing no stepper and saying why.
                                                          */}
                                                        {item.quoteId ? (
                                                            <span className="text-sm text-slate-600">
                                                                <span className="font-semibold text-slate-900">
                                                                    {item.quantity} {item.unit}
                                                                </span>{" "}
                                                                — the quantity you agreed
                                                            </span>
                                                        ) : (
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
                                                        )}
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
                                            placeholder="e.g. 123 Main Street"
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary"
                                            autoComplete="off"
                                            required
                                        />

                                        {/*
                                          *   THE SUGGESTION LIST, which replaces the
                                          *   Google Places dropdown. It is a real list
                                          *   in this page rather than a control Google
                                          *   attaches to the input, so it is styled with
                                          *   the rest of the form and cannot be painted
                                          *   grey by a refused key.
                                          */}
                                        {suggestions.length > 0 && !isAddressVerified && (
                                            <ul className="mt-2 border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 bg-white shadow-sm">
                                                {suggestions.map((place, index) => (
                                                    <li key={`${place.lat},${place.lng},${index}`}>
                                                        <button
                                                            type="button"
                                                            onClick={() => applySuggestion(place)}
                                                            className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                                                        >
                                                            {place.label}
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}

                                        <div className="mt-2 space-y-2">
                                            <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                                                <div>
                                                    {isGeocoding || isSearching ? (
                                                        <span className="text-blue-600 font-medium flex items-center gap-1 animate-pulse">
                                                            🌀 Searching OpenStreetMap...
                                                         </span>
                                                    ) : isAddressVerified && destinationCoords ? (
                                                        <span className="text-green-600 font-semibold flex items-center gap-1">
                                                            🟢 Address verified (Distance: {distance} km)
                                                        </span>
                                                    ) : searchNotice ? (
                                                        <span className="text-amber-600 font-medium flex items-center gap-1">
                                                            🟡 {searchNotice}
                                                        </span>
                                                    ) : (
                                                        <span className="text-amber-600 font-medium flex items-center gap-1">
                                                            🟡 Address unverified. Select from suggestions or click verify.
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    {/*
                                                      *   The deliberate press. Typing pauses
                                                      *   search too, but a buyer who wants an
                                                      *   answer NOW should not have to stop
                                                      *   typing to get one — and Nominatim's
                                                      *   policy is the reason there is no
                                                      *   per-keystroke option. See
                                                      *   lib/nominatim.
                                                      */}
                                                    <button
                                                        type="button"
                                                        onClick={() => searchAddress(deliveryAddress.street, true)}
                                                        disabled={isSearching || !deliveryAddress.street.trim()}
                                                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-semibold rounded-lg border border-slate-300 transition-colors"
                                                    >
                                                        Search
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => geocodeManualAddress(true)}
                                                        disabled={isGeocoding || !deliveryAddress.street.trim()}
                                                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-semibold rounded-lg border border-slate-300 transition-colors"
                                                    >
                                                        Verify Address
                                                    </button>
                                                </div>
                                            </div>

                                            {isAddressVerified && destinationCoords && (
                                                <div className="mt-3">
                                                    <CheckoutRouteMap
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
                                                            /*
                                                             *   THE OWNER: "checkout on marketplace wasn't
                                                             *   implementing the user's delivery address. it was
                                                             *   hardcoding the address and wasn't changing it."
                                                             *
                                                             *   THIS BUTTON WAS THE HARDCODING. It read:
                                                             *
                                                             *       setDestinationCoords({ lat: 6.5244, lng: 3.3792 });
                                                             *       setDistance(10);
                                                             *
                                                             *   — Lagos, and a flat ten kilometres, for every buyer
                                                             *   who pressed it, whatever they had typed. And the
                                                             *   screen TELLS them to press it: "If the map cannot
                                                             *   locate your address, click the 'Use Address Anyway'
                                                             *   option."
                                                             *
                                                             *   The stored street, city, state and LGA stayed
                                                             *   correct, so the seller still shipped to the right
                                                             *   place. What went wrong is what the buyer SAW — a map
                                                             *   showing Lagos — and what they were CHARGED:
                                                             *   `distance` travels to the server, which takes
                                                             *   `location?.distance || 10` and prices delivery from
                                                             *   it. A buyer in Maiduguri was quoted a ten-kilometre
                                                             *   Lagos delivery.
                                                             *
                                                             *   fallbackToState is the rule its two siblings already
                                                             *   use — the typed path and the saved-address path both
                                                             *   place the buyer at their own state's centroid. This
                                                             *   was the one door that invented a location instead.
                                                             *   With real coordinates set, the distance effect
                                                             *   computes the real distance from the seller's
                                                             *   products; nothing here has to state a number.
                                                             */
                                                            fallbackToState(
                                                                "We could not place this address, and your state was "
                                                                + "not recognised either. Check the state on the "
                                                                + "address, or continue and we will use a standard "
                                                                + "shipping rate.",
                                                                true,
                                                            );
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
                                                setVerificationError(null);
                                                // Auto-set coords from the local state table — no lookup needed
                                                const centroid = stateCentroid(selectedState);
                                                if (centroid) {
                                                    setDestinationCoords(centroid);
                                                    setIsAddressVerified(true);
                                                } else {
                                                    setIsAddressVerified(false);
                                                    setDestinationCoords(null);
                                                }
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
                                                setVerificationError(null);
                                                // Keep state-level coords when LGA changes — map already verified at state level
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
            </div>
        </MarketplaceErrorBoundary>
    );
}
