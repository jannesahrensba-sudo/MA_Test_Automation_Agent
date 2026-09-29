'use strict';
/**
 * MOCK price list (simulation rule SIM-3). The prices are invented; they only make the golden test case
 * plausible: 3 HR × 1,000.00 EUR (P700_SERV_ONS) + 1 PC × 693.00 EUR (P700-SC-100) = 3,693.00 EUR.
 * In a real system the net value results from S/4HANA pricing (condition technique); the verification layer
 * only reads it from the documents.
 */
const PRICE_LIST = Object.freeze({
    P700_SERV_ONS: { price: 1000.0, unit: 'HR', currency: 'EUR' },
    P700_SERV_REM: { price: 800.0, unit: 'HR', currency: 'EUR' },
    'P700-SC-100': { price: 693.0, unit: 'PC', currency: 'EUR' },
    'P700-SC-110': { price: 120.0, unit: 'PC', currency: 'EUR' },
    'P700-SC-999': { price: 999.0, unit: 'PC', currency: 'EUR', blocked: true }
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

/** @returns {boolean} whether the product is blocked in the mock plant (simulation rule SIM-6) */
function isBlocked(product) {
    return PRICE_LIST[product]?.blocked === true;
}

module.exports = { PRICE_LIST, priceItem, isBlocked, round2 };
