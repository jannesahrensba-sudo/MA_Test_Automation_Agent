'use strict';
/**
 * MockTestCaseExtractionService — MOCK implementation of ITestCaseExtractionService.
 *
 * Pure keyword / token matching against the master data pools. No language model, no probabilities:
 * a value is proposed when exactly one pool entry matches (SUCCESS) or several match (WARNING with candidates).
 * Values that cannot be found are simply not proposed; the deterministic validation reports the gaps.
 */
const { ITestCaseExtractionService } = require('./ITestCaseExtractionService');

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Parses "3.693 EUR", "3,693.00 EUR", "3693,50 €" into a number */
function parseAmount(raw) {
    let s = raw.replace(/\s/g, '');
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
        // both separators: the last one is the decimal separator
        s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lastComma > -1) {
        s = /,\d{3}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (lastDot > -1 && /\.\d{3}$/.test(s)) {
        s = s.replace(/\./g, ''); // German thousands separator, e.g. 3.693
    }
    const n = Number(s);
    return Number.isNaN(n) ? undefined : n;
}

class MockTestCaseExtractionService extends ITestCaseExtractionService {
    extract(text, pools) {
        const proposals = [];
        const input = String(text || '');
        const upper = input.toUpperCase();
        const propose = (field, candidates, matchedText, source = 'EXTRACTION_MOCK') => {
            const unique = [...new Set(candidates)];
            if (unique.length === 0) {
                return;
            }
            proposals.push({
                field,
                value: unique[0],
                candidates: unique,
                status: unique.length === 1 ? 'SUCCESS' : 'WARNING',
                source,
                matchedText
            });
        };
        const byKeyInText = (entries, key) => entries.filter((e) => new RegExp(`(^|[^A-Z0-9_-])${escapeRegExp(String(e[key]).toUpperCase())}($|[^A-Z0-9_-])`).test(upper));

        // Customer: ID or full name
        const customers = pools.customers || [];
        let customerMatches = byKeyInText(customers, 'Customer');
        if (customerMatches.length === 0) {
            customerMatches = customers.filter((c) => upper.includes(String(c.CustomerName).toUpperCase()));
        }
        propose('SoldToParty', customerMatches.map((c) => c.Customer), customerMatches.map((c) => c.Customer).join(', '));

        // Reporter: full name (unique) or last name (possibly ambiguous)
        const contacts = pools.contacts || [];
        let contactMatches = contacts.filter((c) => upper.includes(String(c.BusinessPartnerFullName).toUpperCase()));
        let contactText = contactMatches.map((c) => c.BusinessPartnerFullName).join(', ');
        if (contactMatches.length === 0) {
            contactMatches = contacts.filter((c) => new RegExp(`\\b${escapeRegExp(String(c.LastName).toUpperCase())}\\b`).test(upper));
            contactText = contactMatches.length ? contactMatches[0].LastName : '';
        }
        // prefer contacts of the proposed customer, but keep ambiguity visible
        if (contactMatches.length > 1 && customerMatches.length === 1 && contactMatches.some((c) => c.Customer === customerMatches[0].Customer)) {
            contactMatches.sort((a, b) => (a.Customer === customerMatches[0].Customer ? -1 : 0) - (b.Customer === customerMatches[0].Customer ? -1 : 0));
        }
        propose('ServiceRequestReporter', contactMatches.map((c) => c.BusinessPartner), contactText);

        // Functional location and equipment: exact IDs, or ID prefixes (e.g. "EL-10" → EL-100, EL-101)
        const fls = pools.functionalLocations || [];
        propose('ServiceRefFunctionalLocation', byKeyInText(fls, 'FunctionalLocation').map((f) => f.FunctionalLocation), 'functional location');
        const equipments = pools.equipments || [];
        let equipmentMatches = byKeyInText(equipments, 'Equipment');
        let equipmentText = equipmentMatches.map((e) => e.Equipment).join(', ');
        if (equipmentMatches.length === 0) {
            const prefix = upper.match(/\b([A-Z]{2,4}-\d{1,3})\b/g) || [];
            for (const p of prefix) {
                const found = equipments.filter((e) => String(e.Equipment).toUpperCase().startsWith(p));
                if (found.length) {
                    equipmentMatches = found;
                    equipmentText = p;
                    break;
                }
            }
        }
        propose('ServiceReferenceEquipment', equipmentMatches.map((e) => e.Equipment), equipmentText);

        // Products: IDs (service product, spare part, reference product)
        const products = pools.products || [];
        const productMatches = byKeyInText(products, 'Product');
        propose('ServiceProduct', productMatches.filter((p) => p.ProductType === 'SERV').map((p) => p.Product), 'service product');
        propose('ServicePart', productMatches.filter((p) => p.ProductType === 'ERSA').map((p) => p.Product), 'service part');
        propose('ReferenceProduct', productMatches.filter((p) => p.ProductType === 'FERT').map((p) => p.Product), 'reference product');

        // Service team
        propose('RespyMgmtServiceTeam', byKeyInText(pools.serviceTeams || [], 'RespyMgmtServiceTeam').map((t) => t.RespyMgmtServiceTeam), 'service team');

        // Priority words
        const priorityWords = [
            [/\b(VERY HIGH|URGENT|SEHR HOCH)\b/, '1'],
            [/\bPRIORITY\s+HIGH\b|\bHIGH PRIORITY\b|\bPRIORITÄT HOCH\b/, '3'],
            [/\b(MEDIUM|NORMAL|MITTEL)\b/, '5'],
            [/\b(LOW|NIEDRIG)\b/, '9']
        ];
        for (const [regex, code] of priorityWords) {
            const m = upper.match(regex);
            if (m) {
                propose('ServiceDocumentPriority', [code], m[0]);
                break;
            }
        }

        // Quantities: "3 HR", "3 hours", "3 h", "1 PC", "1 piece"
        const duration = input.match(/(\d+(?:[.,]\d+)?)\s*(HR|HRS|HOURS?|H|STD|STUNDEN)\b/i);
        if (duration) {
            propose('ServiceDuration', [Number(duration[1].replace(',', '.'))], duration[0]);
            propose('ServiceDurationUnit', ['HR'], duration[0]);
        }
        const pieces = input.match(/(\d+(?:[.,]\d+)?)\s*(PC|PCS|PIECES?|STK|STÜCK)\b/i);
        if (pieces) {
            propose('ServicePartQuantity', [Number(pieces[1].replace(',', '.'))], pieces[0]);
            propose('ServicePartQuantityUnit', ['PC'], pieces[0]);
        }

        // Expected net value: "3.693 EUR", "EUR 3,693.00", "3693 €"
        const amount = input.match(/(\d[\d.,]*)\s*(EUR|€)/i) || input.match(/(?:EUR|€)\s*(\d[\d.,]*)/i);
        if (amount) {
            const value = parseAmount(amount[1]);
            if (value !== undefined) {
                propose('ExpectedNetAmount', [value], amount[0]);
                propose('TransactionCurrency', ['EUR'], amount[0]);
            }
        }

        // Problem description: text in quotes, otherwise nothing (no guessing)
        const quoted = input.match(/["“„']([^"“”„']{3,40})["”“']/);
        if (quoted) {
            propose('ServiceRequestDescription', [quoted[1].trim()], quoted[0]);
        }

        // Derivations along the master data relationships (source DERIVED). An ambiguous equipment still yields a
        // derivation when all candidates agree (e.g. EL-100 and EL-101 are both installed at H2POWC00-PROD).
        const has = (field) => proposals.some((p) => p.field === field);
        const equipmentProposal = proposals.find((p) => p.field === 'ServiceReferenceEquipment');
        if (equipmentProposal) {
            const candidates = equipmentProposal.candidates.map((id) => equipments.find((e) => e.Equipment === id)).filter(Boolean);
            const source = equipmentProposal.status === 'SUCCESS' ? `equipment ${equipmentProposal.value}` : `equipment candidates ${equipmentProposal.candidates.join(', ')}`;
            const unanimous = (key) => (candidates.length && candidates.every((e) => e[key] === candidates[0][key]) ? candidates[0][key] : undefined);
            for (const [field, key] of [
                ['ServiceRefFunctionalLocation', 'FunctionalLocation'],
                ['ReferenceProduct', 'Material'],
                ['SoldToParty', 'Customer']
            ]) {
                const value = unanimous(key);
                if (value && !has(field)) {
                    propose(field, [value], source, 'DERIVED');
                }
            }
        }
        // service team → its service organization → the sales organization of the service organization
        const teamProposal = proposals.find((p) => p.field === 'RespyMgmtServiceTeam' && p.status === 'SUCCESS');
        const team = teamProposal && (pools.serviceTeams || []).find((t) => t.RespyMgmtServiceTeam === teamProposal.value);
        if (team?.ServiceOrganization && !has('ServiceOrganization')) {
            propose('ServiceOrganization', [team.ServiceOrganization], `service team ${team.RespyMgmtServiceTeam}`, 'DERIVED');
            const serviceOrganization = (pools.serviceOrganizations || []).find((o) => o.ServiceOrganization === team.ServiceOrganization);
            if (serviceOrganization?.SalesOrganization && !has('SalesOrganization')) {
                propose('SalesOrganization', [serviceOrganization.SalesOrganization], `service organization ${serviceOrganization.ServiceOrganization}`, 'DERIVED');
            }
        }
        return { proposals };
    }
}

module.exports = { MockTestCaseExtractionService, parseAmount };
