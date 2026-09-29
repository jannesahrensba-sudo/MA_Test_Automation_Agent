sap.ui.define(["sap/base/security/encodeXML", "sap/ui/core/format/NumberFormat"], function (encodeXML, NumberFormat) {
    "use strict";

    const numberFormat = NumberFormat.getFloatInstance({ maxFractionDigits: 3 });
    const amountFormat = NumberFormat.getFloatInstance({ minFractionDigits: 2, maxFractionDigits: 2, groupingEnabled: true });
    const isEmpty = (value) => value === null || value === undefined || String(value).trim() === "";
    const value = (raw, formatted) => (isEmpty(raw) ? "<em>…</em>" : `<strong>${encodeXML(String(formatted ?? raw))}</strong>`);
    const withText = (key, text) => (isEmpty(key) ? value(key) : `${value(key)}${isEmpty(text) ? "" : ` (${encodeXML(String(text))})`}`);
    const number = (raw) => (isEmpty(raw) ? raw : numberFormat.format(Number(raw)));
    const amount = (raw) => (isEmpty(raw) ? raw : amountFormat.format(Number(raw)));

    /**
     * Formatter of the custom subsection "Test Case in Words": renders the captured test data as a short narrative.
     * Display only — validation and derivations happen in the service.
     */
    return {
        format: function (
            processProfile,
            soldToParty,
            customerName,
            description,
            reporter,
            reporterName,
            priority,
            team,
            functionalLocation,
            equipment,
            referenceProduct,
            serviceProduct,
            duration,
            durationUnit,
            part,
            partQuantity,
            partUnit,
            expectedAmount,
            tolerance,
            currency
        ) {
            const lines = [
                `<p>Process profile ${value(processProfile)}. A <strong>service request</strong> for customer ${withText(soldToParty, customerName)}: ` +
                    `${isEmpty(description) ? value(description) : `“${encodeXML(String(description))}”`}, reported by ${withText(reporter, reporterName)}, ` +
                    `priority ${value(priority)}, service team ${value(team)}.</p>`,
                `<p>The <strong>reference object</strong> is equipment ${value(equipment)} at functional location ${value(functionalLocation)} (product ${value(referenceProduct)}).</p>`,
                `<p>The <strong>service order</strong> plans service ${value(serviceProduct)} for ${value(duration, number(duration))} ${value(durationUnit)}` +
                    `${isEmpty(part) ? "" : ` and spare part ${value(part)}, ${value(partQuantity, number(partQuantity))} ${value(partUnit)}`}.</p>`,
                `<p>The <strong>expected result</strong> is a billing document with net value ${value(expectedAmount, amount(expectedAmount))} ${value(currency)}` +
                    `${isEmpty(tolerance) || Number(tolerance) === 0 ? "" : ` (tolerance ${value(tolerance, amount(tolerance))})`}.</p>`
            ];
            return lines.join("");
        }
    };
});
