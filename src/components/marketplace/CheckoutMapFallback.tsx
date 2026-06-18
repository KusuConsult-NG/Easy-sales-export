"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix for default Leaflet icon paths in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
    iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

// Custom markers styling (Premium Tailwind elements wrapped in DivIcon)
const destinationIcon = L.divIcon({
    html: `
        <div class="relative flex items-center justify-center">
            <span class="absolute inline-flex h-8 w-8 animate-ping rounded-full bg-red-400 opacity-75"></span>
            <div class="relative flex items-center justify-center w-8 h-8 rounded-full bg-red-600 border-2 border-white shadow-lg text-white text-xs font-bold animate-bounce">
                📍
            </div>
        </div>
    `,
    className: "custom-destination-icon",
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
});

const sourceIcon = L.divIcon({
    html: `
        <div class="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-600 border-2 border-white shadow-lg text-white text-xs font-bold">
            📦
        </div>
    `,
    className: "custom-source-icon",
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
});

interface ProductMarker {
    id: string;
    name: string;
    coords: { lat: number; lng: number } | null;
    locationName?: string;
}

interface ValidProductMarker {
    id: string;
    name: string;
    coords: { lat: number; lng: number };
    locationName?: string;
}

interface CheckoutMapFallbackProps {
    destination: { lat: number; lng: number };
    products: ProductMarker[];
}

// Map controller to adjust viewport bounds automatically
function MapController({ bounds, center }: { bounds: L.LatLngBoundsExpression; center: L.LatLngExpression }) {
    const map = useMap();
    
    useEffect(() => {
        if (bounds && (bounds as any).length > 1) {
            map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
        } else {
            map.setView(center, 11);
        }
    }, [bounds, center, map]);

    return null;
}

export default function CheckoutMapFallback({ destination, products }: CheckoutMapFallbackProps) {
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!isMounted) {
        return (
            <div className="h-[300px] w-full bg-slate-50 flex items-center justify-center text-slate-400 text-sm">
                Initializing Map...
            </div>
        );
    }

    const validProducts = products.filter(p => p.coords !== null) as unknown as ValidProductMarker[];
    const centerPoint: L.LatLngTuple = [destination.lat, destination.lng];
    
    // Construct bounds covering destination + all products
    const bounds: L.LatLngTuple[] = [centerPoint];
    validProducts.forEach(p => {
        bounds.push([p.coords.lat, p.coords.lng]);
    });

    return (
        <div className="relative w-full h-[300px] rounded-xl overflow-hidden border border-slate-200 shadow-inner z-10">
            <MapContainer
                center={centerPoint}
                zoom={11}
                scrollWheelZoom={false}
                style={{ height: "100%", width: "100%" }}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {/* Destination Marker */}
                <Marker position={centerPoint} icon={destinationIcon}>
                    <Popup>
                        <div className="p-1 font-sans">
                            <p className="font-bold text-slate-800 text-xs">Delivery Destination</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">Your entered address</p>
                        </div>
                    </Popup>
                </Marker>

                {/* Product/Source Markers */}
                {validProducts.map((p) => {
                    const productCoords: L.LatLngTuple = [p.coords.lat, p.coords.lng];
                    return (
                        <div key={p.id}>
                            <Marker position={productCoords} icon={sourceIcon}>
                                <Popup>
                                    <div className="p-1 font-sans">
                                        <p className="font-bold text-slate-800 text-xs">{p.name}</p>
                                        {p.locationName && (
                                            <p className="text-[10px] text-slate-500 mt-0.5">Origin: {p.locationName}</p>
                                        )}
                                    </div>
                                </Popup>
                            </Marker>

                            {/* Direct Polyline route link from source to destination */}
                            <Polyline
                                positions={[productCoords, centerPoint]}
                                pathOptions={{
                                    color: "#059669", // Emerald 600
                                    weight: 3,
                                    dashArray: "6, 8",
                                    opacity: 0.8
                                }}
                            />
                        </div>
                    );
                })}

                <MapController bounds={bounds} center={centerPoint} />
            </MapContainer>
        </div>
    );
}
