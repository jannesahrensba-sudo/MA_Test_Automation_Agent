sap.ui.define(["./textMatching"], function (textMatching) {
    "use strict";

    /**
     * Team run of the service assistant ("Ich habe im Coding des Standardreparaturprozesses etwas angepasst – nimm alle
     * Testfälle vor, die dem Prozessteam zugeordnet sind"): recognition of the request, process team, process, release and
     * reason, the preview of the run (which test cases run, which are skipped and why, which wait for a predecessor, which
     * dependent test cases of other teams exist) and the German texts. Pure functions; the run itself is the release action
     * startTeamRegressionRun — started only on the user's confirmation — and the server checks every test case again.
     */

    const RUN_WORDS = /(vornehm|\bnimm\b.*\bvor\b|ausfuehr|durchfuehr|\blaufen\b|starte|durchlauf|durchtest|\btesten\b|pruefen|regression|teamlauf)/;
    const SET_WORDS =
        /((alle|saemtliche|jede[nrs]?|die) (\w+ )?(test ?f(ae|a)ll\w*|testcases?|test cases?|tests?)\b|testf(ae|a)lle (des|der|vom|dem|meines|unseres) (prozess)?team|dem (prozess)?team zugeordnet|regression|teamlauf)/;
    const CREATE_WORDS = /(anleg|\bleg\b|erstell|generier|entwerf|entwirf)/;
    const CHANGE_WORDS = /(coding|code|programm|abap|erweiterung|transport|customizing|angepasst|geaendert|anpassung|korrektur|bugfix|fix\b|hinweis|update|upgrade)/;
    const DEPENDENT_WORDS = /(abhaengig|folgetestf|folge testf|uebergabe|nachgelagert|mit e2e|auch e2e|auch die fakturierung)/;
    const NOT_DEPENDENT_WORDS = /(ohne abhaengig|keine abhaengig|nur (die )?(eigenen|des teams))/;

    const DECISION_TEXT = { RUN: "wird ausgeführt", SKIP: "wird übersprungen", WAIT: "wartet auf Vorgänger" };
    const DECISION_STATE = { RUN: "Success", SKIP: "Warning", WAIT: "Information" };
    const RESULT_TEXT = {
        PASSED: "bestanden",
        PASSED_WITH_WARNING: "bestanden mit Warnung",
        FAILED_FUNCTIONAL: "fachlich fehlgeschlagen",
        FAILED_TECHNICAL: "technisch fehlgeschlagen",
        BLOCKED: "blockiert"
    };
    const RESULT_STATE = { PASSED: "Success", PASSED_WITH_WARNING: "Warning", FAILED_FUNCTIONAL: "Error", FAILED_TECHNICAL: "Error", BLOCKED: "Error" };
    const FAILED = ["FAILED_FUNCTIONAL", "FAILED_TECHNICAL", "BLOCKED"];

    /**
     * Is the message a request to run the test cases of a process team (or process)?
     *
     * @param {string} text message of the user
     * @returns {boolean} team run request
     */
    function isRequest(text) {
        const n = textMatching.normalize(text);
        return RUN_WORDS.test(n) && SET_WORDS.test(n) && !CREATE_WORDS.test(n);
    }

    /** whole words only: "ang" (process ANG) is not part of "angepasst" */
    function containsWords(normalized, words) {
        return (" " + normalized + " ").indexOf(" " + words + " ") > -1;
    }

    /** significant word of a process name: "Service-Reparaturprozess" → "reparatur", "Angebotsprozess" → "angebot" */
    function processWords(process) {
        return textMatching
            .normalize(process.ProcessName)
            .split(" ")
            .map(function (word) {
                return word.replace(/s?prozess$/, "");
            })
            .filter(function (word) {
                return word.length > 3 && word !== "service";
            });
    }

    /**
     * Process team, process, reason and dependents named in a message. A named process without a team takes the team that
     * owns the process ("die dem Prozessteam zugeordnet sind").
     *
     * @param {string} text message
     * @param {object} catalog {processes: BusinessProcessVH rows, teams: ProcessTeamVH rows}
     * @returns {{team: string, processId: string, reason: string, includeDependents: boolean, teamNamed: boolean, processNamed: boolean}} request
     */
    function parse(text, catalog) {
        const n = textMatching.normalize(text);
        const teams = catalog.teams || [];
        const processes = catalog.processes || [];
        let team = teams.find(function (t) {
            return containsWords(n, textMatching.normalize(t.ProcessTeam));
        });
        if (!team) {
            const named = n.match(/(?:prozess)?team (\w+)/);
            if (named) {
                team = teams.find(function (t) {
                    const words = textMatching.normalize(t.ProcessTeamName).split(" ");
                    return words.indexOf(named[1]) > -1 && named[1] !== "prozess";
                });
            }
        }
        if (!team && /\be2e\b|end to end|fakturierung/.test(n)) {
            team = teams.find(function (t) {
                return /end to end/.test(textMatching.normalize(t.ProcessTeamName));
            });
        }
        let process = processes.find(function (p) {
            return containsWords(n, textMatching.normalize(p.ProcessID));
        });
        if (!process) {
            process = processes.find(function (p) {
                return processWords(p).some(function (word) {
                    return n.indexOf(word + "sprozess") > -1 || n.indexOf(word + "prozess") > -1 || (!team && n.indexOf(word) > -1);
                });
            });
        }
        const teamId = team ? team.ProcessTeam : process ? process.OwnerTeam : "";
        let reason = "";
        if (CHANGE_WORDS.test(n)) {
            const sentence = String(text)
                .split(/[.!?\n,;]/)
                .map(function (s) {
                    return s.trim();
                })
                .find(function (s) {
                    return CHANGE_WORDS.test(textMatching.normalize(s));
                });
            reason = ("Code-Änderung: " + (sentence || text)).slice(0, 120);
        }
        return {
            team: teamId,
            processId: process ? process.ProcessID : "",
            reason: reason || "Teamlauf auf Anfrage im Service-Assistenten",
            includeDependents: DEPENDENT_WORDS.test(n) && !NOT_DEPENDENT_WORDS.test(n),
            teamNamed: !!team,
            processNamed: !!process
        };
    }

    /**
     * Release of the run: a release in test whose regression scope contains the team (and the process).
     *
     * @param {object[]} releases Release rows
     * @param {object[]} scopes ReleaseScope rows
     * @param {string} team process team
     * @param {string} [processId] process
     * @param {string} [releaseId] release named by the user
     * @returns {object|undefined} release
     */
    function releaseFor(releases, scopes, team, processId, releaseId) {
        const fits = function (release) {
            return scopes.some(function (s) {
                return s.ReleaseID === release.ReleaseID && s.ProcessTeam === team && (!processId || s.ProcessID === processId) && s.IsRegressionRelevant !== false;
            });
        };
        if (releaseId) {
            return releases.find(function (r) {
                return r.ReleaseID === releaseId;
            });
        }
        return releases
            .filter(function (r) {
                return r.ReleaseStatus === "IN_TEST" && fits(r);
            })
            .sort(function (a, b) {
                return String(a.TestEndDate || "9999").localeCompare(String(b.TestEndDate || "9999"));
            })[0];
    }

    /**
     * Preview of a team run (the same checks as the server, as far as the read data show them; the execution authorization
     * and the handover of a predecessor's documents are checked by the server at the start).
     *
     * @param {object} input input
     * @param {object[]} input.testCases active test cases
     * @param {string} input.team process team
     * @param {string} [input.processId] process
     * @param {object} input.release release
     * @param {object[]} input.scopes ReleaseScope rows
     * @param {boolean} [input.includeDependents] dependent test cases of other teams join the run
     * @returns {object} preview {items, dependents, counts}
     */
    function preview(input) {
        const scopes = (input.scopes || []).filter(function (s) {
            return s.ReleaseID === input.release.ReleaseID && s.IsRegressionRelevant !== false;
        });
        const inScope = function (tc) {
            return scopes.some(function (s) {
                return s.ProcessTeam === tc.ProcessTeam && s.ProcessID === tc.BusinessProcess;
            });
        };
        const own = input.testCases.filter(function (tc) {
            return tc.ProcessTeam === input.team && (!input.processId || tc.BusinessProcess === input.processId) && inScope(tc);
        });
        // dependent test cases of other teams: continue with the documents of a test case of the run (transitively)
        const dependents = [];
        let ids = own.map(function (tc) {
            return tc.CaseID;
        });
        let added = true;
        while (added) {
            added = false;
            input.testCases.forEach(function (tc) {
                if (ids.indexOf(tc.CaseID) === -1 && tc.PredecessorTestCase && ids.indexOf(tc.PredecessorTestCase) > -1 && inScope(tc)) {
                    dependents.push(tc);
                    ids = ids.concat([tc.CaseID]);
                    added = true;
                }
            });
        }
        const candidates = input.includeDependents ? own.concat(dependents) : own;
        const candidateIds = candidates.map(function (tc) {
            return tc.CaseID;
        });
        const items = candidates.map(function (tc) {
            let decision = "RUN";
            let reason = "";
            if (tc.ValidationStatus !== "VALID") {
                decision = "SKIP";
                reason = "Testdaten nicht gültig (" + tc.ValidationStatus + ") – erst validieren";
            } else if (tc.ApprovalStatus !== "APPROVED") {
                decision = "SKIP";
                reason = "nicht freigegeben";
            } else if (Number(tc.ApprovedVersion) !== Number(tc.Version)) {
                decision = "SKIP";
                reason = "Version " + tc.Version + " nicht freigegeben (freigegeben: " + tc.ApprovedVersion + ")";
            } else if (tc.AssignmentStatus === "OPEN") {
                decision = "SKIP";
                reason = "Prozesszuordnung offen";
            } else if (tc.PredecessorTestCase && candidateIds.indexOf(tc.PredecessorTestCase) > -1) {
                decision = "WAIT";
                reason = "wartet auf " + tc.PredecessorTestCase + " (Übergabe der Belege)";
            } else if (tc.PredecessorTestCase) {
                reason = "übernimmt die Belege des letzten bestandenen Laufs von " + tc.PredecessorTestCase;
            }
            return {
                caseId: tc.CaseID,
                uuid: tc.TestCaseUUID,
                title: tc.Title,
                team: tc.ProcessTeam,
                variant: tc.ProcessVariant,
                decision: decision,
                reason: reason,
                dependent: tc.ProcessTeam !== input.team
            };
        });
        return {
            items: items,
            dependents: dependents.map(function (tc) {
                return { caseId: tc.CaseID, title: tc.Title, team: tc.ProcessTeam, predecessor: tc.PredecessorTestCase };
            }),
            counts: {
                total: items.length,
                run: items.filter(function (i) { return i.decision === "RUN"; }).length,
                skip: items.filter(function (i) { return i.decision === "SKIP"; }).length,
                wait: items.filter(function (i) { return i.decision === "WAIT"; }).length
            }
        };
    }

    /** German text of a skip reason of the server (the backend writes English messages) */
    const REASONS = [
        [/^Test data (not validated|invalid|ambiguous)/i, function (m) {
            return "Testdaten " + ({ "not validated": "nicht validiert", invalid: "ungültig", ambiguous: "mehrdeutig" }[m[1].toLowerCase()] || m[1]) + " – erst validieren";
        }],
        [/^Approve the test case before/i, function () {
            return "nicht freigegeben";
        }],
        [/^Version (\d+) is not approved \(approved version (\d+)\)/i, function (m) {
            return "Version " + m[1] + " nicht freigegeben (freigegeben: " + m[2] + ")";
        }],
        [/may not run this test case: the role .* in process team (\S+) is missing/i, function (m) {
            return "keine Berechtigung zur Testausführung im Prozessteam " + m[1];
        }],
        [/^Waits for predecessor (\S+)/i, function (m) {
            return "wartet auf Vorgänger " + m[1];
        }],
        [/^Predecessor (\S+) (?:was skipped|ended with (\S+))/i, function (m) {
            return "Vorgänger " + m[1] + (m[2] ? " endete mit " + m[2] : " wurde übersprungen") + ": nichts zu übernehmen";
        }],
        [/^The process assignment is open/i, function () {
            return "Prozesszuordnung offen";
        }]
    ];

    function germanReason(reason) {
        const text = String(reason || "");
        for (const entry of REASONS) {
            const match = text.match(entry[0]);
            if (match) {
                return entry[1](match);
            }
        }
        return text;
    }

    /** text of a value without its ID: "PT-REPARATUR · Prozessteam Reparatur" → "Prozessteam Reparatur" */
    function nameOf(describe, field, id) {
        const text = String(describe(field, id) || "");
        const separator = text.indexOf(" · ");
        return separator > -1 && text.slice(0, separator) === String(id) ? text.slice(separator + 3) : text || id;
    }

    /** German answer about a prepared team run */
    function previewReport(run, describe) {
        const p = run.preview;
        const lines = [];
        lines.push(
            "Teamlauf vorbereitet: **" +
                nameOf(describe, "ProcessTeam", run.team) +
                "**" +
                (run.processId ? " · " + nameOf(describe, "BusinessProcess", run.processId) : " · alle Prozesse des Teams") +
                " · Release **" +
                run.release.ReleaseID +
                "** (" +
                run.release.ReleaseName +
                ", in Test)."
        );
        lines.push("Anlass: " + run.reason);
        lines.push(
            "**" +
                p.counts.total +
                " Testfälle** im Scope: " +
                p.counts.run +
                " werden ausgeführt" +
                (p.counts.wait ? ", " + p.counts.wait + " warten auf ihren Vorgänger" : "") +
                (p.counts.skip ? ", " + p.counts.skip + " werden übersprungen" : "") +
                "."
        );
        p.items
            .filter(function (i) {
                return i.decision === "SKIP";
            })
            .forEach(function (i) {
                lines.push("- " + i.caseId + " übersprungen: " + i.reason);
            });
        if (p.dependents.length) {
            lines.push(
                (run.includeDependents ? "Mitgenommen" : "Nicht enthalten") +
                    " sind die abhängigen Testfälle anderer Teams: " +
                    p.dependents
                        .map(function (d) {
                            return d.caseId + " (" + nameOf(describe, "ProcessTeam", d.team) + ", Vorgänger " + d.predecessor + ")";
                        })
                        .join(", ") +
                    (run.includeDependents ? "." : " – schreiben Sie „mit abhängigen Testfällen“, wenn die Übergabe mitgeprüft werden soll.")
            );
        }
        lines.push("Die Berechtigung (Testausführung im Team) und die Übergaben prüft der Server beim Start noch einmal. Bestätigen Sie mit **Teamlauf starten**.");
        return lines.join("\n");
    }

    /** German answer when a team run finished */
    function resultReport(run, describe) {
        const r = run.run;
        const items = run.items || [];
        const failed = items.filter(function (i) {
            return FAILED.indexOf(i.FinalResult) > -1;
        });
        const skipped = items.filter(function (i) {
            return i.Decision === "SKIPPED";
        });
        const lines = [];
        lines.push(
            "Teamlauf **" +
                r.RunID +
                "** beendet: " +
                r.PassedCount +
                " bestanden, " +
                r.FailedCount +
                " fehlgeschlagen, " +
                r.SkippedCount +
                " übersprungen (Bestehensquote " +
                r.PassRate +
                " %)."
        );
        if (failed.length) {
            lines.push("Fehlgeschlagen:");
            failed.forEach(function (i) {
                lines.push("- **" + i.CaseID + "** " + i.Title + " – " + (RESULT_TEXT[i.FinalResult] || i.FinalResult) + " (Lauf " + i.ExternalExecutionID + ")");
            });
            lines.push("Mit **Besprechen** rechts erkläre ich die Ursache aus der Ergebnisanalyse – oder schreiben Sie „Ergebnis von " + failed[0].CaseID + " besprechen“.");
        } else {
            lines.push("Kein Testfall ist fehlgeschlagen – die Änderung hat im Prozessteam nichts gebrochen, soweit die Testfälle reichen.");
        }
        if (skipped.length) {
            lines.push(
                "Übersprungen: " +
                    skipped
                        .map(function (i) {
                            return i.CaseID + " (" + germanReason(i.Reason) + ")";
                        })
                        .join("; ")
            );
        }
        lines.push("Die Auswertung des Release zeigt das Ergebnis je Prozessschritt.");
        return lines.join("\n");
    }

    /**
     * Data of the run panel of the page: the preview before the start, the run items afterwards.
     *
     * @param {object} run run state of the session
     * @param {Function} describe master data texts
     * @returns {object} panel model
     */
    function panel(run, describe) {
        const started = run.phase !== "PREVIEW";
        let items;
        if (!started) {
            items = run.preview.items.map(function (i) {
                return {
                    caseId: i.caseId,
                    uuid: i.uuid,
                    title: i.title,
                    team: nameOf(describe, "ProcessTeam", i.team),
                    status: DECISION_TEXT[i.decision],
                    state: DECISION_STATE[i.decision],
                    info: i.reason,
                    failed: false,
                    runId: ""
                };
            });
        } else {
            items = (run.items || []).map(function (i) {
                const result = i.FinalResult;
                const running = !result && i.Decision === "STARTED";
                return {
                    caseId: i.CaseID,
                    uuid: i.TestCaseUUID,
                    title: i.Title,
                    team: nameOf(describe, "ProcessTeam", i.ProcessTeam),
                    status:
                        i.Decision === "SKIPPED"
                            ? "übersprungen"
                            : i.Decision === "WAITING"
                            ? "wartet auf Vorgänger"
                            : result
                            ? RESULT_TEXT[result] || result
                            : running
                            ? "läuft"
                            : i.ExecutionStatus || "",
                    state: i.Decision === "SKIPPED" ? "Warning" : result ? RESULT_STATE[result] || "None" : "Information",
                    info: i.Reason ? germanReason(i.Reason) : i.ExternalExecutionID || "",
                    failed: FAILED.indexOf(result) > -1,
                    runId: i.ExternalExecutionID || ""
                };
            });
        }
        const r = run.run;
        return {
            heading: "Teamlauf · " + nameOf(describe, "ProcessTeam", run.team) + (run.processId ? " · " + nameOf(describe, "BusinessProcess", run.processId) : ""),
            release: run.release.ReleaseID,
            reason: run.reason,
            phase: run.phase,
            started: started,
            finished: run.phase === "FINISHED",
            includeDependents: !!run.includeDependents,
            dependentsText: run.preview.dependents.length
                ? "Abhängige Testfälle anderer Teams mitnehmen (" +
                  run.preview.dependents
                      .map(function (d) {
                          return d.caseId;
                      })
                      .join(", ") +
                  ")"
                : "",
            counts: started
                ? r
                    ? (run.phase === "FINISHED" ? r.RunID + ": " : r.RunID + " läuft: ") + r.PassedCount + " bestanden, " + r.FailedCount + " fehlgeschlagen, " + r.SkippedCount + " übersprungen" + (run.phase === "FINISHED" ? " · " + r.PassRate + " %" : "")
                    : ""
                : run.preview.counts.run + " ausführen · " + run.preview.counts.wait + " warten · " + run.preview.counts.skip + " überspringen",
            state: run.phase === "FINISHED" ? (r && r.FailedCount ? "Error" : "Success") : started ? "Information" : "None",
            items: items
        };
    }

    /** compact summary for the language model (tool result) */
    function summarize(run, describe) {
        return {
            team: nameOf(describe, "ProcessTeam", run.team),
            prozess: run.processId || "alle Prozesse des Teams",
            release: run.release.ReleaseID,
            anlass: run.reason,
            abhaengige_mitgenommen: !!run.includeDependents,
            testfaelle: run.preview.items.map(function (i) {
                return { case_id: i.caseId, titel: i.title, entscheidung: DECISION_TEXT[i.decision], grund: i.reason };
            }),
            abhaengige_anderer_teams: run.preview.dependents,
            hinweis: "Gestartet wird erst mit dem Knopf „Teamlauf starten“ (Bestätigung des Nutzers); der Server prüft Berechtigung und Übergaben erneut."
        };
    }

    return {
        isRequest: isRequest,
        parse: parse,
        releaseFor: releaseFor,
        preview: preview,
        previewReport: previewReport,
        resultReport: resultReport,
        panel: panel,
        summarize: summarize,
        germanReason: germanReason,
        FAILED: FAILED,
        DEPENDENT_WORDS: DEPENDENT_WORDS
    };
});
