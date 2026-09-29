'use strict';
/**
 * Product group hierarchy of the mock master data (ProductVH.ProductGroup, material group in S/4HANA terms).
 *
 * A group like "MD-HKV" (heat cost allocators) has the parent "MD" (metering service). Devices (reference products),
 * their spare parts and device-specific services carry the device group; services for all devices of a domain carry
 * the parent group; a product without a group is generic. Used by validation rule R10 and by the mock extraction.
 */

/**
 * @param {string} productGroup group of a service product or spare part
 * @param {string} deviceGroup group of the device type (reference product)
 * @returns {boolean} whether the product may be used for the device
 */
function fitsGroup(productGroup, deviceGroup) {
    return !productGroup || !deviceGroup || productGroup === deviceGroup || deviceGroup.startsWith(`${productGroup}-`);
}

/**
 * @param {string} productGroup group of a service product or spare part
 * @param {string} deviceGroup group of the device type
 * @returns {number} 2 = made for the device type, 1 = for the domain (parent group), 0 = generic or not fitting
 */
function specificity(productGroup, deviceGroup) {
    if (!productGroup || !deviceGroup) {
        return 0;
    }
    if (productGroup === deviceGroup) {
        return 2;
    }
    return deviceGroup.startsWith(`${productGroup}-`) ? 1 : 0;
}

module.exports = { fitsGroup, specificity };
