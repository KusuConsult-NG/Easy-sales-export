"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import { Icon, LatLngBounds } from "leaflet";
import { motion } from "framer-motion";
import { MapPin, Droplets, Zap, Route } from "lucide-react";
import { type LandListing, SoilQuality } from "@/types/strict";
import { formatCurrency } from "@/lib/utils";
import "leaflet/dist/leaflet.css";

// Fix for default marker icon in Next.js
if (typeof window !== 'undefined') {
    delete (Icon.Default.prototype as any)._getIconUrl;
    Icon.Default.mergeOptions({
        iconRetinaUrl: '/leaflet/marker-icon-2x.png',
        iconUrl: '/leaflet/marker-icon.png',
        shadowUrl: '/leaflet/marker-shadow.png',
    });
}

interface LandMapProps {
    listings: LandListing[];
    onListingClick?: (listing: LandListing) => void;
    selectedListing?: LandListing | null;
    height?: string;
}

// Component to auto-fit bounds
function AutoFitBounds({ listings }: { listings: LandListing[] }) {
    const map = useMap();

    useEffect(() => {
        if (listings.length === 0) return;

        const bounds = new LatLngBounds(
            listings.map(listing => [listing.location.lat, listing.location.lng])
        );

        map.fitBounds(bounds, { padding: [50, 50] });
    }, [listings, map]);

    return null;
}

// Custom marker icon based on soil quality
function getMarkerIcon(soilQuality: SoilQuality): Icon {
    const colors = {
        [SoilQuality.EXCELLENT]: '#22c55e', // green
        [SoilQuality.GOOD]: '#84cc16',      // lime
        [SoilQuality.FAIR]: '#eab308',      // yellow
        [SoilQuality.POOR]: '#ef4444',      // red
    };

    const color = colors[soilQuality];

    return new Icon({
        iconUrl: `data:image/svg+xml;utf8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32">
        <path fill="${color}" stroke="white" stroke-width="2" 
          d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
        <circle cx="12" cy="9" r="3" fill="white"/>
      </svg>
    `)}`,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
    });
}

function getSoilQualityColor(quality: SoilQuality): string {
    const colors = {
        [SoilQuality.EXCELLENT]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        [SoilQuality.GOOD]: 'bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200',
        [SoilQuality.FAIR]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        [SoilQuality.POOR]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    };
    return colors[quality];
}

export function LandMap({
    listings,
    onListingClick,
    selectedListing,
    height = "500px"
}: LandMapProps) {
    const [mounted, setMounted] = useState(false);

    // Only render map on client-side
    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <div
                className="w-full bg-slate-200 dark:bg-slate-700 rounded-xl flex items-center justify-center"
                style={{ height }}
            >
                <p className="text-slate-600 dark:text-slate-400">Loading map...</p>
            </div>
        );
    }

    // Default center: Nigeria
    const defaultCenter: [number, number] = [9.0820, 8.6753];

    return (
        <div className="relative" style={{ height }}>
            <MapContainer
                center={defaultCenter}
                zoom={6}
                style={{ height: '100%', width: '100%', borderRadius: '12px' }}
                className="z-0"
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <AutoFitBounds listings={listings} />

                {/* Markers */}
                {listings.map((listing) => (
                    <Marker
                        key={listing.id}
                        position={[listing.location.lat, listing.location.lng]}
                        icon={getMarkerIcon(listing.soilQuality)}
                        eventHandlers={{
                            click: () => onListingClick?.(listing),
                        }}
                    >
                        <Popup>
                            <div className="p-2 min-w-[250px]">
                                <h3 className="font-bold text-lg mb-2">{listing.title}</h3>

                                <div className="space-y-2 text-sm">
                                    {/* Price */}
                                    <div>
                                        <p className="text-2xl font-bold text-[#1358ec] mb-1">
                                            {formatCurrency(listing.price)}
                                        </p>
                                    </div>

                                    {/* Location */}
                                    <div className="flex items-start gap-2">
                                        <MapPin className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                                        <div>
                                            <p className="font-medium">{listing.location.address}</p>
                                            <p className="text-slate-600">{listing.location.city}, {listing.location.state}</p>
                                        </div>
                                    </div>

                                    {/* Acreage */}
                                    <div>
                                        <p className="text-slate-700">
                                            <span className="font-semibold">{listing.acreage}</span> acres
                                        </p>
                                    </div>

                                    {/* Soil Quality */}
                                    <div>
                                        <span className={`inline-block px-2 py-1 rounded-lg text-xs font-bold ${getSoilQualityColor(listing.soilQuality)}`}>
                                            {listing.soilQuality.toUpperCase()} Soil
                                        </span>
                                    </div>

                                    {/* Amenities */}
                                    <div className="flex gap-3 pt-2 border-t border-slate-200">
                                        <div className={`flex items-center gap-1 ${listing.waterAccess ? 'text-blue-600' : 'text-slate-400'}`}>
                                            <Droplets className="w-4 h-4" />
                                            <span className="text-xs">Water</span>
                                        </div>
                                        <div className={`flex items-center gap-1 ${listing.electricityAccess ? 'text-yellow-600' : 'text-slate-400'}`}>
                                            <Zap className="w-4 h-4" />
                                            <span className="text-xs">Power</span>
                                        </div>
                                        <div className={`flex items-center gap-1 ${listing.roadAccess ? 'text-slate-600' : 'text-slate-400'}`}>
                                            <Route className="w-4 h-4" />
                                            <span className="text-xs">Road</span>
                                        </div>
                                    </div>

                                    {/* Status Badge */}
                                    <div className="pt-2">
                                        <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${listing.status === 'verified'
                                                ? 'bg-green-100 text-green-800'
                                                : listing.status === 'rejected'
                                                    ? 'bg-red-100 text-red-800'
                                                    : 'bg-yellow-100 text-yellow-800'
                                            }`}>
                                            {listing.status.replace('_', ' ').toUpperCase()}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </Popup>
                    </Marker>
                ))}
            </MapContainer>

            {/* Legend */}
            <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="absolute top-4 left-4 bg-white dark:bg-slate-800 rounded-xl p-4 shadow-lg z-[1000]"
            >
                <h4 className="font-bold text-sm mb-3 text-slate-900 dark:text-white">Soil Quality</h4>
                <div className="space-y-2">
                    {[
                        { quality: SoilQuality.EXCELLENT, label: 'Excellent', color: '#22c55e' },
                        { quality: SoilQuality.GOOD, label: 'Good', color: '#84cc16' },
                        { quality: SoilQuality.FAIR, label: 'Fair', color: '#eab308' },
                        { quality: SoilQuality.POOR, label: 'Poor', color: '#ef4444' },
                    ].map(({ quality, label, color }) => (
                        <div key={quality} className="flex items-center gap-2">
                            <div
                                className="w-4 h-4 rounded-full border-2 border-white shadow"
                                style={{ backgroundColor: color }}
                            />
                            <span className="text-xs text-slate-600 dark:text-slate-400">{label}</span>
                        </div>
                    ))}
                </div>
            </motion.div>

            {/* Stats Overlay */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute bottom-4 right-4 bg-white dark:bg-slate-800 rounded-xl p-4 shadow-lg z-[1000]"
            >
                <p className="text-2xl font-bold text-[#1358ec] mb-1">{listings.length}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                    {listings.length === 1 ? 'Listing' : 'Listings'}
                </p>
            </motion.div>
        </div>
    );
}
