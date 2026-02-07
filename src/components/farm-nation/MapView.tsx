"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin } from "lucide-react";

type LandListing = {
    id: string;
    title: string;
    category: string;
    state: string;
    size: number;
    unit: string;
    totalPrice: number;
    gpsCoordinates?: {
        latitude: number;
        longitude: number;
    };
};

export default function MapView({ listings }: { listings: LandListing[] }) {
    const mapRef = useRef<L.Map | null>(null);
    const mapContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!mapContainerRef.current) return;

        // Initialize map
        if (!mapRef.current) {
            mapRef.current = L.map(mapContainerRef.current).setView([9.0820, 8.6753], 6);

            // Add OpenStreetMap tiles
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 18,
            }).addTo(mapRef.current);
        }

        // Clear existing markers
        mapRef.current.eachLayer((layer) => {
            if (layer instanceof L.Marker) {
                mapRef.current?.removeLayer(layer);
            }
        });

        // Category colors
        const categoryColors: Record<string, string> = {
            farmland: "#10b981",
            ranch: "#f59e0b",
            forest: "#059669",
            mixed: "#8b5cf6",
            orchard: "#ec4899",
            aquaculture: "#3b82f6"
        };

        // Add markers for each listing
        listings.forEach((listing) => {
            if (!listing.gpsCoordinates) return;

            const color = categoryColors[listing.category] || "#10b981";

            // Create custom icon
            const icon = L.divIcon({
                className: "custom-marker",
                html: `
                    <div style="
                        background-color: ${color};
                        width: 30px;
                        height: 30px;
                        border-radius: 50% 50% 50% 0;
                        transform: rotate(-45deg);
                        border: 3px solid white;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                        display: flex;
                        align-items: center;
                        justify-center;
                    ">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="white" transform="rotate(45)">
                            <path d="M12 0c-4.198 0-8 3.403-8 7.602 0 4.198 3.469 9.21 8 16.398 4.531-7.188 8-12.2 8-16.398 0-4.199-3.801-7.602-8-7.602zm0 11c-1.657 0-3-1.343-3-3s1.343-3 3-3 3 1.343 3 3-1.343 3-3 3z"/>
                        </svg>
                    </div>
                `,
                iconSize: [30, 30],
                iconAnchor: [15, 30],
            });

            const marker = L.marker(
                [listing.gpsCoordinates.latitude, listing.gpsCoordinates.longitude],
                { icon }
            ).addTo(mapRef.current!);

            // Add popup
            const popupContent = `
                <div style="min-width: 200px;">
                    <h3 style="font-weight: bold; margin-bottom: 8px; font-size: 14px;">${listing.title}</h3>
                    <p style="color: #64748b; font-size: 12px; margin-bottom: 4px;">${listing.state}</p>
                    <p style="font-size: 12px; margin-bottom: 4px;"><strong>Size:</strong> ${listing.size} ${listing.unit}</p>
                    <p style="font-size: 12px; margin-bottom: 8px;"><strong>Price:</strong> <span style="color: #10b981; font-weight: bold;">₦${listing.totalPrice.toLocaleString()}</span></p>
                    <a href="/farm-nation/${listing.id}" style="
                        display: inline-block;
                        background-color: #10b981;
                        color: white;
                        padding: 6px 12px;
                        border-radius: 6px;
                        text-decoration: none;
                        font-size: 12px;
                        font-weight: 600;
                    ">View Details</a>
                </div>
            `;

            marker.bindPopup(popupContent);
        });

        // Fit bounds if there are listings
        if (listings.length > 0) {
            const validListings = listings.filter(l => l.gpsCoordinates);
            if (validListings.length > 0) {
                const bounds = L.latLngBounds(
                    validListings.map(l => [l.gpsCoordinates!.latitude, l.gpsCoordinates!.longitude])
                );
                mapRef.current.fitBounds(bounds, { padding: [50, 50] });
            }
        }

        return () => {
            // Cleanup on unmount
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, [listings]);

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg overflow-hidden">
            <div
                ref={mapContainerRef}
                className="h-[600px] w-full"
                style={{ zIndex: 0 }}
            />

            {/* Legend */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-700">
                <p className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Land Categories:</p>
                <div className="flex flex-wrap gap-3">
                    {[
                        { name: "Farmland", color: "#10b981", icon: "🌾" },
                        { name: "Ranch", color: "#f59e0b", icon: "🐄" },
                        { name: "Forest", color: "#059669", icon: "🌲" },
                        { name: "Mixed", color: "#8b5cf6", icon: "🌻" },
                        { name: "Orchard", color: "#ec4899", icon: "🍊" },
                        { name: "Aquaculture", color: "#3b82f6", icon: "🐟" }
                    ].map(cat => (
                        <div key={cat.name} className="flex items-center gap-2">
                            <div
                                className="w-4 h-4 rounded-full border-2 border-white shadow"
                                style={{ backgroundColor: cat.color }}
                            />
                            <span className="text-xs text-slate-600 dark:text-slate-400">
                                {cat.icon} {cat.name}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
