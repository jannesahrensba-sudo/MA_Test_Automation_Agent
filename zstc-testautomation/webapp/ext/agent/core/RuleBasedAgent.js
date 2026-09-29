sap.ui.define(["./prompts", "./textMatching"], function (prompts, textMatching) {
    "use strict";

    /**
     * MOCK agent without a language model ("Mock-Agent, regelbasiert"). It follows the same process as the Claude agent,
     * but deterministically:
     *   1. process profile from device keywords (smoke alarm → MD_RWM_STOER, heat cost allocator / meter → MD_HKV_STOER, else FS_TM)
     *   2. draft with the fault report as scenario description, backend action analyze (MockTestCaseExtractionService)
     *   3. backend action validate; findings of the device type rules R5/R10 are corrected with the first suggestion
     *   4. German summary with follow-up questions for ambiguous (R7) or missing (R1) values; answers are matched
     *      against the candidates of the open questions
     */

    const LABEL = prompts.FIELD_LABELS;

    function isEmpty(value) {
        return value === null || value === undefined || value === "";
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
            if (!draft) {
                return this.firstTurn(text);
            }
            if (draft.submitted) {
                return "Der Testfall **" + (draft.caseId || "") + "** ist bereits übernommen. Für eine neue Störungsmeldung wählen Sie **Neu beginnen**.";
            }
            return this.followUp(text);
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
            this.session.step(this.validationStep(state));
            const corrections = [];
            state = await this.autoCorrect(state, corrections);
            return this.report(state, masterData, corrections);
        }

        async followUp(text) {
            const masterData = await this.gateway.masterData();
            const uuid = this.session.draft.uuid;
            const patch = {};
            for (const question of this.openQuestions) {
                const ranked = textMatching.rank(question.candidates, text, function (c) {
                    return c.id + " " + c.text;
                });
                if (ranked.length === 1 || (ranked.length > 1 && ranked[0].score > ranked[1].score)) {
                    patch[question.field] = ranked[0].entry.id;
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
            if (Object.keys(patch).length === 0) {
                const open = this.openQuestions
                    .map(function (q) {
                        return "**" + (LABEL[q.field] || q.field) + "**";
                    })
                    .join(", ");
                return (
                    "Ich konnte Ihre Antwort keinem offenen Punkt zuordnen" +
                    (open ? " (offen: " + open + ")" : "") +
                    ". Bitte nennen Sie z. B. den Raum des Geräts oder den Namen des Meldenden – oder öffnen Sie den Entwurf im Formular."
                );
            }
            await this.gateway.updateDraft(uuid, {}, patch);
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
            if (!isEmpty(v.ServiceReferenceEquipment) || !isEmpty(v.ServiceRefFunctionalLocation)) {
                lines.push("- Gerät: " + (d("ServiceReferenceEquipment") || "offen") + (isEmpty(v.ServiceRefFunctionalLocation) ? "" : " in " + d("ServiceRefFunctionalLocation")));
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
            }
            return lines.join("\n");
        }
    }

    return RuleBasedAgent;
});
