sap.ui.define(["./prompts", "./resultReport", "./testDesign", "./testPackage", "./teamRun"], function (prompts, resultReport, testDesign, testPackage, teamRun) {
    "use strict";

    /**
     * Tools of the service assistant. Each tool is one call of the OData service ZUI_STC_TEST_CASE_O4 through the
     * gateway: value help search, draft create/update (with the backend determinations) and the validate action.
     * The same definitions serve the claude.ai sample capability (execute runs in the page), the Messages API loop of
     * the local proxy and — as tool contract — the Joule agent (docs/agent-konzept.md).
     *
     * Approve and start execution are deliberately NOT tools: they need the confirmation of the user.
     * ergebnis_lesen reads the result of a run with its deterministic analysis (discussion of a result, read-only).
     * prozessmodell_lesen describes the process (ways, steps, teams, test cases per way); testpaket_entwerfen creates and
     * validates the drafts of a test package (saving needs the confirmation); teamlauf_vorbereiten prepares the run of all
     * test cases of a process team (starting needs the confirmation).
     */

    const MAX_DESCRIPTION = 40;
    const VARIANTS = ["W1_REQUEST", "W2_QUOTATION", "W2_REJECTED", "W3_CONTRACT", "W3_BILLING_PLAN"];
    const END_OBJECTS = ["SERVICE_REQUEST", "SERVICE_QUOTATION", "SERVICE_ORDER", "SERVICE_CONFIRMATION", "BILLING_DOC_REQUEST", "BILLING_DOCUMENT", "ACCOUNTING_DOCUMENT"];
    /** start objects: the FI check needs the billing document of the same run; the contract is determined, not started with */
    const START_OBJECTS = ["SERVICE_CONTRACT", "SERVICE_REQUEST", "SERVICE_QUOTATION", "SERVICE_ORDER", "SERVICE_CONFIRMATION", "BILLING_DOC_REQUEST", "BILLING_DOCUMENT"];

    /** header fields of the process reference from the tool input; unknown codes are reported, not sent */
    function normalizeProcess(input, notes) {
        const header = {};
        const variant = asString(input && input.prozessvariante).toUpperCase();
        if (variant) {
            if (VARIANTS.indexOf(variant) > -1) {
                header.processVariant = variant;
            } else {
                notes.push("Unbekannter Weg " + variant + " ignoriert. Erlaubt: " + VARIANTS.join(", ") + ".");
            }
        }
        const endObject = asString(input && input.bis_objekt).toUpperCase();
        if (endObject) {
            if (END_OBJECTS.indexOf(endObject) > -1) {
                header.endObject = endObject;
            } else {
                notes.push("Unbekanntes Endobjekt " + endObject + " ignoriert.");
            }
        }
        const startObject = asString(input && input.start_objekt).toUpperCase();
        if (startObject) {
            if (START_OBJECTS.indexOf(startObject) > -1) {
                header.startObject = startObject;
            } else {
                notes.push("Unbekanntes Startobjekt " + startObject + " ignoriert.");
            }
        }
        const predecessor = asString(input && input.vorgaenger_testfall).toUpperCase();
        if (predecessor) {
            if (/^STC-\d{4}-\d{6}$/.test(predecessor)) {
                header.predecessorTestCase = predecessor;
            } else {
                notes.push("Vorgänger-Testfall " + predecessor + " ignoriert: erwartet wird eine Case ID wie STC-2026-000013.");
            }
        }
        const team = asString(input && input.prozessteam).toUpperCase();
        if (team) {
            header.processTeam = team;
        }
        const preconditions = asString(input && input.voraussetzungen);
        if (preconditions) {
            header.preconditions = preconditions.slice(0, 1000);
        }
        return header;
    }

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

    /**
     * Process description for the language model: ways with their steps (team, automation, document), the teams and the
     * test cases per way; processes without steps are marked as not modeled.
     */
    function processSummary(model, testCases, processId, describe) {
        const processes = model.processes.filter(function (p) {
            return !processId || p.ProcessID === processId;
        });
        return processes.map(function (process) {
            const steps = model.steps.filter(function (s) {
                return s.ProcessID === process.ProcessID;
            });
            const variants = model.variants
                .filter(function (v) {
                    return v.ProcessID === process.ProcessID;
                })
                .sort(function (a, b) {
                    return (Number(a.Sequence) || 0) - (Number(b.Sequence) || 0);
                });
            return {
                prozess: process.ProcessID,
                name: process.ProcessName,
                verantwortlich: describe("ProcessTeam", process.OwnerTeam),
                modelliert: steps.length > 0,
                hinweis: steps.length ? "" : "keine Prozessschritte modelliert – keine Testfälle ableitbar",
                wege: variants.map(function (v) {
                    const path = testDesign.wayPath(steps, v.Variant);
                    const cases = testCases.filter(function (tc) {
                        return tc.BusinessProcess === process.ProcessID && tc.ProcessVariant === v.Variant;
                    });
                    return {
                        weg: v.Variant,
                        name: v.VariantName,
                        pilot: v.PilotScope === "PILOT",
                        schritte: path.map(function (s) {
                            return s.StepID + " " + s.StepName + " [" + (s.ResponsibleTeam || "Team offen") + ", " + s.Automation + (s.BusinessObjectType ? ", " + s.BusinessObjectType : "") + "]";
                        }),
                        testfaelle: cases.map(function (tc) {
                            return tc.CaseID + " (" + tc.ProcessTeam + ", " + (tc.StartObject || "-") + "→" + (tc.EndObject || "-") + ", " + tc.ApprovalStatus + (tc.FinalResult ? ", " + tc.FinalResult : "") + ")";
                        })
                    };
                })
            };
        });
    }

    /** Compact German summary of a draft for tool results and the context block */
    function summarizeDraft(draft, describe) {
        const values = {};
        prompts.SUMMARY_FIELDS.forEach(function (field) {
            const value = draft.values[field];
            if (value !== null && value !== undefined && value !== "") {
                values[field] = prompts.display(field, value, draft.values, describe);
            }
        });
        const process = draft.process || {};
        return {
            entwurf: draft.uuid,
            prozessprofil: draft.processProfile,
            prozessbezug: {
                team: process.team ? describe("ProcessTeam", process.team) : "offen",
                weg: process.variant ? describe("ProcessVariant", process.variant) : "offen",
                bis: process.endObject ? describe("EndObject", process.endObject) : "",
                start: process.start ? describe("StartObject", process.start) : "",
                vorgaenger: process.predecessor ? describe("PredecessorTestCase", process.predecessor) : "",
                uebernimmt: process.takesOver ? describe("EndObject", process.takesOver) : "",
                teststufe: prompts.TEST_LEVEL[process.level] || process.level || "",
                zuordnung: prompts.ASSIGNMENT[process.assignment] || process.assignment || "",
                hinweis: process.note || ""
            },
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
                "Sucht Stammdaten in den Wertehilfen des Service (Kunden, Liegenschaften, Nutzeinheiten, Geräte, Ansprechpartner, Serviceteams, Serviceverträge, Produkte). " +
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
                                typ: { type: "string", enum: ["geraet", "nutzeinheit", "liegenschaft", "kunde", "ansprechpartner", "serviceteam", "servicevertrag", "produkt"] },
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
                "Serviceorganisation, Vorbelegungen des Prozessprofils, erwarteter Nettowert aus der Mock-Preisliste) und die Validierung (R1–R12). " +
                "Liefert alle aktuellen Werte, den Prozessbezug (Team, Weg, Start ab, Lauf bis, Vorgänger), den Validierungsstatus und die Befunde mit Vorschlägen. " +
                "Nur gesicherte Felder angeben; leere Felder weglassen. Der Prozessbezug (prozessvariante, start_objekt, bis_objekt, prozessteam, vorgaenger_testfall) leitet die Testschritte ab " +
                "und legt fest, welche Belege erwartet werden. Freigabe und Start der Ausführung sind nicht Teil dieses Tools.",
            inputSchema: {
                type: "object",
                properties: {
                    prozessprofil: { type: "string", description: "Prozessprofil, z. B. MD_HKV_STOER oder MD_RWM_STOER" },
                    titel: { type: "string", description: "kurzer Titel des Testfalls, höchstens 80 Zeichen" },
                    prozessvariante: { type: "string", enum: VARIANTS, description: "Weg durch den Reparaturprozess" },
                    bis_objekt: { type: "string", enum: END_OBJECTS, description: "Lauf bis zu diesem Beleg; nur wenn der Nutzer es nennt" },
                    start_objekt: {
                        type: "string",
                        enum: START_OBJECTS,
                        description: "Start ab diesem Beleg; nur wenn der Nutzer es nennt (z. B. „direkt ab dem Angebot“). Ohne Angabe startet der Lauf dort, wo das Prozessteam in den Weg einsteigt."
                    },
                    vorgaenger_testfall: {
                        type: "string",
                        description:
                            "Case ID des Vorgänger-Testfalls, dessen Belege übernommen werden. Nur nötig, wenn der Start einen Vorgängerbeleg braucht (Rückmeldung, Fakturaanforderung, Faktura; Befund R12) – Kandidaten aus den Vorschlägen des Befunds."
                    },
                    prozessteam: { type: "string", description: "Prozessteam, nur wenn genannt, z. B. PT-REPARATUR, PT-ANGEBOT oder PT-E2E (New End to End Prozess: Fakturierung und FI)" },
                    voraussetzungen: { type: "string", description: "Voraussetzungen und Übergaben, nur wenn genannt" },
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
                            ExpectedNetAmount: { type: "number", description: "erwarteter Nettowert in EUR, nur wenn vom Nutzer genannt" },
                            ServiceContract: { type: "string", description: "Servicevertrag (Weg 3), nur aus Suchergebnissen" }
                        }
                    }
                },
                required: ["felder"]
            },
            execute: function (input) {
                return serialized(async function () {
                    const normalized = normalizeFields(input && input.felder);
                    const fields = normalized.fields;
                    const header = normalizeProcess(input, normalized.notes);
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
                        await gateway.updateDraft(uuid, header, fields);
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
                        const carriedHeader = draft.process
                            ? {
                                  processTeam: draft.process.team,
                                  processVariant: draft.process.variant,
                                  endObject: draft.process.endObject,
                                  startObject: draft.process.start,
                                  predecessorTestCase: draft.process.predecessor || undefined
                              }
                            : {};
                        await gateway.updateDraft(uuid, Object.assign(carriedHeader, header), Object.assign(carried, fields));
                        await gateway.discardDraft(draft.uuid).catch(function () {});
                        session.step({ icon: "sap-icon://switch-views", text: "Prozessprofil gewechselt: neuer Entwurf mit Profil " + profile });
                        draft = { uuid: uuid };
                    } else {
                        await gateway.updateDraft(draft.uuid, Object.assign({ title: title }, header), fields);
                    }
                    if (Object.keys(header).length) {
                        session.step({
                            icon: "sap-icon://process",
                            text:
                                "Prozessbezug gesetzt: " +
                                Object.keys(header)
                                    .map(function (key) {
                                        return key === "preconditions" ? "Voraussetzungen" : header[key];
                                    })
                                    .join(", ")
                        });
                    }
                    await gateway.validateDraft(draft.uuid);
                    const state = await session.refreshDraft(draft.uuid);
                    session.step({
                        icon: "sap-icon://validate",
                        text:
                            "Entwurf erfasst und validiert: " + (prompts.STATUS[state.validation.status] || state.validation.status) + " – " + prompts.counts(state.validation),
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

        const result = {
            name: "ergebnis_lesen",
            description:
                "Liest das Ergebnis des letzten Laufs eines gespeicherten Testfalls: Lauf (Release, Version, Ergebnis), Schritte mit Status, abweichende Prüfungen (Soll/Ist), " +
                "Belege (erzeugt oder von einem Vorgänger übernommen), die Befunde der deterministischen Ergebnisanalyse (Ursache, Konfidenz, Evidenz, zuständiges Team, Empfehlung) " +
                "und die Läufe davor. Ohne case_id: der Testfall, dessen Ergebnis gerade besprochen wird. Ändert nichts.",
            inputSchema: {
                type: "object",
                properties: {
                    case_id: { type: "string", description: "Case ID, z. B. STC-2026-000007; leer = besprochener Testfall" }
                }
            },
            execute: async function (input) {
                const caseId = asString(input && input.case_id).toUpperCase();
                let analysis = session.analysis;
                if (caseId && (!analysis || analysis.caseId !== caseId)) {
                    if (!/^STC-\d{4}-\d{6}$/.test(caseId)) {
                        throw new Error("case_id: erwartet wird eine Case ID wie STC-2026-000007.");
                    }
                    const uuid = await gateway.findTestCase(caseId);
                    if (!uuid) {
                        throw new Error("Testfall " + caseId + " nicht gefunden (nur gespeicherte Testfälle haben Ergebnisse).");
                    }
                    analysis = resultReport.fromRead(await gateway.readResult(uuid));
                    if (!session.analysis && !session.draft) {
                        // first result of the conversation: shown in the analysis panel
                        session.setAnalysis(analysis, { keepChat: true });
                    } else {
                        session.step({ icon: "sap-icon://inspection", text: "Ergebnis gelesen: " + caseId + (analysis.run ? " · Lauf " + analysis.run.id : " · noch kein Lauf") });
                    }
                } else if (!analysis) {
                    throw new Error("Es wird kein Ergebnis besprochen: case_id angeben.");
                }
                const masterData = await gateway.masterData();
                return resultReport.summarize(analysis, masterData.describe);
            }
        };

        const processRead = {
            name: "prozessmodell_lesen",
            description:
                "Liest die Prozessbeschreibung: Prozesse mit ihren Wegen (Pilot oder später), den Schritten je Weg (Prozessteam, Automatisierung, Beleg) und den vorhandenen Testfällen je Weg. " +
                "Prozesse ohne Schritte sind als nicht modelliert gekennzeichnet. Ändert nichts.",
            inputSchema: {
                type: "object",
                properties: {
                    prozess: { type: "string", description: "optional: Prozess-ID, z. B. SRV-REP; leer = alle Prozesse" }
                }
            },
            execute: async function (input) {
                const model = await gateway.processModel();
                const testCases = await gateway.testCases();
                const masterData = await gateway.masterData();
                const processId = asString(input && input.prozess).toUpperCase();
                session.step({ icon: "sap-icon://process", text: "Prozessbeschreibung gelesen" + (processId ? ": " + processId : "") });
                return { prozesse: processSummary(model, testCases, processId, masterData.describe) };
            }
        };

        const packageTool = {
            name: "testpaket_entwerfen",
            description:
                "Entwirft ein Testpaket aus der Prozessbeschreibung für ein Release: je Pilot-Weg ein End-to-End-Testfall und je weiterem Prozessteam ein Teilprozess-Testfall, " +
                "mit Testdaten aus den Stammdaten. Jeder Entwurf wird im Backend angelegt und validiert (R1–R13, eindeutige Korrekturen übernommen); das Paket wird geprüft " +
                "(Abdeckung der Prozessschritte, Wege, Teams, Überschneidungen, Dubletten). Prozesse ohne Prozessschritte werden gemeldet, nicht erfunden. " +
                "Speichern und Freigabe sind nicht Teil dieses Tools (Knopf „Paket speichern“).",
            inputSchema: {
                type: "object",
                properties: {
                    release: { type: "string", description: "Release-ID, z. B. S4-2025-FPS02; leer = das nächste geplante Release" },
                    prozesse: { type: "array", items: { type: "string" }, description: "optional: Prozess-IDs; leer = Prozesse im Scope des Release" },
                    teilprozesse: { type: "boolean", description: "Teilprozess-Testfälle der weiteren Prozessteams (Standard: ja)" }
                }
            },
            execute: function (input) {
                return serialized(async function () {
                    const masterData = await gateway.masterData();
                    const pkg = await session.createPackage({
                        releaseId: asString(input && input.release) || undefined,
                        processIds: Array.isArray(input && input.prozesse) ? input.prozesse.map(asString).filter(Boolean) : undefined,
                        teamSections: !(input && input.teilprozesse === false)
                    });
                    return testPackage.summarize(pkg, masterData.describe);
                });
            }
        };

        const runTool = {
            name: "teamlauf_vorbereiten",
            description:
                "Bereitet den Lauf aller Testfälle eines Prozessteams (oder eines Prozesses) im Release in Test vor, z. B. nach einer Code-Änderung: welche Testfälle laufen, " +
                "welche übersprungen werden (mit Grund) und welche auf einen Vorgänger warten; abhängige Testfälle anderer Teams nur auf Wunsch. Startet nichts – der Nutzer bestätigt mit „Teamlauf starten“.",
            inputSchema: {
                type: "object",
                properties: {
                    prozessteam: { type: "string", description: "Prozessteam, z. B. PT-REPARATUR; leer = Team, dem der Prozess gehört" },
                    prozess: { type: "string", description: "Prozess-ID, z. B. SRV-REP; leer = alle Prozesse des Teams" },
                    release: { type: "string", description: "optional: Release in Test" },
                    anlass: { type: "string", description: "Anlass des Laufs, z. B. „Code-Änderung im Reparaturprozess“" },
                    abhaengige: { type: "boolean", description: "abhängige Testfälle anderer Teams (Übergaben) mitnehmen" }
                }
            },
            execute: async function (input) {
                const masterData = await gateway.masterData();
                const run = await session.prepareTeamRun({
                    team: asString(input && input.prozessteam) || undefined,
                    processId: asString(input && input.prozess) || undefined,
                    releaseId: asString(input && input.release) || undefined,
                    reason: asString(input && input.anlass) || undefined,
                    includeDependents: !!(input && input.abhaengige)
                });
                return teamRun.summarize(run, masterData.describe);
            }
        };

        return [search, capture, result, processRead, packageTool, runTool];
    }

    return {
        createTools: createTools,
        normalizeFields: normalizeFields,
        normalizeProcess: normalizeProcess,
        summarizeDraft: summarizeDraft,
        processSummary: processSummary,
        VARIANTS: VARIANTS,
        END_OBJECTS: END_OBJECTS,
        START_OBJECTS: START_OBJECTS
    };
});
