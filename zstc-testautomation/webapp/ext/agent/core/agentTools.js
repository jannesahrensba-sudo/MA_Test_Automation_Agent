sap.ui.define(["./prompts"], function (prompts) {
    "use strict";

    /**
     * Tools of the service assistant. Each tool is one call of the OData service ZUI_STC_TEST_CASE_O4 through the
     * gateway: value help search, draft create/update (with the backend determinations) and the validate action.
     * The same definitions serve the claude.ai sample capability (execute runs in the page), the Messages API loop of
     * the local proxy and — as tool contract — the Joule agent (docs/agent-konzept.md).
     *
     * Approve and start execution are deliberately NOT tools: they need the confirmation of the user.
     */

    const MAX_DESCRIPTION = 40;

    function asString(value) {
        return value === null || value === undefined ? "" : String(value).trim();
    }

    /** Normalizes the fields proposed by the model: known fields only, numbers as numbers, texts trimmed */
    function normalizeFields(felder) {
        const fields = {};
        const ignored = [];
        const notes = [];
        Object.keys(felder || {}).forEach(function (name) {
            if (prompts.AGENT_FIELDS.indexOf(name) === -1) {
                ignored.push(name);
                return;
            }
            const raw = felder[name];
            if (prompts.NUMERIC_FIELDS.indexOf(name) > -1) {
                if (raw === null || raw === "") {
                    fields[name] = null;
                    return;
                }
                const number = Number(String(raw).replace(",", "."));
                if (Number.isNaN(number)) {
                    ignored.push(name);
                    return;
                }
                fields[name] = number;
                return;
            }
            let text = asString(raw);
            if (name === "ServiceRequestDescription" && text.length > MAX_DESCRIPTION) {
                notes.push("Problembeschreibung auf " + MAX_DESCRIPTION + " Zeichen gekürzt.");
                text = text.slice(0, MAX_DESCRIPTION);
            }
            fields[name] = text === "" ? null : text;
        });
        return { fields: fields, ignored: ignored, notes: notes };
    }

    /** Compact German summary of a draft for tool results and the context block */
    function summarizeDraft(draft, describe) {
        const values = {};
        prompts.SUMMARY_FIELDS.forEach(function (field) {
            const value = draft.values[field];
            if (value !== null && value !== undefined && value !== "") {
                values[field] = prompts.NUMERIC_FIELDS.indexOf(field) > -1 ? prompts.formatValue(field, value) : describe(field, value);
            }
        });
        return {
            entwurf: draft.uuid,
            prozessprofil: draft.processProfile,
            titel: draft.title,
            validierung: draft.validation.status,
            fehler: draft.validation.errors,
            warnungen: draft.validation.warnings,
            werte: values,
            befunde: draft.validation.findings.map(function (f) {
                return { feld: f.feld, status: f.status, regel: f.regel, meldung: f.meldung, vorschlaege: f.vorschlaege };
            })
        };
    }

    /**
     * @param {object} gateway OData gateway (TestCaseGateway or a test double)
     * @param {object} session agent session: draft state, original text, step callback
     * @returns {object[]} tools {name, description, inputSchema, execute}
     */
    function createTools(gateway, session) {
        // tool calls of one round may run concurrently: changes of the draft are serialized
        let queue = Promise.resolve();
        const serialized = function (fn) {
            const run = queue.then(fn, fn);
            queue = run.catch(function () {});
            return run;
        };

        const search = {
            name: "stammdaten_suchen",
            description:
                "Sucht Stammdaten in den Wertehilfen des Service (Kunden, Liegenschaften, Nutzeinheiten, Geräte, Ansprechpartner, Serviceteams, Produkte). " +
                "Liefert je Suche bis zu 8 Treffer (beste zuerst) mit ID, Bezeichnung und Beziehungen sowie 'eindeutig'. " +
                "Typ geraet sucht auch über Adresse, Bewohner, Geschoss, Raum und Gerätetyp. Mehrere Suchen in einem Aufruf bündeln.",
            inputSchema: {
                type: "object",
                properties: {
                    suchen: {
                        type: "array",
                        description: "1 bis 6 Suchen",
                        items: {
                            type: "object",
                            properties: {
                                typ: { type: "string", enum: ["geraet", "nutzeinheit", "liegenschaft", "kunde", "ansprechpartner", "serviceteam", "produkt"] },
                                text: { type: "string", description: "Suchbegriffe, z. B. 'Musterstraße 12 Müller 1. OG links Wohnzimmer Heizkostenverteiler'" },
                                kunde: { type: "string", description: "optional: nur Treffer dieses Kunden (Kunden-ID)" }
                            },
                            required: ["typ", "text"]
                        }
                    }
                },
                required: ["suchen"]
            },
            execute: async function (input) {
                const queries = Array.isArray(input && input.suchen) ? input.suchen.slice(0, 6) : [];
                if (queries.length === 0) {
                    throw new Error("suchen: mindestens eine Suche {typ, text} angeben.");
                }
                const masterData = await gateway.masterData();
                const results = queries.map(function (q) {
                    return masterData.search(asString(q.typ), asString(q.text), asString(q.kunde) || undefined);
                });
                session.step({
                    icon: "sap-icon://search",
                    text:
                        "Stammdaten gesucht: " +
                        results
                            .map(function (r) {
                                return r.typ + " „" + r.suchtext + "“ → " + (r.treffer.length ? r.treffer[0].id + (r.eindeutig ? "" : " (+" + (r.treffer.length - 1) + " weitere)") : "kein Treffer");
                            })
                            .join(" · ")
                });
                return { ergebnisse: results };
            }
        };

        const capture = {
            name: "testfall_entwurf_erfassen",
            description:
                "Legt beim ersten Aufruf den Testfall-Entwurf an, sonst aktualisiert es ihn. Danach laufen die Ableitungen des Backends (Kunde, Gerätetyp, " +
                "Serviceorganisation, Vorbelegungen des Prozessprofils, erwarteter Nettowert aus der Mock-Preisliste) und die Validierung (R1–R10). " +
                "Liefert alle aktuellen Werte, den Validierungsstatus und die Befunde mit Vorschlägen. Nur gesicherte Felder angeben; " +
                "leere Felder weglassen. Freigabe und Start der Ausführung sind nicht Teil dieses Tools.",
            inputSchema: {
                type: "object",
                properties: {
                    prozessprofil: { type: "string", description: "Prozessprofil, z. B. MD_HKV_STOER oder MD_RWM_STOER" },
                    titel: { type: "string", description: "kurzer Titel des Testfalls, höchstens 80 Zeichen" },
                    felder: {
                        type: "object",
                        properties: {
                            SoldToParty: { type: "string", description: "Kunde / Auftraggeber (Hausverwaltung)" },
                            ServiceRefFunctionalLocation: { type: "string", description: "Nutzeinheit (Technischer Platz)" },
                            ServiceReferenceEquipment: { type: "string", description: "Gerät (Equipment)" },
                            ServiceRequestReporter: { type: "string", description: "Meldender: Ansprechpartner des Kunden" },
                            ServiceRequestDescription: { type: "string", description: "Problembeschreibung, höchstens 40 Zeichen" },
                            ServiceDocumentPriority: { type: "string", enum: ["1", "3", "5", "9"] },
                            RespyMgmtServiceTeam: { type: "string", description: "Serviceteam (Monteurteam der Region)" },
                            ServiceProduct: { type: "string", description: "Leistung" },
                            ServiceDuration: { type: "number", description: "Einsatzdauer in Stunden" },
                            ServicePart: { type: "string", description: "Ersatzteil / Ersatzgerät" },
                            ServicePartQuantity: { type: "number", description: "Menge in Stück" },
                            ExpectedNetAmount: { type: "number", description: "erwarteter Nettowert in EUR, nur wenn vom Nutzer genannt" }
                        }
                    }
                },
                required: ["felder"]
            },
            execute: function (input) {
                return serialized(async function () {
                    const normalized = normalizeFields(input && input.felder);
                    const fields = normalized.fields;
                    const profile = asString(input && input.prozessprofil) || undefined;
                    const title = asString(input && input.titel).slice(0, 80) || undefined;
                    const touchesPricing = prompts.PRICING_FIELDS.some(function (f) {
                        return f in fields;
                    });
                    if (touchesPricing && !("ExpectedNetAmount" in fields) && !session.userStatedNetAmount) {
                        // recalculated by the backend determination from the mock price list
                        fields.ExpectedNetAmount = null;
                    }
                    let draft = session.draft;
                    if (draft && draft.submitted) {
                        throw new Error("Der Testfall " + (draft.caseId || "") + " ist bereits übernommen und gestartet. Für eine neue Meldung „Neu beginnen“ wählen.");
                    }
                    if (!draft) {
                        const uuid = await gateway.createDraft({ processProfile: profile, title: title, text: session.originalText });
                        session.step({ icon: "sap-icon://add-document", text: "Testfall-Entwurf angelegt" + (profile ? " (Profil " + profile + ")" : "") });
                        await gateway.updateDraft(uuid, {}, fields);
                        draft = { uuid: uuid };
                    } else if (profile && profile !== draft.processProfile) {
                        // other profile: new draft with the defaults of that profile, the values found so far are kept
                        const carried = {};
                        prompts.AGENT_FIELDS.forEach(function (f) {
                            const value = draft.values[f];
                            if (value !== null && value !== undefined && value !== "" && ["ServiceProduct", "ServicePart", "ExpectedNetAmount"].indexOf(f) === -1) {
                                carried[f] = value;
                            }
                        });
                        const uuid = await gateway.createDraft({ processProfile: profile, title: title || draft.title, text: session.originalText });
                        await gateway.updateDraft(uuid, {}, Object.assign(carried, fields));
                        await gateway.discardDraft(draft.uuid).catch(function () {});
                        session.step({ icon: "sap-icon://switch-views", text: "Prozessprofil gewechselt: neuer Entwurf mit Profil " + profile });
                        draft = { uuid: uuid };
                    } else {
                        await gateway.updateDraft(draft.uuid, { title: title }, fields);
                    }
                    await gateway.validateDraft(draft.uuid);
                    const state = await session.refreshDraft(draft.uuid);
                    session.step({
                        icon: "sap-icon://validate",
                        text:
                            "Entwurf erfasst und validiert: " +
                            (prompts.STATUS[state.validation.status] || state.validation.status) +
                            " – " +
                            state.validation.errors +
                            " Fehler, " +
                            state.validation.warnings +
                            " Warnungen",
                        state: state.validation.status === "VALID" ? "Success" : state.validation.errors ? "Error" : "Warning"
                    });
                    const masterData = await gateway.masterData();
                    const result = summarizeDraft(state, masterData.describe);
                    if (normalized.ignored.length) {
                        result.ignoriert = normalized.ignored;
                    }
                    if (normalized.notes.length) {
                        result.hinweise = normalized.notes;
                    }
                    return result;
                });
            }
        };

        return [search, capture];
    }

    return { createTools: createTools, normalizeFields: normalizeFields, summarizeDraft: summarizeDraft };
});
