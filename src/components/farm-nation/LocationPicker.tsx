"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
//   #868 The bounding box and the centre live in lib, not here: importing this
//   component to check four numbers drags Leaflet and a DOM in behind them.
import { NIGERIA_CENTRE, isWithinNigeria } from "@/lib/nigeria-bounds";
import { NIGERIAN_STATE_COORDINATES } from "@/lib/locations";
//   #899 "Is this coordinate anywhere near the state the listing names?"
import { stateCentre, isFarFromState } from "@/lib/state-proximity";

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
     *   #880 THE STATE THE SELLER ALREADY CHOSE.
     *
     *   THE OWNER: "The location picker is hardcoding a location."
     *
     *   It was not writing a hardcoded VALUE — the marker follows the two
     *   number fields and there is no marker at all until there is a
     *   coordinate. What it did was OPEN IN THE SAME PLACE EVERY TIME: the
     *   build effect centres on NIGERIA_CENTRE at zoom 6, and nothing ever
     *   moved it. A seller who had just picked Kano, then Kano's LGA, was
     *   shown the middle of the country and had to find their own land by
     *   dragging — and a map that always shows one spot is a map that looks
     *   hardcoded, because from the seller's side it is.
     *
     *   Optional: the browse map mounts this component with no form behind it.
     */
    state?: string;
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
    latitude, longitude, onChange, readOnly = false, state,
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
    //   #899 Same reason as onChangeRef: the geolocation callback is created
    //   when the button is pressed and must read the CURRENT state, not the one
    //   captured when the component last rendered.
    const stateRef = useRef(state);
    useEffect(() => {
        stateRef.current = state;
    }, [state]);

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

    /**
     *   #880 OPEN WHERE THE SELLER SAID THE LAND IS.
     *
     *   Centres on the chosen state, and DEFERS TO A REAL COORDINATE: once
     *   there is a pin, the pin is the answer and re-centring would drag the
     *   seller away from the point they just placed. So this runs only while
     *   `hasPoint` is false — picking a state moves the view, dropping a pin
     *   ends the moving.
     *
     *   NIGERIAN_STATE_COORDINATES already exists in lib/locations.ts and the
     *   marketplace checkout already geocodes against it; a second table of
     *   state centroids would be a second thing to keep correct.
     */
    useEffect(() => {
        const map = mapRef.current;
        if (!map || hasPoint) return;

        const key = Object.keys(NIGERIAN_STATE_COORDINATES)
            .find((s) => s.toLowerCase() === String(state ?? "").trim().toLowerCase());
        if (!key) return;

        const { lat: sLat, lng: sLng } = NIGERIAN_STATE_COORDINATES[key];
        map.setView([sLat, sLng], 9);
    }, [state, hasPoint]);

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

    /*
     *   #899 THE LAND'S LOCATION WINS OVER THE SELLER'S.
     *
     *   THE OWNER: "when a user use the option of 'Use my location' and the
     *   product is in a different location, over-ride the 'use my location'
     *   with the location of the product so that the inspector doesn't get
     *   confused with the cordinates."
     *
     *   This dropped the pin on the device's GPS, full stop. A seller in Lagos
     *   listing family land in Benue stamped the listing with Lagos — while its
     *   own `state` field said Benue — and #866 then dispatches an inspector to
     *   the pin.
     *
     *   The coordinate is the one field on a listing nobody can sanity-check by
     *   reading it: state and LGA are dropdowns, the address is prose, and a
     *   pair of decimals looks equally plausible wherever it points.
     *
     *   So when the device is obviously not in the state the seller chose, the
     *   STATE wins and she is told. See lib/state-proximity for why the test is
     *   deliberately loose, and why "I cannot tell" never moves her pin.
     */
    const [overrodeLocation, setOverrodeLocation] = useState<string | null>(null);

    const useMyLocation = () => {
        if (typeof navigator === "undefined" || !navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                const centre = stateCentre(stateRef.current);

                if (centre && isFarFromState(here, stateRef.current)) {
                    onChangeRef.current({ latitude: fmt(centre.lat), longitude: fmt(centre.lng) });
                    setOverrodeLocation(String(stateRef.current));
                    return;
                }

                setOverrodeLocation(null);
                onChangeRef.current({
                    latitude: fmt(here.lat),
                    longitude: fmt(here.lng),
                });
            },
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

            {/*
              *   #899 SAID OUT LOUD, because the pin moved somewhere she did not
              *   put it. A silent override is the same class of defect as the
              *   wrong coordinate: she cannot tell what the listing will carry.
              */}
            {!readOnly && overrodeLocation && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Your device is not in {overrodeLocation}, so the pin was placed on{" "}
                    {overrodeLocation} instead — the state this listing names. Tap the
                    map to put it exactly on the land.
                </p>
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
