'use strict';
/**
 * ValidationEngine — REAL, deterministic validation ("Abgleich") of a test case against the master data pools.
 *
 * - Completeness is checked against the customizing table FieldRequirement (per process profile), never hard-coded.
 * - Existence and relationships (customer → functional location → equipment → reference product) are checked
 *   on the value help pools; every finding carries concrete suggestions.
 * - R10: service product and spare part must fit the device type (product group of the equipment's reference product),
 *   e.g. no smoke alarm spare part for a heat cost allocator.
 * - R11: the service contract of a contract variant must be released, valid and cover the reference object.
 * - Required fields only apply to the business objects of the executed path (process variant up to the end object):
 *   a test case that runs up to the service order needs no expected billing value.
 * - Result per field: SUCCESS (validated) · WARNING (several plausible values) · ERROR (missing or invalid).
 *   Deliberately no "AI confidence".
 *
 * Pure module: no mock server APIs. In the real system these rules become RAP validations/actions of the facade
 * BO, the pools become lookups on released CDS views (see docs/mock-to-real-mapping.md).
 */
const { ITEM_STATUS, VALIDATION, BO, BO_LABEL, criticalityOf } = require('../common/codes');
const { fitsGroup, specificity } = require('../common/productGroups');

const MAX_SUGGESTIONS = 5;

/** Field catalog: business object, pool and key of the value help */
const FIELDS = [
    ['ProcessProfile', BO.TEST_CASE, 'processProfiles', 'ProcessProfile', 'ProcessProfileName'],
    ['ServiceRequestType', BO.SERVICE_REQUEST, 'requestTypes', 'ServiceRequestType', 'ServiceRequestTypeName'],
    ['SoldToParty', BO.SERVICE_REQUEST, 'customers', 'Customer', 'CustomerName'],
    ['ServiceRequestReporter', BO.SERVICE_REQUEST, 'contacts', 'BusinessPartner', 'BusinessPartnerFullName'],
    ['ServiceRequestDescription', BO.SERVICE_REQUEST],
    ['ServiceDocumentPriority', BO.SERVICE_REQUEST, 'priorities', 'ServiceDocumentPriority', 'ServiceDocumentPriorityName'],
    ['SalesOrganization', BO.SERVICE_REQUEST, 'salesOrganizations', 'SalesOrganization', 'SalesOrganizationName'],
    ['ServiceOrganization', BO.SERVICE_REQUEST, 'serviceOrganizations', 'ServiceOrganization', 'ServiceOrganizationName'],
    ['RespyMgmtServiceTeam', BO.SERVICE_REQUEST, 'serviceTeams', 'RespyMgmtServiceTeam', 'RespyMgmtServiceTeamName'],
    ['ServiceProfile', BO.SERVICE_REQUEST],
    ['ResponseProfile', BO.SERVICE_REQUEST],
    ['RequestedServiceStartDateTime', BO.SERVICE_REQUEST],
    ['RequestedServiceEndDateTime', BO.SERVICE_REQUEST],
    ['ServiceRefFunctionalLocation', BO.SERVICE_REQUEST, 'functionalLocations', 'FunctionalLocation', 'FunctionalLocationName'],
    ['ServiceReferenceEquipment', BO.SERVICE_REQUEST, 'equipments', 'Equipment', 'EquipmentName'],
    ['ReferenceProduct', BO.SERVICE_REQUEST, 'products', 'Product', 'ProductDescription'],
    ['ServiceContract', BO.SERVICE_CONTRACT, 'serviceContracts', 'ServiceContract', 'ServiceContractDescription'],
    ['ServiceProduct', BO.SERVICE_ORDER, 'products', 'Product', 'ProductDescription'],
    ['ServiceDuration', BO.SERVICE_ORDER],
    ['ServiceDurationUnit', BO.SERVICE_ORDER, 'units', 'UnitOfMeasure', 'UnitOfMeasureName'],
    ['ServicePart', BO.SERVICE_ORDER, 'products', 'Product', 'ProductDescription'],
    ['ServicePartQuantity', BO.SERVICE_ORDER],
    ['ServicePartQuantityUnit', BO.SERVICE_ORDER, 'units', 'UnitOfMeasure', 'UnitOfMeasureName'],
    ['ExpectedNetAmount', BO.BILLING_DOCUMENT],
    ['NetAmountTolerance', BO.BILLING_DOCUMENT],
    ['TransactionCurrency', BO.BILLING_DOCUMENT, 'currencies', 'Currency', 'CurrencyName']
].map(([name, bo, pool, key, text]) => ({ name, bo, pool, key, text }));

const FIELD_BY_NAME = new Map(FIELDS.map((f) => [f.name, f]));
const NUMERIC_FIELDS = new Set(['ServiceDuration', 'ServicePartQuantity', 'ExpectedNetAmount', 'NetAmountTolerance']);

function isEmpty(value) {
    return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** Levenshtein distance (small inputs only) */
function distance(a, b) {
    const s = a.toUpperCase();
    const t = b.toUpperCase();
    const row = Array.from({ length: t.length + 1 }, (_, i) => i);
    for (let i = 1; i <= s.length; i++) {
        let prev = row[0];
        row[0] = i;
        for (let j = 1; j <= t.length; j++) {
            const tmp = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (s[i - 1] === t[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return row[t.length];
}

/** Business objects whose required fields apply for a path: quotation items are order items; priced paths need the expectation */
function relevantBusinessObjects(chainTypes) {
    if (!chainTypes) {
        return undefined;
    }
    const relevant = new Set(chainTypes);
    if (relevant.has(BO.SERVICE_QUOTATION)) {
        relevant.add(BO.SERVICE_ORDER);
    }
    if ([BO.SERVICE_QUOTATION, BO.SERVICE_ORDER, BO.BILLING_DOC_REQUEST, BO.BILLING_DOCUMENT].some((type) => relevant.has(type))) {
        relevant.add(BO.BILLING_DOCUMENT);
    }
    return relevant;
}

class ValidationContext {
    constructor({ testCase, data, requirements, pools, extraction, fieldLabels, chainTypes, requiredByVariant, referenceDate }) {
        this.testCase = testCase || {};
        this.data = data || {};
        this.pools = pools || {};
        this.extraction = extraction || [];
        this.fieldLabels = fieldLabels || {};
        this.relevantBOs = relevantBusinessObjects(chainTypes);
        this.requiredByVariant = new Set(requiredByVariant || []);
        this.referenceDate = referenceDate || new Date().toISOString().slice(0, 10);
        this.requirements = new Map();
        for (const req of requirements || []) {
            if (req.Active !== false) {
                this.requirements.set(req.FieldName, req);
            }
        }
    }

    value(fieldName) {
        return fieldName === 'ProcessProfile' ? this.testCase.ProcessProfile : this.data[fieldName];
    }

    label(fieldName) {
        return this.fieldLabels[fieldName] || fieldName;
    }

    pool(name) {
        return this.pools[name] || [];
    }

    /** required by the customizing (for a business object of the path) or by the process variant */
    isRequired(field, req) {
        if (this.requiredByVariant.has(field.name)) {
            return true;
        }
        if (!req || !req.Required) {
            return false;
        }
        return !this.relevantBOs || this.relevantBOs.has(req.BusinessObject || field.bo);
    }

    find(field, value) {
        if (!field.pool || isEmpty(value)) {
            return undefined;
        }
        return this.pool(field.pool).find((entry) => String(entry[field.key]).toUpperCase() === String(value).trim().toUpperCase());
    }

    entry(fieldName) {
        const field = FIELD_BY_NAME.get(fieldName);
        return field ? this.find(field, this.value(fieldName)) : undefined;
    }
}

/** Formats "KEY (Text)" for suggestion lists */
function describe(field, entry) {
    if (!entry) {
        return '';
    }
    const key = entry[field.key];
    const text = field.text ? entry[field.text] : undefined;
    return text && text !== key ? `${key} (${text})` : String(key);
}

/** Device type of the test case: the reference product of the equipment, otherwise the maintained reference product */
function deviceProduct(ctx) {
    const equipment = ctx.entry('ServiceReferenceEquipment');
    const product = equipment ? ctx.pool('products').find((p) => p.Product === equipment.Material) : ctx.entry('ReferenceProduct');
    return product && product.ProductGroup ? product : undefined;
}

/** R10: a service product or spare part with a product group must belong to the device type (or its parent group) */
function fitsDevice(ctx, product) {
    const device = deviceProduct(ctx);
    return !device || !product || fitsGroup(product.ProductGroup, device.ProductGroup);
}

/** Functional location of the reference object and its superior functional locations (contract object list) */
function referenceLocations(ctx) {
    const equipment = ctx.entry('ServiceReferenceEquipment');
    const start = ctx.value('ServiceRefFunctionalLocation') || equipment?.FunctionalLocation;
    const locations = [];
    let current = start;
    while (current && !locations.includes(current)) {
        locations.push(current);
        current = ctx.pool('functionalLocations').find((f) => f.FunctionalLocation === current)?.SuperiorFunctionalLocation;
    }
    return locations;
}

/** Context specific candidate values for a field (used for missing and invalid values) */
function contextualCandidates(ctx, field) {
    const customer = ctx.value('SoldToParty');
    const fl = ctx.value('ServiceRefFunctionalLocation');
    const equipment = ctx.entry('ServiceReferenceEquipment');
    switch (field.name) {
        case 'ServiceRequestReporter':
            return ctx.pool('contacts').filter((c) => !customer || c.Customer === customer);
        case 'ServiceRefFunctionalLocation':
            return ctx.pool('functionalLocations').filter((f) => !customer || f.Customer === customer);
        case 'ServiceReferenceEquipment':
            return ctx.pool('equipments').filter((e) => (fl ? e.FunctionalLocation === fl : !customer || e.Customer === customer));
        case 'ReferenceProduct':
            return equipment
                ? ctx.pool('products').filter((p) => p.Product === equipment.Material)
                : ctx.pool('products').filter((p) => p.ProductType === 'FERT');
        case 'ServiceProduct':
        case 'ServicePart': {
            // products made for the device type first, then those of the domain, then generic ones
            const type = field.name === 'ServiceProduct' ? 'SERV' : 'ERSA';
            const deviceGroup = deviceProduct(ctx)?.ProductGroup;
            return ctx
                .pool('products')
                .filter((p) => p.ProductType === type && fitsDevice(ctx, p))
                .sort((a, b) => specificity(b.ProductGroup, deviceGroup) - specificity(a.ProductGroup, deviceGroup));
        }
        case 'ServiceDurationUnit':
            return ctx.pool('units').filter((u) => u.UnitOfMeasureDimension === 'TIME');
        case 'ServicePartQuantityUnit': {
            const part = ctx.entry('ServicePart');
            return ctx.pool('units').filter((u) => (part ? u.UnitOfMeasure === part.BaseUnit : u.UnitOfMeasureDimension !== 'TIME'));
        }
        case 'ServiceOrganization': {
            const salesOrg = ctx.value('SalesOrganization');
            return ctx.pool('serviceOrganizations').filter((o) => !salesOrg || o.SalesOrganization === salesOrg);
        }
        case 'RespyMgmtServiceTeam': {
            const org = ctx.value('ServiceOrganization');
            return ctx.pool('serviceTeams').filter((t) => !org || t.ServiceOrganization === org);
        }
        case 'ServiceContract': {
            const locations = referenceLocations(ctx);
            const valid = (c) =>
                c.ServiceContractIsReleased &&
                (!c.ServiceContractStartDate || ctx.referenceDate >= c.ServiceContractStartDate) &&
                (!c.ServiceContractEndDate || ctx.referenceDate <= c.ServiceContractEndDate);
            return ctx
                .pool('serviceContracts')
                .filter((c) => valid(c) && (!customer || c.SoldToParty === customer) && (!locations.length || locations.includes(c.ServiceRefFunctionalLocation)));
        }
        default:
            return field.pool ? ctx.pool(field.pool) : [];
    }
}

function suggestionsFor(ctx, field, { invalidValue } = {}) {
    const req = ctx.requirements.get(field.name);
    const result = [];
    const productField = field.name === 'ServiceProduct' || field.name === 'ServicePart';
    const fits = (key) => !productField || fitsDevice(ctx, ctx.pool('products').find((p) => p.Product === key));
    if (req && !isEmpty(req.DefaultValue) && fits(String(req.DefaultValue))) {
        result.push(String(req.DefaultValue));
    }
    let candidates = contextualCandidates(ctx, field);
    if (invalidValue && field.pool) {
        const needle = String(invalidValue).trim().toUpperCase();
        const scored = ctx
            .pool(field.pool)
            .map((entry) => {
                const key = String(entry[field.key]);
                const text = field.text ? String(entry[field.text] || '') : '';
                let score = distance(key, needle);
                if (key.toUpperCase().includes(needle) || needle.includes(key.toUpperCase()) || text.toUpperCase().includes(needle)) {
                    score = Math.min(score, 1);
                }
                return { entry, score };
            })
            .filter((s) => s.score <= 3)
            .sort((a, b) => a.score - b.score || String(a.entry[field.key]).localeCompare(String(b.entry[field.key])));
        const fuzzy = scored.map((s) => s.entry);
        candidates = fuzzy.length ? fuzzy : candidates;
    }
    for (const entry of candidates) {
        const key = String(entry[field.key]);
        if (!result.includes(key) && fits(key)) {
            result.push(key);
        }
    }
    return result.slice(0, MAX_SUGGESTIONS);
}

/**
 * Validates a test case.
 *
 * @param {object} input input
 * @param {object} input.testCase TestCase entry (ProcessProfile)
 * @param {object} input.data TestCaseData entry
 * @param {object[]} input.requirements FieldRequirement rows of the process profile
 * @param {object} input.pools value help pools { customers, contacts, functionalLocations, equipments, products, ... }
 * @param {object[]} [input.extraction] open extraction proposals of a previous analyze run
 * @param {object} [input.fieldLabels] field name → label
 * @returns {{items: object[], overall: string, counts: object}} findings (one per checked field) and overall status
 */
function validate(input) {
    const ctx = new ValidationContext(input);
    const items = [];

    const add = (field, status, category, ruleId, message, extra = {}) => {
        items.push({
            BusinessObjectType: field.bo,
            Category: category,
            FieldName: field.name,
            ProposedValue: isEmpty(ctx.value(field.name)) ? '' : String(ctx.value(field.name)),
            ResolvedValue: extra.resolved || '',
            SuggestedValue: (extra.suggestions && extra.suggestions[0]) || '',
            SuggestedValues: (extra.suggestions || []).join(', '),
            Source: extra.source || 'USER',
            RuleID: ruleId,
            ValidationStatus: status,
            Criticality: criticalityOf(status),
            ValidationMessage: message,
            Severity: status,
            target: field.name === 'ProcessProfile' ? 'ProcessProfile' : `_TestCaseData/${field.name}`
        });
    };

    for (const field of FIELDS) {
        const req = ctx.requirements.get(field.name);
        const value = ctx.value(field.name);
        const label = ctx.label(field.name);
        const ruleId = req?.ValidationRule && req.ValidationRule !== 'NONE' ? req.ValidationRule : field.pool ? 'R2_EXISTS' : 'R1_REQUIRED';

        // R1 completeness (customizing driven, for the business objects of the path; contract by the variant)
        if (isEmpty(value)) {
            if (ctx.isRequired(field, req)) {
                const suggestions = suggestionsFor(ctx, field);
                add(
                    field,
                    ITEM_STATUS.ERROR,
                    'COMPLETENESS',
                    'R1_REQUIRED',
                    `${label} is required for the ${BO_LABEL[field.bo]}.${suggestions.length ? ` Suggested: ${suggestions.join(', ')}.` : ''}`,
                    { suggestions }
                );
            }
            continue;
        }

        // Numeric consistency
        if (NUMERIC_FIELDS.has(field.name)) {
            const number = Number(value);
            const mustBePositive = field.name === 'ServiceDuration' || field.name === 'ServicePartQuantity';
            if (Number.isNaN(number) || number < 0 || (mustBePositive && number === 0)) {
                add(field, ITEM_STATUS.ERROR, 'CONSISTENCY', 'R6_PRODUCT_TYPE', `${label} must be ${mustBePositive ? 'greater than zero' : 'zero or positive'}.`);
            } else {
                add(field, ITEM_STATUS.SUCCESS, 'CONSISTENCY', ruleId, `${label} is consistent.`, { resolved: String(value) });
            }
            continue;
        }

        // R2 existence in master data
        const entry = field.pool ? ctx.find(field, value) : undefined;
        if (field.pool && !entry) {
            const suggestions = suggestionsFor(ctx, field, { invalidValue: value });
            add(
                field,
                ITEM_STATUS.ERROR,
                'EXISTENCE',
                'R2_EXISTS',
                `${label} "${value}" does not exist in the master data.${suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''}`,
                { suggestions }
            );
            continue;
        }

        const finding = checkRelationships(ctx, field, entry, label);
        if (finding) {
            add(field, finding.status, finding.category, finding.ruleId, finding.message, { suggestions: finding.suggestions, resolved: describe(field, entry) });
            continue;
        }

        // R7 ambiguity of extracted values that were not confirmed yet
        const open = ctx.extraction.find(
            (x) => x.FieldName === field.name && x.ValidationStatus === ITEM_STATUS.WARNING && !x.ResolvedValue && String(x.ProposedValue) === String(value)
        );
        if (open) {
            const candidates = (open.SuggestedValues || '').split(',').map((s) => s.trim()).filter(Boolean);
            add(
                field,
                ITEM_STATUS.WARNING,
                'EXTRACTION',
                'R7_AMBIGUOUS',
                `"${value}" was taken from the scenario description, but ${candidates.length} values match: ${candidates.join(', ')}. Confirm the value or choose another one.`,
                // no resolved value: the finding stays open until the value is changed or a suggestion is applied
                { suggestions: candidates, source: 'EXTRACTION_MOCK' }
            );
            continue;
        }

        add(field, ITEM_STATUS.SUCCESS, field.pool ? 'EXISTENCE' : 'COMPLETENESS', ruleId, `${label} validated${entry ? `: ${describe(field, entry)}` : ''}.`, {
            resolved: entry ? describe(field, entry) : String(value)
        });
    }

    const rank = { ERROR: 0, WARNING: 1, INFO: 2, SUCCESS: 3 };
    items.sort((a, b) => rank[a.ValidationStatus] - rank[b.ValidationStatus]);
    items.forEach((item, index) => {
        item.Sequence = index + 1;
    });
    const counts = {
        error: items.filter((i) => i.ValidationStatus === ITEM_STATUS.ERROR).length,
        warning: items.filter((i) => i.ValidationStatus === ITEM_STATUS.WARNING).length,
        success: items.filter((i) => i.ValidationStatus === ITEM_STATUS.SUCCESS).length
    };
    const overall = counts.error > 0 ? VALIDATION.INVALID : counts.warning > 0 ? VALIDATION.AMBIGUOUS : VALIDATION.VALID;
    return { items, overall, counts };
}

/** Relationship and type rules R3–R6, R8, R9. Returns a finding or undefined. */
function checkRelationships(ctx, field, entry, label) {
    const customer = ctx.value('SoldToParty');
    switch (field.name) {
        case 'ServiceRequestReporter': {
            if (customer && entry.Customer !== customer) {
                return {
                    status: ITEM_STATUS.WARNING,
                    category: 'RELATIONSHIP',
                    ruleId: 'R8_CONTACT_CUSTOMER',
                    message: `Reporter ${entry.BusinessPartnerFullName} is a contact of ${entry.Customer}, not of customer ${customer}.`,
                    suggestions: suggestionsFor(ctx, field)
                };
            }
            return undefined;
        }
        case 'ServiceRefFunctionalLocation': {
            if (customer && entry.Customer !== customer) {
                return {
                    status: ITEM_STATUS.ERROR,
                    category: 'RELATIONSHIP',
                    ruleId: 'R3_CUSTOMER_FL',
                    message: `Functional location ${entry.FunctionalLocation} does not belong to customer ${customer}.`,
                    suggestions: suggestionsFor(ctx, field)
                };
            }
            return undefined;
        }
        case 'ServiceReferenceEquipment': {
            const fl = ctx.value('ServiceRefFunctionalLocation');
            if (fl && entry.FunctionalLocation !== fl) {
                return {
                    status: ITEM_STATUS.ERROR,
                    category: 'RELATIONSHIP',
                    ruleId: 'R4_FL_EQUIPMENT',
                    message: `Equipment ${entry.Equipment} does not belong to functional location ${fl} (installed at ${entry.FunctionalLocation}).`,
                    suggestions: suggestionsFor(ctx, field)
                };
            }
            if (!fl && customer && entry.Customer !== customer) {
                return {
                    status: ITEM_STATUS.ERROR,
                    category: 'RELATIONSHIP',
                    ruleId: 'R4_FL_EQUIPMENT',
                    message: `Equipment ${entry.Equipment} is not assigned to customer ${customer}.`,
                    suggestions: suggestionsFor(ctx, field)
                };
            }
            return undefined;
        }
        case 'ReferenceProduct': {
            const equipment = ctx.entry('ServiceReferenceEquipment');
            if (equipment && equipment.Material !== entry.Product) {
                return {
                    status: ITEM_STATUS.ERROR,
                    category: 'RELATIONSHIP',
                    ruleId: 'R5_EQUIPMENT_PRODUCT',
                    message: `Reference product ${entry.Product} does not match equipment ${equipment.Equipment} (expected ${equipment.Material}).`,
                    suggestions: [equipment.Material]
                };
            }
            if (entry.ProductType !== 'FERT') {
                return {
                    status: ITEM_STATUS.WARNING,
                    category: 'CONSISTENCY',
                    ruleId: 'R6_PRODUCT_TYPE',
                    message: `Reference product ${entry.Product} is not a serialized product (type ${entry.ProductType}).`,
                    suggestions: suggestionsFor(ctx, field)
                };
            }
            return undefined;
        }
        case 'ServiceProduct':
        case 'ServicePart': {
            const expectedType = field.name === 'ServiceProduct' ? 'SERV' : 'ERSA';
            if (entry.ProductType !== expectedType) {
                return {
                    status: ITEM_STATUS.ERROR,
                    category: 'CONSISTENCY',
                    ruleId: 'R6_PRODUCT_TYPE',
                    message: `${label} ${entry.Product} has product type ${entry.ProductType}; expected ${expectedType === 'SERV' ? 'a service product (SERV)' : 'a spare part (ERSA)'}.`,
                    suggestions: suggestionsFor(ctx, field)
                };
            }
            if (!fitsDevice(ctx, entry)) {
                const device = deviceProduct(ctx);
                const equipment = ctx.entry('ServiceReferenceEquipment');
                return {
                    status: ITEM_STATUS.ERROR,
                    category: 'CONSISTENCY',
                    ruleId: 'R10_DEVICE_TYPE',
                    message: `${label} ${entry.Product} (${entry.ProductDescription}) does not fit ${equipment ? `equipment ${equipment.Equipment}` : 'the reference product'} of device type ${device.Product} (${device.ProductDescription}).`,
                    suggestions: suggestionsFor(ctx, field)
                };
            }
            return undefined;
        }
        case 'ServiceDurationUnit': {
            if (entry.UnitOfMeasureDimension !== 'TIME') {
                return {
                    status: ITEM_STATUS.ERROR,
                    category: 'CONSISTENCY',
                    ruleId: 'R6_PRODUCT_TYPE',
                    message: `Unit ${entry.UnitOfMeasure} is not a time unit; the service duration needs a time unit.`,
                    suggestions: suggestionsFor(ctx, field)
                };
            }
            return undefined;
        }
        case 'ServicePartQuantityUnit': {
            const part = ctx.entry('ServicePart');
            if (part && part.BaseUnit !== entry.UnitOfMeasure) {
                return {
                    status: ITEM_STATUS.WARNING,
                    category: 'CONSISTENCY',
                    ruleId: 'R6_PRODUCT_TYPE',
                    message: `Unit ${entry.UnitOfMeasure} differs from the base unit ${part.BaseUnit} of ${part.Product}.`,
                    suggestions: [part.BaseUnit]
                };
            }
            return undefined;
        }
        case 'ServiceOrganization': {
            const salesOrg = ctx.value('SalesOrganization');
            if (salesOrg && entry.SalesOrganization !== salesOrg) {
                return {
                    status: ITEM_STATUS.WARNING,
                    category: 'RELATIONSHIP',
                    ruleId: 'R2_EXISTS',
                    message: `Service organization ${entry.ServiceOrganization} belongs to sales organization ${entry.SalesOrganization}, not ${salesOrg}.`,
                    suggestions: suggestionsFor(ctx, field)
                };
            }
            return undefined;
        }
        case 'RespyMgmtServiceTeam': {
            const org = ctx.value('ServiceOrganization');
            if (org && entry.ServiceOrganization !== org) {
                return {
                    status: ITEM_STATUS.WARNING,
                    category: 'RELATIONSHIP',
                    ruleId: 'R2_EXISTS',
                    message: `Service team ${entry.RespyMgmtServiceTeam} belongs to ${entry.ServiceOrganization}, not to ${org}.`,
                    suggestions: suggestionsFor(ctx, field)
                };
            }
            return undefined;
        }
        case 'ServiceContract': {
            const problems = [];
            if (customer && entry.SoldToParty !== customer) {
                problems.push(`belongs to customer ${entry.SoldToParty}, not to ${customer}`);
            }
            if (!entry.ServiceContractIsReleased) {
                problems.push('is not released');
            }
            if ((entry.ServiceContractStartDate && ctx.referenceDate < entry.ServiceContractStartDate) || (entry.ServiceContractEndDate && ctx.referenceDate > entry.ServiceContractEndDate)) {
                problems.push(`is not valid on ${ctx.referenceDate} (valid ${entry.ServiceContractStartDate} to ${entry.ServiceContractEndDate})`);
            }
            const locations = referenceLocations(ctx);
            if (locations.length && entry.ServiceRefFunctionalLocation && !locations.includes(entry.ServiceRefFunctionalLocation)) {
                problems.push(`does not cover ${locations[0]} (covered object ${entry.ServiceRefFunctionalLocation})`);
            }
            if (problems.length) {
                return {
                    status: ITEM_STATUS.ERROR,
                    category: 'RELATIONSHIP',
                    ruleId: 'R11_CONTRACT',
                    message: `Service contract ${entry.ServiceContract} ${problems.join('; ')}.`,
                    suggestions: suggestionsFor(ctx, field).filter((key) => key !== entry.ServiceContract)
                };
            }
            return undefined;
        }
        case 'RequestedServiceEndDateTime': {
            const start = ctx.value('RequestedServiceStartDateTime');
            if (start && new Date(ctx.value('RequestedServiceEndDateTime')) < new Date(start)) {
                return {
                    status: ITEM_STATUS.ERROR,
                    category: 'CONSISTENCY',
                    ruleId: 'R9_DATE_RANGE',
                    message: 'The requested end is before the requested start.',
                    suggestions: []
                };
            }
            return undefined;
        }
        default:
            return undefined;
    }
}

module.exports = { validate, FIELDS, FIELD_BY_NAME, isEmpty, relevantBusinessObjects };
