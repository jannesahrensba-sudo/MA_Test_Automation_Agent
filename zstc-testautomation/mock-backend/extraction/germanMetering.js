'use strict';
/**
 * German vocabulary of fault reports in the metering service (Messdienst) for the MOCK extraction:
 * device types, rooms, symptoms, urgency, addresses and usage units (Nutzeinheiten).
 *
 * Pure keyword rules on the master data pools — no language model, no probabilities. A value is only resolved when the
 * text names it (address, resident, floor, room, device type); everything else stays open for the validation.
 */

/** lower case, umlauts and ß transliterated, "str." expanded — the same normalization for texts and master data */
function normalize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/str\.\s*/g, 'strasse ')
        .replace(/\s+/g, ' ');
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** device types by product group (ProductVH.ProductGroup) */
const DEVICE_TYPES = [
    { group: 'MD-HKV', label: 'Heizkostenverteiler', short: 'HKV', pattern: /heizkostenverteiler|\bhkv\b|heizkostenzaehler|verdunster|ablesegeraet/ },
    { group: 'MD-RWM', label: 'Rauchwarnmelder', short: 'RWM', pattern: /rauch ?(warn)?melder|\brwm\b|brandmelder|feuermelder/ },
    { group: 'MD-WZ', label: 'Wasserzähler', short: 'WZ', pattern: /wasserzaehler|wasseruhr|\bwz\b/ }
];

/** rooms as they appear in the equipment descriptions */
const ROOMS = [
    ['Wohnzimmer', /wohnzimmer|wohnraum|\bstube\b/],
    ['Schlafzimmer', /schlafzimmer|schlafraum/],
    ['Kinderzimmer', /kinderzimmer/],
    ['Küche', /kueche/],
    ['Bad', /\bbad\b|badezimmer/],
    ['Flur', /\bflur\b|\bdiele\b|korridor/],
    ['Arbeitszimmer', /arbeitszimmer|\bbuero\b/]
];

/** symptoms → short problem description (Service Request description, max. 40 characters) */
const SYMPTOMS = [
    ['Display ohne Anzeige', /display (ist )?(\w+ )?(dunkel|aus|leer|schwarz)|zeigt (gar )?nichts (mehr )?an|nichts (mehr )?anzeigt|keine anzeige|anzeige (ist )?(dunkel|aus|leer)/],
    ['Fehleranzeige', /fehler(meldung|code|anzeige)?\b|\bf ?\d{1,2}\b|\berr\b/],
    ['Warnton', /piept|piepen|piepst|signalton|warnton|pfeift|dauerton/],
    ['Fehlalarm', /fehlalarm|ohne rauch|kein rauch/],
    ['Gerät demontiert', /abgerissen|abgefallen|heruntergefallen|runtergefallen|demontiert|abmontiert|abgenommen/],
    ['Gerät beschädigt', /beschaedigt|gebrochen|zerbrochen|ueberstrichen|uebermalt|ueberklebt/],
    ['Rauchkammer verschmutzt', /rauchkammer|verschmutzt|verstaubt/],
    ['Batteriewarnung', /batterie|akku/],
    ['Verbrauchswert unplausibel', /unplausibel|(verbrauch|wert)\w* (\w+ ){0,3}(zu hoch|zu niedrig)/],
    ['Gerät defekt', /funktioniert (\w+ ){0,2}nicht|geht nicht|defekt|kaputt|ausgefallen|ohne funktion/]
];
/** symptoms that do not require a device exchange */
const NO_EXCHANGE = new Set(['Verbrauchswert unplausibel']);
const EXCHANGE_WORDS = /austausch|tauschen|ersetzen|ersatzgeraet|neues geraet|neuen melder/;

/** urgency → ServiceDocumentPriority (checked in this order) */
const URGENCY = [
    ['9', /nicht (so )?(dringend|eilig)|keine eile|bei gelegenheit/],
    ['1', /sehr dringend|notfall|brandgeruch/],
    ['3', /dringend|eilig|zeitnah|schnellstmoeglich|so schnell wie moeglich|umgehend|sofort/]
];

const FLOOR_WORDS = { erste: 1, ersten: 1, erster: 1, erstes: 1, zweite: 2, zweiten: 2, zweiter: 2, dritte: 3, dritten: 3, dritter: 3, vierte: 4, vierten: 4 };

/**
 * Floor and side mentioned in a (normalized) text, e.g. "1. og links", "im erdgeschoss rechts", "zweiten stock".
 *
 * @param {string} text normalized text
 * @returns {{floor: number, side?: string}|undefined} floor (0 = ground floor) and side
 */
function parseFloor(text) {
    const patterns = [
        [/\b(eg|erdgeschoss|parterre|hochparterre)\b/, () => 0],
        [/\b(\d)\s*\.?\s*(og|obergeschoss|stock|etage)\b/, (m) => Number(m[1])],
        [/\b(erste[nrs]?|zweite[nrs]?|dritte[nrs]?|vierte[n]?)\s+(og|obergeschoss|stock|etage)\b/, (m) => FLOOR_WORDS[m[1]]]
    ];
    for (const [regex, floorOf] of patterns) {
        const m = text.match(regex);
        if (m) {
            const after = text.slice(m.index + m[0].length, m.index + m[0].length + 12);
            const side = after.match(/^\W*(links|rechts|mitte)\b/);
            return { floor: floorOf(m), side: side ? side[1] : undefined };
        }
    }
    return undefined;
}

/** "Musterstraße 12, 80331 München" → street, house number */
function parseAddress(name) {
    const m = normalize(name).match(/^(.*?)\s+(\d+\s?[a-z]?)\s*,/);
    return m ? { street: m[1].trim(), number: m[2].replace(/\s/g, '') } : undefined;
}

/** "NE 03 · 1. OG links · Nutzer Müller" → number, floor, side, resident */
function parseUsageUnit(name) {
    const text = normalize(name);
    const number = text.match(/\bne\s*0?(\d{1,2})\b/);
    const resident = text.match(/nutzer\s+([a-z-]+)/);
    return { number: number ? Number(number[1]) : undefined, ...parseFloor(text), resident: resident ? resident[1] : undefined };
}

/**
 * Resolves property (Liegenschaft), usage unit (Nutzeinheit), device type, room, symptoms and urgency of a German
 * fault report against the master data pools.
 *
 * @param {string} input text of the fault report
 * @param {object} pools value help pools
 * @returns {object} resolution: functionalLocations (usage unit IDs), equipments (IDs), deviceGroups, room, symptoms,
 *   priority, description and the matched text snippets
 */
function resolveMetering(input, pools) {
    const text = normalize(input);
    const fls = pools.functionalLocations || [];
    const equipments = pools.equipments || [];
    const products = pools.products || [];
    const result = { functionalLocations: [], equipments: [], deviceGroups: [], symptoms: [], matched: {} };

    // device types, room, symptoms, urgency
    result.deviceGroups = DEVICE_TYPES.filter((d) => d.pattern.test(text)).map((d) => d.group);
    const room = ROOMS.find(([, regex]) => regex.test(text));
    result.room = room ? room[0] : undefined;
    result.symptoms = SYMPTOMS.filter(([, regex]) => regex.test(text)).map(([label]) => label);
    if (result.symptoms.length > 1) {
        // "Gerät defekt" is the fallback when nothing more specific is named
        result.symptoms = result.symptoms.filter((s) => s !== 'Gerät defekt');
    }
    const urgency = URGENCY.find(([, regex]) => regex.test(text));
    if (urgency) {
        result.priority = urgency[0];
        result.matched.priority = text.match(urgency[1])[0];
    }
    result.exchange = EXCHANGE_WORDS.test(text) || result.symptoms.some((s) => !NO_EXCHANGE.has(s));

    // property by address (street + house number, else street only)
    const buildings = fls.filter((f) => !f.SuperiorFunctionalLocation && parseAddress(f.FunctionalLocationName));
    let properties = buildings.filter((b) => {
        const { street, number } = parseAddress(b.FunctionalLocationName);
        return new RegExp(`${escapeRegExp(street)}\\s*${escapeRegExp(number)}\\b`).test(text);
    });
    if (properties.length === 0) {
        properties = buildings.filter((b) => new RegExp(`\\b${escapeRegExp(parseAddress(b.FunctionalLocationName).street)}\\b`).test(text));
    }
    if (properties.length) {
        result.matched.property = properties.map((p) => p.FunctionalLocationName).join(' | ');
    }

    // usage unit by resident, floor/side or unit number — within the property, or by resident name alone
    const units = fls.filter((f) => f.SuperiorFunctionalLocation && (properties.length === 0 || properties.some((p) => p.FunctionalLocation === f.SuperiorFunctionalLocation)));
    const floor = parseFloor(text);
    const unitNumber = text.match(/\b(?:ne|nutzeinheit|wohnung|whg)\.?\s*(?:nr\.?\s*)?0?(\d{1,2})\b/);
    const scored = units
        .map((unit) => {
            const u = parseUsageUnit(unit.FunctionalLocationName);
            let score = 0;
            if (u.resident && new RegExp(`\\b${escapeRegExp(u.resident)}\\b`).test(text)) {
                score += 2;
            }
            if (floor && u.floor === floor.floor && (!floor.side || !u.side || floor.side === u.side)) {
                score += floor.side && u.side ? 2 : 1;
            }
            if (unitNumber && u.number === Number(unitNumber[1])) {
                score += 2;
            }
            return { unit, score };
        })
        .filter((s) => s.score > 0);
    const best = Math.max(0, ...scored.map((s) => s.score));
    let unitCandidates = scored.filter((s) => s.score === best).map((s) => s.unit);
    if (unitCandidates.length === 0 && properties.length) {
        // property known, unit open: all units of the property stay candidates for the device search
        unitCandidates = units;
        result.unitOpen = true;
    }
    if (unitCandidates.length === 0) {
        return result;
    }
    result.matched.unit = unitCandidates.map((u) => u.FunctionalLocationName).join(' | ');

    // devices of the candidate units, narrowed by device type and room
    const groupOf = (equipment) => products.find((p) => p.Product === equipment.Material)?.ProductGroup;
    let devices = equipments.filter((e) => unitCandidates.some((u) => u.FunctionalLocation === e.FunctionalLocation));
    if (result.deviceGroups.length) {
        devices = devices.filter((e) => result.deviceGroups.includes(groupOf(e)));
    }
    if (result.room) {
        const byRoom = devices.filter((e) => normalize(e.EquipmentName).includes(normalize(result.room)));
        devices = byRoom.length ? byRoom : devices;
    }
    // only propose devices when the text names a device type or a room (no guessing among all devices of a unit)
    if (result.deviceGroups.length || result.room) {
        result.equipments = devices.map((e) => e.Equipment);
    }
    const unique = result.equipments.length === 1 ? equipments.find((e) => e.Equipment === result.equipments[0]) : undefined;
    result.functionalLocations = unique ? [unique.FunctionalLocation] : result.unitOpen ? [] : unitCandidates.map((u) => u.FunctionalLocation);
    if (unique && result.deviceGroups.length === 0) {
        result.deviceGroups = [groupOf(unique)].filter(Boolean);
    }
    return result;
}

/**
 * Short problem description "HKV Wohnzimmer: Display ohne Anzeige" (max. 40 characters).
 *
 * @param {object} resolution result of resolveMetering
 * @returns {string|undefined} description, undefined without a recognized symptom
 */
function describeProblem(resolution) {
    if (resolution.symptoms.length === 0) {
        return undefined;
    }
    const device = DEVICE_TYPES.find((d) => d.group === resolution.deviceGroups[0]);
    const prefix = [device?.short, resolution.room].filter(Boolean).join(' ');
    let symptoms = resolution.symptoms.slice(0, 2);
    let description = `${prefix ? `${prefix}: ` : ''}${symptoms.join(', ')}`;
    while (description.length > 40 && symptoms.length > 1) {
        symptoms = symptoms.slice(0, -1);
        description = `${prefix ? `${prefix}: ` : ''}${symptoms.join(', ')}`;
    }
    return description.slice(0, 40);
}

module.exports = { normalize, resolveMetering, describeProblem, parseFloor, DEVICE_TYPES };
