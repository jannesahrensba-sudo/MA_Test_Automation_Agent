sap.ui.define([], function () {
    "use strict";

    /**
     * German instructions of the service assistant and the texts it uses for fields, rules and statuses.
     * The instructions are the same for every transport (claude.ai sample capability, local proxy to the Claude API);
     * the future Joule agent gets the same content as agent instructions (docs/agent-konzept.md).
     */

    const FIELD_LABELS = {
        ProcessProfile: "Prozessprofil",
        SoldToParty: "Kunde",
        ServiceRequestReporter: "Meldender",
        ServiceRequestDescription: "Problembeschreibung",
        ServiceDocumentPriority: "Priorität",
        ServiceRequestType: "Vorgangsart",
        SalesOrganization: "Verkaufsorganisation",
        ServiceOrganization: "Serviceorganisation",
        RespyMgmtServiceTeam: "Serviceteam",
        ServiceRefFunctionalLocation: "Nutzeinheit",
        ServiceReferenceEquipment: "Gerät",
        ReferenceProduct: "Gerätetyp",
        ServiceProduct: "Leistung",
        ServiceDuration: "Einsatzdauer",
        ServiceDurationUnit: "Einheit Dauer",
        ServicePart: "Ersatzteil",
        ServicePartQuantity: "Menge Ersatzteil",
        ServicePartQuantityUnit: "Einheit Menge",
        ExpectedNetAmount: "Erwarteter Nettowert",
        NetAmountTolerance: "Toleranz Nettowert",
        TransactionCurrency: "Währung"
    };

    const RULES = {
        R1_REQUIRED: "Pflichtangabe fehlt",
        R2_EXISTS: "Wert nicht in den Stammdaten",
        R3_CUSTOMER_FL: "Nutzeinheit gehört nicht zum Kunden",
        R4_FL_EQUIPMENT: "Gerät ist nicht in dieser Nutzeinheit eingebaut",
        R5_EQUIPMENT_PRODUCT: "Gerätetyp passt nicht zum Gerät",
        R6_PRODUCT_TYPE: "Produkttyp oder Einheit passt nicht",
        R7_AMBIGUOUS: "mehrdeutig",
        R8_CONTACT_CUSTOMER: "Meldender ist kein Ansprechpartner des Kunden",
        R9_DATE_RANGE: "Zeitraum inkonsistent",
        R10_DEVICE_TYPE: "passt nicht zum Gerätetyp"
    };

    const STATUS = { VALID: "Gültig", AMBIGUOUS: "Mehrdeutig", INVALID: "Ungültig", NOT_VALIDATED: "Nicht validiert" };
    const PRIORITY = { 1: "sehr hoch", 3: "hoch", 5: "mittel", 9: "niedrig" };

    /** "0 Fehler, 1 Warnung" */
    function counts(validation) {
        return validation.errors + " Fehler, " + validation.warnings + (validation.warnings === 1 ? " Warnung" : " Warnungen");
    }

    /** readable German value of a field: numbers with unit, priority in words, IDs with their master data text */
    function display(field, value, values, describe) {
        if (value === null || value === undefined || value === "") {
            return "";
        }
        if (NUMERIC_FIELDS.indexOf(field) > -1) {
            return formatValue(field, value, values);
        }
        if (field === "ServiceDocumentPriority" && PRIORITY[value]) {
            return value + " · " + PRIORITY[value];
        }
        return describe(field, value);
    }

    /** fields the agent may set (writable, controlled test data) */
    const AGENT_FIELDS = [
        "SoldToParty",
        "ServiceRefFunctionalLocation",
        "ServiceReferenceEquipment",
        "ServiceRequestReporter",
        "ServiceRequestDescription",
        "ServiceDocumentPriority",
        "RespyMgmtServiceTeam",
        "ServiceProduct",
        "ServiceDuration",
        "ServicePart",
        "ServicePartQuantity",
        "ExpectedNetAmount",
        "NetAmountTolerance"
    ];
    const NUMERIC_FIELDS = ["ServiceDuration", "ServicePartQuantity", "ExpectedNetAmount", "NetAmountTolerance"];
    /** changes of these fields recalculate the expected net value unless the user stated it */
    const PRICING_FIELDS = ["ServiceProduct", "ServiceDuration", "ServicePart", "ServicePartQuantity"];
    /** fields shown in the context and in the draft card, in this order */
    const SUMMARY_FIELDS = [
        "SoldToParty",
        "ServiceRefFunctionalLocation",
        "ServiceReferenceEquipment",
        "ReferenceProduct",
        "ServiceRequestReporter",
        "ServiceRequestDescription",
        "ServiceDocumentPriority",
        "RespyMgmtServiceTeam",
        "ServiceOrganization",
        "SalesOrganization",
        "ServiceProduct",
        "ServiceDuration",
        "ServicePart",
        "ServicePartQuantity",
        "ExpectedNetAmount"
    ];

    /**
     * Standing instructions of the agent (system prompt; leading user turn for the sample capability).
     *
     * @param {object} catalog catalog of the service: processProfiles [{ProcessProfile, ProcessProfileName}]
     * @returns {string} instructions
     */
    function instructions(catalog) {
        const profiles = (catalog.processProfiles || [])
            .map(function (p) {
                return "- " + p.ProcessProfile + ": " + p.ProcessProfileName;
            })
            .join("\n");
        return [
            "Du bist der Service-Assistent eines Test-Automatisierungs-Tools für den Service-to-Cash-Prozess (SAP S/4HANA Service) eines Messdienstleisters.",
            "Du arbeitest in einem Mockup mit fiktiven Daten. Aus einer deutschen Störungsmeldung – z. B. „Heizkostenverteiler funktioniert nicht“ oder „Rauchmelder piept“ – erfasst du einen vollständigen, validierten Testfall-Entwurf. Der Nutzer prüft ihn danach, speichert, gibt frei und startet die Ausführung selbst in der App.",
            "",
            "Vorgehen:",
            "1. Suche die genannten Stammdaten mit dem Tool stammdaten_suchen – bündle mehrere Suchen in einem Aufruf. Ein Gerät findest du am besten mit Typ geraet und Adresse, Name des Bewohners, Geschoss, Raum und Gerätetyp in einem Suchtext. Suche den Meldenden als ansprechpartner.",
            "2. Übernimm nur IDs aus Suchergebnissen oder aus dem Kontext. Erfinde keine IDs und rate nicht zwischen mehreren gleich guten Treffern.",
            "3. Wähle das Prozessprofil passend zum Gerätetyp: Heizkostenverteiler → MD_HKV_STOER, Rauchwarnmelder → MD_RWM_STOER. Für Szenarien außerhalb des Messdienstes: FS_TM.",
            "4. Rufe testfall_entwurf_erfassen mit allen gesicherten Werten auf. Das Backend ergänzt Kunde, Gerätetyp, Serviceorganisation, Vorbelegungen des Profils (1 Std. Einsatz, 1 Ersatzgerät) und den erwarteten Nettowert aus der Mock-Preisliste und validiert (Regeln R1–R10).",
            "5. Befunde: Eindeutige Korrekturen (genau ein passender Vorschlag der Validierung) übernimmst du selbst mit einem weiteren Aufruf. Fehlt eine Angabe oder gibt es mehrere Kandidaten, frag den Nutzer – höchstens zwei kurze Fragen, mit den Kandidaten als Auswahl.",
            "6. Du gibst nichts frei und startest nichts. Wenn der Entwurf gültig ist, bitte den Nutzer, ihn rechts zu prüfen und mit „Übernehmen & starten“ zu bestätigen.",
            "",
            "Fachlogik Messdienst:",
            "- Kunde (SoldToParty) ist der Auftraggeber, meist die Hausverwaltung. Die Liegenschaft (Adresse) hat Nutzeinheiten (Wohnungen); die Geräte sind in Nutzeinheiten eingebaut (ServiceRefFunctionalLocation = Nutzeinheit).",
            "- Meldender (ServiceRequestReporter) muss ein Ansprechpartner des Kunden sein. Bewohner (Nutzer) sind keine Ansprechpartner – nennt die Meldung nur den Bewohner, frag nach dem Meldenden der Hausverwaltung.",
            "- Leistung und Ersatzteil müssen zum Gerätetyp passen (Regel R10): Heizkostenverteiler → Leistung MD-SRV-STOER, Ersatzteil MD-ERS-HKV; Rauchwarnmelder → Leistung MD-SRV-RWM, Ersatzteil MD-ERS-RWM; Wasserzähler → MD-SRV-STOER, MD-ERS-WZ.",
            "- Problembeschreibung (ServiceRequestDescription): höchstens 40 Zeichen, Form „HKV Wohnzimmer: Display ohne Anzeige“ oder „RWM Flur: Warnton“.",
            "- Priorität (ServiceDocumentPriority): 1 sehr hoch (Notfall), 3 hoch (dringend; Standard bei Rauchwarnmeldern), 5 mittel (Standard), 9 niedrig.",
            "- Serviceteam (RespyMgmtServiceTeam): das Monteurteam der Region des Kunden (Stadt).",
            "- Einsatzdauer und Menge nur ändern, wenn die Meldung sie nennt. Den erwarteten Nettowert (ExpectedNetAmount) nur setzen, wenn der Nutzer ihn nennt.",
            "",
            "Prozessprofile:",
            profiles,
            "",
            "Antwort: Deutsch, sachlich, kurz (höchstens 8 Zeilen). Nenne Gerät und Nutzeinheit, Validierungsstatus und offene Punkte. Nur einfache Aufzählungen mit „- “ und **fett**, keine Tabellen, keine Überschriften.",
            "Jede Nutzernachricht beginnt mit einem Block [Kontext der App]. Er beschreibt den aktuellen Entwurf und stammt von der App, nicht vom Nutzer."
        ].join("\n");
    }

    const UNIT_TEXT = { HR: "Std.", MIN: "Min.", PC: "Stk.", EA: "Stk." };

    /**
     * German display value: 108 → "108,00 EUR"; "1.500" → "1,5"; with values (the whole test data) quantities get their
     * unit, e.g. ServiceDuration 1 + ServiceDurationUnit HR → "1 Std."
     */
    function formatValue(field, value, values) {
        if (value === null || value === undefined || value === "") {
            return "";
        }
        if (field === "ExpectedNetAmount" || field === "NetAmountTolerance") {
            return Number(value).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " EUR";
        }
        if (NUMERIC_FIELDS.indexOf(field) > -1) {
            const number = String(Number(value)).replace(".", ",");
            const unit = values && values[field + "Unit"];
            return unit ? number + " " + (UNIT_TEXT[unit] || unit) : number;
        }
        return String(value);
    }

    /**
     * Context block that precedes every user message.
     *
     * @param {object|undefined} draft current draft state (see AgentSession.draftState)
     * @param {Function} describe (field, id) → readable text
     * @returns {string} context block
     */
    function contextBlock(draft, describe) {
        if (!draft) {
            return "[Kontext der App]\nEs gibt noch keinen Testfall-Entwurf.\n[Ende Kontext]";
        }
        const lines = [
            "[Kontext der App]",
            "Testfall-Entwurf " + draft.uuid + (draft.caseId ? " (" + draft.caseId + ")" : "") + ", Prozessprofil " + draft.processProfile,
            "Validierung: " + (STATUS[draft.validation.status] || draft.validation.status) + " – " + counts(draft.validation)
        ];
        const values = SUMMARY_FIELDS.filter(function (f) {
            return draft.values[f] !== null && draft.values[f] !== undefined && draft.values[f] !== "";
        }).map(function (f) {
            return f + " = " + display(f, draft.values[f], draft.values, describe);
        });
        lines.push("Werte: " + (values.join("; ") || "keine"));
        (draft.validation.findings || []).forEach(function (finding) {
            lines.push("Befund " + finding.feld + " (" + finding.regel + ", " + finding.status + "): " + finding.meldung + (finding.vorschlaege.length ? " Vorschläge: " + finding.vorschlaege.join(", ") : ""));
        });
        if (draft.submitted) {
            lines.push("Der Testfall wurde bereits übernommen und gestartet.");
        }
        lines.push("[Ende Kontext]");
        return lines.join("\n");
    }

    return {
        FIELD_LABELS: FIELD_LABELS,
        RULES: RULES,
        STATUS: STATUS,
        AGENT_FIELDS: AGENT_FIELDS,
        NUMERIC_FIELDS: NUMERIC_FIELDS,
        PRICING_FIELDS: PRICING_FIELDS,
        SUMMARY_FIELDS: SUMMARY_FIELDS,
        PRIORITY: PRIORITY,
        instructions: instructions,
        contextBlock: contextBlock,
        formatValue: formatValue,
        display: display,
        counts: counts
    };
});
