"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import { Icon, LatLngBounds } from "leaflet";
import { motion } from "framer-motion";
import { MapPin, Droplets, Zap, Route } from "lucide-react";
import { type LandListing, SoilQuality } from "@/types/strict";
import { readLandLocation, landLocationText } from "@/lib/land-location";
import { readSoil, soilKey } from "@/lib/land-soil";
import { formatCurrency } from "@/lib/utils";
import { humaniseUpper } from "@/lib/humanise";
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
        /*
         *   #901 THE SAME COORDINATES THE PINS USE, AND ONLY THE REAL ONES.
         *
         *   `listings.map(l => [l.location.lat, l.location.lng])` handed
         *   LatLngBounds a list of [undefined, undefined] for every live row —
         *   see the markers below for why none of them carries location.lat —
         *   and Leaflet rejects that, from an effect, before a single pin is
         *   drawn. A map that cannot fit its bounds must still show its tiles,
         *   so an unplottable listing is skipped rather than fatal.
         */
        const points = listings
            .map((listing) => readLandLocation(listing as any))
            .filter((where) => where.lat !== null && where.lng !== null)
            .map((where) => [where.lat as number, where.lng as number] as [number, number]);

        if (points.length === 0) return;

        map.fitBounds(new LatLngBounds(points), { padding: [50, 50] });
    }, [listings, map]);

    return null;
}

// Custom marker icon based on soil quality
function getMarkerIcon(soilQuality: SoilQuality): Icon {
    const colors: Record<string, string> = {
        [SoilQuality.EXCELLENT]: '#22c55e', // green
        [SoilQuality.GOOD]: '#84cc16',      // lime
        [SoilQuality.FAIR]: '#eab308',      // yellow
        [SoilQuality.POOR]: '#ef4444',      // red
        [SoilQuality.FERTILE]: '#10b981',   // emerald
        [SoilQuality.SANDY]: '#f97316',     // orange
        [SoilQuality.LOAMY]: '#f59e0b',     // amber
        [SoilQuality.CLAY]: '#78716c',      // stone
        [SoilQuality.MIXED]: '#06b6d4',     // cyan
        [SoilQuality.UNKNOWN]: '#6b7280',   // gray
    };

    const color = colors[soilQuality] || '#6b7280';

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
    const colors: Record<string, string> = {
        [SoilQuality.EXCELLENT]: 'bg-green-100 text-green-800',
        [SoilQuality.GOOD]: 'bg-lime-100 text-lime-800',
        [SoilQuality.FAIR]: 'bg-yellow-100 text-yellow-800',
        [SoilQuality.POOR]: 'bg-red-100 text-red-800',
        [SoilQuality.FERTILE]: 'bg-emerald-100 text-emerald-800',
        [SoilQuality.SANDY]: 'bg-orange-100 text-orange-800',
        [SoilQuality.LOAMY]: 'bg-amber-100 text-amber-800',
        [SoilQuality.CLAY]: 'bg-stone-100 text-stone-800',
        [SoilQuality.MIXED]: 'bg-cyan-100 text-cyan-800',
        [SoilQuality.UNKNOWN]: 'bg-gray-100 text-gray-800',
    };
    return colors[quality] || 'bg-gray-100 text-gray-800';
}

export function LandMap({
    listings,
    onListingClick,
    selectedListing,
    height = "500px"
}: LandMapProps) {
    const [mounted, setMounted] = useState(false);

    // Only render map on client-side — setMounted(true) in a mount effect is idiomatic
    // for SSR hydration guards; this single call does not cause a re-render cascade.
    useEffect(() => {
         
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <div
                className="w-full bg-slate-200 rounded-xl flex items-center justify-center"
                style={{ height }}
            >
                <p className="text-slate-600">Loading map...</p>
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

                {/*
                  *   #901 Markers, FROM THE COORDINATES THE ROW ACTUALLY HAS.
                  *
                  *   This read `listing.location.lat` / `.lng` directly. No live
                  *   writer of LAND_LISTINGS stores those: `submitLandListingAction`
                  *   writes `location: { state, lga, address }` and puts the
                  *   coordinates in `gpsCoordinates`, farm-nation writes `location`
                  *   as a STRING, and the one writer of the lat/lng shape —
                  *   createLandListing in land-actions.ts — has no caller anywhere.
                  *
                  *   So every pin on the public land map was
                  *   `position={[undefined, undefined]}`, which Leaflet rejects
                  *   ("Invalid LatLng object") from inside the .map — #598's finding
                  *   in this very file, which was fixed in the grid beside this
                  *   component and never entered the component.
                  *
                  *   readLandLocation is #689's shared reader and resolves all four
                  *   shapes, including gpsCoordinates. It returns null when the row
                  *   truly has no coordinates, and a parcel whose position is not
                  *   recorded is LEFT OFF THE MAP rather than plotted at (0, 0) off
                  *   the coast of Ghana, or allowed to take the map down.
                  */}
                {listings.map((listing) => {
                    const where = readLandLocation(listing as any);
                    if (where.lat === null || where.lng === null) return null;
                    const soil = readSoil(listing as any);

                    return (
                    <Marker
                        key={listing.id}
                        position={[where.lat, where.lng]}
                        //   #901 Keyed through soilKey: the colour tables use the
                        //   enum's lower-case values and the form writes "Clay".
                        icon={getMarkerIcon(soilKey(soil) as SoilQuality)}
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
                                            {/*   #901 landLocationText builds the line from
                                              *   the parts that exist, so a row with no
                                              *   `city` does not render a leading comma —
                                              *   the stray-comma defect #689 wrote it for. */}
                                            <p className="font-medium">{landLocationText(listing as any)}</p>
                                        </div>
                                    </div>

                                    {/* Acreage */}
                                    <div>
                                        <p className="text-slate-900">
                                            <span className="font-semibold">{(listing.size * 2.47).toFixed(1)}</span> acres
                                        </p>
                                    </div>

                                    {/*   #901 Soil, ONLY WHEN THE ROW RECORDS ONE.
                                      *
                                      *   `listing.soilQuality.toUpperCase()` threw on
                                      *   every row the platform has: the field is
                                      *   written by nothing. readSoil accepts the
                                      *   `soilType` live writers use as well. */}
                                    {soil && (
                                        <div>
                                            <span className={`inline-block px-2 py-1 rounded-lg text-xs font-bold ${getSoilQualityColor(soilKey(soil) as SoilQuality)}`}>
                                                {soil.toUpperCase()} Soil
                                            </span>
                                        </div>
                                    )}

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
                                            {humaniseUpper(listing.status)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </Popup>
                    </Marker>
                    );
                })}
            </MapContainer>

            {/* Legend */}
            <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="absolute top-4 left-4 bg-white rounded-xl p-4 shadow-lg z-40"
            >
                <h4 className="font-bold text-sm mb-3 text-slate-900">Soil Quality</h4>
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
                            <span className="text-xs text-slate-600">{label}</span>
                        </div>
                    ))}
                </div>
            </motion.div>

            {/* Stats Overlay */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute bottom-4 right-4 bg-white rounded-xl p-4 shadow-lg z-40"
            >
                <p className="text-2xl font-bold text-[#1358ec] mb-1">{listings.length}</p>
                <p className="text-xs text-slate-600">
                    {listings.length === 1 ? 'Listing' : 'Listings'}
                </p>
            </motion.div>
        </div>
    );
}
