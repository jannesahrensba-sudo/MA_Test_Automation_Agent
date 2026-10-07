sap.ui.define(["./prompts", "./agentTools", "./RuleBasedAgent", "./messagesLoop", "./resultReport"], function (prompts, agentTools, RuleBasedAgent, messagesLoop, resultReport) {
    "use strict";

    const MAX_CHAT_TURNS = 16;

    /**
     * One conversation of the service assistant: chat turns, the current test case draft and the steps (tool calls) of
     * the running turn. The language model is reached through a transport:
     *   - "sample": Claude through the claude.ai sample capability of the hosted artifact (viewer's own account)
     *   - "proxy": Claude through the local development proxy /agent-api (Claude API, key only on the server)
     *   - "rules": rule-based mock agent (no language model): backend analyze + deterministic follow-up questions
     * Two topics: capturing a test case from a fault report (draft) and discussing the result of a test run (analysis,
     * "Ergebnis besprechen"). An open analysis takes precedence; closing it returns to the draft.
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
         */
        constructor(options) {
            this.gateway = options.gateway;
            this.transport = options.transport;
            this.onStepCallback = options.onStep || function () {};
            this.onDraft = options.onDraft || function () {};
            this.onText = options.onText || function () {};
            this.onAnalysis = options.onAnalysis || function () {};
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
            const context = analysis ? resultReport.contextBlock(analysis, masterData.describe) : prompts.contextBlock(this.draft, masterData.describe);
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

        /** Discards an unsaved draft and starts over */
        async reset() {
            if (this.draft && !this.draft.isActive) {
                await this.gateway.discardDraft(this.draft.uuid).catch(function () {});
            }
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
