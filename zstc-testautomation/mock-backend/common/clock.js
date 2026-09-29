'use strict';
/**
 * Injectable clock. The mock execution is time based (SIM-1); tests replace the clock to stay deterministic.
 */
let nowFn = () => Date.now();

/** @returns {number} current time in ms */
function now() {
    return nowFn();
}

/** @returns {string} current time as ISO string (Edm.DateTimeOffset) */
function nowIso() {
    return new Date(nowFn()).toISOString();
}

/**
 * Replaces the clock (tests only).
 *
 * @param {Function} fn function returning epoch milliseconds
 */
function setClock(fn) {
    nowFn = fn;
}

/** Restores the system clock. */
function resetClock() {
    nowFn = () => Date.now();
}

module.exports = { now, nowIso, setClock, resetClock };
