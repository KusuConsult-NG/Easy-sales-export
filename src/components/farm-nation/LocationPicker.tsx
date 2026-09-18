"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
//   #868 The bounding box and the centre live in lib, not here: importing this
//   component to check four numbers drags Leaflet and a DOM in behind them.
import { NIGERIA_CENTRE, isWithinNigeria } from "@/lib/nigeria-bounds";

/**
 * Pick a point on a map instead of typing two numbers.
 *
 *   #868 THE FORM ASKED A SELLER FOR HER LATITUDE.
 *
 *   THE OWNER: "Map API (Plus Codes or any free API we can use apart from Google
 *   Maps, and that can also be mapped to a location picker)."
 *
 *   MEASURED FIRST, and half the request was already satisfied: the browse maps
 *   — components/farm-nation/MapView and app/land/LandMapClient — are Leaflet
 *   over `tile.openstreetmap.org`. No Google, no key, no billing account. That
 *   is worth stating plainly because the worry behind the request does not apply
 *   to the map itself.
 *
 *   WHAT WAS ACTUALLY MISSING IS THIS. The listing form asked for GPS as two
 *   `<input type="number">` boxes — "Latitude", "Longitude", "e.g. 9.0820" —
 *   with a hint about Nigeria's bounds. A farmer in Oji River is expected to
 *   know her land's decimal coordinates to six places, or to leave the field
 *   empty. The field is optional, so what actually happened is that it was left
 *   empty, and #340's map filter then dropped the listing: a parcel with no
 *   coordinates cannot be placed, so it appears on no map at all.
 *
 *   So the map was free and the way to feed it was not usable. This is the
 *   picker.
 *
 * ── PLUS CODES ARE AN ENCODING, NOT A MAP ───────────────────────────────────
 *
 *   Named in the request, and worth answering rather than quietly ignoring. An
 *   Open Location Code ("6FR5CQ8R+9V") is a way of WRITING a coordinate
 *   compactly — it is not a tile source and not a geocoder, and adopting it
 *   would still leave the question of what draws the map. Leaflet with
 *   OpenStreetMap answers that, is already a dependency of this project, and is
 *   already what the two existing maps use. Adding a second mapping library for
 *   one form would be the thing this audit keeps finding.
 *
 * ── NO REVERSE GEOCODING, DELIBERATELY ──────────────────────────────────────
 *
 *   The obvious next step is to look up the state and LGA from the pin. It is
 *   not taken: Nominatim is the free service that would do it, its usage policy
 *   requires a stable identifying User-Agent and rate limiting, and a form that
 *   silently depends on a third-party lookup fails in a way the seller cannot
 *   act on. #857 already made state and LGA dependent dropdowns over the
 *   platform's own data, so the address is collected correctly without it.
 */

export interface LocationPickerProps {
    latitude: string;
    longitude: string;
    /** Both together, because a half-set coordinate places nothing. */
    onChange: (next: { latitude: string; longitude: string }) => void;
    /**
     *   #871 THE SAME MAP, SHOWING rather than asking.
     *
     *   THE OWNER: "where users have coordinates of latitude and longitude, the
     *   map picks the location and display it on the details (can this be
     *   done)." It can, and it was not there — the property page never read
     *   `gpsCoordinates` at all, so a seller who placed her land on the map
     *   showed a buyer nothing.
     *
     *   A FLAG ON THIS COMPONENT RATHER THAN A SECOND ONE. A read-only view is
     *   this component without the click, the drag and the buttons; the tiles,
     *   the marker, the centring and the teardown are identical. A separate
     *   PropertyMap would be a second copy of all of that, and the tile URL is
     *   exactly the line that should exist once (#868).
     */
    readOnly?: boolean;
}

/** Six decimal places is about 10cm — past that is noise in a land listing. */
const fmt = (n: number) => n.toFixed(6);

export default function LocationPicker({
    latitude, longitude, onChange, readOnly = false,
}: LocationPickerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const markerRef = useRef<L.Marker | null>(null);
    /*
     *   Held in a ref so the map's click handler, bound once, always calls the
     *   CURRENT onChange. Re-binding it on every render would mean tearing the
     *   map down and rebuilding it as the parent's state changes, which is both
     *   slow and visible.
     *
     *   ASSIGNED IN AN EFFECT, not during render. Writing to a ref while
     *   rendering is what React's own lint rule refuses — under concurrent
     *   rendering a render can be thrown away, and a ref written during one is a
     *   side effect that escaped it.
     */
    const onChangeRef = useRef(onChange);
    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    //   Read in the build effect, which runs once — so it is held the same way
    //   and for the same reason as onChange.
    const readOnlyRef = useRef(readOnly);
    useEffect(() => {
        readOnlyRef.current = readOnly;
    }, [readOnly]);

    const lat = Number(latitude);
    const lng = Number(longitude);
    const hasPoint = Number.isFinite(lat) && Number.isFinite(lng)
        && latitude !== "" && longitude !== "";

    //   Build once. A map rebuilt on each keystroke loses the seller's zoom and
    //   pan, which is the whole value of a picker.
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const map = L.map(containerRef.current).setView([...NIGERIA_CENTRE] as [number, number], 6);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "© OpenStreetMap contributors",
            maxZoom: 18,
        }).addTo(map);

        //   #871 A read-only map is not a broken picker: clicking it must do
        //   nothing at all rather than silently move a pin a buyer cannot save.
        if (!readOnlyRef.current) {
            map.on("click", (e: L.LeafletMouseEvent) => {
                onChangeRef.current({
                    latitude: fmt(e.latlng.lat),
                    longitude: fmt(e.latlng.lng),
                });
            });
        }

        mapRef.current = map;

        return () => {
            map.remove();
            mapRef.current = null;
            markerRef.current = null;
        };
    }, []);

    //   The marker follows the VALUES, not the clicks, so typing into the two
    //   number fields moves the pin exactly as clicking does. One source of
    //   truth, and the fields stay usable for anyone who does have coordinates.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        if (!hasPoint) {
            if (markerRef.current) {
                map.removeLayer(markerRef.current);
                markerRef.current = null;
            }
            return;
        }

        const point: [number, number] = [lat, lng];

        if (!markerRef.current) {
            const marker = L.marker(point, { draggable: !readOnlyRef.current }).addTo(map);
            marker.on("dragend", () => {
                const p = marker.getLatLng();
                onChangeRef.current({ latitude: fmt(p.lat), longitude: fmt(p.lng) });
            });
            markerRef.current = marker;
            map.setView(point, Math.max(map.getZoom(), 13));
        } else {
            markerRef.current.setLatLng(point);
        }
    }, [lat, lng, hasPoint]);

    const useMyLocation = () => {
        if (typeof navigator === "undefined" || !navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            (pos) => onChangeRef.current({
                latitude: fmt(pos.coords.latitude),
                longitude: fmt(pos.coords.longitude),
            }),
            //   Swallowed: a refused permission is the seller's choice, and the
            //   map and the two fields both still work without it.
            () => undefined,
            { enableHighAccuracy: true, timeout: 10_000 },
        );
    };

    const outsideNigeria = hasPoint && !isWithinNigeria(lat, lng);

    return (
        <div className="space-y-2">
            {!readOnly && (
                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-blue-700">
                        Tap the map where the land is, or drag the pin to adjust it.
                    </p>
                    <button
                        type="button"
                        onClick={useMyLocation}
                        className="shrink-0 px-3 py-1.5 text-xs font-semibold bg-white border border-blue-300 rounded-lg text-blue-700 hover:bg-blue-50 transition"
                    >
                        Use my location
                    </button>
                </div>
            )}

            <div
                ref={containerRef}
                data-testid="location-picker-map"
                className="h-64 w-full rounded-lg border border-blue-300 overflow-hidden"
            />

            {hasPoint && (
                <p className="text-xs text-blue-900">
                    {readOnly ? "Coordinates" : "Selected"}: {fmt(lat)}, {fmt(lng)}
                </p>
            )}

            {/*
              *   A WARNING, NOT A REFUSAL. The coordinate is still stored — a
              *   seller near a border, or one correcting a pin, must not be
              *   blocked by a bounding box — but a pin dropped in the wrong
              *   hemisphere by a stray tap should say so while she can see it.
              */}
            {!readOnly && outsideNigeria && (
                <p className="text-xs font-semibold text-amber-700">
                    That point is outside Nigeria. Check the pin before submitting.
                </p>
            )}
        </div>
    );
}
