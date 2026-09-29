sap.ui.define([], function () {
    "use strict";

    /**
     * How the service assistant reaches a language model. Detected at runtime, nothing is configured in the app:
     *
     *   sample  Claude through the claude.ai "sample" capability — only when the hosted mockup runs inside the
     *           claude.ai artifact viewer; the viewer consents on the first call and uses their own Claude account
     *   proxy   Claude through the local development proxy (tools/agent-proxy, ui5-mock.yaml): POST /agent-api/messages.
     *           The API key and the model are environment variables of the local server; the browser never sees them
     *   rules   rule-based mock agent without a language model — always available
     *
     * No credentials are handled in the frontend (prompt.md, rule 2).
     */

    const PROXY_BASE = "/agent-api";

    /** sample errors after which Claude is not usable in this view (never retried) */
    const PERMANENT_SAMPLE_ERRORS = ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed", "tools_unavailable", "images_unavailable"];

    const SAMPLE_ERROR_TEXT = {
        not_granted: "Claude ist für diese Seite nicht freigegeben (Zustimmung abgelehnt).",
        sampling_disabled: "Claude ist für dieses Konto oder diese Organisation nicht verfügbar.",
        not_declared: "Die Seite hat keinen Zugriff auf Claude.",
        capability_disabled: "Claude ist in dieser Ansicht nicht nutzbar.",
        capability_removed: "Claude ist in dieser Ansicht nicht nutzbar.",
        tools_unavailable: "Claude kann in dieser Ansicht keine Tools der Seite aufrufen.",
        rate_limited: "Claude ist gerade ausgelastet oder Ihr Nutzungskontingent ist erreicht. Bitte später erneut versuchen oder den regelbasierten Agenten verwenden.",
        session_expired: "Ihre claude.ai-Sitzung ist abgelaufen – bitte erneut anmelden.",
        refused: "Claude hat die Anfrage abgelehnt. Bitte formulieren Sie die Störungsmeldung sachlich neu.",
        prompt_too_large: "Die Unterhaltung ist zu lang geworden. Bitte „Neu beginnen“.",
        empty_completion: "Claude hat keine Antwort geliefert. Bitte die Meldung kürzer oder genauer formulieren.",
        cancelled: "Abgebrochen.",
        upstream_error: "Claude ist gerade nicht erreichbar. Bitte erneut senden."
    };

    /** claude.ai sample capability, or undefined (not in the artifact viewer, not granted, no page tools) */
    async function detectSample() {
        const claude = typeof window !== "undefined" ? window.claude : undefined;
        if (!claude || typeof claude.use !== "function") {
            return undefined;
        }
        const sample = await claude.use("sample");
        if (!sample) {
            return undefined;
        }
        const limits = await sample.limits().catch(function () {
            return null;
        });
        if (!limits || !limits.tools) {
            return undefined;
        }
        return {
            kind: "sample",
            key: "claude",
            label: "Claude (über claude.ai, Ihr Nutzungskontingent)",
            sample: function (turns, options) {
                return sample(turns, { tools: options.tools, signal: options.signal, onText: options.onText, modelTier: "default" });
            }
        };
    }

    /** local proxy /agent-api, or undefined (hosted variant, or no API key configured) */
    async function detectProxy() {
        let status;
        try {
            const response = await fetch(PROXY_BASE + "/status", { headers: { Accept: "application/json" } });
            if (!response.ok || !/json/.test(response.headers.get("content-type") || "")) {
                return undefined;
            }
            status = await response.json();
        } catch (error) {
            return undefined;
        }
        if (!status || status.available !== true) {
            return status && status.reason ? { unavailableReason: status.reason } : undefined;
        }
        return {
            kind: "proxy",
            key: "claude",
            model: status.model,
            label: "Claude (lokaler Proxy, Modell " + status.model + ")",
            send: async function (request, signal) {
                const response = await fetch(PROXY_BASE + "/messages", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify(request),
                    signal: signal
                });
                const body = await response.json().catch(function () {
                    return {};
                });
                if (!response.ok) {
                    const error = new Error((body.error && body.error.message) || "Proxy-Fehler " + response.status);
                    error.code = (body.error && body.error.type) || "proxy_error";
                    error.status = response.status;
                    throw error;
                }
                return body;
            }
        };
    }

    const RULES = { kind: "rules", key: "rules", label: "Mock-Agent (regelbasiert, ohne Sprachmodell)" };

    /**
     * @param {object} error error of a transport
     * @returns {{text: string, permanent: boolean, cancelled: boolean}} German text and whether Claude should be switched off
     */
    function describeError(error) {
        const code = error && error.code;
        if (code && SAMPLE_ERROR_TEXT[code]) {
            return { text: SAMPLE_ERROR_TEXT[code], permanent: PERMANENT_SAMPLE_ERRORS.indexOf(code) > -1, cancelled: code === "cancelled" };
        }
        if (error && error.name === "AbortError") {
            return { text: SAMPLE_ERROR_TEXT.cancelled, permanent: false, cancelled: true };
        }
        if (error && error.status === 401) {
            return { text: "Der lokale Proxy meldet einen ungültigen API-Schlüssel (ANTHROPIC_API_KEY).", permanent: true, cancelled: false };
        }
        if (error && error.status === 429) {
            return { text: SAMPLE_ERROR_TEXT.rate_limited, permanent: false, cancelled: false };
        }
        return { text: "Fehler: " + ((error && error.message) || String(error)), permanent: false, cancelled: false };
    }

    return { detectSample: detectSample, detectProxy: detectProxy, RULES: RULES, describeError: describeError };
});
