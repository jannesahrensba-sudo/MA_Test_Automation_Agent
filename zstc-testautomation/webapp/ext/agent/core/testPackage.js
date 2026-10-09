sap.ui.define(["./textMatching", "./testDesign"], function (textMatching, testDesign) {
    "use strict";

    /**
     * Test package of the service assistant ("Lege mir für das nächste Release Testfälle an, die zur Prozessbeschreibung
     * passen"): recognition of the request, the target release and its scope, the validation of the package as a whole
     * and the German texts. Pure functions; the session (AgentSession) creates the drafts through the OData service and
     * the backend validates every single test case (R1–R13).
     *
     * Validation of the package (in addition to the validation of each test case):
     *   - every pilot way of the process has a test case, the automated steps are covered (gaps are listed),
     *   - every process team with automated steps has a test case of its own (team regression),
     *   - overlaps with existing test cases (same section) and possible duplicates (rule R13) are shown,
     *   - processes without process steps and ways outside the pilot are reported, not invented,
     *   - the release: scope of the processes (copied from the predecessor release on saving when it is empty).
     */

    const PACKAGE_WORDS = /(testf(ae|a)ll|testcase|test case|testpaket|tests?\b|regressionspaket)/;
    const CREATE_WORDS = /\b(anleg|leg\w*|anlegen|erstell|generier|entwerf|entwirf|vorschlag|vorschlaeg|baue?|aufbau|plane?\b)/;
    const ALL_PROCESSES = /(jede[nrs]? prozess|alle[n]? prozess|saemtliche[n]? prozess|jeden weg|alle wege|komplett|vollstaendig)/;
    const EXECUTE_WORDS = /(vornehm|nimm\b.*\bvor\b|ausfuehr|laufen lass|starte|durchlaufen lass|teamlauf)/;
    const MONTHS = ["januar", "februar", "maerz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];

    const STATUS_TEXT = { VALID: "gültig", AMBIGUOUS: "mehrdeutig", INVALID: "ungültig", NOT_VALIDATED: "nicht validiert" };
    const STATUS_STATE = { VALID: "Success", AMBIGUOUS: "Warning", INVALID: "Error", NOT_VALIDATED: "None" };
    const REASON_TEXT = {
        NOT_MODELED: "noch nicht modelliert (keine Prozessschritte) – ohne Prozessbeschreibung wird kein Testfall erfunden",
        LATER: "nicht im Pilot (spätere API-Erweiterung) – keine automatisierbaren Schritte",
        NO_AUTOMATED_STEP: "kein automatisierter Schritt",
        NO_TEST_DATA: "keine passenden Stammdaten (Gerät oder gültiger Vertrag) gefunden"
    };

    /**
     * Is the message a request to create several test cases (test package)?
     *
     * @param {string} text message of the user
     * @returns {boolean} package request
     */
    function isRequest(text) {
        const n = textMatching.normalize(text);
        if (EXECUTE_WORDS.test(n) && !CREATE_WORDS.test(n)) {
            return false;
        }
        return (PACKAGE_WORDS.test(n) && CREATE_WORDS.test(n) && /(release|prozess|weg|team|paket|mehrere|alle|jede)/.test(n)) || (ALL_PROCESSES.test(n) && /(test|durchtest)/.test(n));
    }

    /**
     * Release named in a message: an explicit ID, a feature package stack ("FPS02"), a month of an internal release,
     * "Release in Test"/"aktuelles Release" — otherwise the next planned release.
     *
     * @param {string} text message
     * @param {object[]} releases Release rows (ReleaseID, ReleaseName, ReleaseStatus, TestStartDate)
     * @param {string} today YYYY-MM-DD
     * @returns {object|undefined} release
     */
    function resolveRelease(text, releases, today) {
        const n = textMatching.normalize(text);
        const upper = String(text || "").toUpperCase();
        const explicit = releases.find(function (r) {
            return upper.indexOf(String(r.ReleaseID).toUpperCase()) > -1;
        });
        if (explicit) {
            return explicit;
        }
        const fps = n.match(/fps ?0?(\d)/);
        if (fps) {
            const found = releases.find(function (r) {
                return new RegExp("FPS0?" + fps[1] + "$").test(String(r.ReleaseID).toUpperCase());
            });
            if (found) {
                return found;
            }
        }
        const month = MONTHS.find(function (m) {
            return n.indexOf(m) > -1;
        });
        if (month) {
            const found = releases.find(function (r) {
                return textMatching.normalize(r.ReleaseName).indexOf(month) > -1;
            });
            if (found) {
                return found;
            }
        }
        if (/(release in test|aktuelle[ns]? release|laufende[ns]? release|dieses release)/.test(n)) {
            const inTest = releases.find(function (r) {
                return r.ReleaseStatus === "IN_TEST";
            });
            if (inTest) {
                return inTest;
            }
        }
        return nextRelease(releases, today);
    }

    /** next planned release: the first planned release whose test starts today or later (else the first planned one) */
    function nextRelease(releases, today) {
        const planned = releases
            .filter(function (r) {
                return r.ReleaseStatus === "PLANNED";
            })
            .sort(function (a, b) {
                return String(a.TestStartDate || "9999").localeCompare(String(b.TestStartDate || "9999"));
            });
        return (
            planned.find(function (r) {
                return !r.TestStartDate || r.TestStartDate >= today;
            }) || planned[0]
        );
    }

    /**
     * Processes of the package: those named in the message, otherwise the scope of the release — of its predecessor when
     * the release has no scope yet (it is copied on saving) — otherwise all processes.
     *
     * @param {string} text message
     * @param {object} release release
     * @param {object[]} scopes ReleaseScope rows
     * @param {object[]} processes BusinessProcessVH rows
     * @returns {{processes: object[], copyFrom: string, named: boolean}} processes
     */
    function packageProcesses(text, release, scopes, processes) {
        const n = textMatching.normalize(text);
        const named = processes.filter(function (p) {
            const words = textMatching
                .normalize(p.ProcessName)
                .split(" ")
                .filter(function (w) {
                    return w.length > 4 && ["service", "prozess"].indexOf(w) === -1;
                })
                .map(function (w) {
                    return w.replace(/prozess$/, "");
                });
            return (" " + n + " ").indexOf(" " + textMatching.normalize(p.ProcessID) + " ") > -1 || words.some(function (w) {
                return w.length > 4 && n.indexOf(w) > -1;
            });
        });
        if (named.length && !ALL_PROCESSES.test(n)) {
            return { processes: named, copyFrom: "", named: true };
        }
        const own = release ? scopes.filter(function (s) { return s.ReleaseID === release.ReleaseID; }) : [];
        const predecessor = release && release.PredecessorRelease ? scopes.filter(function (s) { return s.ReleaseID === release.PredecessorRelease; }) : [];
        const source = own.length ? own : predecessor;
        const ids = [];
        source.forEach(function (s) {
            if (ids.indexOf(s.ProcessID) === -1) {
                ids.push(s.ProcessID);
            }
        });
        const inScope = processes.filter(function (p) {
            return ids.indexOf(p.ProcessID) > -1;
        });
        return { processes: inScope.length ? inScope : processes, copyFrom: !own.length && predecessor.length ? release.PredecessorRelease : "", named: false };
    }

    /**
     * Validation of the package as a whole.
     *
     * @param {object} pkg package (items with proposal, steps, status, findings; processes; skipped)
     * @param {object} model process model {steps, variants}
     * @returns {object} {coverage, ways, teams, duplicates, overlaps, invalid, ambiguous, messages}
     */
    function validate(pkg, model) {
        const selected = pkg.items.filter(function (item) {
            return item.selected && item.uuid;
        });
        const processIds = pkg.processes
            .filter(function (p) {
                return p.modeled;
            })
            .map(function (p) {
                return p.id;
            });
        const steps = model.steps.filter(function (s) {
            return processIds.indexOf(s.ProcessID) > -1 && s.PilotScope === "PILOT";
        });
        const automated = steps.filter(function (s) {
            return s.Automation === "AUTOMATED" && s.BusinessObjectType;
        });
        const covered = {};
        selected.forEach(function (item) {
            (item.steps || []).forEach(function (id) {
                covered[id] = (covered[id] || 0) + 1;
            });
        });
        const gaps = automated.filter(function (s) {
            return !covered[s.StepID];
        });
        const pilotWays = model.variants.filter(function (v) {
            return processIds.indexOf(v.ProcessID) > -1 && v.PilotScope === "PILOT";
        });
        const missingWays = pilotWays.filter(function (v) {
            return !selected.some(function (item) {
                return item.proposal.variant === v.Variant;
            });
        });
        const teams = [];
        automated.forEach(function (s) {
            if (s.ResponsibleTeam && s.TeamAssignment !== "OPEN" && teams.indexOf(s.ResponsibleTeam) === -1) {
                teams.push(s.ResponsibleTeam);
            }
        });
        const teamsWithout = teams.filter(function (team) {
            return !selected.some(function (item) {
                return item.proposal.team === team;
            });
        });
        const duplicates = selected.filter(function (item) {
            return item.duplicateOf && item.duplicateOf.length;
        });
        const overlaps = selected.filter(function (item) {
            return item.proposal.overlaps && item.proposal.overlaps.length;
        });
        const invalid = selected.filter(function (item) {
            return item.status === "INVALID";
        });
        const ambiguous = selected.filter(function (item) {
            return item.status === "AMBIGUOUS" || item.status === "NOT_VALIDATED";
        });
        return {
            coverage: { covered: automated.length - gaps.length, total: automated.length, gaps: gaps, map: covered },
            ways: { total: pilotWays.length, missing: missingWays },
            teams: { total: teams, without: teamsWithout },
            duplicates: duplicates,
            overlaps: overlaps,
            invalid: invalid,
            ambiguous: ambiguous,
            selected: selected.length
        };
    }

    /** text of a value without its ID: "PT-REPARATUR · Prozessteam Reparatur" → "Prozessteam Reparatur" */
    function nameOf(describe, field, id) {
        const text = String(describe(field, id) || "");
        const separator = text.indexOf(" · ");
        return separator > -1 && text.slice(0, separator) === String(id) ? text.slice(separator + 3) : text || id;
    }

    function wayLabel(item, describe) {
        const p = item.proposal;
        return (
            nameOf(describe, "ProcessVariant", p.variant) +
            " · " +
            (p.startObject === p.endObject ? testDesign.OBJECT_SHORT[p.startObject] || p.startObject : (testDesign.OBJECT_SHORT[p.startObject] || p.startObject) + " → " + (testDesign.OBJECT_SHORT[p.endObject] || p.endObject))
        );
    }

    /**
     * German answer of the assistant about a created package.
     *
     * @param {object} pkg package
     * @param {Function} describe master data texts (field, id) → text
     * @returns {string} markdown
     */
    function report(pkg, describe) {
        const v = pkg.validation;
        const lines = [];
        const release = pkg.release ? "**" + pkg.release.ReleaseID + "** (" + pkg.release.ReleaseName + ")" : "das Release";
        lines.push(
            "Ich habe für " +
                release +
                " ein Testpaket aus der Prozessbeschreibung entworfen: **" +
                pkg.items.length +
                " Testfall-Entwürfe**, jeder vom Backend validiert (" +
                pkg.items.filter(function (i) { return i.status === "VALID"; }).length +
                " gültig" +
                (v.ambiguous.length ? ", " + v.ambiguous.length + " mit Warnungen" : "") +
                (v.invalid.length ? ", " + v.invalid.length + " ungültig" : "") +
                ")."
        );
        pkg.items.forEach(function (item) {
            const p = item.proposal;
            lines.push(
                "- **" +
                    p.title +
                    "** – " +
                    nameOf(describe, "ProcessTeam", p.team) +
                    ", " +
                    wayLabel(item, describe) +
                    " – " +
                    (STATUS_TEXT[item.status] || item.status) +
                    (item.corrections.length ? " (korrigiert: " + item.corrections.join("; ") + ")" : "") +
                    (item.predecessor ? " · Vorgänger " + item.predecessor : "") +
                    (p.overlaps.length ? " · überschneidet sich mit " + p.overlaps.map(function (o) { return o.CaseID; }).join(", ") : "") +
                    (item.duplicateOf && item.duplicateOf.length ? " · mögliche Dublette von " + item.duplicateOf.join(", ") : "")
            );
        });
        lines.push("");
        lines.push(
            "Prüfung des Pakets: **" +
                v.coverage.covered +
                " von " +
                v.coverage.total +
                " automatisierten Prozessschritten** abgedeckt" +
                (v.coverage.gaps.length ? " (offen: " + v.coverage.gaps.map(function (s) { return s.StepID; }).join(", ") + ")" : "") +
                ", " +
                (v.ways.missing.length ? "Wege ohne Testfall: " + v.ways.missing.map(function (w) { return w.VariantName; }).join(", ") : "alle " + v.ways.total + " Pilot-Wege enthalten") +
                ", " +
                (v.teams.without.length ? "Teams ohne eigenen Testfall: " + v.teams.without.map(function (t) { return nameOf(describe, "ProcessTeam", t); }).join(", ") : "jedes Prozessteam mit eigenem Testfall") +
                "."
        );
        const skipped = pkg.skipped || [];
        const notModeled = skipped.filter(function (s) {
            return s.reason === "NOT_MODELED";
        });
        if (notModeled.length) {
            lines.push(
                "Nicht angelegt: " +
                    notModeled
                        .map(function (s) {
                            return "**" + s.name + "** (" + s.id + ")";
                        })
                        .join(", ") +
                    " – " +
                    REASON_TEXT.NOT_MODELED +
                    ". Sobald die Prozessschritte im Prozessmodell gepflegt sind, kann ich auch dafür Testfälle entwerfen."
            );
        }
        const later = skipped.filter(function (s) {
            return s.reason === "LATER";
        });
        if (later.length) {
            lines.push(
                "Nicht im Pilot: " +
                    later
                        .map(function (s) {
                            return s.name;
                        })
                        .join(", ") +
                    "."
            );
        }
        const other = skipped.filter(function (s) {
            return s.reason !== "LATER" && s.reason !== "NOT_MODELED";
        });
        other.forEach(function (s) {
            lines.push("Ohne Testfall: " + s.name + " – " + (REASON_TEXT[s.reason] || s.reason) + ".");
        });
        if (pkg.copyFrom) {
            lines.push("Der Scope von " + pkg.release.ReleaseID + " ist noch leer: beim Speichern übernehme ich ihn aus " + pkg.copyFrom + " (Prozessteams × Prozesse, aktuelle Prozessversionen).");
        }
        if (pkg.release && pkg.release.ReleaseStatus === "PLANNED") {
            lines.push("Ausgeführt werden die Testfälle mit dem Regressionslauf, sobald " + pkg.release.ReleaseID + " in Test geht.");
        }
        lines.push("");
        lines.push(
            "Rechts sehen Sie jeden Entwurf mit Prozessbild und Validierung. Abwählen, was Sie nicht brauchen, dann **Paket speichern** – freigegeben wird nur, wo Sie die Prozessverantwortung haben."
        );
        return lines.join("\n");
    }

    /** German summary after saving */
    function savedReport(pkg) {
        const saved = pkg.items.filter(function (i) {
            return i.caseId && i.saved;
        });
        const lines = ["Testpaket gespeichert: " + saved.length + " Testfälle (" + saved.map(function (i) { return i.caseId; }).join(", ") + ")."];
        const approved = saved.filter(function (i) {
            return i.approved;
        });
        if (approved.length) {
            lines.push("- Freigegeben: " + approved.map(function (i) { return i.caseId; }).join(", "));
        }
        const pending = saved.filter(function (i) {
            return !i.approved && i.approvalMessage;
        });
        pending.forEach(function (i) {
            lines.push("- " + i.caseId + " nicht freigegeben: " + i.approvalMessage);
        });
        if (pkg.scopeCopied) {
            lines.push("- Scope von " + pkg.release.ReleaseID + " aus " + pkg.copyFrom + " übernommen.");
        }
        return lines.join("\n");
    }

    /**
     * Data of the package panel of the page.
     *
     * @param {object} pkg package
     * @param {Function} describe master data texts
     * @returns {object} panel model
     */
    function panel(pkg, describe) {
        const v = pkg.validation;
        const messages = [];
        messages.push({
            type: v.coverage.gaps.length ? "Warning" : "Success",
            text:
                v.coverage.covered +
                " von " +
                v.coverage.total +
                " automatisierten Prozessschritten abgedeckt" +
                (v.coverage.gaps.length ? " – offen: " + v.coverage.gaps.map(function (s) { return s.StepID + " " + s.StepName; }).join(", ") : "")
        });
        messages.push(
            v.ways.missing.length
                ? { type: "Warning", text: "Wege ohne Testfall: " + v.ways.missing.map(function (w) { return w.VariantName; }).join(", ") }
                : { type: "Success", text: "Alle " + v.ways.total + " Pilot-Wege enthalten" }
        );
        messages.push(
            v.teams.without.length
                ? { type: "Warning", text: "Teams ohne eigenen Testfall: " + v.teams.without.map(function (t) { return nameOf(describe, "ProcessTeam", t); }).join(", ") }
                : { type: "Success", text: "Jedes Prozessteam hat einen eigenen Testfall (Teamregression)" }
        );
        if (v.invalid.length || v.ambiguous.length) {
            messages.push({ type: v.invalid.length ? "Error" : "Warning", text: (v.invalid.length ? v.invalid.length + " ungültig" : "") + (v.invalid.length && v.ambiguous.length ? ", " : "") + (v.ambiguous.length ? v.ambiguous.length + " mit Warnungen" : "") + " – im Testfall korrigieren oder abwählen" });
        }
        if (v.duplicates.length) {
            messages.push({ type: "Information", text: "Mögliche Dubletten (R13): " + v.duplicates.map(function (i) { return i.proposal.scenarioId + " ↔ " + i.duplicateOf.join(", "); }).join("; ") });
        }
        (pkg.skipped || [])
            .filter(function (s) {
                return s.reason === "NOT_MODELED";
            })
            .forEach(function (s) {
                messages.push({ type: "Information", text: s.name + " (" + s.id + "): " + REASON_TEXT.NOT_MODELED });
            });
        return {
            heading: "Testpaket " + (pkg.release ? pkg.release.ReleaseID + " · " + pkg.release.ReleaseName : ""),
            counts: v.selected + " von " + pkg.items.length + " ausgewählt",
            saved: !!pkg.saved,
            copyFrom: pkg.copyFrom || "",
            copyText: pkg.copyFrom ? "Scope aus " + pkg.copyFrom + " übernehmen" : "",
            coverage: v.coverage.map,
            processId: (pkg.processes.find(function (p) { return p.modeled; }) || {}).id || "",
            messages: messages,
            items: pkg.items.map(function (item) {
                const p = item.proposal;
                const findings = (item.findings || []).filter(function (f) {
                    return f.status === "ERROR" || f.status === "WARNING";
                });
                return {
                    key: p.key,
                    uuid: item.uuid,
                    caseId: item.caseId || "",
                    selected: item.selected,
                    saved: !!item.saved,
                    title: p.title,
                    team: nameOf(describe, "ProcessTeam", p.team),
                    way: wayLabel(item, describe),
                    data: p.data.ServiceReferenceEquipment
                        ? describe("ServiceReferenceEquipment", p.data.ServiceReferenceEquipment)
                        : p.data.ServiceContract
                        ? describe("ServiceContract", p.data.ServiceContract)
                        : "",
                    statusText: item.saved ? (item.approved ? "gespeichert, freigegeben" : "gespeichert") : STATUS_TEXT[item.status] || item.status,
                    statusState: item.saved ? "Success" : STATUS_STATE[item.status] || "None",
                    info: [
                        item.corrections.length ? "korrigiert: " + item.corrections.join("; ") : "",
                        item.predecessor ? "Vorgänger " + item.predecessor : "",
                        p.overlaps.length ? "überschneidet sich mit " + p.overlaps.map(function (o) { return o.CaseID; }).join(", ") : "",
                        item.duplicateOf && item.duplicateOf.length ? "mögliche Dublette: " + item.duplicateOf.join(", ") : "",
                        findings.length ? findings.map(function (f) { return f.bezeichnung + ": " + f.regeltext; }).join("; ") : "",
                        item.approvalMessage || ""
                    ]
                        .filter(Boolean)
                        .join(" · "),
                    variant: p.variant,
                    startObject: item.startObject || p.startObject,
                    endObject: item.endObject || p.endObject,
                    predecessorObject: item.predecessorObject || ""
                };
            })
        };
    }

    /** compact summary for the language model (tool result) */
    function summarize(pkg, describe) {
        const v = pkg.validation;
        return {
            release: pkg.release ? pkg.release.ReleaseID : "",
            release_status: pkg.release ? pkg.release.ReleaseStatus : "",
            scope_uebernahme_aus: pkg.copyFrom || "",
            testfaelle: pkg.items.map(function (item) {
                const p = item.proposal;
                return {
                    schluessel: p.key,
                    titel: p.title,
                    team: nameOf(describe, "ProcessTeam", p.team),
                    weg: p.variant,
                    start: p.startObject,
                    bis: p.endObject,
                    validierung: item.status,
                    korrekturen: item.corrections,
                    vorgaenger: item.predecessor || "",
                    ueberschneidung: p.overlaps.map(function (o) { return o.CaseID; }),
                    dublette: item.duplicateOf || [],
                    befunde: (item.findings || [])
                        .filter(function (f) {
                            return f.status === "ERROR" || f.status === "WARNING";
                        })
                        .map(function (f) {
                            return f.feld + ": " + f.meldung;
                        }),
                    ausgewaehlt: item.selected
                };
            }),
            pruefung: {
                schritte_abgedeckt: v.coverage.covered + "/" + v.coverage.total,
                offene_schritte: v.coverage.gaps.map(function (s) { return s.StepID; }),
                wege_ohne_testfall: v.ways.missing.map(function (w) { return w.Variant; }),
                teams_ohne_testfall: v.teams.without
            },
            nicht_angelegt: (pkg.skipped || []).map(function (s) {
                return { was: s.name, grund: REASON_TEXT[s.reason] || s.reason };
            }),
            hinweis: "Gespeichert wird erst mit dem Knopf „Paket speichern“ (Bestätigung des Nutzers)."
        };
    }

    return {
        isRequest: isRequest,
        resolveRelease: resolveRelease,
        nextRelease: nextRelease,
        packageProcesses: packageProcesses,
        validate: validate,
        report: report,
        savedReport: savedReport,
        panel: panel,
        summarize: summarize,
        nameOf: nameOf,
        STATUS_TEXT: STATUS_TEXT,
        REASON_TEXT: REASON_TEXT
    };
});
