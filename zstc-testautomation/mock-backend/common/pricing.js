'use strict';
/**
 * MOCK price list (simulation rule SIM-3). The prices are invented; they only make the golden test cases
 * plausible:
 *   H2 domain:        3 HR × 1,000.00 EUR (P700_SERV_ONS) + 1 PC × 693.00 EUR (P700-SC-100) = 3,693.00 EUR
 *   metering service: 1 HR × 69.00 EUR (MD-SRV-STOER) + 1 PC × 39.00 EUR (MD-ERS-HKV) = 108.00 EUR
 *                     1 HR × 59.00 EUR (MD-SRV-RWM) + 1 PC × 35.00 EUR (MD-ERS-RWM) = 94.00 EUR
 * In a real system the net value results from S/4HANA pricing (condition technique); the verification layer
 * only reads it from the documents.
 */
const PRICE_LIST = Object.freeze({
    P700_SERV_ONS: { price: 1000.0, unit: 'HR', currency: 'EUR' },
    P700_SERV_REM: { price: 800.0, unit: 'HR', currency: 'EUR' },
    'P700-SC-100': { price: 693.0, unit: 'PC', currency: 'EUR' },
    'P700-SC-110': { price: 120.0, unit: 'PC', currency: 'EUR' },
    'P700-SC-999': { price: 999.0, unit: 'PC', currency: 'EUR', blocked: true },
    // metering service (Messdienst), fictional prices
    'MD-SRV-STOER': { price: 69.0, unit: 'HR', currency: 'EUR' },
    'MD-SRV-RWM': { price: 59.0, unit: 'HR', currency: 'EUR' },
    'MD-ERS-HKV': { price: 39.0, unit: 'PC', currency: 'EUR' },
    'MD-ERS-RWM': { price: 35.0, unit: 'PC', currency: 'EUR' },
    'MD-ERS-WZ': { price: 45.0, unit: 'PC', currency: 'EUR' },
    'MD-ERS-HKV-ALT': { price: 25.0, unit: 'PC', currency: 'EUR', blocked: true }
});

const UNIT_FACTOR_TO_HOURS = Object.freeze({ HR: 1, MIN: 1 / 60 });

/** Rounds to 2 decimals (currency amounts). */
function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Prices one item.
 *
 * @param {string} product product ID
 * @param {number} quantity quantity
 * @param {string} unit unit of the quantity
 * @returns {{netAmount:number, currency:string, priced:boolean, note?:string}} result
 */
function priceItem(product, quantity, unit) {
    const entry = PRICE_LIST[product];
    const qty = Number(quantity) || 0;
    if (!entry) {
        return { netAmount: 0, currency: 'EUR', priced: false, note: `No mock price for ${product}` };
    }
    let effectiveQty = qty;
    if (entry.unit === 'HR' && unit && unit !== 'HR') {
        effectiveQty = qty * (UNIT_FACTOR_TO_HOURS[unit] ?? 1);
    }
    return { netAmount: round2(entry.price * effectiveQty), currency: entry.currency, priced: true };
}

/** @returns {{price: number, unit: string, currency: string}|undefined} mock price list entry of a product */
function unitPrice(product) {
    return PRICE_LIST[product];
}

/** @returns {boolean} whether the product is blocked in the mock plant (simulation rule SIM-6) */
function isBlocked(product) {
    return PRICE_LIST[product]?.blocked === true;
}

/**
 * Expected net value of a test data set according to the mock price list (service item + optional part item) —
 * the same items the simulated service order prices. Stand-in for a pricing simulation in S/4HANA
 * (⚠ NOCH ZU VERIFIZIEREN which API; see docs/mock-to-real-mapping.md).
 *
 * @param {object} data TestCaseData values
 * @returns {number|undefined} net value, or undefined when an item is incomplete or has no mock price
 */
function expectedNetAmount(data) {
    if (!data.ServiceProduct || !(Number(data.ServiceDuration) > 0)) {
        return undefined;
    }
    const service = priceItem(data.ServiceProduct, data.ServiceDuration, data.ServiceDurationUnit);
    if (!service.priced) {
        return undefined;
    }
    let net = service.netAmount;
    if (data.ServicePart) {
        if (!(Number(data.ServicePartQuantity) > 0)) {
            return undefined;
        }
        const part = priceItem(data.ServicePart, data.ServicePartQuantity, data.ServicePartQuantityUnit);
        if (!part.priced) {
            return undefined;
        }
        net += part.netAmount;
    }
    return round2(net);
}

module.exports = { PRICE_LIST, priceItem, unitPrice, isBlocked, round2, expectedNetAmount };
