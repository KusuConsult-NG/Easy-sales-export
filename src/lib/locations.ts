//   #789 Nigeria's electoral wards, generated from the published INEC
//   register — see scripts/build-wards.ts for the sources and the checks.
import { WARDS_BY_STATE_AND_LGA } from "@/lib/nigeria-wards.generated";

export const NIGERIAN_LOCATIONS: Record<string, string[]> = {
    "Abia": [
        "Aba North", "Aba South", "Arochukwu", "Bende", "Ikwuano", "Isiala Ngwa North",
        "Isiala Ngwa South", "Isuikwuato", "Obi Ngwa", "Ohafia", "Osisioma", "Ugwunagbo",
        "Ukwa East", "Ukwa West", "Umuahia North", "Umuahia South", "Umu Nneochi"
    ],
    "Adamawa": [
        "Demsa", "Fufure", "Ganye", "Gayuk", "Gombi", "Grie", "Hong", "Jada", "Lamurde",
        "Madagali", "Maiha", "Mayo Belwa", "Michika", "Mubi North", "Mubi South", "Numan",
        "Shelleng", "Song", "Toungo", "Yola North", "Yola South"
    ],
    "Akwa Ibom": [
        "Abak", "Eastern Obolo", "Eket", "Esit Eket", "Essien Udim", "Etim Ekpo", "Etinan",
        "Ibeno", "Ibesikpo Asutan", "Ibiono Ibom", "Ika", "Ikono", "Ikot Abasi", "Ikot Ekpene",
        "Ini", "Itu", "Mbo", "Mkpat Enin", "Nsit Atai", "Nsit Ibom", "Nsit Ubium", "Obot Akara",
        "Okobo", "Onna", "Oron", "Oruk Anam", "Udung Uko", "Ukanafun", "Uruan", "Urue-Offong/Oruko",
        "Uyo"
    ],
    "Anambra": [
        "Aguata", "Anambra East", "Anambra West", "Anaocha", "Awka North", "Awka South",
        "Ayamelum", "Dunukofia", "Ekwusigo", "Idemili North", "Idemili South", "Ihiala",
        "Njikoka", "Nnewi North", "Nnewi South", "Ogbaru", "Onitsha North", "Onitsha South",
        "Orumba North", "Orumba South", "Oyi"
    ],
    "Bauchi": [
        "Alkaleri", "Bauchi", "Bogoro", "Damban", "Darazo", "Dass", "Gamawa", "Ganjuwa",
        "Giade", "Itas/Gadau", "Jama'are", "Katagum", "Kirfi", "Misau", "Ningi", "Shira",
        "Tafawa Balewa", "Toro", "Warji", "Zaki"
    ],
    "Bayelsa": [
        "Brass", "Ekeremor", "Kolokuma/Opokuma", "Nembe", "Ogbia", "Sagbama", "Southern Ijaw",
        "Yenagoa"
    ],
    "Benue": [
        "Ado", "Agatu", "Apa", "Buruku", "Gboko", "Guma", "Gwer East", "Gwer West",
        "Katsina-Ala", "Konshisha", "Kwande", "Logo", "Makurdi", "Obi", "Ogbadibo",
        "Ohimini", "Oju", "Okpokwu", "Otukpo", "Tarka", "Ukum", "Ushongo", "Vandeikya"
    ],
    "Borno": [
        "Abadam", "Askira/Uba", "Bama", "Bayo", "Biu", "Chibok", "Damboa", "Dikwa",
        "Gubio", "Guzamala", "Gwoza", "Hawul", "Jere", "Kaga", "Kala/Balge", "Konduga",
        "Kukawa", "Kwaya Kusar", "Mafa", "Magumeri", "Maiduguri", "Marte", "Mobbar",
        "Monguno", "Ngala", "Nganzai", "Shani"
    ],
    "Cross River": [
        "Abi", "Akamkpa", "Akpabuyo", "Bakassi", "Bekwarra", "Biase", "Boki", "Calabar Municipal",
        "Calabar South", "Etung", "Ikom", "Obanliku", "Obubra", "Obudu", "Odukpani", "Ogoja",
        "Yakuur", "Yala"
    ],
    "Delta": [
        "Aniocha North", "Aniocha South", "Bomadi", "Burutu", "Ethiope East", "Ethiope West",
        "Ika North East", "Ika South", "Isoko North", "Isoko South", "Ndokwa East", "Ndokwa West",
        "Okpe", "Oshimili North", "Oshimili South", "Patani", "Sapele", "Udu", "Ughelli North",
        "Ughelli South", "Ukwuani", "Uvwie", "Warri North", "Warri South", "Warri South West"
    ],
    "Ebonyi": [
        "Abakaliki", "Afikpo North", "Afikpo South", "Ebonyi", "Ezza North", "Ezza South",
        "Ikwo", "Ishielu", "Ivo", "Izzi", "Ohaozara", "Ohaukwu", "Onicha"
    ],
    "Edo": [
        "Akoko-Edo", "Egor", "Esan Central", "Esan North-East", "Esan South-East", "Esan West",
        "Etsako Central", "Etsako East", "Etsako West", "Igueben", "Ikpoba Okha", "Oredo",
        "Orhionmwon", "Ovia North-East", "Ovia South-West", "Owan East", "Owan West", "Uhunmwonde"
    ],
    "Ekiti": [
        "Ado Ekiti", "Efon", "Ekiti East", "Ekiti South-West", "Ekiti West", "Emure",
        "Gbonyin", "Ido Osi", "Ijero", "Ikere", "Ikole", "Ilejemeje", "Irepodun/Ifelodun",
        "Ise/Orun", "Moba", "Oye"
    ],
    "Enugu": [
        "Aninri", "Awgu", "Enugu East", "Enugu North", "Enugu South", "Ezeagu",
        "Igbo Etiti", "Igbo Eze North", "Igbo Eze South", "Isi Uzo", "Nkanu East",
        "Nkanu West", "Nsukka", "Oji River", "Udenu", "Udi", "Uzo Uwani"
    ],
    "FCT": [
        "Abaji", "Bwari", "Gwagwalada", "Kuje", "Kwali", "Municipal Area Council"
    ],
    "Gombe": [
        "Akko", "Balanga", "Billiri", "Dukku", "Funakaye", "Gombe", "Kaltungo",
        "Kwami", "Nafada", "Shongom", "Yamaltu/Deba"
    ],
    "Imo": [
        "Aboh Mbaise", "Ahiazu Mbaise", "Ehime Mbano", "Ezinihitte", "Ideato North",
        "Ideato South", "Ihitte/Uboma", "Ikeduru", "Isiala Mbano", "Isu", "Mbaitoli",
        "Ngor Okpala", "Njaba", "Nkwerre", "Nwangele", "Obowo", "Oguta", "Ohaji/Egbema",
        "Okigwe", "Orlu", "Orsu", "Oru East", "Oru West", "Owerri Municipal", "Owerri North",
        "Owerri West", "Unuimo"
    ],
    "Jigawa": [
        "Auyo", "Babura", "Biriniwa", "Birnin Kudu", "Buji", "Dutse", "Gagarawa",
        "Garki", "Gumel", "Guri", "Gwaram", "Gwiwa", "Hadejia", "Jahun", "Kafin Hausa",
        "Kaugama", "Kazaure", "Kiri Kasama", "Kiyawa", "Maigatari", "Malam Madori",
        "Miga", "Ringim", "Roni", "Sule Tankarkar", "Taura", "Yankwashi"
    ],
    "Kaduna": [
        "Birnin Gwari", "Chikun", "Giwa", "Igabi", "Ikara", "Jaba", "Jema'a",
        "Kachia", "Kaduna North", "Kaduna South", "Kagarko", "Kajuru", "Kaura",
        "Kauru", "Kubau", "Kudan", "Lere", "Makarfi", "Sabon Gari", "Sanga",
        "Soba", "Zangon Kataf", "Zaria"
    ],
    "Kano": [
        "Ajingi", "Albasu", "Bagwai", "Bebeji", "Bichi", "Bunkure", "Dala", "Dambatta",
        "Dawakin Kudu", "Dawakin Tofa", "Doguwa", "Fagge", "Gabasawa", "Garko", "Garun Mallam",
        "Gaya", "Gezawa", "Gwale", "Gwarzo", "Kabo", "Kano Municipal", "Karaye", "Kibiya",
        "Kiru", "Kumbotso", "Kunchi", "Kura", "Madobi", "Makoda", "Minjibir", "Nasarawa",
        "Rano", "Rimin Gado", "Rogo", "Shanono", "Sumaila", "Takai", "Tarauni", "Tofa",
        "Tsanyawa", "Tudun Wada", "Ungogo", "Warawa", "Wudil"
    ],
    "Katsina": [
        "Bakori", "Batagarawa", "Batsari", "Baure", "Bindawa", "Charanchi", "Dandume",
        "Danja", "Dan Musa", "Daura", "Dutsi", "Dutsin Ma", "Faskari", "Funtua",
        "Ingawa", "Jibia", "Kafur", "Kaita", "Kankara", "Kankia", "Katsina", "Kurfi",
        "Kusada", "Mai'Adua", "Malumfashi", "Mani", "Mashi", "Matazu", "Musawa",
        "Rimi", "Sabuwa", "Safana", "Sandamu", "Zango"
    ],
    "Kebbi": [
        "Aleiro", "Arewa Dandi", "Argungu", "Augie", "Bagudo", "Birnin Kebbi", "Bunza",
        "Dandi", "Fakai", "Gwandu", "Jega", "Kalgo", "Koko/Besse", "Maiyama", "Ngaski",
        "Sakaba", "Shanga", "Suru", "Wasagu/Danko", "Yauri", "Zuru"
    ],
    "Kogi": [
        "Adavi", "Ajaokuta", "Ankpa", "Bassa", "Dekina", "Ibaji", "Idah", "Igalamela Odolu",
        "Ijumu", "Kabba/Bunu", "Kogi", "Lokoja", "Mopa Muro", "Ofu", "Ogori/Magongo",
        "Okehi", "Okene", "Olamaboro", "Omala", "Yagba East", "Yagba West"
    ],
    "Kwara": [
        "Asa", "Baruten", "Edu", "Ekiti", "Ifelodun", "Ilorin East", "Ilorin South",
        "Ilorin West", "Irepodun", "Isin", "Kaiama", "Moro", "Offa", "Oke Ero",
        "Oyun", "Pategi"
    ],
    "Lagos": [
        "Agege", "Ajeromi-Ifelodun", "Alimosho", "Amuwo-Odofin", "Apapa", "Badagry",
        "Epe", "Eti Osa", "Ibeju-Lekki", "Ifako-Ijaiye", "Ikeja", "Ikorodu",
        "Kosofe", "Lagos Island", "Lagos Mainland", "Mushin", "Ojo", "Oshodi-Isolo",
        "Shomolu", "Surulere"
    ],
    "Nasarawa": [
        "Akwanga", "Awe", "Doma", "Karu", "Keana", "Keffi", "Kokona", "Lafia",
        "Nasarawa", "Nasarawa Egon", "Obi", "Toto", "Wamba"
    ],
    "Niger": [
        "Agaie", "Agwara", "Bida", "Borgu", "Bosso", "Chanchaga", "Edati", "Gbako",
        "Gurara", "Katcha", "Kontagora", "Lapai", "Lavun", "Magama", "Mariga",
        "Mashegu", "Mokwa", "Moya", "Paikoro", "Rafi", "Rijau", "Shiroro",
        "Suleja", "Tafa", "Wushishi"
    ],
    "Ogun": [
        "Abeokuta North", "Abeokuta South", "Ado-Odo/Ota", "Egbado North", "Egbado South",
        "Ewekoro", "Ifo", "Ijebu East", "Ijebu North", "Ijebu North East", "Ijebu Ode",
        "Ikenne", "Imeko Afon", "Ipokia", "Obafemi Owode", "Odeda", "Odogbolu",
        "Ogun Waterside", "Remo North", "Shagamu"
    ],
    "Ondo": [
        "Akoko North-East", "Akoko North-West", "Akoko South-East", "Akoko South-West",
        "Akure North", "Akure South", "Ese Odo", "Idanre", "Ifedore", "Ilaje",
        "Ile Oluji/Okeigbo", "Irele", "Odigbo", "Okitipupa", "Ondo East", "Ondo West",
        "Ose", "Owo"
    ],
    "Osun": [
        "Atakunmosa East", "Atakunmosa West", "Aiyedaade", "Aiyedire", "Boluwaduro",
        "Boripe", "Ede North", "Ede South", "Egbedore", "Ejigbo", "Ife Central",
        "Ife East", "Ife North", "Ife South", "Ifedayo", "Ifelodun", "Ila",
        "Ilesa East", "Ilesa West", "Irepodun", "Irewole", "Isokan", "Iwo",
        "Obokun", "Odo Otin", "Ola Oluwa", "Olorunda", "Oriade", "Orolu", "Osogbo"
    ],
    "Oyo": [
        "Afijio", "Akinyele", "Atiba", "Atisbo", "Egbeda", "Ibadan North",
        "Ibadan North-East", "Ibadan North-West", "Ibadan South-East", "Ibadan South-West",
        "Ibarapa Central", "Ibarapa East", "Ibarapa North", "Ido", "Irepo",
        "Iseyin", "Itesiwaju", "Iwajowa", "Kajola", "Lagelu", "Ogbomosho North",
        "Ogbomosho South", "Ogo Oluwa", "Olorunsogo", "Oluyole", "Ona Ara",
        "Orelope", "Ori Ire", "Oyo East", "Oyo West", "Saki East", "Saki West", "Surulere"
    ],
    "Plateau": [
        "Barkin Ladi", "Bassa", "Bokkos", "Jos East", "Jos North", "Jos South",
        "Kanam", "Kanke", "Langtang North", "Langtang South", "Mangu", "Mikang",
        "Pankshin", "Qua'an Pan", "Riyom", "Shendam", "Wase"
    ],
    "Rivers": [
        "Abua/Odual", "Ahoada East", "Ahoada West", "Akuku-Toru", "Andoni",
        "Asari-Toru", "Bonny", "Degema", "Eleme", "Emohua", "Etche", "Gokana",
        "Ikwerre", "Khana", "Obio/Akpor", "Ogba/Egbema/Ndoni", "Ogu/Bolo",
        "Okrika", "Omuma", "Opobo/Nkoro", "Oyigbo", "Port Harcourt", "Tai"
    ],
    "Sokoto": [
        "Binji", "Bodinga", "Dange Shuni", "Gada", "Goronyo", "Gudu", "Gwadabawa",
        "Illela", "Isa", "Kebbe", "Kware", "Rabah", "Sabon Birni", "Shagari",
        "Silame", "Sokoto North", "Sokoto South", "Tambuwal", "Tangaza", "Tureta",
        "Wamako", "Wurno", "Yabo"
    ],
    "Taraba": [
        "Ardo Kola", "Bali", "Donga", "Gashaka", "Gassol", "Ibi", "Jalingo",
        "Karim Lamido", "Kurmi", "Lau", "Sardauna", "Takum", "Ussa", "Wukari",
        "Yorro", "Zing"
    ],
    "Yobe": [
        "Bade", "Bursari", "Damaturu", "Fika", "Fune", "Geidam", "Gujba",
        "Gulani", "Jakusko", "Karasuwa", "Machina", "Nangere", "Nguru",
        "Potiskum", "Tarmuwa", "Yunusari", "Yusufari"
    ],
    "Zamfara": [
        "Anka", "Bakura", "Birnin Magaji/Kiyaw", "Bukkuyum", "Bungudu", "Chafe",
        "Gummi", "Gusau", "Kaura Namoda", "Maradun", "Maru", "Shinkafi",
        "Talata Mafara", "Zurmi"
    ]
};

export const STATES = Object.keys(NIGERIAN_LOCATIONS).sort();

/**
 * Normalizes a location string to Title Case and trimmed.
 */
export function normalizeLocation(input: string): string {
    if (!input) return "";
    return input
        .toLowerCase()
        .split(" ")
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
        .trim();
}

/**
 * Validates if the given state exists in Nigeria.
 */
export function isValidState(state: string): boolean {
    if (!state) return false;
    const normalized = normalizeLocation(state);
    return Object.prototype.hasOwnProperty.call(NIGERIAN_LOCATIONS, normalized);
}

/**
 * Validates if the given LGA belongs to the State.
 */
export function isValidLGA(state: string, lga: string): boolean {
    if (!state || !lga) return false;
    const normalizedState = normalizeLocation(state);
    const normalizedLGA = normalizeLocation(lga);

    if (!isValidState(normalizedState)) return false;

    // Check strict inclusion
    const lgas = NIGERIAN_LOCATIONS[normalizedState];
    return lgas.some(l => normalizeLocation(l) === normalizedLGA);
}

// MOCK DATA FOR WARDS AND POLLING UNITS
// In a real application, this would be fetched from an API or a large database
/**
 * Wards this platform can actually name, by LGA.
 *
 *   #774 RENAMED FROM MOCK_WARDS, and the numbered "default" is GONE.
 *
 *   The placeholder row was the defect: it made every unlisted LGA look
 *   answered. What remains is what somebody verified. Add an LGA here — real
 *   names, from the INEC register — and its field becomes a dropdown again.
 */
/**
 *   #789 THE HAND-WRITTEN TABLE IS GONE. The real register is here.
 *
 *   #774 removed the numbered placeholder and left two LGAs with real names,
 *   saying the rest had to be added "one verified LGA at a time". The owner:
 *   "do a deep search and find them. they are available and you know where to
 *   find these details. Its public information and accessible to everyone."
 *
 *   They were right, and the sweep is done: 772 of 774 LGAs, 8,778 wards, from
 *   two independently published copies of the INEC register that were measured
 *   against each other before either was used. scripts/build-wards.ts holds the
 *   sources, the cross-check, the hand-verified spelling aliases, and what it
 *   refuses to guess.
 *
 *   Ikeja and Abuja Municipal are no longer special-cased — they are two rows
 *   of the generated table like every other LGA.
 */
const VERIFIED_WARDS = WARDS_BY_STATE_AND_LGA;

/**
 * LGA names that belong to more than one state.
 *
 *   Bassa (Kogi, Plateau) · Ifelodun and Irepodun (Kwara, Osun) ·
 *   Nasarawa (Kano, Nasarawa) · Obi (Benue, Nasarawa) · Surulere (Lagos, Oyo)
 *
 *   Computed rather than listed, so it cannot fall out of step with the table.
 *   getWards refuses to answer for one of these without a state — see there.
 */
const AMBIGUOUS_LGA_NAMES: ReadonlySet<string> = (() => {
    const states = new Map<string, Set<string>>();
    for (const composite of Object.keys(VERIFIED_WARDS)) {
        const [state, lga] = composite.split("|");
        const k = normalizeLocation(lga);
        if (!states.has(k)) states.set(k, new Set());
        states.get(k)!.add(state);
    }
    return new Set([...states].filter(([, s]) => s.size > 1).map(([k]) => k));
})();

/**
 * Returns a list of Wards for a given LGA.
 * Falls back to generic numbered wards if refined data isn't available.
 */
export function getWards(lga: string, state?: string): string[] {
    /**
     *   #774 "Ward 1 … Ward 10" WAS OFFERED AS THE WARD LIST FOR 772 OF
     *        NIGERIA'S 774 LGAs.
     *
     *   The owner: "ward should be names of wards not ward 1 ward 2 etc."
     *
     *   MOCK_WARDS holds real names for Ikeja and Abuja Municipal. Every other
     *   LGA fell through to `MOCK_WARDS["default"]` — a numbered placeholder —
     *   and the form presented it as a DROPDOWN, which is a claim that these
     *   are the choices. An applicant in Gwagwalada picked "Ward 3", and "Ward
     *   3" is not the name of anywhere.
     *
     *   NO WARD NAMES ARE INVENTED HERE, and that is the point. Nigeria has
     *   roughly 8,800 wards; writing plausible-looking names for them would put
     *   a REAL-LOOKING wrong answer on a member's record, which is worse than an
     *   obviously-placeholder one — it would survive every review precisely
     *   because it reads as data.
     *
     *   So an LGA with no verified list returns EMPTY, and the form asks the
     *   applicant to type her ward instead of choosing a fiction. Adding a real
     *   list for an LGA turns its field back into a dropdown with no other
     *   change — which is the only way this gets fixed properly, one verified
     *   LGA at a time.
     */
    /*
     *   #789 AND THE STATE IS PART OF THE QUESTION NOW.
     *
     *   With two LGAs in the table this was keyed on the LGA name alone and it
     *   did not matter. With all 772 it does: six LGA names belong to two states
     *   each, so a name-only lookup would hand a woman in Surulere, Oyo the ward
     *   list for Surulere, Lagos — and she would pick one, and it would look
     *   like an answer for the rest of the record's life.
     *
     *   So an ambiguous name asked WITHOUT a state gets nothing, and she types
     *   her ward instead. Both forms pass the state, so this is a guard rather
     *   than a behaviour anybody meets.
     */
    if (!lga) return [];
    const wanted = normalizeLocation(lga);

    if (state) {
        const composite = Object.keys(VERIFIED_WARDS).find(k => {
            const [s, l] = k.split("|");
            return normalizeLocation(s) === normalizeLocation(state) && normalizeLocation(l) === wanted;
        });
        return composite ? [...VERIFIED_WARDS[composite]] : [];
    }

    if (AMBIGUOUS_LGA_NAMES.has(wanted)) return [];

    const key = Object.keys(VERIFIED_WARDS).find(k => normalizeLocation(k.split("|")[1]) === wanted);
    return key ? [...VERIFIED_WARDS[key]] : [];
}

/** True when this LGA's wards are known, so the form can offer a list. */
export function hasVerifiedWards(lga: string, state?: string): boolean {
    return getWards(lga, state).length > 0;
}

/**
 *   #792 THE POLLING-UNIT LOOKUP LEFT THIS FILE.
 *
 *   `getPollingUnits(ward)` and `hasVerifiedPollingUnits(ward)` are gone with
 *   the hand-written table they read — two wards, and not merely incomplete:
 *   FOUR units for Alausa where INEC's register has EIGHTY-FOUR, seven for
 *   Garki against a hundred and sixty-nine. A dropdown offering four of
 *   eighty-four is a claim that those are the choices.
 *
 *   The real register is 172,000 units, about five megabytes, so it cannot be a
 *   synchronous function in a module the browser downloads. It is sharded by
 *   state and read on the server: see lib/polling-units.ts and
 *   /api/locations/polling-units.
 *
 *   They are DELETED rather than left returning nothing, so a caller that still
 *   expects the old answer fails to compile instead of silently showing an empty
 *   list — which is how a removed feature goes unnoticed.
 */



/**
 * Approximate centre of each Nigerian state, for distance-based delivery
 * pricing.
 *
 * Moved here from marketplace/checkout/page.tsx, which declared it inline. It
 * is reference data with no React in it, and this module already owns the
 * state and LGA lists it is keyed by.
 *
 * The checkout page looked a state up case-insensitively in five places:
 *
 *     Object.keys(NIGERIAN_STATE_COORDINATES).find(s => s.toLowerCase() === state.toLowerCase())
 *
 * and that comment then said "which is a helper waiting to be named. Not named
 * here: that would change five call sites in a file with no rendering tests,
 * and this commit is a move." IT IS NAMED NOW — `stateCentroid` below.
 *
 * Named while replacing Google Maps on that page with OpenStreetMap, and for a
 * reason that came out of TESTING it rather than reading it. Every one of those
 * five sites is the offline last resort: what checkout uses to place a delivery
 * when the geocoding service is unreachable. A mutant that gutted one of them
 * survived a test asserting the file still mentioned the table and still called
 * `setDestinationCoords(NIGERIAN_STATE_COORDINATES[matchedState])`, because
 * both lines are still there when the LOOKUP between them has gone. A rule
 * spelled out at five call sites inside a 1400-line client component cannot be
 * executed by a test; one exported function can.
 */

/**
 * The centre of a state, whatever case it was written in.
 *
 *   `null` when the name is not one of the thirty-seven, which is a real
 *   outcome and not an error: it is what tells checkout it has no offline
 *   answer and must say so rather than place a pin somewhere plausible.
 */
export function stateCentroid(state: unknown): { lat: number; lng: number } | null {
    if (typeof state !== "string" || !state.trim()) return null;

    const wanted = state.trim().toLowerCase();
    const key = Object.keys(NIGERIAN_STATE_COORDINATES).find(
        (name) => name.toLowerCase() === wanted);

    return key ? NIGERIAN_STATE_COORDINATES[key] : null;
}

export const NIGERIAN_STATE_COORDINATES: Record<string, { lat: number; lng: number }> = {
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
