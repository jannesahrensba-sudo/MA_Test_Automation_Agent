sap.ui.define(["./prompts", "./agentTools", "./RuleBasedAgent", "./messagesLoop"], function (prompts, agentTools, RuleBasedAgent, messagesLoop) {
    "use strict";

    const MAX_CHAT_TURNS = 16;

    /**
     * One conversation of the service assistant: chat turns, the current test case draft and the steps (tool calls) of
     * the running turn. The language model is reached through a transport:
     *   - "sample": Claude through the claude.ai sample capability of the hosted artifact (viewer's own account)
     *   - "proxy": Claude through the local development proxy /agent-api (Claude API, key only on the server)
     *   - "rules": rule-based mock agent (no language model): backend analyze + deterministic follow-up questions
     */
    class AgentSession {
        /**
         * @param {object} options options
         * @param {object} options.gateway OData gateway
         * @param {object} options.transport {kind, label, send?, sample?}
         * @param {Function} [options.onStep] step callback (UI)
         * @param {Function} [options.onDraft] draft state callback (UI)
         * @param {Function} [options.onText] streamed answer text callback (UI)
         */
        constructor(options) {
            this.gateway = options.gateway;
            this.transport = options.transport;
            this.onStepCallback = options.onStep || function () {};
            this.onDraft = options.onDraft || function () {};
            this.onText = options.onText || function () {};
            this.chat = []; // {role, content} for the sample capability
            this.apiMessages = []; // Messages API history of the proxy transport (append-only)
            this.draft = undefined;
            this.originalText = "";
            this.userStatedNetAmount = false;
            this.ruleAgent = new RuleBasedAgent(this.gateway, this);
            this.tools = agentTools.createTools(this.gateway, this);
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
            const read = await this.gateway.readDraft(uuid);
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
         * Handles one user message: the transport decides whether a language model or the rule-based agent answers.
         *
         * @param {string} text user message
         * @param {AbortSignal} [signal] stop signal
         * @returns {Promise<{text: string, mode: string}>} answer
         */
        async send(text, signal) {
            if (!this.originalText) {
                this.originalText = text;
            }
            if (/\d[\d.,]*\s*(eur|€)/i.test(text)) {
                this.userStatedNetAmount = true;
            }
            if (this.transport.kind === "rules") {
                return { text: await this.ruleAgent.respond(text), mode: "rules" };
            }
            const masterData = await this.gateway.masterData();
            const context = prompts.contextBlock(this.draft, masterData.describe);
            const message = context + "\n\n" + text;
            const system = prompts.instructions(await this.gateway.catalog());
            if (this.transport.kind === "sample") {
                this.chat.push({ role: "user", content: message });
                // standing instructions are the leading user turn (the sample capability has no system prompt); oldest turns go first
                while (this.chat.length > MAX_CHAT_TURNS) {
                    this.chat.splice(0, 2);
                }
                const turns = [{ role: "user", content: system }].concat(this.chat);
                try {
                    const result = await this.transport.sample(turns, {
                        tools: this.tools,
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
                tools: this.tools,
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
        }
    }

    return AgentSession;
});
