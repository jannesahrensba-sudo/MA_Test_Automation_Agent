sap.ui.define(["./prompts", "./textMatching"], function (prompts, textMatching) {
    "use strict";

    /**
     * "Ergebnis besprechen": German texts for the result of a test run. The analysis itself is deterministic and runs in
     * the backend (mock-backend/analysis/ResultAnalysisService.js → ResultFinding): each finding names its evidence, a
     * confidence, the responsible team and a recommendation. This module only phrases those findings in German — for the
     * analysis panel, the answers of the mock agent and the context of the language model. It adds no causes of its own.
     * Pure module (no UI5), testable in Node.
     */

    const BO_LABEL = {
        SERVICE_CONTRACT: "Servicevertrag",
        SERVICE_REQUEST: "Service Request",
        SERVICE_QUOTATION: "Angebot",
        SERVICE_ORDER: "Serviceauftrag",
        SERVICE_CONFIRMATION: "Rückmeldung",
        BILLING_DOC_REQUEST: "Fakturaanforderung",
        BILLING_DOCUMENT: "Faktura",
        ACCOUNTING_DOCUMENT: "Buchhaltungsbeleg (FI)"
    };
    const RESULT_TEXT = {
        PASSED: "Bestanden",
        PASSED_WITH_WARNING: "Bestanden mit Warnung",
        FAILED_FUNCTIONAL: "Fachlich fehlgeschlagen",
        FAILED_TECHNICAL: "Technisch fehlgeschlagen",
        BLOCKED: "Blockiert"
    };
    const RESULT_STATE = { PASSED: "Success", PASSED_WITH_WARNING: "Warning", FAILED_FUNCTIONAL: "Error", FAILED_TECHNICAL: "Error", BLOCKED: "Error" };
    const RUN_STATUS_TEXT = { NOT_STARTED: "nicht gestartet", RUNNING: "läuft", FINISHED: "beendet", FAILED: "abgebrochen (Fehler)", CANCELLED: "abgebrochen" };
    const STEP_STATUS_TEXT = { PLANNED: "geplant", RUNNING: "läuft", DONE: "erledigt", FAILED: "fehlgeschlagen", SKIPPED: "übersprungen" };
    const SEVERITY_TEXT = { ERROR: "Fehler", WARNING: "Warnung", INFO: "Info", SUCCESS: "OK" };
    const SEVERITY_STATE = { ERROR: "Error", WARNING: "Warning", INFO: "Information", SUCCESS: "Success" };
    const SEVERITY_ICON = { ERROR: "sap-icon://error", WARNING: "sap-icon://alert", INFO: "sap-icon://information", SUCCESS: "sap-icon://sys-enter-2" };
    const CONFIDENCE_TEXT = { HIGH: "hoch – durch die Evidenz belegt", MEDIUM: "mittel – passt zu einer bekannten Ursache", LOW: "niedrig – nur ein Hinweis" };
    const CONFIDENCE_SHORT = { HIGH: "Konfidenz hoch", MEDIUM: "Konfidenz mittel", LOW: "Konfidenz niedrig" };
    const ORIGIN_TEXT = { CREATED: "erzeugt", DETERMINED: "ermittelt", TAKEN_OVER: "übernommen" };
    /** fields checked by the verification (TestAssertion.Field) */
    const ASSERTION_FIELD = {
        AccountingDocument: "Buchhaltungsbeleg",
        DocumentFlow: "Belegfluss",
        Equipment: "Gerät",
        FunctionalLocation: "Nutzeinheit",
        NetValue: "Nettowert",
        Quantity: "Menge",
        QuotationDecision: "Kundenentscheidung",
        ServiceDuration: "Einsatzdauer",
        ServicePart: "Ersatzteil",
        ServiceProduct: "Leistung",
        SoldToParty: "Kunde",
        Status: "Status",
        SuccessorOrder: "Folgeauftrag",
        Unit: "Einheit"
    };
    const CONTRACT_REASON = {
        "expired or not yet valid": "abgelaufen oder noch nicht gültig",
        "not released": "nicht freigegeben",
        "not covering the reference object": "deckt das Bezugsobjekt nicht ab",
        "not found": "nicht gefunden"
    };
    const UNIT_WORD = { HR: ["Std.", "Stunde"], PC: ["Stk.", "Stück"] };
    const PASSED = ["PASSED", "PASSED_WITH_WARNING"];

    function isEmpty(value) {
        return value === null || value === undefined || value === "";
    }

    function boLabel(code) {
        return BO_LABEL[code] || code || "";
    }

    function resultText(code) {
        return RESULT_TEXT[code] || code || "kein Ergebnis";
    }

    /** 183 → "183,00 EUR" */
    function money(value, currency) {
        if (isEmpty(value) || Number.isNaN(Number(value))) {
            return "–";
        }
        return Number(value).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + (currency || "EUR");
    }

    /** "183.00 EUR" (backend text) → "183,00 EUR"; other texts unchanged */
    function moneyText(text) {
        const match = String(isEmpty(text) ? "" : text).match(/^\s*(-?[\d,]*\.?\d+)\s*([A-Z]{3})\s*$/);
        return match ? money(Number(match[1].replace(/,/g, "")), match[2]) : isEmpty(text) ? "–" : String(text);
    }

    function dateTime(iso) {
        if (!iso) {
            return "";
        }
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) {
            return String(iso);
        }
        return date.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
    }

    function parameters(text) {
        if (!text) {
            return {};
        }
        try {
            const parsed = JSON.parse(text);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    /** "test case version 2: Changed: ServiceDuration" → "Testfall-Version 2: geändert Einsatzdauer" */
    function changeText(change) {
        const text = String(change || "");
        const version = text.match(/^test case version (\d+): (.*)$/);
        if (version) {
            const summary = version[2];
            const changed = summary.match(/^Changed: (.*)$/);
            let german;
            if (changed) {
                german =
                    "geändert " +
                    changed[1]
                        .split(",")
                        .map(function (field) {
                            const name = field.trim();
                            return name === "Test steps" ? "Testschritte" : prompts.FIELD_LABELS[name] || name;
                        })
                        .join(", ");
            } else if (summary === "Initial version") {
                german = "erste Version";
            } else if (summary === "No content change") {
                german = "ohne inhaltliche Änderung";
            } else {
                german = summary;
            }
            return "Testfall-Version " + version[1] + ": " + german;
        }
        const process = text.match(/^process version (\d+) → (\d+)$/);
        if (process) {
            return "Prozessversion " + process[1] + " → " + process[2];
        }
        return text;
    }

    /** "1 Std. MD-SRV-STOER (69,00 EUR je Stunde)" */
    function explainedText(explained) {
        if (!explained || !explained.product) {
            return "";
        }
        const words = UNIT_WORD[explained.unit] || ["", ""];
        const quantity = String(Math.abs(Number(explained.quantity))).replace(".", ",");
        return quantity + " " + words[0] + " " + explained.product + (explained.price ? " (" + money(explained.price) + " je " + words[1] + ")" : "");
    }

    /**
     * Raw read of the gateway → analysis of the latest run (German-independent structure).
     *
     * @param {object} read {testCase, values, execution, steps, assertions, documents, findings, history}
     * @returns {object} analysis
     */
    function fromRead(read) {
        const tc = read.testCase || {};
        const execution = read.execution;
        return {
            uuid: tc.TestCaseUUID,
            caseId: tc.CaseID || "",
            title: tc.Title || "",
            profile: tc.ProcessProfile || "",
            team: tc.ProcessTeam || "",
            process: tc.BusinessProcess || "",
            variant: tc.ProcessVariant || "",
            start: tc.StartObject || "",
            endObject: tc.EndObject || "",
            predecessor: tc.PredecessorTestCase || "",
            version: tc.Version,
            approval: tc.ApprovalStatus || "",
            executionStatus: tc.ExecutionStatus || "",
            values: read.values || {},
            run: execution
                ? {
                      id: execution.ExternalExecutionID || "",
                      status: execution.Status || "",
                      result: execution.FunctionalResult || "",
                      release: execution.ReleaseID || "",
                      version: execution.TestCaseVersion,
                      variant: execution.ProcessVariant || "",
                      start: execution.StartObject || "",
                      endObject: execution.EndObject || "",
                      predecessor: execution.PredecessorExecution || "",
                      headline: execution.AnalysisHeadline || "",
                      startedAt: execution.StartedAt || "",
                      finishedAt: execution.FinishedAt || "",
                      duration: execution.DurationInSeconds,
                      executedBy: execution.ExecutedBy || "",
                      runType: execution.RunType || ""
                  }
                : null,
            steps: (read.steps || []).map(function (s) {
                return {
                    seq: s.Sequence,
                    stepId: s.ProcessStepID || "",
                    stepName: s.StepName || "",
                    team: s.ResponsibleTeam || "",
                    object: s.BusinessObjectType || "",
                    status: s.ExecutionStatus || "",
                    expected: s.ExpectedStatus || "",
                    actual: s.ActualStatus || "",
                    message: s.Message || ""
                };
            }),
            assertions: (read.assertions || []).map(function (a) {
                return {
                    seq: a.Sequence,
                    object: a.BusinessObjectType || "",
                    field: a.Field || "",
                    expected: a.ExpectedValue || "",
                    actual: a.ActualValue || "",
                    tolerance: a.Tolerance || "",
                    result: a.Result || "",
                    message: a.Message || "",
                    stepId: a.ProcessStepID || "",
                    stepName: a.StepName || ""
                };
            }),
            documents: (read.documents || []).map(function (d) {
                return {
                    seq: d.Sequence,
                    object: d.BusinessObjectType || "",
                    id: d.DocumentID || "",
                    origin: d.DocumentOrigin || "CREATED",
                    from: d.OriginReference || "",
                    status: d.LifecycleStatus || "",
                    netAmount: d.NetAmount,
                    currency: d.TransactionCurrency || "",
                    stepId: d.ProcessStepID || ""
                };
            }),
            findings: (read.findings || []).map(function (f) {
                return {
                    seq: f.Sequence,
                    code: f.FindingCode || "",
                    category: f.Category || "",
                    severity: f.Severity || "INFO",
                    stepId: f.ProcessStepID || "",
                    stepName: f.StepName || "",
                    team: f.ResponsibleTeam || "",
                    confidence: f.Confidence || "",
                    params: parameters(f.Parameters),
                    finding: f.Finding || "",
                    cause: f.ProbableCause || "",
                    recommendation: f.Recommendation || "",
                    evidence: f.Evidence || ""
                };
            }),
            latestRunId: read.history && read.history.length ? read.history[0].ExternalExecutionID || "" : "",
            history: (read.history || []).map(function (e) {
                return {
                    id: e.ExternalExecutionID || "",
                    status: e.Status || "",
                    result: e.FunctionalResult || "",
                    release: e.ReleaseID || "",
                    version: e.TestCaseVersion,
                    startedAt: e.StartedAt || "",
                    runType: e.RunType || ""
                };
            })
        };
    }

    /**
     * German texts of one finding from its code and parameters; unknown codes keep the backend texts.
     *
     * @param {object} f finding (see fromRead)
     * @param {object} analysis analysis
     * @returns {{titel: string, ursache: string, empfehlung: string}} German texts
     */
    function germanFinding(f, analysis) {
        const p = f.params || {};
        const step = analysis.steps.find(function (s) {
            return s.stepId === f.stepId;
        });
        const stepText = "Schritt " + (p.sequence || (step && step.seq) || "?") + " (" + boLabel(p.object || (step && step.object)) + ")";
        switch (f.code) {
            case "ALL_PASSED": {
                const documents = p.documents || [];
                return {
                    titel: "Alle " + (p.assertions || 0) + " Prüfungen bestanden; " + documents.length + (documents.length === 1 ? " Beleg" : " Belege") + " erzeugt" + (documents.length ? ": " + documents.join(" → ") : "") + ".",
                    ursache: "",
                    empfehlung: "Kein Handlungsbedarf."
                };
            }
            case "NET_VALUE_DEVIATION":
            case "NET_VALUE_IN_TOLERANCE": {
                const consistent = !isEmpty(p.priceList) && Math.abs(Number(p.priceList) - Number(p.actual)) < 0.005;
                const explained = explainedText(p.explained);
                let ursache;
                if (consistent && explained) {
                    ursache = "Die Belege sind genau so bepreist, wie es die Testdaten vorgeben (" + money(p.priceList) + "); die gepflegte Erwartung weicht um " + explained + " ab.";
                } else if (consistent) {
                    ursache = "Die Belege sind so bepreist, wie es die Testdaten vorgeben (" + money(p.priceList) + "); die gepflegte Erwartung ist nicht aktuell.";
                } else if (explained) {
                    ursache = "Die Differenz entspricht " + explained + ": Dauer oder Menge weichen zwischen Testdaten und Belegen ab, oder der Preis hat sich geändert.";
                } else {
                    ursache = "Die Preisfindung im System weicht von der Erwartung ab (Konditionen, Preisliste oder Rabatt geändert).";
                }
                return {
                    titel:
                        "Nettowert " + money(p.actual) + " statt " + money(p.expected) + " (Differenz " + money(p.delta) +
                        (isEmpty(p.tolerance) ? "" : ", Toleranz " + money(p.tolerance)) + ")" + (f.code === "NET_VALUE_IN_TOLERANCE" ? " – innerhalb der Toleranz" : "") + ".",
                    ursache: ursache,
                    empfehlung: consistent
                        ? "Stimmen die Testdaten, den erwarteten Nettowert auf " + money(p.actual) + " setzen; sonst Dauer oder Menge in den Testdaten korrigieren."
                        : "Preisfindung des Belegs mit den Preiskonditionen dieses Release vergleichen; das für die Preisfindung zuständige Team einbeziehen."
                };
            }
            case "STATUS_MISMATCH":
                return {
                    titel: boLabel(p.object) + " hat den Status " + (p.actual || "–") + " statt " + (p.expected || "–") + ".",
                    ursache: "Der Beleg wurde nicht bis zum erwarteten Status bearbeitet (fehlender Folgeschritt, Statusschema oder ein blockierender Fehler).",
                    empfehlung: "Schrittprotokoll und Status des Belegs im System prüfen und mit dem erwarteten Status des Prozessschritts vergleichen."
                };
            case "FLOW_INCOMPLETE":
                return {
                    titel: "Belegfluss " + (p.actual || "–") + " statt " + (p.expected || "–") + ".",
                    ursache: "Ein Beleg fehlt oder ist nicht mit seinem Vorgänger verknüpft (Kopiersteuerung oder Referenzfelder).",
                    empfehlung: "SAP-Objekte des Laufs öffnen und die Vorgängerbezüge der Belege prüfen."
                };
            case "FIELD_MISMATCH":
                return {
                    titel: (ASSERTION_FIELD[p.field] || p.field) + " im Beleg " + boLabel(p.object) + " ist " + (p.actual || "–") + " statt " + (p.expected || "–") + ".",
                    ursache: "Der Beleg wurde mit anderen Werten als den freigegebenen Testdaten angelegt (Findung im System oder geänderter Testfall).",
                    empfehlung: "Testdaten mit dem Beleg vergleichen; ist die Findung im System gewollt, die Testdaten anpassen."
                };
            case "MATERIAL_BLOCKED":
                return {
                    titel: stepText + " ist fehlgeschlagen: Warenausgang für das Ersatzteil " + (p.part || "") + " nicht möglich.",
                    ursache: "Das Ersatzteil " + (p.part || "") + " ist im Werk gesperrt (Materialstatus).",
                    empfehlung: (p.part || "Das Ersatzteil") + " im Werk entsperren oder ein anderes Ersatzteil in den Testdaten wählen; danach erneut ausführen."
                };
            case "CONTRACT_INVALID":
                return {
                    titel: stepText + " ist fehlgeschlagen: kein gültiger Servicevertrag.",
                    ursache: "Der Servicevertrag" + (p.contract ? " " + p.contract : "") + " ist " + (CONTRACT_REASON[p.reason] || p.reason || "ungültig") + ".",
                    empfehlung: "Vertrag verlängern oder freigeben, das Objekt in die Objektliste des Vertrags aufnehmen oder den Fall über einen Weg ohne Vertrag testen."
                };
            case "POSTING_MISSING":
                return {
                    titel: stepText + " ist fehlgeschlagen: Die Faktura wurde nicht an die Buchhaltung übergeben.",
                    ursache: "Eine Buchungssperre oder die Kontenfindung verhindert die Übergabe an FI.",
                    empfehlung: "Buchhaltungsstatus der Faktura und die Kontenfindung prüfen; das für Fakturierung und FI zuständige Team einbeziehen."
                };
            case "STEP_ERROR":
                return {
                    titel: stepText + " ist fehlgeschlagen.",
                    ursache: p.message ? "Meldung des Schritts (Originaltext): „" + p.message + "“" : "Der Schritt hat einen Fehler ohne Details gemeldet.",
                    empfehlung: "Technisches Protokoll des Laufs und das Anwendungsprotokoll des Belegs im System prüfen."
                };
            case "CANCELLED":
                return {
                    titel: "Der Lauf wurde vor dem Ende abgebrochen.",
                    ursache: "Abbruch durch einen Benutzer.",
                    empfehlung: "Die Ausführung erneut starten, wenn der Abbruch nicht gewollt war."
                };
            case "HANDOVER": {
                const documents = (p.documents || []).map(function (d) {
                    return boLabel(d.type) + " " + d.id;
                });
                return {
                    titel: "Der Lauf setzt auf " + (documents.join(", ") || "den Belegen") + " aus " + (p.from || "dem Vorgänger-Testfall") + " auf.",
                    ursache: "",
                    empfehlung: "Scheitert der erste eigene Schritt, zuerst den übergebenen Beleg im Lauf des Vorgänger-Testfalls prüfen."
                };
            }
            case "REGRESSION": {
                const changes = (p.changes || []).map(changeText);
                const run = analysis.run || {};
                const releaseChanged = p.previousRelease && run.release && p.previousRelease !== run.release;
                return {
                    titel:
                        "Regression: Der " + (p.lastPassed ? "letzte erfolgreiche" : "vorige") + " Lauf " + p.previous + (p.previousRelease ? " (Release " + p.previousRelease + ")" : "") +
                        " war mit Version " + p.previousVersion + " erfolgreich; dieser Lauf scheitert mit Version " + (run.version || "?") + ".",
                    ursache: changes.length
                        ? "Seit dem erfolgreichen Lauf geändert: " + changes.join("; ") + "."
                        : "Der Testfall ist unverändert" + (releaseChanged ? "; das Release wechselte von " + p.previousRelease + " auf " + run.release : "") +
                          ": die Ursache liegt vermutlich im System (Customizing, Transport, Upgrade).",
                    empfehlung: changes.length
                        ? "Prüfen, ob die Änderung am Testfall gewollt ist; sonst zurücknehmen."
                        : "Konfiguration der Releases vergleichen; die Abweichung dem Team des fehlgeschlagenen Schritts melden."
                };
            }
            case "FIXED":
                return {
                    titel: "Behoben: Der vorige Lauf " + p.previous + " endete mit „" + resultText(p.previousResult) + "“; dieser Lauf ist erfolgreich.",
                    ursache: "",
                    empfehlung: "Kein Handlungsbedarf."
                };
            case "SAME_AS_BEFORE": {
                const passed = analysis.run && PASSED.indexOf(analysis.run.result) > -1;
                return {
                    titel: "Gleiches Ergebnis wie im vorigen Lauf " + p.previous + ": „" + resultText(p.previousResult) + "“.",
                    ursache: "",
                    empfehlung: passed ? "Kein Handlungsbedarf." : "Die Abweichung besteht weiter: die übrigen Befunde bearbeiten."
                };
            }
            default:
                return { titel: f.finding, ursache: f.cause, empfehlung: f.recommendation };
        }
    }

    /** German findings, most important first (the backend orders them by severity) */
    function germanFindings(analysis) {
        return analysis.findings.map(function (f) {
            return Object.assign({}, f, germanFinding(f, analysis));
        });
    }

    function teamText(team, describe) {
        return team ? describe("ProcessTeam", team) : "";
    }

    function stepLabel(f) {
        return f.stepId ? f.stepId + (f.stepName ? " " + f.stepName : "") : "";
    }

    /** "19 von 20 Prüfungen bestanden, 1 abweichend" */
    function assertionCounts(analysis) {
        const total = analysis.assertions.length;
        const passed = analysis.assertions.filter(function (a) {
            return a.result === "PASSED";
        }).length;
        const failed = analysis.assertions.filter(function (a) {
            return a.result === "FAILED";
        }).length;
        const warnings = analysis.assertions.filter(function (a) {
            return a.result === "WARNING";
        }).length;
        if (!total) {
            return "keine Prüfungen";
        }
        return passed + " von " + total + " Prüfungen bestanden" + (failed ? ", " + failed + " abweichend" : "") + (warnings ? ", " + warnings + " mit Warnung" : "");
    }

    function documentCounts(analysis) {
        const takenOver = analysis.documents.filter(function (d) {
            return d.origin === "TAKEN_OVER";
        }).length;
        const total = analysis.documents.length;
        return total + (total === 1 ? " Beleg" : " Belege") + (takenOver ? " (" + takenOver + " übernommen)" : "");
    }

    /** one line per run: "MOCK-20261001-0007 · 01.10.2026, 11:00 · Release INT-2026.10 · Version 2: Fachlich fehlgeschlagen" */
    function runLine(run) {
        return (
            run.id + (run.startedAt ? " · " + dateTime(run.startedAt) : "") + (run.release ? " · Release " + run.release : "") + (isEmpty(run.version) ? "" : " · Version " + run.version) + ": " +
            (run.result ? resultText(run.result) : RUN_STATUS_TEXT[run.status] || run.status)
        );
    }

    /** finding as one list line of a chat answer */
    function findingLine(f, describe, withCause) {
        const where = [stepLabel(f), teamText(f.team, describe) ? "zuständig " + teamText(f.team, describe) : ""].filter(Boolean).join(" · ");
        return (
            "**" + (SEVERITY_TEXT[f.severity] || f.severity) + ":** " + f.titel + (where ? " (" + where + ")" : "") +
            (withCause && f.ursache ? " Ursache: " + f.ursache : "") +
            (withCause && f.ursache && f.confidence ? " [" + (CONFIDENCE_SHORT[f.confidence] || f.confidence) + "]" : "")
        );
    }

    /**
     * First answer of the discussion: run, verdict, findings with cause and confidence, what can be asked.
     *
     * @param {object} analysis analysis (see fromRead)
     * @param {Function} describe (field, id) → readable text
     * @returns {string} German answer (Markdown subset)
     */
    function report(analysis, describe) {
        const lines = ["Ergebnis von **" + analysis.caseId + "** „" + analysis.title + "“:"];
        if (!analysis.run) {
            lines.push("Der Testfall wurde noch nicht ausgeführt – es gibt kein Ergebnis zu besprechen. Starten Sie die Ausführung im Testfall.");
            return lines.join("\n");
        }
        const run = analysis.run;
        if (run.status === "RUNNING") {
            lines.push("Der Lauf **" + run.id + "** läuft noch. Das Ergebnis und die Analyse liegen vor, sobald er beendet ist.");
            return lines.join("\n");
        }
        lines.push(
            "Lauf **" + run.id + "**" + (run.release ? " im Release " + run.release : "") + " mit Version " + run.version + ": **" + resultText(run.result) + "** – " +
                assertionCounts(analysis) + ", " + documentCounts(analysis) + "."
        );
        if (analysis.latestRunId && analysis.latestRunId !== run.id) {
            lines.push("Hinweis: Das ist nicht der neueste Lauf des Testfalls; neuester Lauf ist **" + analysis.latestRunId + "**.");
        }
        const findings = germanFindings(analysis);
        if (!findings.length) {
            lines.push("Zu diesem Lauf liegt keine Ergebnisanalyse vor (z. B. Lauf nach einem Neustart des Mockservers verloren). Bitte erneut ausführen.");
            return lines.join("\n");
        }
        lines.push("");
        lines.push("Befunde der Ergebnisanalyse (deterministisch, nur aus der Evidenz dieses Laufs):");
        findings.forEach(function (f) {
            lines.push("- " + findingLine(f, describe, true));
        });
        const actions = findings.filter(function (f) {
            return f.severity === "ERROR" || f.severity === "WARNING";
        });
        if (actions.length) {
            lines.push("");
            lines.push("Empfehlung: " + actions[0].empfehlung);
            lines.push("Fragen Sie z. B. „Wer ist zuständig?“, „Was hat sich seit dem letzten Lauf geändert?“, „Wie sicher ist das?“ oder „Welche Belege?“.");
        } else {
            lines.push("");
            lines.push("Kein Handlungsbedarf. Fragen Sie z. B. „Welche Belege?“ oder „Wie liefen die Läufe davor?“.");
        }
        return lines.join("\n");
    }

    /** intents of a follow-up question (mock agent) in answer order */
    const INTENTS = [
        ["cause", /warum|wieso|weshalb|ursache|grund|schief|fehler|fehlgeschlagen|was ist (da )?passiert|woran/],
        ["team", /\bwer\b|\bwem\b|zustaendig|verantwortlich|\bteams?\b|melden|ansprechpartner/],
        ["compare", /geaendert|aenderung|vorher|vorig|letzt|regression|frueher|unterschied|\bseit\b|historie|davor|\blaeufe\b/],
        ["confidence", /sicher|konfidenz|evidenz|beweis|belegt|validiert|verlass|stimmt das|vertrauen/],
        ["action", /was (soll|kann|muss) ich|was tun|empfehl|naechste|massnahme|beheben|loesung|korrigier|vorgehen|handlung|fixen/],
        ["net", /nettowert|preis|betrag|euro|\beur\b|kosten|teuer/],
        ["documents", /\bbelege?\b|belegnummer|belegfluss|dokument|objekte/],
        ["steps", /(?<!naechste[nr]? )schritte?\b|protokoll|\blog\b|ablauf/],
        ["assertions", /pruefung|assertion|soll ist|soll und ist|erwartet|abweichung/],
        ["handover", /uebergabe|uebergeben|vorgaenger|uebernommen|uebernahme/],
        ["rerun", /nochmal|erneut|wiederhol|neu starten|ausfuehren|starten/],
        ["data", /testdaten|\bdaten\b|\bwerte\b/]
    ];

    /** German names of the intents (agent log) */
    const INTENT_LABEL = {
        cause: "Ursache",
        team: "Zuständigkeit",
        compare: "Vergleich mit früheren Läufen",
        confidence: "Sicherheit der Befunde",
        action: "Empfehlung",
        net: "Nettowert",
        documents: "Belege",
        steps: "Schritte",
        assertions: "Prüfungen",
        handover: "Übergabe",
        rerun: "Erneut ausführen",
        data: "Testdaten"
    };

    function intentsOf(question) {
        const n = textMatching.normalize(question);
        return INTENTS.filter(function (intent) {
            return intent[1].test(n);
        }).map(function (intent) {
            return intent[0];
        });
    }

    /** sections of the answer of the mock agent */
    const SECTIONS = {
        cause: function (analysis, findings, describe) {
            const relevant = findings.filter(function (f) {
                return f.severity === "ERROR" || f.severity === "WARNING";
            });
            if (!relevant.length) {
                return ["Es gibt keine Abweichung: " + (findings[0] ? findings[0].titel : resultText(analysis.run.result))];
            }
            return ["Ursachen laut Analyse:"].concat(
                relevant.map(function (f) {
                    return "- " + f.titel + (f.ursache ? " Ursache: " + f.ursache : "") + " [" + (CONFIDENCE_SHORT[f.confidence] || "ohne Konfidenz") + "; Evidenz: " + (f.evidence || "–") + "]";
                })
            );
        },
        team: function (analysis, findings, describe) {
            const lines = [];
            findings
                .filter(function (f) {
                    return f.severity === "ERROR" || f.severity === "WARNING";
                })
                .forEach(function (f) {
                    lines.push(
                        "- " + f.titel + " → " + (f.team ? "**" + teamText(f.team, describe) + "**" : "kein Team festgelegt (Vergleich bzw. Gesamtergebnis)") +
                            (f.stepId ? " · Schritt " + stepLabel(f) : "")
                    );
                });
            if (!lines.length) {
                return ["Keine Abweichung – niemand muss etwas tun. Verantwortlich für den Testfall ist " + (teamText(analysis.team, describe) || "das Prozessteam des Testfalls") + "."];
            }
            return ["Zuständig laut Analyse (Abweichungen zwischen Testdaten und Erwartung pflegt das Team des Testfalls, sonst das Team des Prozessschritts):"].concat(lines);
        },
        compare: function (analysis, findings) {
            const lines = [];
            findings
                .filter(function (f) {
                    return f.category === "REGRESSION";
                })
                .forEach(function (f) {
                    lines.push("- " + f.titel + (f.ursache ? " " + f.ursache : ""));
                });
            if (!lines.length) {
                lines.push(analysis.history.length > 1 ? "- Die Analyse hat keinen Vergleichsbefund." : "- Das ist der erste Lauf dieses Testfalls – es gibt keinen Vergleich.");
            }
            const history = analysis.history.slice(0, 5).map(function (run) {
                return "- " + runLine(run);
            });
            return ["Vergleich mit den vorigen Läufen:"].concat(lines, history.length > 1 ? ["Läufe (neueste zuerst):"].concat(history) : []);
        },
        confidence: function (analysis, findings) {
            return ["So sicher sind die Befunde (deterministische Analyse, kein Sprachmodell):"].concat(
                findings.map(function (f) {
                    return "- " + f.titel + " → Konfidenz " + (CONFIDENCE_TEXT[f.confidence] || "–") + ". Evidenz: " + (f.evidence || "–");
                }),
                ["Hohe Konfidenz heißt: Die Evidenz des Laufs beweist die Ursache. Mittel oder niedrig: im System prüfen, bevor etwas geändert wird."]
            );
        },
        action: function (analysis, findings) {
            const relevant = findings.filter(function (f) {
                return f.severity === "ERROR" || f.severity === "WARNING";
            });
            if (!relevant.length) {
                return ["Kein Handlungsbedarf: " + (findings[0] ? findings[0].titel : "Lauf bestanden.")];
            }
            return ["Empfohlene nächste Schritte:"].concat(
                relevant.map(function (f, index) {
                    return "- " + (index + 1) + ". " + f.empfehlung;
                }),
                ["Ändern Sie den Testfall im Formular („Zum Testfall“ → Bearbeiten): nach dem Speichern entsteht eine neue Version, die neu validiert und freigegeben werden muss."]
            );
        },
        net: function (analysis, findings) {
            const net = findings.filter(function (f) {
                return f.code === "NET_VALUE_DEVIATION" || f.code === "NET_VALUE_IN_TOLERANCE";
            });
            const assertions = analysis.assertions.filter(function (a) {
                return a.field === "NetValue";
            });
            const lines = ["Nettowert:"];
            net.forEach(function (f) {
                lines.push("- " + f.titel + " " + f.ursache);
            });
            assertions.forEach(function (a) {
                lines.push("- Prüfung " + boLabel(a.object) + ": Soll " + moneyText(a.expected) + ", Ist " + moneyText(a.actual) + (a.tolerance ? ", Toleranz " + moneyText(a.tolerance) : "") + " → " + (a.result === "PASSED" ? "bestanden" : a.result === "WARNING" ? "Warnung" : "abweichend"));
            });
            const values = analysis.values || {};
            if (!isEmpty(values.ExpectedNetAmount)) {
                lines.push(
                    "- Testdaten: " + (values.ServiceProduct || "") + " " + prompts.formatValue("ServiceDuration", values.ServiceDuration, values) +
                        (values.ServicePart ? " + " + values.ServicePart + " " + prompts.formatValue("ServicePartQuantity", values.ServicePartQuantity, values) : "") +
                        ", erwarteter Nettowert " + prompts.formatValue("ExpectedNetAmount", values.ExpectedNetAmount)
                );
            }
            if (lines.length === 1) {
                lines.push("- Der Nettowert wurde in diesem Lauf nicht geprüft (Lauf endet vor der Faktura oder vor dem Prüfschritt).");
            }
            return lines;
        },
        documents: function (analysis) {
            if (!analysis.documents.length) {
                return ["Der Lauf hat keine Belege erzeugt."];
            }
            return ["Belege des Laufs:"].concat(
                analysis.documents.map(function (d) {
                    return (
                        "- " + boLabel(d.object) + " **" + d.id + "** – " + (ORIGIN_TEXT[d.origin] || d.origin) + (d.from ? " aus " + d.from : "") + (d.status ? " · Status " + d.status : "") +
                        (isEmpty(d.netAmount) || Number(d.netAmount) === 0 ? "" : " · " + money(d.netAmount, d.currency))
                    );
                })
            );
        },
        steps: function (analysis) {
            if (!analysis.steps.length) {
                return ["Für diesen Lauf gibt es keine Schritte."];
            }
            return ["Schritte des Laufs:"].concat(
                analysis.steps.map(function (s) {
                    return "- " + s.seq + ". " + (s.stepName || boLabel(s.object)) + " – " + (STEP_STATUS_TEXT[s.status] || s.status) + (s.status === "FAILED" && s.message ? ": " + s.message : "");
                })
            );
        },
        assertions: function (analysis) {
            const deviating = analysis.assertions.filter(function (a) {
                return a.result !== "PASSED";
            });
            const lines = ["Prüfungen: " + assertionCounts(analysis) + "."];
            deviating.slice(0, 6).forEach(function (a) {
                lines.push("- " + boLabel(a.object) + " · " + (ASSERTION_FIELD[a.field] || a.field) + ": Soll " + moneyText(a.expected) + ", Ist " + moneyText(a.actual) + " – " + a.message);
            });
            return lines;
        },
        handover: function (analysis, findings) {
            const handover = findings.filter(function (f) {
                return f.code === "HANDOVER";
            });
            if (!handover.length) {
                return [analysis.predecessor ? "Der Testfall hat den Vorgänger " + analysis.predecessor + ", der letzte Lauf hat aber keine Belege übernommen." : "Dieser Lauf hat keine Belege von einem Vorgänger-Testfall übernommen."];
            }
            return handover.map(function (f) {
                return f.titel + " " + f.empfehlung;
            });
        },
        rerun: function () {
            return [
                "Erneut ausführen: im Testfall „Ausführung starten“. Haben Sie den Testfall vorher geändert, braucht die neue Version eine Validierung und eine Freigabe durch den Process Owner des Teams."
            ];
        },
        data: function (analysis, findings, describe) {
            const values = analysis.values || {};
            const shown = prompts.SUMMARY_FIELDS.filter(function (field) {
                return !isEmpty(values[field]);
            });
            return ["Testdaten der Version " + analysis.version + ":"].concat(
                shown.slice(0, 10).map(function (field) {
                    return "- " + (prompts.FIELD_LABELS[field] || field) + ": " + prompts.display(field, values[field], values, describe);
                })
            );
        }
    };

    /**
     * Answer of the mock agent to a follow-up question about the result (deterministic, from the analysis only).
     *
     * @param {string} question question of the user
     * @param {object} analysis analysis (see fromRead)
     * @param {Function} describe (field, id) → readable text
     * @returns {string} German answer
     */
    function answer(question, analysis, describe) {
        if (!analysis.run || analysis.run.status === "RUNNING") {
            return report(analysis, describe);
        }
        const findings = germanFindings(analysis);
        const intents = intentsOf(question);
        if (!intents.length) {
            return (
                "Dazu kann ich aus der Ergebnisanalyse nichts Sicheres sagen. Ich beantworte Fragen zu **Ursache**, **Zuständigkeit**, **Vergleich mit dem letzten Lauf**, " +
                "**Sicherheit der Befunde**, **Empfehlung**, **Nettowert**, **Belegen**, **Schritten**, **Prüfungen**, **Übergabe** und **Testdaten**. " +
                "Für freie Rückfragen schalten Sie auf Claude um (wenn verfügbar)."
            );
        }
        const lines = [];
        intents.slice(0, 3).forEach(function (intent) {
            if (lines.length) {
                lines.push("");
            }
            Array.prototype.push.apply(lines, SECTIONS[intent](analysis, findings, describe));
        });
        return lines.join("\n");
    }

    /**
     * Compact result for the tool ergebnis_lesen (language model): German keys, failed assertions only.
     *
     * @param {object} analysis analysis
     * @param {Function} describe (field, id) → readable text
     * @returns {object} summary
     */
    function summarize(analysis, describe) {
        const findings = germanFindings(analysis);
        const run = analysis.run;
        return {
            testfall: analysis.caseId,
            titel: analysis.title,
            prozessbezug: {
                team: teamText(analysis.team, describe),
                weg: analysis.variant ? describe("ProcessVariant", analysis.variant) : "",
                start_ab: analysis.start ? describe("StartObject", analysis.start) : "",
                lauf_bis: analysis.endObject ? describe("EndObject", analysis.endObject) : "",
                vorgaenger: analysis.predecessor || ""
            },
            version: analysis.version,
            freigabe: analysis.approval,
            lauf: run
                ? {
                      id: run.id,
                      status: RUN_STATUS_TEXT[run.status] || run.status,
                      ergebnis: resultText(run.result),
                      release: run.release,
                      version: run.version,
                      gestartet: dateTime(run.startedAt),
                      uebernommen_aus: run.predecessor || "",
                      pruefungen: assertionCounts(analysis)
                  }
                : null,
            schritte: analysis.steps.map(function (s) {
                return {
                    nr: s.seq,
                    prozessschritt: s.stepId + " " + s.stepName,
                    team: s.team,
                    beleg: boLabel(s.object),
                    status: STEP_STATUS_TEXT[s.status] || s.status,
                    meldung: s.status === "FAILED" ? s.message : undefined
                };
            }),
            abweichende_pruefungen: analysis.assertions
                .filter(function (a) {
                    return a.result !== "PASSED";
                })
                .map(function (a) {
                    return { beleg: boLabel(a.object), feld: ASSERTION_FIELD[a.field] || a.field, soll: a.expected, ist: a.actual, toleranz: a.tolerance || undefined, ergebnis: a.result, meldung: a.message };
                }),
            belege: analysis.documents.map(function (d) {
                return { typ: boLabel(d.object), nummer: d.id, herkunft: ORIGIN_TEXT[d.origin] || d.origin, aus: d.from || undefined };
            }),
            befunde: findings.map(function (f) {
                return {
                    nr: f.seq,
                    code: f.code,
                    schwere: SEVERITY_TEXT[f.severity] || f.severity,
                    befund: f.titel,
                    ursache: f.ursache || undefined,
                    konfidenz: CONFIDENCE_TEXT[f.confidence] || f.confidence,
                    evidenz: f.evidence,
                    team: teamText(f.team, describe) || undefined,
                    prozessschritt: stepLabel(f) || undefined,
                    empfehlung: f.empfehlung
                };
            }),
            historie: analysis.history.slice(0, 6).map(runLine)
        };
    }

    /**
     * Context block of the language model during the discussion of a result.
     *
     * @param {object} analysis analysis
     * @param {Function} describe (field, id) → readable text
     * @returns {string} context block
     */
    function contextBlock(analysis, describe) {
        const lines = [
            "[Kontext der App]",
            "Besprochen wird das Ergebnis von " + analysis.caseId + " „" + analysis.title + "“ (Team " + (analysis.team || "offen") + ", Weg " + (analysis.variant || "offen") +
                ", Start ab " + (analysis.start || "-") + ", Lauf bis " + (analysis.endObject || "-") + (analysis.predecessor ? ", Vorgänger " + analysis.predecessor : "") + ", Version " + analysis.version + ")."
        ];
        if (!analysis.run) {
            lines.push("Der Testfall wurde noch nicht ausgeführt.");
        } else {
            lines.push("Letzter Lauf " + runLine(analysis.run) + "; " + assertionCounts(analysis) + "; " + documentCounts(analysis) + ".");
            germanFindings(analysis).forEach(function (f) {
                lines.push(
                    "Befund " + f.seq + " (" + (SEVERITY_TEXT[f.severity] || f.severity) + ", " + f.code + ", " + (CONFIDENCE_SHORT[f.confidence] || "-") + (f.stepId ? ", Schritt " + stepLabel(f) : "") +
                        (f.team ? ", Team " + f.team : "") + "): " + f.titel + (f.ursache ? " Ursache: " + f.ursache : "") + " Empfehlung: " + f.empfehlung + " Evidenz: " + (f.evidence || "-")
                );
            });
        }
        lines.push("[Ende Kontext]");
        return lines.join("\n");
    }

    /**
     * Standing instructions of the language model for the discussion of a result.
     *
     * @param {object} catalog catalog of the service (process teams)
     * @returns {string} instructions
     */
    function instructions(catalog) {
        const teams = (catalog.processTeams || [])
            .map(function (t) {
                return "- " + t.ProcessTeam + ": " + t.ProcessTeamName;
            })
            .join("\n");
        return [
            "Du bist der Service-Assistent eines Test-Automatisierungs-Tools für den Service-to-Cash-Prozess (SAP S/4HANA Service) eines Messdienstleisters. Du arbeitest in einem Mockup mit fiktiven Daten.",
            "Jetzt besprichst du mit dem Nutzer das Ergebnis eines Testlaufs (Ergebnis besprechen).",
            "",
            "Grundlage – validiert, nicht geraten:",
            "- Die Befunde der Ergebnisanalyse im Backend sind deterministisch. Sie stammen aus den Prüfungen (Soll/Ist), den Belegen, dem Schrittprotokoll, den Testdaten, der Mock-Preisliste und dem vorigen Lauf. Jeder Befund nennt Evidenz und Konfidenz (hoch = durch die Evidenz belegt, mittel = passt zu einer bekannten Ursache, niedrig = nur ein Hinweis).",
            "- Nenne als Ursache nur, was ein Befund oder die Daten des Laufs belegen, und nenne die Evidenz dazu (z. B. Prüfung Nettowert: Soll 114,00 EUR, Ist 183,00 EUR). Eigene Vermutungen kennzeichnest du ausdrücklich als Vermutung und sagst, wie man sie im System prüft.",
            "- Erfinde keine Belege, Belegnummern, Transaktionen, Customizing-Einstellungen, Konditionen oder Systemmeldungen. Beantworten die Daten eine Frage nicht, sag das.",
            "- Weitere Daten liest du mit dem Tool ergebnis_lesen: ohne case_id den besprochenen Testfall, mit case_id z. B. den Vorgänger-Testfall, dessen Belege der Lauf übernommen hat.",
            "- Zuständig ist das Team im Befund; fehlt es, das Team des betroffenen Prozessschritts. Abweichungen zwischen Testdaten und Erwartung pflegt das Team des Testfalls.",
            "- Du änderst nichts: keine Testdaten, keine Freigabe, kein Start. Für Korrekturen verweist du auf den Testfall (Button „Zum Testfall“: Bearbeiten, Validieren, Freigeben, Ausführen). Eine Änderung erzeugt eine neue Version, die neu freigegeben werden muss.",
            "",
            "Begriffe: Service Request, Angebot, Serviceauftrag, Rückmeldung, Fakturaanforderung, Faktura, Buchhaltungsbeleg (FI). Ergebnisse: Bestanden, Bestanden mit Warnung, Fachlich fehlgeschlagen (eine Prüfung weicht ab), Technisch fehlgeschlagen (ein Schritt ist abgebrochen), Blockiert (Lauf abgebrochen).",
            "Prozessteams:",
            teams || "- (keine)",
            "",
            "Antwort: Deutsch, sachlich, kurz (höchstens 10 Zeilen). Nur einfache Aufzählungen mit „- “ und **fett**, keine Tabellen, keine Überschriften.",
            "Jede Nutzernachricht beginnt mit einem Block [Kontext der App]. Er fasst das besprochene Ergebnis zusammen und stammt von der App, nicht vom Nutzer."
        ].join("\n");
    }

    /**
     * Data of the analysis panel of the page.
     *
     * @param {object} analysis analysis
     * @param {Function} describe (field, id) → readable text
     * @returns {object} panel data
     */
    function panel(analysis, describe) {
        const run = analysis.run;
        const findings = run ? germanFindings(analysis) : [];
        const main = findings.find(function (f) {
            return f.severity === "ERROR";
        }) ||
            findings.find(function (f) {
                return f.severity === "WARNING";
            }) ||
            findings[0];
        return {
            uuid: analysis.uuid,
            caseId: analysis.caseId,
            heading: analysis.caseId + " – " + analysis.title,
            team: teamText(analysis.team, describe),
            runId: run ? run.id : "",
            release: run ? run.release : "",
            version: run && !isEmpty(run.version) ? String(run.version) : "",
            resultText: run ? (run.status === "RUNNING" ? "Lauf läuft" : resultText(run.result)) : "Nicht ausgeführt",
            resultState: run ? RESULT_STATE[run.result] || "None" : "None",
            counts: run ? assertionCounts(analysis) + " · " + documentCounts(analysis) : "",
            olderRun: run && analysis.latestRunId && analysis.latestRunId !== run.id ? "Nicht der neueste Lauf – neuester Lauf: " + analysis.latestRunId : "",
            headline: main ? (main.ursache && main.severity !== "SUCCESS" ? main.ursache : main.titel) : "",
            findings: findings.map(function (f) {
                return {
                    title: f.titel,
                    description: [f.ursache ? "Ursache: " + f.ursache : "", "Empfehlung: " + f.empfehlung, teamText(f.team, describe) ? "Zuständig: " + teamText(f.team, describe) : ""]
                        .filter(Boolean)
                        .join(" · "),
                    info: CONFIDENCE_SHORT[f.confidence] || "",
                    icon: SEVERITY_ICON[f.severity] || "sap-icon://message-information",
                    state: SEVERITY_STATE[f.severity] || "None"
                };
            })
        };
    }

    return {
        fromRead: fromRead,
        germanFinding: germanFinding,
        germanFindings: germanFindings,
        report: report,
        answer: answer,
        intentsOf: intentsOf,
        INTENT_LABEL: INTENT_LABEL,
        summarize: summarize,
        contextBlock: contextBlock,
        instructions: instructions,
        panel: panel,
        changeText: changeText,
        money: money,
        RESULT_TEXT: RESULT_TEXT
    };
});
