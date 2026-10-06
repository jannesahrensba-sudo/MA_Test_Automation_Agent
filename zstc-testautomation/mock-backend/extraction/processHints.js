'use strict';
/**
 * Process hints in a German (or English) scenario description — MOCK keyword rules, no language model:
 *   way through the repair process (process variant), end object ("bis …") and the process team when it is named.
 *
 *   "Angebot", "Kostenvoranschlag"                → W2_QUOTATION (customer accepts)
 *   "Angebot … abgelehnt", "lehnt … ab"          → W2_REJECTED
 *   "Wartungsvertrag", "Servicevertrag", "Vertragsfindung" → W3_CONTRACT (not when negated: "ohne Wartungsvertrag")
 *   "Rechnungsplan", "Vertragsabrechnung", "Pauschale abrechnen" → W3_BILLING_PLAN
 *   "ohne Angebot", "direkt beauftragt"          → W1_REQUEST
 *   fault report of the metering service without these words → W1_REQUEST (assumption: a fault is repaired without a quotation)
 *   "bis zum Auftrag" → SERVICE_ORDER · "bis zur Rückmeldung" → SERVICE_CONFIRMATION · "bis zum Angebot" → SERVICE_QUOTATION ·
 *   "bis zur Faktura/Rechnung" → BILLING_DOCUMENT · "FI", "Buchhaltungsbeleg", "bis zur Buchung" → ACCOUNTING_DOCUMENT
 */
const { normalize } = require('./germanMetering');

const START_RULES = [
    ['SERVICE_QUOTATION', /\bab (dem |einem )?(angebot|kostenvoranschlag|quote)\b|direkt (mit dem |vom |beim )?(angebot|quote)\b|vom quote\b/],
    ['SERVICE_ORDER', /\bab (dem )?(service ?)?auftrag\b|direkt (mit dem |vom )?(service ?)?auftrag\b/],
    ['SERVICE_CONFIRMATION', /\bab (der )?rueckmeldung\b/],
    ['BILLING_DOC_REQUEST', /\bab (der )?(fakturaanforderung|fakturierung|abrechnung)\b/],
    ['BILLING_DOCUMENT', /\bab (der )?faktura\b/]
];

const TEAMS = [
    ['PT-ANGEBOT', /(prozess)?team angebot|angebotsteam/],
    ['PT-MONTAGE', /(prozess)?team montage|montageteam/],
    ['PT-ABLESUNG', /(prozess)?team ablesung|ableseteam/],
    ['PT-REPARATUR', /(prozess)?team reparatur|reparaturteam/],
    ['PT-E2E', /(prozess)?team (new )?end ?to ?end|new end ?to ?end|e2e[- ]?team|team e2e|fakturierungsteam/]
];

/**
 * @param {string} text scenario description
 * @param {object} [options] options
 * @param {boolean} [options.meteringFault] the text is a fault report of the metering service (germanMetering found a device)
 * @returns {{variant?: string, endObject?: string, startObject?: string, team?: string, matched: string[]}} hints
 */
function processHints(text, { meteringFault = false } = {}) {
    let n = normalize(text);
    const matched = [];
    // start ("direkt ab dem Angebot"): detected first and removed, so that it does not decide the way
    let startObject;
    for (const [code, pattern] of START_RULES) {
        if (pattern.test(n)) {
            startObject = code;
            matched.push(`ab ${code}`);
            n = n.replace(pattern, ' ');
            break;
        }
    }
    let variant;
    if (/rechnungsplan|vertragsabrechnung|pauschale (ab)?rechnen|jahrespauschale|billing plan/.test(n)) {
        variant = 'W3_BILLING_PLAN';
        matched.push('Rechnungsplan');
    } else if (
        /(service|wartungs|miet|geraetemiet)vertrag|vertragsfindung|im rahmen des vertrags|laut vertrag|aus dem vertrag|service contract/.test(n) &&
        !/\b(ohne|kein|keinen) (\w+ )?\w*vertrag/.test(n)
    ) {
        variant = 'W3_CONTRACT';
        matched.push('Vertrag');
    } else if (/(angebot|kostenvoranschlag|quotation)\b[^.]*\b(abgelehnt|ablehnen|lehnt)|lehnt[^.]*\b(angebot|kostenvoranschlag)|rejected/.test(n)) {
        variant = 'W2_REJECTED';
        matched.push('Angebot abgelehnt');
    } else if (/ohne angebot|direkt beauftrag|kein angebot|without (a )?quotation/.test(n)) {
        variant = 'W1_REQUEST';
        matched.push('ohne Angebot');
    } else if (/angebot|kostenvoranschlag|\bkva\b|quotation/.test(n)) {
        variant = 'W2_QUOTATION';
        matched.push('Angebot');
    } else if (meteringFault) {
        variant = 'W1_REQUEST';
        matched.push('Störungsmeldung ohne Angebot');
    }
    if (startObject === 'SERVICE_QUOTATION' && (!variant || variant === 'W1_REQUEST')) {
        // a start with the quotation implies a way with a quotation
        variant = 'W2_QUOTATION';
        matched.splice(matched.indexOf('Störungsmeldung ohne Angebot') >>> 0, matched.includes('Störungsmeldung ohne Angebot') ? 1 : 0);
        matched.push('Start mit Angebot');
    }
    let endObject;
    if (/\bbis (zum |zur |zu )?(buchhaltungsbeleg|fi\b|buchung)|buchhaltungsbeleg|fi-beleg|accounting document/.test(n)) {
        endObject = 'ACCOUNTING_DOCUMENT';
    } else if (/\bbis (zur |zum )?(faktura|rechnung)\b/.test(n)) {
        endObject = 'BILLING_DOCUMENT';
    } else if (/\bbis (zur |zum )?(fakturaanforderung|freigabe zur fakturierung)/.test(n)) {
        endObject = 'BILLING_DOC_REQUEST';
    } else if (/\bbis (zur |zum )?(rueckmeldung|confirmation)/.test(n)) {
        endObject = 'SERVICE_CONFIRMATION';
    } else if (/\bbis (zum |zur )?(service ?order|(service)?auftrag)\b|up to the service order/.test(n)) {
        endObject = 'SERVICE_ORDER';
    } else if (/\bbis (zum |zur )?(angebot|kundenannahme|kundenentscheidung)/.test(n)) {
        endObject = 'SERVICE_QUOTATION';
    } else if (/\bbis (zum |zur )?(service request|anfrage)\b/.test(n)) {
        endObject = 'SERVICE_REQUEST';
    }
    if (endObject) {
        matched.push(`bis ${endObject}`);
    }
    const team = TEAMS.find(([, pattern]) => pattern.test(n))?.[0];
    if (team) {
        matched.push(team);
    }
    return { variant, endObject, startObject, team, matched };
}

module.exports = { processHints };
