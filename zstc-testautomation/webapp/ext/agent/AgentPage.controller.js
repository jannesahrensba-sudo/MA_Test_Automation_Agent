sap.ui.define(
    [
        "sap/fe/core/PageController",
        "sap/ui/model/json/JSONModel",
        "sap/m/MessageToast",
        "sap/m/MessageBox",
        "./TestCaseGateway",
        "./transports",
        "./core/AgentSession",
        "./core/prompts",
        "./core/markdown",
        "./core/resultReport"
    ],
    function (PageController, JSONModel, MessageToast, MessageBox, TestCaseGateway, transports, AgentSession, prompts, markdown, resultReport) {
        "use strict";

        /** example fault reports (fictional metering-service data, docs/messdienst-szenarien.md) */
        const EXAMPLES = {
            hkv: "Frau Müller aus der Musterstraße 12 in München (1. OG links) meldet über Petra Wagner von der Hausverwaltung, dass der Heizkostenverteiler im Wohnzimmer nichts mehr anzeigt – das Display ist komplett dunkel.",
            rwm: "Im Kinderzimmer der Wohnung Yilmaz (Musterstraße 12, EG rechts) piept der Rauchmelder alle paar Sekunden, obwohl kein Rauch da ist. Bitte dringend jemanden schicken. Gemeldet von Hausmeister Stefan Brandl.",
            ambiguous: "Bei Familie Müller in der Musterstraße 12 funktioniert ein Heizkostenverteiler nicht.",
            cologne: "Lindenallee 5 in Köln, Herr Nowak: der Rauchwarnmelder im Flur ist abgerissen und liegt auf dem Boden. Meldung von Aylin Demir.",
            contract:
                "Laut Wartungsvertrag: Im Kinderzimmer der Wohnung Yilmaz (Musterstraße 12, EG rechts) piept der Rauchwarnmelder. Austausch im Rahmen des Vertrags, " +
                "Test bis zur Faktura. Gemeldet von Hausmeister Stefan Brandl."
        };

        /** suggested questions about a result (the assistant answers in German) */
        const QUESTIONS = {
            cause: "Warum ist der Lauf fehlgeschlagen?",
            team: "Wer ist zuständig?",
            compare: "Was hat sich seit dem letzten Lauf geändert?",
            confidence: "Wie sicher ist das?",
            action: "Was soll ich tun?",
            documents: "Welche Belege hat der Lauf?"
        };

        const STATUS_STATE = { VALID: "Success", AMBIGUOUS: "Warning", INVALID: "Error", NOT_VALIDATED: "None" };

        function now() {
            return new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
        }

        /**
         * Service assistant (FPM custom page): an agent in front of the app. It turns a German fault report into a
         * validated test case draft through the OData service (tools), asks back when something is ambiguous and hands
         * the test case over to the app — saving, approval and start only on the user's confirmation.
         * Jump-off "Ergebnis besprechen": the header action of the test case (and the analytics page) open this page with
         * ?analyze=<TestCaseUUID>[&run=<External Execution ID>]; the assistant then discusses the result of that run (default:
         * the latest one) with its deterministic analysis.
         */
        return PageController.extend("zstc.testautomation.ext.agent.AgentPage", {
            onInit: function () {
                PageController.prototype.onInit.apply(this, arguments);
                this.transports = { rules: Object.assign({}, transports.RULES, { label: this._text("agentTransportRules") }) };
                this.state = new JSONModel({
                    messages: [],
                    steps: [],
                    draft: null,
                    draftRows: [],
                    findings: [],
                    analysis: null,
                    busy: false,
                    busyText: "",
                    input: "",
                    modes: [{ key: "rules", text: this._text("agentModeRules") }],
                    mode: "rules",
                    modeText: "",
                    modeType: "Information"
                });
                this.getView().setModel(this.state, "agent");
                this._updateModeText();
                this._welcome();
                this._detectTransports();
                // jump-off from the test case: ?analyze=<TestCaseUUID>&n=<nonce>
                const router = this.getAppComponent().getRouter();
                router.getRoute("AgentPage").attachPatternMatched(this._onRouteMatched, this);
                // the route may have matched before this view existed (direct link, first navigation)
                const current = router.getRouteInfoByHash(router.getHashChanger().getHash());
                if (current && current.name === "AgentPage") {
                    setTimeout(this._handleQuery.bind(this, current.arguments && current.arguments["?query"]), 0);
                }
            },

            _onRouteMatched: function (event) {
                this._handleQuery((event.getParameter("arguments") || {})["?query"]);
            },

            _handleQuery: function (query) {
                const uuid = query && query.analyze;
                if (!uuid) {
                    return;
                }
                // every press of "Ergebnis besprechen" carries a new nonce; back navigation to the same hash opens nothing again
                const key = uuid + "|" + (query.n || "");
                if (this._handledQuery === key) {
                    return;
                }
                this._handledQuery = key;
                this._openResult(uuid, query.run);
            },

            /** discussion of the result of a run of a test case (the latest one unless a run is given) */
            _openResult: async function (uuid, run) {
                if (this.state.getProperty("/busy")) {
                    this._pendingResult = { uuid: uuid, run: run };
                    return;
                }
                this.state.setProperty("/busy", true);
                this.state.setProperty("/busyText", this._text("agentResultReading"));
                try {
                    const session = this._session();
                    this.masterData = await this._gateway().masterData();
                    const analysis = await session.openResult(uuid, { run: run });
                    this._addMessage("assistant", resultReport.report(analysis, this.masterData.describe), this._text("agentResultSource"));
                } catch (error) {
                    this._addMessage("assistant", this._text("agentResultError", [transports.describeError(error).text]));
                } finally {
                    this.state.setProperty("/busy", false);
                }
            },

            _text: function (key, args) {
                return this.getAppComponent().getModel("i18n").getResourceBundle().getText(key, args);
            },

            _gateway: function () {
                if (!this.gateway) {
                    // the view gets the model of the component only once it is placed; a jump-off may come earlier
                    this.gateway = new TestCaseGateway(this.getView().getModel() || this.getAppComponent().getModel());
                }
                return this.gateway;
            },

            _welcome: function () {
                this._addMessage(
                    "assistant",
                    "Guten Tag! Schildern Sie eine Störung aus dem Messdienst auf Deutsch – z. B. einen **Heizkostenverteiler**, der nichts anzeigt, oder einen **Rauchwarnmelder**, der piept. " +
                        "Nennen Sie möglichst Adresse, Wohnung oder Bewohner, Raum und wer die Störung gemeldet hat.\n" +
                        "Ich erfasse daraus einen Testfall, prüfe ihn gegen die Stammdaten und frage nach, wenn etwas fehlt. Gestartet wird erst nach Ihrer Bestätigung.\n" +
                        "Der Testfall wird dem Reparaturprozess zugeordnet: Ihr **Prozessteam** und der **Weg** – ohne Angebot, mit Angebot (angenommen oder abgelehnt) " +
                        "oder über einen Servicevertrag. Sagen Sie z. B. „laut Wartungsvertrag“ oder „nur bis zum Auftrag“, wenn Sie einen anderen Weg oder Endpunkt testen wollen.\n" +
                        "Ergebnisse besprechen: im Testfall **Ergebnis besprechen** wählen oder hier z. B. „Ergebnis von STC-2026-000007 besprechen“ schreiben."
                );
            },

            /** Claude through claude.ai (hosted artifact) or the local proxy; the rule-based agent is always available */
            _detectTransports: function () {
                const add = function (transport) {
                    if (!transport || !transport.kind) {
                        return;
                    }
                    transport.label = transport.kind === "sample" ? this._text("agentTransportSample") : this._text("agentTransportProxy", [transport.model]);
                    this.transports.claude = transport;
                    this.state.setProperty("/modes", [
                        { key: "claude", text: this._text("agentModeClaude") },
                        { key: "rules", text: this._text("agentModeRules") }
                    ]);
                    if (!this.session && this.state.getProperty("/messages").length <= 1) {
                        this.state.setProperty("/mode", "claude");
                    }
                    this._updateModeText();
                }.bind(this);
                transports
                    .detectProxy()
                    .then(
                        function (proxy) {
                            if (proxy && proxy.unavailableReason) {
                                this.proxyHint = proxy.unavailableReason;
                                this._updateModeText();
                                return;
                            }
                            add(proxy);
                        }.bind(this)
                    )
                    .catch(function () {});
                transports
                    .detectSample()
                    .then(add)
                    .catch(function () {});
            },

            _updateModeText: function () {
                const mode = this.state.getProperty("/mode");
                const transport = this.transports[mode] || this.transports.rules;
                let text = this._text("agentModeActive", [transport.label]);
                if (transport.kind === "rules") {
                    text += " " + this._text("agentModeRulesHint");
                    if (this.proxyHint) {
                        text += " " + this.proxyHint;
                    }
                } else if (transport.kind === "sample") {
                    text += " " + this._text("agentModeSampleHint");
                } else {
                    text += " " + this._text("agentModeProxyHint");
                }
                text += " " + this._text("agentDataHint");
                this.state.setProperty("/modeText", text);
                this.state.setProperty("/modeType", transport.kind === "rules" ? "Information" : "Success");
            },

            _session: function () {
                if (!this.session) {
                    const mode = this.state.getProperty("/mode");
                    this.session = new AgentSession({
                        gateway: this._gateway(),
                        transport: this.transports[mode] || this.transports.rules,
                        onStep: this._addStep.bind(this),
                        onDraft: this._showDraft.bind(this),
                        onAnalysis: this._showAnalysis.bind(this),
                        onText: function (update) {
                            this._setStreamingText(update.text);
                        }.bind(this)
                    });
                    if (this._carriedAnalysis) {
                        // agent changed during a discussion: the new agent continues with the same result
                        this.session.setAnalysis(this._carriedAnalysis);
                        this._carriedAnalysis = undefined;
                    }
                }
                return this.session;
            },

            _showAnalysis: function (analysis) {
                if (!analysis) {
                    this.state.setProperty("/analysis", null);
                    return;
                }
                const describe = this.masterData
                    ? this.masterData.describe
                    : function (field, value) {
                          return String(value);
                      };
                this.state.setProperty("/analysis", resultReport.panel(analysis, describe));
            },

            _addMessage: function (role, text, info) {
                const messages = this.state.getProperty("/messages").slice();
                messages.push({
                    role: role,
                    author: role === "user" ? this._text("agentYou") : this._text("agentName"),
                    icon: role === "user" ? "sap-icon://customer" : "sap-icon://ai",
                    html: markdown.toHtml(text),
                    time: now(),
                    info: info || ""
                });
                this.state.setProperty("/messages", messages);
                return messages.length - 1;
            },

            _setStreamingText: function (text) {
                if (this.streamingIndex !== undefined) {
                    this.state.setProperty("/messages/" + this.streamingIndex + "/html", markdown.toHtml(text));
                }
            },

            _addStep: function (step) {
                const steps = this.state.getProperty("/steps").slice();
                steps.push({ icon: step.icon || "sap-icon://activity-items", text: step.text, state: step.state || "None", time: now() });
                this.state.setProperty("/steps", steps);
                this.state.setProperty("/busyText", step.text);
            },

            _showDraft: function (draft) {
                if (!draft) {
                    this.state.setProperty("/draft", null);
                    this.state.setProperty("/draftRows", []);
                    this.state.setProperty("/findings", []);
                    return;
                }
                const describe = this.masterData
                    ? this.masterData.describe
                    : function (field, value) {
                          return String(value);
                      };
                // process reference first (team, way, end object, assignment), then the test data
                const rows = prompts.processRows(draft.process, describe).concat(
                    prompts.SUMMARY_FIELDS.filter(function (field) {
                        const value = draft.values[field];
                        return value !== null && value !== undefined && value !== "";
                    }).map(function (field) {
                        const value = draft.values[field];
                        return {
                            label: prompts.FIELD_LABELS[field] || field,
                            value: prompts.display(field, value, draft.values, describe)
                        };
                    })
                );
                const findings = draft.validation.findings.map(function (f) {
                    return {
                        title: f.bezeichnung + " – " + f.regeltext,
                        description: f.vorschlaege.length ? "Vorschläge: " + f.vorschlaege.join(" | ") : f.meldung,
                        icon: f.status === "ERROR" ? "sap-icon://error" : "sap-icon://alert",
                        state: f.status === "ERROR" ? "Error" : "Warning"
                    };
                });
                this.state.setProperty(
                    "/draft",
                    Object.assign({}, draft, {
                        title: draft.title || draft.values.ServiceRequestDescription || this._text("agentDraftUntitled"),
                        statusText: prompts.STATUS[draft.validation.status] || draft.validation.status,
                        statusState: STATUS_STATE[draft.validation.status] || "None",
                        submittedText: draft.submitted
                            ? draft.externalExecutionId
                                ? this._text("agentSubmittedText", [draft.caseId, draft.externalExecutionId])
                                : this._text("agentSavedText", [draft.caseId])
                            : ""
                    })
                );
                this.state.setProperty("/draftRows", rows);
                this.state.setProperty("/findings", findings);
            },

            onExample: function (event) {
                const key = event.getParameter("item").getKey();
                this.state.setProperty("/input", EXAMPLES[key] || "");
            },

            onModeChange: async function () {
                if (this.session) {
                    const analysis = this.session.analysis;
                    await this.session.reset();
                    this.session = undefined;
                    this.state.setProperty("/steps", []);
                    if (analysis) {
                        this._carriedAnalysis = analysis;
                        this._session();
                        this._addMessage("assistant", this._text("agentModeChangedResult", [analysis.caseId]));
                    } else {
                        this._addMessage("assistant", this._text("agentModeChanged"));
                    }
                }
                this._updateModeText();
            },

            onReset: async function () {
                if (this.session) {
                    await this.session.reset();
                }
                this.session = undefined;
                this.state.setProperty("/messages", []);
                this.state.setProperty("/steps", []);
                this._welcome();
            },

            onStop: function () {
                if (this.abortController) {
                    this.abortController.abort();
                }
            },

            onSend: async function () {
                const text = String(this.state.getProperty("/input") || "").trim();
                if (!text || this.state.getProperty("/busy")) {
                    return;
                }
                this.state.setProperty("/input", "");
                this._addMessage("user", text);
                this.state.setProperty("/busy", true);
                this.state.setProperty("/busyText", this._text("agentThinking"));
                this.abortController = new AbortController();
                const session = this._session();
                if (session.transport.kind === "sample") {
                    this.streamingIndex = this._addMessage("assistant", this._text("agentThinking"), session.transport.label);
                }
                try {
                    this.masterData = await this._gateway().masterData();
                    const answer = await session.send(text, this.abortController.signal);
                    if (this.streamingIndex !== undefined) {
                        this.state.setProperty("/messages/" + this.streamingIndex + "/html", markdown.toHtml(answer.text));
                    } else {
                        this._addMessage("assistant", answer.text, session.transport.label);
                    }
                    if (answer.truncated) {
                        this._addStep({ icon: "sap-icon://message-warning", text: this._text("agentTruncated"), state: "Warning" });
                    }
                } catch (error) {
                    this._handleError(error, text);
                } finally {
                    this.streamingIndex = undefined;
                    this.abortController = undefined;
                    this.state.setProperty("/busy", false);
                    if (this._pendingResult) {
                        const pending = this._pendingResult;
                        this._pendingResult = undefined;
                        this._openResult(pending.uuid, pending.run);
                    }
                }
            },

            /** errors of the language model: permanent ones switch to the rule-based agent (a new draft only if none exists) */
            _handleError: function (error, text) {
                const described = transports.describeError(error);
                const partial = error && typeof error.text === "string" ? error.text : "";
                if (this.streamingIndex !== undefined) {
                    this.state.setProperty("/messages/" + this.streamingIndex + "/html", markdown.toHtml(partial ? partial + "\n\n" + described.text : described.text));
                } else {
                    this._addMessage("assistant", described.text);
                }
                if (described.cancelled) {
                    return;
                }
                this._addStep({ icon: "sap-icon://error", text: described.text, state: "Error" });
                if (described.permanent && this.session && this.session.transport.kind !== "rules") {
                    delete this.transports.claude;
                    this.state.setProperty("/modes", [{ key: "rules", text: this._text("agentModeRules") }]);
                    this.state.setProperty("/mode", "rules");
                    this._updateModeText();
                    if (!this.session.draft) {
                        this.session = undefined;
                        this.state.setProperty("/input", text);
                        this._addMessage("assistant", this._text("agentFallbackResend"));
                    } else {
                        this.session.transport = this.transports.rules;
                    }
                }
            },

            onSubmit: async function () {
                const session = this.session;
                if (!session || !session.draft) {
                    return;
                }
                this.state.setProperty("/busy", true);
                this.state.setProperty("/busyText", this._text("agentSubmitting"));
                try {
                    const draft = await session.submit();
                    this._addMessage("assistant", this._text("agentHandover", [draft.caseId, draft.externalExecutionId]));
                    MessageToast.show(this._text("agentHandoverToast", [draft.caseId]));
                    this._navigateToTestCase(draft);
                } catch (error) {
                    MessageBox.error(transports.describeError(error).text);
                    this._addStep({ icon: "sap-icon://error", text: error.message || String(error), state: "Error" });
                } finally {
                    this.state.setProperty("/busy", false);
                }
            },

            onSaveOnly: async function () {
                const session = this.session;
                if (!session || !session.draft) {
                    return;
                }
                this.state.setProperty("/busy", true);
                try {
                    const draft = await session.saveOnly();
                    this._addMessage("assistant", this._text("agentSavedMessage", [draft.caseId]));
                } catch (error) {
                    MessageBox.error(transports.describeError(error).text);
                } finally {
                    this.state.setProperty("/busy", false);
                }
            },

            onOpenTestCase: function () {
                const draft = this.session && this.session.draft;
                if (draft) {
                    this._navigateToTestCase(draft);
                }
            },

            /** hand-over to the app: object page of the test case (draft or saved) */
            _navigateToTestCase: function (draft) {
                return this.routing.navigateToRoute("TestCaseObjectPage", {
                    key: "TestCaseUUID=" + draft.uuid + ",IsActiveEntity=" + (draft.isActive ? "true" : "false")
                });
            },

            onShowOverview: function () {
                return this.routing.navigateToRoute("Overview");
            },

            onQuestion: function (event) {
                const key = event.getParameter("item").getKey();
                this.state.setProperty("/input", QUESTIONS[key] || "");
            },

            onOpenResultTestCase: function () {
                const analysis = this.state.getProperty("/analysis");
                if (analysis) {
                    this._navigateToTestCase({ uuid: analysis.uuid, isActive: true });
                }
            },

            onCloseAnalysis: function () {
                if (this.session) {
                    this.session.closeAnalysis();
                }
                this._addMessage("assistant", this._text("agentResultClosed"));
            },

            /** analytics of the release of the discussed run (otherwise of the release in test) */
            onShowDashboard: function () {
                const release = this.state.getProperty("/analysis/release");
                return this.routing.navigateToRoute("Analytics", release ? { "?query": { release: release } } : {});
            }
        });
    }
);
