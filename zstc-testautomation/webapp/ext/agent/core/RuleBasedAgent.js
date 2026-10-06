sap.ui.define(["./prompts", "./textMatching", "./resultReport"], function (prompts, textMatching, resultReport) {
    "use strict";

    /**
     * MOCK agent without a language model ("Mock-Agent, regelbasiert"). It follows the same process as the Claude agent,
     * but deterministically:
     *   1. process profile from device keywords (smoke alarm → MD_RWM_STOER, heat cost allocator / meter → MD_HKV_STOER, else FS_TM)
     *   2. draft with the fault report as scenario description, backend action analyze (MockTestCaseExtractionService)
     *   3. backend action validate; findings of the device type rules R5/R10 are corrected with the first suggestion
     *   4. German summary with follow-up questions for ambiguous (R7) or missing (R1) values; answers are matched
     *      against the candidates of the open questions
     *   5. process reference: the backend analysis sets the way through the repair process and the end object from the
     *      report; answers such as "mit Angebot", "über den Wartungsvertrag" or "nur bis zum Auftrag" change them
     *   6. discussion of a result ("Ergebnis besprechen"): answers from the deterministic result analysis of the backend
     *      (resultReport) — cause, responsible team, comparison with the previous run, confidence, recommendation
     */

    const LABEL = prompts.FIELD_LABELS;

    /** way through the repair process named in an answer (same keywords as the analysis in the backend); [code, pattern, negation] */
    const WAY_WORDS = [
        ["W3_BILLING_PLAN", /rechnungsplan|vertragsabrechnung|pauschale|billing plan/],
        ["W3_CONTRACT", /vertrag|vertragsfindung|contract/, /\b(ohne|kein|keinen) (\w+ )?\w*vertrag/],
        ["W2_REJECTED", /(angebot|kostenvoranschlag)( \w+){0,6} (abgelehnt|ablehnen|lehnt)|lehnt( \w+){0,6} (angebot|kostenvoranschlag)|rejected/],
        ["W1_REQUEST", /ohne angebot|kein angebot|direkt beauftrag|without quotation/],
        ["W2_QUOTATION", /angebot|kostenvoranschlag|\bkva\b|quotation/]
    ];
    /** end object of the run ("bis …") named in an answer */
    const END_OBJECT_WORDS = [
        ["ACCOUNTING_DOCUMENT", /buchhaltungsbeleg|fi beleg|bis (zur |zum )?buchung|\bfi\b/],
        ["BILLING_DOC_REQUEST", /bis (zur |zum )?fakturaanforderung/],
        ["BILLING_DOCUMENT", /bis (zur |zum )?(faktura|rechnung)\b/],
        ["SERVICE_CONFIRMATION", /bis (zur |zum )?rueckmeldung/],
        ["SERVICE_ORDER", /bis (zum |zur )?(service ?)?auftrag\b|bis (zum |zur )?service order/],
        ["SERVICE_QUOTATION", /bis (zum |zur )?(angebot|kundenentscheidung)/],
        ["SERVICE_REQUEST", /bis (zum |zur )?(service request|anfrage)\b/]
    ];

    /** start object of the run ("ab …") named in an answer; the phrase is removed before the way is detected */
    const START_WORDS = [
        ["SERVICE_QUOTATION", /\bab (dem |einem )?(angebot|kostenvoranschlag|quote)\b|direkt (mit dem |vom |beim )?(angebot|quote)\b|vom quote\b/],
        ["SERVICE_ORDER", /\bab (dem )?(service ?)?auftrag\b|direkt (mit dem |vom )?(service ?)?auftrag\b/],
        ["SERVICE_CONFIRMATION", /\bab (der )?rueckmeldung\b/],
        ["BILLING_DOC_REQUEST", /\bab (der )?(fakturaanforderung|fakturierung|abrechnung)\b/],
        ["BILLING_DOCUMENT", /\bab (der )?faktura\b/],
        ["SERVICE_REQUEST", /\bab (dem |der )?(service request|meldung|anfrage|anfang)\b|von anfang an/]
    ];

    /** header fields that a follow-up question asks for (findings on the process reference instead of the test data) */
    const HEADER_QUESTIONS = { PredecessorTestCase: "predecessorTestCase" };

    /**
     * Process reference named in an answer: start object, way (process variant) and end object.
     *
     * @param {string} text answer of the user
     * @returns {{startObject?: string, processVariant?: string, endObject?: string}} header changes
     */
    function processChoice(text) {
        let n = textMatching.normalize(text);
        const header = {};
        const start = START_WORDS.find(function (entry) {
            return entry[1].test(n);
        });
        if (start) {
            header.startObject = start[0];
            n = n.replace(start[1], " ");
        }
        const way = WAY_WORDS.find(function (entry) {
            return entry[1].test(n) && !(entry[2] && entry[2].test(n));
        });
        if (way) {
            header.processVariant = way[0];
        }
        const end = END_OBJECT_WORDS.find(function (entry) {
            return entry[1].test(n);
        });
        if (end) {
            header.endObject = end[0];
        }
        return header;
    }

    function isEmpty(value) {
        return value === null || value === undefined || value === "";
    }

    /**
     * Case ID of a request to discuss a result, e.g. "Ergebnis von STC-2026-000007 besprechen" or "Warum ist STC-2026-000007 fehlgeschlagen?".
     *
     * @param {string} text message of the user
     * @returns {string|undefined} Case ID
     */
    function resultRequest(text) {
        const id = String(text || "").toUpperCase().match(/STC-\d{4}-\d{6}/);
        if (!id) {
            return undefined;
        }
        return /ergebnis|lauf|laeufe|besprech|auswert|analys|fehlgeschlagen|bestanden|warum|ursache|befund/.test(textMatching.normalize(text)) ? id[0] : undefined;
    }

    class RuleBasedAgent {
        constructor(gateway, session) {
            this.gateway = gateway;
            this.session = session;
            this.openQuestions = [];
        }

        /** process profile from the device type named in the report */
        classify(text) {
            const n = textMatching.normalize(text);
            if (/rauch ?(warn)?melder|\brwm\b|brandmelder|feuermelder/.test(n)) {
                return "MD_RWM_STOER";
            }
            if (/heizkostenverteiler|\bhkv\b|wasserzaehler|wasseruhr|verdunster|ablesegeraet|heizkoerper/.test(n)) {
                return "MD_HKV_STOER";
            }
            return "FS_TM";
        }

        async respond(text) {
            const draft = this.session.draft;
            const requested = resultRequest(text);
            if (this.session.analysis || (requested && (!draft || draft.submitted))) {
                return this.discussResult(text, requested);
            }
            if (!draft) {
                return this.firstTurn(text);
            }
            if (draft.submitted) {
                return "Der Testfall **" + (draft.caseId || "") + "** ist bereits übernommen. Für eine neue Störungsmeldung wählen Sie **Neu beginnen**.";
            }
            return this.followUp(text);
        }

        /** discussion of a result: another Case ID opens that result, otherwise the question is answered from the analysis */
        async discussResult(text, requested) {
            const masterData = await this.gateway.masterData();
            if (requested && (!this.session.analysis || this.session.analysis.caseId !== requested)) {
                const analysis = await this.session.openResultByCaseId(requested);
                return resultReport.report(analysis, masterData.describe);
            }
            const answer = resultReport.answer(text, this.session.analysis, masterData.describe);
            this.session.step({ icon: "sap-icon://inspection", text: "Antwort aus der Ergebnisanalyse: " + (resultReport.intentsOf(text).join(", ") || "keine passende Frage erkannt") });
            return answer;
        }

        async firstTurn(text) {
            const masterData = await this.gateway.masterData();
            const profile = this.classify(text);
            this.session.step({ icon: "sap-icon://decision", text: "Prozess erkannt: " + masterData.describe("ProcessProfile", profile) });
            const uuid = await this.gateway.createDraft({ processProfile: profile, text: text });
            this.session.step({ icon: "sap-icon://add-document", text: "Testfall-Entwurf angelegt, Störungsmeldung als Szenariobeschreibung übernommen" });
            await this.gateway.analyzeDraft(uuid);
            const analyzed = await this.gateway.readDraft(uuid);
            const found = ["ServiceReferenceEquipment", "ServiceRefFunctionalLocation", "SoldToParty"].filter(function (f) {
                return !isEmpty(analyzed.values[f]);
            });
            if (found.length === 0) {
                await this.gateway.discardDraft(uuid).catch(function () {});
                this.session.step({ icon: "sap-icon://message-warning", text: "Analyse: keine Liegenschaft, kein Gerät und kein Kunde erkannt – Entwurf verworfen", state: "Warning" });
                return (
                    "Ich konnte in der Meldung weder Liegenschaft noch Gerät oder Kunde erkennen. Bitte schildern Sie die Störung mit Adresse, " +
                    "Wohnung oder Bewohner, Gerät und Raum – z. B. „Musterstraße 12, 1. OG links (Müller): Heizkostenverteiler im Wohnzimmer zeigt nichts an, " +
                    "gemeldet von Petra Wagner“."
                );
            }
            this.session.step({ icon: "sap-icon://detail-view", text: "Analyse (regelbasierte Extraktion im Backend): " + this.countFilled(analyzed.values) + " Felder befüllt" });
            await this.gateway.validateDraft(uuid);
            let state = await this.session.refreshDraft(uuid);
            this.session.step(this.processStep(state, masterData, "Prozessbezug"));
            this.session.step(this.validationStep(state));
            const corrections = [];
            state = await this.autoCorrect(state, corrections);
            return this.report(state, masterData, corrections);
        }

        async followUp(text) {
            const masterData = await this.gateway.masterData();
            const uuid = this.session.draft.uuid;
            const current = this.session.draft.process || {};
            // way and end object: only real changes are sent (the backend redetermines the path, the steps and the expectation)
            const header = processChoice(text);
            if (header.processVariant === current.variant) {
                delete header.processVariant;
            }
            if (header.endObject === current.endObject) {
                delete header.endObject;
            }
            if (header.startObject === "SERVICE_QUOTATION" && !header.processVariant && ["W2_QUOTATION", "W2_REJECTED"].indexOf(current.variant) === -1) {
                // a start with the quotation needs a way with a quotation
                header.processVariant = "W2_QUOTATION";
            }
            if (header.startObject === current.start) {
                delete header.startObject;
            }
            const patch = {};
            for (const question of this.openQuestions) {
                const ranked = textMatching.rank(question.candidates, text, function (c) {
                    return c.id + " " + c.text;
                });
                if (ranked.length === 1 || (ranked.length > 1 && ranked[0].score > ranked[1].score)) {
                    if (HEADER_QUESTIONS[question.field]) {
                        header[HEADER_QUESTIONS[question.field]] = ranked[0].entry.id;
                    } else {
                        patch[question.field] = ranked[0].entry.id;
                    }
                }
            }
            // explicit changes: duration, priority
            const n = textMatching.normalize(text);
            const hours = n.match(/(\d+(?: \d+)?) ?(std|stunden?|h)\b/);
            if (hours) {
                patch.ServiceDuration = Number(hours[1].replace(" ", "."));
                patch.ExpectedNetAmount = null;
            }
            if (/sehr dringend|notfall/.test(n)) {
                patch.ServiceDocumentPriority = "1";
            } else if (/nicht (so )?dringend|keine eile/.test(n)) {
                patch.ServiceDocumentPriority = "9";
            } else if (/dringend|eilig|sofort/.test(n)) {
                patch.ServiceDocumentPriority = "3";
            }
            if (Object.keys(patch).length === 0 && Object.keys(header).length === 0) {
                const open = this.openQuestions
                    .map(function (q) {
                        return "**" + (LABEL[q.field] || q.field) + "**";
                    })
                    .join(", ");
                return (
                    "Ich konnte Ihre Antwort keinem offenen Punkt zuordnen" +
                    (open ? " (offen: " + open + ")" : "") +
                    ". Bitte nennen Sie z. B. den Raum des Geräts oder den Namen des Meldenden, den Weg („mit Angebot“, „über den Wartungsvertrag“) " +
                    "oder bis wohin getestet wird („bis zum Auftrag“) – oder öffnen Sie den Entwurf im Formular."
                );
            }
            await this.gateway.updateDraft(uuid, header, patch);
            if (Object.keys(header).length) {
                const changed = await this.gateway.readDraft(uuid);
                this.session.step({
                    icon: "sap-icon://process",
                    text:
                        "Prozessbezug geändert: " +
                        [
                            header.processVariant ? "Weg " + masterData.describe("ProcessVariant", changed.testCase.ProcessVariant) : "",
                            header.startObject || header.processVariant ? "Start ab " + masterData.describe("StartObject", changed.testCase.StartObject) : "",
                            header.endObject || header.processVariant ? "Lauf bis " + masterData.describe("EndObject", changed.testCase.EndObject) : "",
                            header.predecessorTestCase ? "Vorgänger " + masterData.describe("PredecessorTestCase", changed.testCase.PredecessorTestCase) + " (Belege und Testdaten übernommen)" : ""
                        ]
                            .filter(Boolean)
                            .join(", ") +
                        " – Testschritte und erwarteter Nettowert neu ermittelt"
                });
            }
            if (Object.keys(patch).length) {
                this.session.step({
                    icon: "sap-icon://edit",
                    text:
                        "Antwort übernommen: " +
                        Object.keys(patch)
                            .filter(function (f) {
                                return patch[f] !== null;
                            })
                            .map(function (f) {
                                return (LABEL[f] || f) + " = " + (prompts.NUMERIC_FIELDS.indexOf(f) > -1 ? prompts.formatValue(f, patch[f]) : masterData.describe(f, patch[f]));
                            })
                            .join(", ")
                });
            }
            await this.gateway.validateDraft(uuid);
            let state = await this.session.refreshDraft(uuid);
            this.session.step(this.validationStep(state));
            const corrections = [];
            state = await this.autoCorrect(state, corrections);
            return this.report(state, masterData, corrections);
        }

        /** device type rules R5/R10 have deterministic suggestions (profile default first): take the first one */
        async autoCorrect(state, corrections) {
            const masterData = await this.gateway.masterData();
            for (let pass = 0; pass < 2; pass++) {
                const fixes = state.validation.findings.filter(function (f) {
                    return (f.regel === "R10_DEVICE_TYPE" || f.regel === "R5_EQUIPMENT_PRODUCT") && f.vorschlagIds.length > 0;
                });
                if (fixes.length === 0) {
                    break;
                }
                const patch = { ExpectedNetAmount: null };
                fixes.forEach(function (f) {
                    patch[f.feld] = f.vorschlagIds[0];
                    corrections.push((LABEL[f.feld] || f.feld) + " " + masterData.describe(f.feld, state.values[f.feld]) + " → " + masterData.describe(f.feld, f.vorschlagIds[0]) + " (" + f.regeltext + ")");
                });
                await this.gateway.updateDraft(state.uuid, {}, patch);
                await this.gateway.validateDraft(state.uuid);
                state = await this.session.refreshDraft(state.uuid);
                this.session.step({ icon: "sap-icon://wrench", text: "Korrigiert nach Regel R5/R10: " + corrections.join("; ") });
            }
            return state;
        }

        countFilled(values) {
            return prompts.SUMMARY_FIELDS.filter(function (f) {
                return !isEmpty(values[f]);
            }).length;
        }

        /** step with the process reference determined by the backend (team, way, end object, assignment) */
        processStep(state, masterData, prefix) {
            const process = state.process || {};
            return {
                icon: "sap-icon://process",
                text:
                    prefix +
                    ": " +
                    prompts
                        .processRows(process, masterData.describe)
                        .map(function (row) {
                            return row.label + " " + row.value;
                        })
                        .join(" · "),
                state: process.assignment === "OPEN" ? "Warning" : "None"
            };
        }

        validationStep(state) {
            return {
                icon: "sap-icon://validate",
                text: "Validierung: " + (prompts.STATUS[state.validation.status] || state.validation.status) + " – " + prompts.counts(state.validation),
                state: state.validation.status === "VALID" ? "Success" : state.validation.errors ? "Error" : "Warning"
            };
        }

        /** German answer: what was captured, validation status, open questions (stored for the next answer) */
        report(state, masterData, corrections) {
            const v = state.values;
            const d = function (field) {
                return prompts.display(field, v[field], v, masterData.describe);
            };
            const lines = [];
            if (state.validation.status === "VALID") {
                lines.push("Ich habe die Störungsmeldung als Testfall erfasst und validiert: **" + prompts.STATUS.VALID + "**.");
            } else {
                lines.push(
                    "Ich habe einen Testfall-Entwurf angelegt. Validierung: **" + (prompts.STATUS[state.validation.status] || state.validation.status) + "** – " + prompts.counts(state.validation) + "."
                );
            }
            const process = state.process || {};
            if (process.variant || process.team) {
                lines.push(
                    "- Prozessbezug: " +
                        (process.team ? masterData.describe("ProcessTeam", process.team) : "Team offen") +
                        " · " +
                        (process.variant ? masterData.describe("ProcessVariant", process.variant) : "Weg offen") +
                        (process.start ? " · Start ab " + masterData.describe("StartObject", process.start) : "") +
                        (process.endObject ? " · Lauf bis " + masterData.describe("EndObject", process.endObject) : "")
                );
            }
            if (process.takesOver) {
                lines.push(
                    "- Übergabe: " +
                        (process.predecessor ? masterData.describe("PredecessorTestCase", process.predecessor) : "Vorgänger-Testfall offen") +
                        " liefert " +
                        masterData.describe("EndObject", process.takesOver)
                );
            }
            if (process.assignment && process.assignment !== "ASSIGNED") {
                lines.push("- Zuordnung: " + (prompts.ASSIGNMENT[process.assignment] || process.assignment) + (process.note ? " – " + process.note : ""));
            }
            if (!isEmpty(v.ServiceReferenceEquipment) || !isEmpty(v.ServiceRefFunctionalLocation)) {
                lines.push("- Gerät: " + (d("ServiceReferenceEquipment") || "offen") + (isEmpty(v.ServiceRefFunctionalLocation) ? "" : " in " + d("ServiceRefFunctionalLocation")));
            }
            if (!isEmpty(v.ServiceContract)) {
                lines.push("- Servicevertrag: " + d("ServiceContract"));
            }
            lines.push("- Kunde: " + (d("SoldToParty") || "offen") + " · Meldender: " + (d("ServiceRequestReporter") || "offen"));
            if (!isEmpty(v.ServiceRequestDescription)) {
                lines.push(
                    "- Problem: " +
                        v.ServiceRequestDescription +
                        " · Priorität " +
                        (d("ServiceDocumentPriority") || "offen") +
                        (isEmpty(v.RespyMgmtServiceTeam) ? "" : " · " + d("RespyMgmtServiceTeam"))
                );
            }
            if (!isEmpty(v.ServiceProduct)) {
                lines.push(
                    "- Leistung: " +
                        v.ServiceProduct +
                        " " +
                        prompts.formatValue("ServiceDuration", v.ServiceDuration, v) +
                        (isEmpty(v.ServicePart) ? "" : " + Ersatzteil " + v.ServicePart + " " + prompts.formatValue("ServicePartQuantity", v.ServicePartQuantity, v)) +
                        (isEmpty(v.ExpectedNetAmount) ? "" : " → erwarteter Nettowert " + prompts.formatValue("ExpectedNetAmount", v.ExpectedNetAmount) + " (Mock-Preisliste)")
                );
            }
            corrections.forEach(function (c) {
                lines.push("- Korrigiert: " + c);
            });
            // follow-up questions
            this.openQuestions = [];
            const questions = [];
            state.validation.findings.forEach(
                function (f) {
                    const label = LABEL[f.feld] || f.feld;
                    const candidates = f.vorschlagIds.map(function (id) {
                        return { id: id, text: masterData.describe(f.feld, id) };
                    });
                    if (candidates.length) {
                        this.openQuestions.push({ field: f.feld, candidates: candidates });
                    }
                    if (f.regel === "R7_AMBIGUOUS") {
                        questions.push("Welches **" + label + "** ist gemeint? " + candidates.map((c) => c.text).join(" | "));
                    } else if (f.regel === "R1_REQUIRED") {
                        questions.push("**" + label + "** fehlt." + (candidates.length ? " Vorschläge: " + candidates.map((c) => c.text).join(" | ") : ""));
                    } else {
                        questions.push("**" + label + "**: " + f.regeltext + " – " + f.meldung);
                    }
                }.bind(this)
            );
            if (questions.length) {
                lines.push("");
                lines.push("Offen:");
                questions.slice(0, 4).forEach(function (q) {
                    lines.push("- " + q);
                });
                lines.push("Antworten Sie einfach hier, z. B. mit dem Raum oder dem Namen des Meldenden.");
            } else {
                lines.push("");
                lines.push("Bitte prüfen Sie den Entwurf rechts und bestätigen Sie mit **Übernehmen & starten**: Der Testfall wird gespeichert, freigegeben und die Ausführung in der App gestartet.");
                lines.push(
                    "Anderer Weg, Start oder Endpunkt? Schreiben Sie z. B. „mit Angebot“, „Angebot wird abgelehnt“, „über den Wartungsvertrag“, „direkt ab dem Angebot“ oder „nur bis zum Auftrag“."
                );
            }
            return lines.join("\n");
        }
    }

    return RuleBasedAgent;
});
