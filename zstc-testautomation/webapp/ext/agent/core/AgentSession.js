sap.ui.define(["./prompts", "./agentTools", "./RuleBasedAgent", "./messagesLoop", "./resultReport", "./testDesign", "./testPackage", "./teamRun"], function (
    prompts,
    agentTools,
    RuleBasedAgent,
    messagesLoop,
    resultReport,
    testDesign,
    testPackage,
    teamRun
) {
    "use strict";

    const MAX_CHAT_TURNS = 16;

    /**
     * One conversation of the service assistant: chat turns, the current test case draft and the steps (tool calls) of
     * the running turn. The language model is reached through a transport:
     *   - "sample": Claude through the claude.ai sample capability of the hosted artifact (viewer's own account)
     *   - "proxy": Claude through the local development proxy /agent-api (Claude API, key only on the server)
     *   - "rules": rule-based mock agent (no language model): backend analyze + deterministic follow-up questions
     * Topics: capturing a test case from a fault report (draft), a test package of several test cases from the process
     * description (package), the run of all test cases of a process team (team run) and the discussion of the result of a
     * run (analysis, "Ergebnis besprechen"). Saving, approving and starting happen only on the user's confirmation.
     */
    class AgentSession {
        /**
         * @param {object} options options
         * @param {object} options.gateway OData gateway
         * @param {object} options.transport {kind, label, send?, sample?}
         * @param {Function} [options.onStep] step callback (UI)
         * @param {Function} [options.onDraft] draft state callback (UI)
         * @param {Function} [options.onText] streamed answer text callback (UI)
         * @param {Function} [options.onAnalysis] analysis state callback (UI)
         * @param {Function} [options.onPackage] test package state callback (UI)
         * @param {Function} [options.onRun] team run state callback (UI)
         * @param {Function} [options.today] date of the reference (YYYY-MM-DD), default: today
         */
        constructor(options) {
            this.gateway = options.gateway;
            this.transport = options.transport;
            this.onStepCallback = options.onStep || function () {};
            this.onDraft = options.onDraft || function () {};
            this.onText = options.onText || function () {};
            this.onAnalysis = options.onAnalysis || function () {};
            this.onPackage = options.onPackage || function () {};
            this.onRun = options.onRun || function () {};
            this.today =
                options.today ||
                function () {
                    return new Date().toISOString().slice(0, 10);
                };
            this.package = undefined;
            this.run = undefined;
            this.chat = []; // {role, content} for the sample capability
            this.apiMessages = []; // Messages API history of the proxy transport (append-only)
            this.draft = undefined;
            this.analysis = undefined;
            this.originalText = "";
            this.userStatedNetAmount = false;
            this.ruleAgent = new RuleBasedAgent(this.gateway, this);
            this.tools = agentTools.createTools(this.gateway, this);
            // discussion of a result: reading results only (no draft changes)
            this.analysisTools = this.tools.filter(function (tool) {
                return tool.name === "ergebnis_lesen";
            });
        }

        step(step) {
            this.onStepCallback(step);
        }

        /**
         * Reads the draft (values, validation findings) and publishes it to the UI.
         *
         * @param {string} uuid draft UUID
         * @returns {Promise<object>} draft state
         */
        async refreshDraft(uuid) {
            const read = await this.gateway.readDraft(uuid, !!(this.draft && this.draft.uuid === uuid && this.draft.isActive));
            const masterData = await this.gateway.masterData();
            const findings = read.findings
                .filter(function (f) {
                    return f.ValidationStatus === "ERROR" || f.ValidationStatus === "WARNING";
                })
                .map(function (f) {
                    return {
                        feld: f.FieldName,
                        bezeichnung: prompts.FIELD_LABELS[f.FieldName] || f.FieldName,
                        status: f.ValidationStatus,
                        regel: f.RuleID,
                        regeltext: prompts.RULES[f.RuleID] || f.RuleID,
                        meldung: f.ValidationMessage,
                        vorschlagIds: String(f.SuggestedValues || "")
                            .split(",")
                            .map(function (s) {
                                return s.trim();
                            })
                            .filter(Boolean)
                    };
                })
                .map(function (f) {
                    return Object.assign(f, {
                        vorschlaege: f.vorschlagIds.map(function (id) {
                            return masterData.describe(f.feld, id);
                        })
                    });
                });
            this.draft = {
                uuid: uuid,
                caseId: read.testCase.CaseID || "",
                title: read.testCase.Title || "",
                processProfile: read.testCase.ProcessProfile,
                isActive: read.testCase.IsActiveEntity === true,
                // process reference: determined by the backend (team, process, way, end object, test level, assignment)
                process: {
                    team: read.testCase.ProcessTeam || "",
                    process: read.testCase.BusinessProcess || "",
                    variant: read.testCase.ProcessVariant || "",
                    endObject: read.testCase.EndObject || "",
                    start: read.testCase.StartObject || "",
                    predecessor: read.testCase.PredecessorTestCase || "",
                    takesOver: read.testCase.PredecessorObject || "",
                    level: read.testCase.TestLevel || "",
                    assignment: read.testCase.AssignmentStatus || "",
                    note: read.testCase.AssignmentNote || "",
                    version: read.testCase.Version
                },
                values: read.values,
                validation: {
                    status: read.testCase.ValidationStatus,
                    errors: findings.filter(function (f) {
                        return f.status === "ERROR";
                    }).length,
                    warnings: findings.filter(function (f) {
                        return f.status === "WARNING";
                    }).length,
                    findings: findings
                },
                submitted: false
            };
            this.onDraft(this.draft);
            return this.draft;
        }

        /**
         * Opens the discussion of a run of a test case (the latest one unless a run is given): reads the result with its
         * deterministic analysis.
         *
         * @param {string} uuid TestCaseUUID (active test case)
         * @param {object} [options] options
         * @param {string} [options.run] External Execution ID of the run (e.g. the run shown in the analytics of a release)
         * @param {boolean} [options.keepChat] keep the conversation of the language model (tool call within a turn)
         * @returns {Promise<object>} analysis (see resultReport.fromRead)
         */
        async openResult(uuid, options) {
            const analysis = resultReport.fromRead(await this.gateway.readResult(uuid, options && options.run));
            this.setAnalysis(analysis, options);
            return analysis;
        }

        /**
         * @param {string} caseId Case ID, e.g. STC-2026-000007
         * @param {object} [options] see openResult
         * @returns {Promise<object>} analysis
         */
        async openResultByCaseId(caseId, options) {
            const uuid = await this.gateway.findTestCase(caseId);
            if (!uuid) {
                throw new Error("Testfall " + caseId + " nicht gefunden (nur gespeicherte Testfälle haben Ergebnisse).");
            }
            return this.openResult(uuid, options);
        }

        setAnalysis(analysis, options) {
            this.analysis = analysis;
            if (!(options && options.keepChat)) {
                // a new topic: the language model starts a new conversation about the result
                this.chat = [];
                this.apiMessages = [];
            }
            this.step({
                icon: "sap-icon://inspection",
                text:
                    "Ergebnis gelesen: " + analysis.caseId + (analysis.run ? " · Lauf " + analysis.run.id + " · " + (resultReport.RESULT_TEXT[analysis.run.result] || analysis.run.status) : " · noch kein Lauf") +
                    " · " + analysis.findings.length + (analysis.findings.length === 1 ? " Befund" : " Befunde")
            });
            this.onAnalysis(analysis);
        }

        /** Ends the discussion of a result: back to the draft (if any) */
        closeAnalysis() {
            this.analysis = undefined;
            this.chat = [];
            this.apiMessages = [];
            this.onAnalysis(undefined);
        }

        /**
         * Handles one user message: the transport decides whether a language model or the rule-based agent answers.
         *
         * @param {string} text user message
         * @param {AbortSignal} [signal] stop signal
         * @returns {Promise<{text: string, mode: string}>} answer
         */
        async send(text, signal) {
            if (!this.analysis) {
                // the fault report and a stated net value belong to the draft, not to the discussion of a result
                if (!this.originalText) {
                    this.originalText = text;
                }
                if (/\d[\d.,]*\s*(eur|€)/i.test(text)) {
                    this.userStatedNetAmount = true;
                }
            }
            if (this.transport.kind === "rules") {
                return { text: await this.ruleAgent.respond(text), mode: "rules" };
            }
            const masterData = await this.gateway.masterData();
            const analysis = this.analysis;
            const context = analysis ? resultReport.contextBlock(analysis, masterData.describe) : prompts.contextBlock(this.draft, masterData.describe, { package: this.package, run: this.run });
            const message = context + "\n\n" + text;
            const catalog = await this.gateway.catalog();
            const system = analysis ? resultReport.instructions(catalog) : prompts.instructions(catalog);
            const tools = analysis ? this.analysisTools : this.tools;
            if (this.transport.kind === "sample") {
                this.chat.push({ role: "user", content: message });
                // standing instructions are the leading user turn (the sample capability has no system prompt); oldest turns go first
                while (this.chat.length > MAX_CHAT_TURNS) {
                    this.chat.splice(0, 2);
                }
                const turns = [{ role: "user", content: system }].concat(this.chat);
                try {
                    const result = await this.transport.sample(turns, {
                        tools: tools,
                        signal: signal,
                        onText: this.onText
                    });
                    this.chat.push({ role: "assistant", content: result.text });
                    return { text: result.text, mode: "sample", truncated: result.truncated };
                } catch (error) {
                    // keep the chat consistent: the unanswered user turn is removed
                    this.chat.pop();
                    throw error;
                }
            }
            // proxy: Messages API loop in the page, append-only history
            const result = await messagesLoop.run({
                send: this.transport.send,
                system: system,
                history: this.apiMessages,
                userContent: message,
                tools: tools,
                signal: signal,
                onStep: this.step.bind(this)
            });
            return { text: result.text, mode: "proxy", stopReason: result.stopReason };
        }

        /** Saves the draft (Prepare + Activate), approves it and starts the execution — only on the user's confirmation */
        async submit() {
            if (!this.draft || this.draft.validation.status !== "VALID") {
                throw new Error("Nur ein gültiger Entwurf kann übernommen werden.");
            }
            const uuid = this.draft.uuid;
            const saved = await this.gateway.saveDraft(uuid);
            this.step({ icon: "sap-icon://save", text: "Gespeichert: " + saved.caseId });
            await this.gateway.approve(uuid);
            this.step({ icon: "sap-icon://approvals", text: "Freigegeben (Mensch im Prozess: Ihre Bestätigung)" });
            const started = await this.gateway.startExecution(uuid);
            this.step({ icon: "sap-icon://process", text: "Ausführung gestartet: " + started.externalExecutionId });
            this.draft = Object.assign({}, this.draft, { caseId: saved.caseId, isActive: true, submitted: true, externalExecutionId: started.externalExecutionId });
            this.onDraft(this.draft);
            return this.draft;
        }

        /** Saves the draft only (Prepare + Activate) */
        async saveOnly() {
            if (!this.draft) {
                throw new Error("Es gibt keinen Entwurf.");
            }
            const saved = await this.gateway.saveDraft(this.draft.uuid);
            this.step({ icon: "sap-icon://save", text: "Gespeichert: " + saved.caseId });
            this.draft = Object.assign({}, this.draft, { caseId: saved.caseId, isActive: true, submitted: true });
            this.onDraft(this.draft);
            return this.draft;
        }

        /* ---------------------------------------------------------------------------------------------- */
        /* Test package: several test cases from the process description                                   */
        /* ---------------------------------------------------------------------------------------------- */
        /**
         * Test package for a release (default: the next planned release): the proposals of the test design become drafts,
         * each validated by the backend; device type corrections (R5/R10) and the predecessor (R12) take the first suggestion
         * of the validation, like a single test case. Then the package as a whole is checked. Nothing is saved here.
         *
         * @param {object} [options] options
         * @param {string} [options.text] request of the user (release, processes)
         * @param {string} [options.releaseId] release
         * @param {string[]} [options.processIds] processes (default: scope of the release)
         * @param {boolean} [options.teamSections] sub-process test cases of the further teams (default true)
         * @returns {Promise<object>} package
         */
        async createPackage(options) {
            const settings = options || {};
            if (this.package && !this.package.saved) {
                await this.discardPackage();
            }
            const gateway = this.gateway;
            const results = await Promise.all([gateway.processModel(), gateway.releases(), gateway.scopes(), gateway.testCases(), gateway.masterData()]);
            const model = results[0];
            const releases = results[1];
            const scopes = results[2];
            const existing = results[3];
            const masterData = results[4];
            const today = this.today();
            const release = settings.releaseId
                ? releases.find(function (r) {
                      return r.ReleaseID === String(settings.releaseId).toUpperCase();
                  })
                : testPackage.resolveRelease(settings.text || "", releases, today);
            if (!release) {
                throw new Error("Kein passendes Release gefunden" + (settings.releaseId ? ": " + settings.releaseId : "") + ".");
            }
            const scope = testPackage.packageProcesses(settings.text || "", release, scopes, model.processes);
            let processes = scope.processes;
            if (settings.processIds && settings.processIds.length) {
                const wanted = settings.processIds.map(function (id) {
                    return String(id).toUpperCase();
                });
                processes = model.processes.filter(function (p) {
                    return wanted.indexOf(p.ProcessID) > -1;
                });
            }
            this.step({
                icon: "sap-icon://process",
                text:
                    "Prozessbeschreibung gelesen: Release " +
                    release.ReleaseID +
                    ", Prozesse " +
                    processes
                        .map(function (p) {
                            return p.ProcessID;
                        })
                        .join(", ") +
                    (scope.copyFrom ? " (Scope aus " + scope.copyFrom + ")" : "")
            });
            const planned = testDesign.planPackage({
                processes: processes,
                steps: model.steps,
                variants: model.variants,
                teams: model.teams,
                pools: masterData.pools,
                existing: existing,
                referenceDate: today,
                prefix: String(release.ReleaseID).split("-").pop(),
                releaseId: release.ReleaseID,
                teamSections: settings.teamSections !== false
            });
            const pkg = {
                release: release,
                copyFrom: scope.copyFrom,
                processes: planned.processes.map(function (p) {
                    return { id: p.process.ProcessID, name: p.process.ProcessName, modeled: p.modeled, proposals: p.proposals };
                }),
                skipped: planned.skipped,
                items: [],
                saved: false,
                validation: undefined
            };
            this.package = pkg;
            this.packageModel = model;
            pkg.validation = testPackage.validate(pkg, model);
            this.step({
                icon: "sap-icon://add-process",
                text:
                    "Testdesign: " +
                    planned.proposals.length +
                    " Testfälle vorgeschlagen" +
                    (planned.skipped.length
                        ? ", nicht angelegt: " +
                          planned.skipped
                              .map(function (s) {
                                  return s.id;
                              })
                              .join(", ")
                        : "")
            });
            for (const proposal of planned.proposals) {
                pkg.items.push(await this._packageDraft(proposal, masterData));
                pkg.validation = testPackage.validate(pkg, model);
                this.onPackage(pkg);
            }
            pkg.validation = testPackage.validate(pkg, model);
            const v = pkg.validation;
            this.step({
                icon: "sap-icon://validate",
                text:
                    "Paket geprüft: " +
                    v.coverage.covered +
                    "/" +
                    v.coverage.total +
                    " automatisierte Schritte abgedeckt, " +
                    (v.ways.missing.length ? v.ways.missing.length + " Wege ohne Testfall" : "alle Wege") +
                    ", " +
                    (v.teams.without.length ? v.teams.without.length + " Teams ohne Testfall" : "alle Teams") +
                    (v.invalid.length ? ", " + v.invalid.length + " ungültig" : ""),
                state: v.invalid.length ? "Error" : v.coverage.gaps.length || v.ways.missing.length || v.teams.without.length ? "Warning" : "Success"
            });
            this.onPackage(pkg);
            return pkg;
        }

        /** one proposal → draft with process reference and test data, validated and corrected like a single test case */
        async _packageDraft(proposal, masterData) {
            const gateway = this.gateway;
            const item = {
                proposal: proposal,
                uuid: "",
                status: "NOT_VALIDATED",
                findings: [],
                corrections: [],
                predecessor: "",
                duplicateOf: [],
                steps: [],
                selected: true,
                saved: false
            };
            try {
                item.uuid = await gateway.createDraft({ processProfile: proposal.profile, title: proposal.title, text: "" });
                await gateway.updateDraft(
                    item.uuid,
                    {
                        processTeam: proposal.team,
                        processVariant: proposal.variant,
                        startObject: proposal.startObject,
                        endObject: proposal.endObject,
                        preconditions: proposal.preconditions || undefined,
                        description: proposal.description,
                        scenarioId: proposal.scenarioId
                    },
                    proposal.data
                );
                await gateway.validateDraft(item.uuid);
                let read = await gateway.readDraft(item.uuid);
                for (let pass = 0; pass < 2; pass++) {
                    const fixes = read.findings.filter(function (f) {
                        return (f.RuleID === "R5_EQUIPMENT_PRODUCT" || f.RuleID === "R10_DEVICE_TYPE") && f.SuggestedValues && (f.ValidationStatus === "ERROR" || f.ValidationStatus === "WARNING");
                    });
                    const predecessor = read.findings.find(function (f) {
                        return f.RuleID === "R12_PREDECESSOR" && f.ValidationStatus === "ERROR" && f.SuggestedValues;
                    });
                    if (!fixes.length && !predecessor) {
                        break;
                    }
                    if (fixes.length) {
                        const patch = { ExpectedNetAmount: null };
                        fixes.forEach(function (f) {
                            const value = String(f.SuggestedValues).split(",")[0].trim();
                            patch[f.FieldName] = value;
                            item.corrections.push((prompts.FIELD_LABELS[f.FieldName] || f.FieldName) + " " + (read.values[f.FieldName] || "–") + " → " + value + " (" + f.RuleID.split("_")[0] + ")");
                        });
                        await gateway.updateDraft(item.uuid, {}, patch);
                    }
                    if (predecessor) {
                        const id = String(predecessor.SuggestedValues).split(",")[0].trim();
                        await gateway.updateDraft(item.uuid, { predecessorTestCase: id }, {});
                        item.corrections.push("Vorgänger " + id + " (R12)");
                    }
                    await gateway.validateDraft(item.uuid);
                    read = await gateway.readDraft(item.uuid);
                }
                item.status = read.testCase.ValidationStatus;
                item.startObject = read.testCase.StartObject;
                item.endObject = read.testCase.EndObject;
                item.predecessorObject = read.testCase.PredecessorObject || "";
                item.predecessor = read.testCase.PredecessorTestCase || "";
                item.findings = read.findings
                    .filter(function (f) {
                        return f.ValidationStatus === "ERROR" || f.ValidationStatus === "WARNING" || f.RuleID === "R13_DUPLICATE";
                    })
                    .map(function (f) {
                        return {
                            feld: f.FieldName,
                            bezeichnung: prompts.FIELD_LABELS[f.FieldName] || f.FieldName,
                            status: f.ValidationStatus,
                            regel: f.RuleID,
                            regeltext: prompts.RULES[f.RuleID] || f.RuleID,
                            meldung: f.ValidationMessage
                        };
                    });
                item.duplicateOf = [];
                item.findings
                    .filter(function (f) {
                        return f.regel === "R13_DUPLICATE";
                    })
                    .forEach(function (f) {
                        (String(f.meldung).match(/STC-\d{4}-\d{6}/g) || []).forEach(function (id) {
                            if (item.duplicateOf.indexOf(id) === -1) {
                                item.duplicateOf.push(id);
                            }
                        });
                    });
                item.steps = (await gateway.draftSteps(item.uuid)).map(function (step) {
                    return step.ProcessStepID;
                });
                this.step({
                    icon: "sap-icon://add-document",
                    text:
                        "Entwurf " +
                        proposal.scenarioId +
                        ": " +
                        masterData.describe("ProcessVariant", proposal.variant) +
                        " – " +
                        (testPackage.STATUS_TEXT[item.status] || item.status) +
                        (item.corrections.length ? " (korrigiert: " + item.corrections.join("; ") + ")" : ""),
                    state: item.status === "VALID" ? "Success" : item.status === "INVALID" ? "Error" : "Warning"
                });
            } catch (error) {
                item.status = "INVALID";
                item.error = error.message || String(error);
                item.findings = [{ feld: "", bezeichnung: "Entwurf", status: "ERROR", regel: "", regeltext: item.error, meldung: item.error }];
                this.step({ icon: "sap-icon://error", text: "Entwurf " + proposal.scenarioId + " nicht angelegt: " + item.error, state: "Error" });
            }
            return item;
        }

        /** (de)selects a draft of the package; the package is checked again */
        selectPackageItem(key, selected) {
            const pkg = this.package;
            if (!pkg || pkg.saved) {
                return pkg;
            }
            pkg.items.forEach(function (item) {
                if (item.proposal.key === key) {
                    item.selected = !!selected;
                }
            });
            pkg.validation = testPackage.validate(pkg, this.packageModel);
            this.onPackage(pkg);
            return pkg;
        }

        /**
         * Saves the selected drafts of the package (Prepare + Activate), discards the others, approves the valid ones where the
         * user is process owner (the server checks the role) and copies the scope of the release when it is empty — only on
         * the user's confirmation.
         *
         * @param {object} [options] options {approve: true, copyScope: true}
         * @returns {Promise<object>} package
         */
        async savePackage(options) {
            const settings = Object.assign({ approve: true, copyScope: true }, options || {});
            const pkg = this.package;
            if (!pkg || pkg.saved) {
                throw new Error("Es gibt kein offenes Testpaket.");
            }
            const gateway = this.gateway;
            if (settings.copyScope && pkg.copyFrom) {
                await gateway.copyScope(pkg.release.ReleaseID);
                pkg.scopeCopied = true;
                this.step({ icon: "sap-icon://copy", text: "Scope von " + pkg.release.ReleaseID + " aus " + pkg.copyFrom + " übernommen" });
            }
            for (const item of pkg.items) {
                if (!item.uuid || item.saved) {
                    continue;
                }
                if (!item.selected) {
                    await gateway.discardDraft(item.uuid).catch(function () {});
                    item.discarded = true;
                    continue;
                }
                const saved = await gateway.saveDraft(item.uuid);
                item.caseId = saved.caseId;
                item.saved = true;
                if (settings.approve && item.status === "VALID") {
                    try {
                        await gateway.approve(item.uuid);
                        item.approved = true;
                    } catch (error) {
                        const message = error.message || String(error);
                        item.approvalMessage = /role|Rolle|may not/i.test(message) ? "Freigabe durch die Prozessverantwortung von " + item.proposal.teamName + " nötig" : message;
                    }
                }
                this.step({
                    icon: "sap-icon://save",
                    text: "Gespeichert: " + item.caseId + " " + item.proposal.title + (item.approved ? " – freigegeben" : item.approvalMessage ? " – " + item.approvalMessage : ""),
                    state: item.approved ? "Success" : "None"
                });
            }
            pkg.saved = true;
            this.onPackage(pkg);
            return pkg;
        }

        /** discards the unsaved drafts of the package */
        async discardPackage() {
            const pkg = this.package;
            if (pkg && !pkg.saved) {
                for (const item of pkg.items) {
                    if (item.uuid && !item.saved) {
                        await this.gateway.discardDraft(item.uuid).catch(function () {});
                    }
                }
            }
            this.package = undefined;
            this.onPackage(undefined);
        }

        /* ---------------------------------------------------------------------------------------------- */
        /* Team run: all test cases of a process team (e.g. after a code change)                          */
        /* ---------------------------------------------------------------------------------------------- */
        /**
         * Prepares a team run: process team (or the owner team of a named process), release in test, reason and the preview
         * of every test case of the team (run, skip with the reason, wait for a predecessor). Nothing is started here.
         *
         * @param {object} [options] options {text, team, processId, releaseId, reason, includeDependents}
         * @returns {Promise<object>} run state
         */
        async prepareTeamRun(options) {
            const settings = options || {};
            const gateway = this.gateway;
            const results = await Promise.all([gateway.processModel(), gateway.releases(), gateway.scopes(), gateway.testCases()]);
            const model = results[0];
            const parsed = teamRun.parse(settings.text || "", { processes: model.processes, teams: model.teams });
            const processId = settings.processId !== undefined && settings.processId !== null ? String(settings.processId).toUpperCase() : parsed.processId;
            const process = model.processes.find(function (p) {
                return p.ProcessID === processId;
            });
            const team = settings.team ? String(settings.team).toUpperCase() : parsed.team || (process ? process.OwnerTeam : "");
            if (!team) {
                throw new Error("Welches Prozessteam oder welcher Prozess soll laufen? Nennen Sie z. B. „Prozessteam Reparatur“ oder „Reparaturprozess“.");
            }
            if (
                !model.teams.some(function (t) {
                    return t.ProcessTeam === team;
                })
            ) {
                throw new Error("Prozessteam " + team + " gibt es nicht.");
            }
            const release = teamRun.releaseFor(results[1], results[2], team, processId, settings.releaseId ? String(settings.releaseId).toUpperCase() : "");
            if (!release) {
                throw new Error("Kein Release in Test hat " + team + (processId ? " mit " + processId : "") + " im Regressions-Scope – ein Teamlauf gehört immer zu einem Release in Test.");
            }
            if (release.ReleaseStatus !== "IN_TEST") {
                throw new Error("Release " + release.ReleaseID + " ist nicht in Test (" + release.ReleaseStatus + "): Teamläufe gibt es nur für Releases in Test.");
            }
            const includeDependents = settings.includeDependents !== undefined ? !!settings.includeDependents : parsed.includeDependents;
            this.run = {
                phase: "PREVIEW",
                team: team,
                processId: processId || "",
                reason: String(settings.reason || parsed.reason).slice(0, 120),
                includeDependents: includeDependents,
                release: release,
                testCases: results[3],
                scopes: results[2],
                preview: teamRun.preview({ testCases: results[3], team: team, processId: processId, release: release, scopes: results[2], includeDependents: includeDependents })
            };
            this.step({
                icon: "sap-icon://group",
                text:
                    "Teamlauf vorbereitet: " +
                    team +
                    (processId ? " · " + processId : "") +
                    " · " +
                    release.ReleaseID +
                    " – " +
                    this.run.preview.counts.run +
                    " ausführen, " +
                    this.run.preview.counts.wait +
                    " warten, " +
                    this.run.preview.counts.skip +
                    " überspringen"
            });
            this.onRun(this.run);
            return this.run;
        }

        /** dependent test cases of other teams in or out of the prepared run */
        setRunDependents(include) {
            const run = this.run;
            if (!run || run.phase !== "PREVIEW") {
                return run;
            }
            run.includeDependents = !!include;
            run.preview = teamRun.preview({ testCases: run.testCases, team: run.team, processId: run.processId, release: run.release, scopes: run.scopes, includeDependents: run.includeDependents });
            this.onRun(run);
            return run;
        }

        /** starts the prepared team run (release action startTeamRegressionRun) — only on the user's confirmation */
        async startTeamRun() {
            const run = this.run;
            if (!run || run.phase !== "PREVIEW") {
                throw new Error("Es ist kein Teamlauf vorbereitet.");
            }
            await this.gateway.startTeamRun(run.release.ReleaseID, {
                ProcessTeam: run.team,
                ProcessID: run.processId || "",
                RunReason: run.reason,
                IncludeDependents: !!run.includeDependents
            });
            const read = await this.gateway.readRun(run.release.ReleaseID);
            run.run = read.run;
            run.items = read.items;
            run.phase = read.run && read.run.Status === "RUNNING" ? "RUNNING" : "FINISHED";
            this.step({
                icon: "sap-icon://process",
                text: "Teamlauf gestartet: " + (read.run ? read.run.RunID + " – " + read.run.StartedCount + " gestartet, " + read.run.SkippedCount + " übersprungen" : run.release.ReleaseID)
            });
            this.onRun(run);
            return run;
        }

        /** advances a running team run (release action refreshRegressionRun) and reads its items */
        async refreshTeamRun() {
            const run = this.run;
            if (!run || run.phase !== "RUNNING") {
                return run;
            }
            await this.gateway.refreshRun(run.release.ReleaseID);
            const read = await this.gateway.readRun(run.release.ReleaseID);
            run.run = read.run;
            run.items = read.items;
            if (!read.run || read.run.Status !== "RUNNING") {
                run.phase = "FINISHED";
                this.step({
                    icon: "sap-icon://inspection",
                    text: "Teamlauf beendet: " + read.run.RunID + " – " + read.run.PassedCount + " bestanden, " + read.run.FailedCount + " fehlgeschlagen, " + read.run.SkippedCount + " übersprungen",
                    state: read.run.FailedCount ? "Error" : "Success"
                });
            }
            this.onRun(run);
            return run;
        }

        closeRun() {
            this.run = undefined;
            this.onRun(undefined);
        }

        /** Discards an unsaved draft and starts over */
        async reset() {
            if (this.draft && !this.draft.isActive) {
                await this.gateway.discardDraft(this.draft.uuid).catch(function () {});
            }
            await this.discardPackage();
            this.closeRun();
            this.chat = [];
            this.apiMessages = [];
            this.draft = undefined;
            this.originalText = "";
            this.userStatedNetAmount = false;
            this.ruleAgent = new RuleBasedAgent(this.gateway, this);
            this.onDraft(undefined);
            if (this.analysis) {
                this.analysis = undefined;
                this.onAnalysis(undefined);
            }
        }
    }

    return AgentSession;
});
