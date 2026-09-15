/**
 * Polling units by state. GENERATED — DO NOT EDIT BY HAND.
 *
 * Built by scripts/build-polling-units.ts, which documents the source, the
 * join rules and what it refuses to guess. Re-run it rather than editing.
 *
 * 8687 wards, 172000 polling units, 37 states.
 *
 * SERVER ONLY. These shards total about five megabytes; lib/polling-units.ts
 * loads one state at a time and no client component imports them.
 */

export const POLLING_UNIT_SHARDS: Record<string, () => Promise<{ default: Record<string, string[]> }>> = {
    "Abia": () => import("./abia.json"),
    "Adamawa": () => import("./adamawa.json"),
    "Akwa Ibom": () => import("./akwa-ibom.json"),
    "Anambra": () => import("./anambra.json"),
    "Bauchi": () => import("./bauchi.json"),
    "Bayelsa": () => import("./bayelsa.json"),
    "Benue": () => import("./benue.json"),
    "Borno": () => import("./borno.json"),
    "Cross River": () => import("./cross-river.json"),
    "Delta": () => import("./delta.json"),
    "Ebonyi": () => import("./ebonyi.json"),
    "Edo": () => import("./edo.json"),
    "Ekiti": () => import("./ekiti.json"),
    "Enugu": () => import("./enugu.json"),
    "FCT": () => import("./fct.json"),
    "Gombe": () => import("./gombe.json"),
    "Imo": () => import("./imo.json"),
    "Jigawa": () => import("./jigawa.json"),
    "Kaduna": () => import("./kaduna.json"),
    "Kano": () => import("./kano.json"),
    "Katsina": () => import("./katsina.json"),
    "Kebbi": () => import("./kebbi.json"),
    "Kogi": () => import("./kogi.json"),
    "Kwara": () => import("./kwara.json"),
    "Lagos": () => import("./lagos.json"),
    "Nasarawa": () => import("./nasarawa.json"),
    "Niger": () => import("./niger.json"),
    "Ogun": () => import("./ogun.json"),
    "Ondo": () => import("./ondo.json"),
    "Osun": () => import("./osun.json"),
    "Oyo": () => import("./oyo.json"),
    "Plateau": () => import("./plateau.json"),
    "Rivers": () => import("./rivers.json"),
    "Sokoto": () => import("./sokoto.json"),
    "Taraba": () => import("./taraba.json"),
    "Yobe": () => import("./yobe.json"),
    "Zamfara": () => import("./zamfara.json"),
};
