sap.ui.define(["sap/ui/model/Sorter", "sap/ui/model/Filter", "sap/ui/model/FilterOperator", "./core/masterData"], function (Sorter, Filter, FilterOperator, masterDataModule) {
    "use strict";

    const NS = "com.sap.gateway.srvd.zui_stc_test_case.v0001";

    /** properties read per value help (the model runs with autoExpandSelect: explicit $select) */
    const VALUE_HELPS = {
        customers: ["CustomerVH", "Customer,CustomerName,CityName,Country"],
        contacts: ["ContactPersonVH", "BusinessPartner,BusinessPartnerFullName,FirstName,LastName,Customer"],
        functionalLocations: ["FunctionalLocationVH", "FunctionalLocation,FunctionalLocationName,Customer,MaintenancePlant,SuperiorFunctionalLocation"],
        equipments: ["EquipmentVH", "Equipment,EquipmentName,FunctionalLocation,Material,SerialNumber,Customer"],
        products: ["ProductVH", "Product,ProductDescription,ProductType,BaseUnit,ProductGroup"],
        serviceTeams: ["ServiceTeamVH", "RespyMgmtServiceTeam,RespyMgmtServiceTeamName,ServiceOrganization"],
        serviceOrganizations: ["ServiceOrganizationVH", "ServiceOrganization,ServiceOrganizationName,SalesOrganization"],
        priorities: ["ServiceDocumentPriorityVH", "ServiceDocumentPriority,ServiceDocumentPriorityName"],
        processProfiles: ["ProcessProfileVH", "ProcessProfile,ProcessProfileName"],
        // process reference: teams, processes, ways (variants), releases and service contracts
        processTeams: ["ProcessTeamVH", "ProcessTeam,ProcessTeamName,ProcessArea"],
        processes: ["BusinessProcessVH", "ProcessID,ProcessName,OwnerTeam,ProcessVersion,PilotScope"],
        variants: ["ProcessVariantVH", "ProcessID,Variant,VariantName,PilotScope,IsDefault"],
        releases: ["ReleaseVH", "ReleaseID,ReleaseName,ReleaseType,ReleaseStatus,TestStartDate,TestEndDate"],
        testCases: ["TestCaseVH", "CaseID,Title,ProcessTeam,BusinessProcess,ProcessVariant,StartObject,EndObject,ApprovalStatus,LatestResult"],
        serviceContracts: [
            "ServiceContractVH",
            "ServiceContract,ServiceContractDescription,SoldToParty,ServiceRefFunctionalLocation,ServiceContractStartDate,ServiceContractEndDate,ServiceContractIsReleased,BillingPlanNetAmount"
        ]
    };

    /** header fields of the process reference: key of the tool/session → property of TestCase */
    const HEADER_FIELDS = {
        description: "Description",
        scenarioId: "ScenarioID",
        processTeam: "ProcessTeam",
        processVariant: "ProcessVariant",
        endObject: "EndObject",
        startObject: "StartObject",
        preconditions: "Preconditions",
        // sent last: whether a predecessor is needed depends on the start object
        predecessorTestCase: "PredecessorTestCase"
    };
    const HEADER_SELECT = "TestCaseUUID,IsActiveEntity,CaseID,Title,ProcessProfile,ValidationStatus,ApprovalStatus,ExecutionStatus,FinalResult," +
        "ProcessTeam,BusinessProcess,ProcessVariant,EndObject,StartObject,PredecessorTestCase,PredecessorObject,TestLevel,AssignmentStatus,AssignmentNote,Version,Preconditions," +
        "LatestExecutionUUID,ExternalExecutionID";

    const DATA_FIELDS = [
        "ServiceRequestType",
        "ServiceRequestDescription",
        "SoldToParty",
        "ServiceRequestReporter",
        "ServiceDocumentPriority",
        "SalesOrganization",
        "ServiceOrganization",
        "RespyMgmtServiceTeam",
        "ServiceRefFunctionalLocation",
        "ServiceReferenceEquipment",
        "ReferenceProduct",
        "ServiceContract",
        "ServiceProduct",
        "ServiceDuration",
        "ServiceDurationUnit",
        "ServicePart",
        "ServicePartQuantity",
        "ServicePartQuantityUnit",
        "ExpectedNetAmount",
        "NetAmountTolerance",
        "TransactionCurrency"
    ];
    /** result of the latest run ("Ergebnis besprechen"): run, steps, assertions, documents, findings of the analysis, history */
    const RESULT_SELECT = {
        header: "TestCaseUUID,IsActiveEntity,CaseID,Title,ProcessProfile,ProcessTeam,BusinessProcess,ProcessVariant,StartObject,EndObject,PredecessorTestCase,Version," +
            "ApprovalStatus,ExecutionStatus,FinalResult,LatestExecutionUUID,ExternalExecutionID",
        execution: "ExecutionUUID,IsActiveEntity,ExternalExecutionID,Status,FunctionalResult,TechnicalResult,ReleaseID,TestCaseVersion,ProcessVariant,StartObject,EndObject," +
            "PredecessorExecution,AnalysisHeadline,StartedAt,FinishedAt,DurationInSeconds,ExecutedBy,RunType",
        steps: "StepUUID,IsActiveEntity,Sequence,ProcessStepID,StepName,ResponsibleTeam,BusinessObjectType,ExecutionStatus,ExpectedStatus,ActualStatus,Message",
        assertions: "AssertionUUID,IsActiveEntity,Sequence,BusinessObjectType,Field,ExpectedValue,ActualValue,Tolerance,Result,Message,ProcessStepID,StepName",
        documents: "DocumentReferenceUUID,IsActiveEntity,Sequence,BusinessObjectType,DocumentID,DocumentOrigin,OriginReference,LifecycleStatus,NetAmount,TransactionCurrency,ProcessStepID",
        findings: "FindingUUID,IsActiveEntity,Sequence,FindingCode,Category,Severity,ProcessStepID,StepName,ResponsibleTeam,Confidence,Parameters,Finding,ProbableCause,Recommendation,Evidence",
        history: "ExecutionUUID,IsActiveEntity,ExternalExecutionID,Status,FunctionalResult,ReleaseID,TestCaseVersion,StartedAt,RunType"
    };

    /** test package and team run: test cases with their test object, releases, scope, regression runs */
    const TEST_CASE_SELECT =
        "TestCaseUUID,IsActiveEntity,CaseID,Title,ScenarioID,ProcessProfile,ProcessTeam,BusinessProcess,ProcessVariant,StartObject,EndObject,PredecessorTestCase," +
        "ValidationStatus,ApprovalStatus,Version,ApprovedVersion,AssignmentStatus,ExecutionStatus,FinalResult";
    const RELEASE_SELECT = "ReleaseID,IsActiveEntity,ReleaseName,ReleaseType,ReleaseStatus,PredecessorRelease,TestStartDate,TestEndDate,LatestRunUUID,LatestRunID,LatestRunStatus";
    const RUN_SELECT = "RunUUID,RunID,ReleaseID,Status,Trigger,ProcessTeam,ProcessID,RunReason,IncludesDependents,StartedAt,FinishedAt,CandidateCount,StartedCount,SkippedCount,RunningCount,PassedCount,FailedCount,PassRate";
    const RUN_ITEM_SELECT = "RunItemUUID,RunUUID,Sequence,TestCaseUUID,CaseID,Title,ProcessTeam,ProcessVariant,TestCaseVersion,Decision,Reason,ExecutionUUID,ExternalExecutionID,ExecutionStatus,FinalResult";
    const PROCESS_STEP_SELECT = "ProcessID,StepID,StepName,Sequence,BusinessObjectType,ResponsibleTeam,TeamAssignment,Variants,PilotScope,Automation";

    /** Edm.Decimal values are strings in the OData V4 model */
    const DECIMAL_FIELDS = ["ServiceDuration", "ServicePartQuantity", "ExpectedNetAmount", "NetAmountTolerance"];

    function odataError(error) {
        const message = (error && error.error && error.error.message) || (error && error.message) || String(error);
        return new Error(message);
    }

    /**
     * Access of the service assistant to the OData V4 service ZUI_STC_TEST_CASE_O4 — exclusively through the OData V4
     * model of the app (no manual AJAX): value helps, draft create/update (PATCH), bound actions analyze · validate ·
     * Prepare · Activate · approve · startExecution, draft discard, and the read of a run result with its analysis.
     * The same operations are the tool contract of a Joule agent (docs/agent-konzept.md).
     */
    class TestCaseGateway {
        constructor(model) {
            this.model = model;
            this.masterDataPromise = undefined;
        }

        draftPath(uuid) {
            return "/TestCase(TestCaseUUID=" + uuid + ",IsActiveEntity=false)";
        }

        activePath(uuid) {
            return "/TestCase(TestCaseUUID=" + uuid + ",IsActiveEntity=true)";
        }

        async readList(path, select, sorters, filters, expand) {
            const parameters = { $$groupId: "$direct", $select: select };
            if (expand) {
                parameters.$expand = expand;
            }
            const binding = this.model.bindList(path, undefined, sorters, filters, parameters);
            try {
                return (await binding.requestContexts(0, 1000)).map(function (context) {
                    return context.getObject();
                });
            } finally {
                binding.destroy();
            }
        }

        async readObject(path, select) {
            const binding = this.model.bindContext(path, undefined, { $$groupId: "$direct", $select: select });
            try {
                return await binding.getBoundContext().requestObject();
            } finally {
                binding.destroy();
            }
        }

        async invoke(action, path, parameters) {
            const target = this.model.bindContext(path);
            const operation = this.model.bindContext(NS + "." + action + "(...)", target.getBoundContext(), { $$groupId: "$direct" });
            try {
                Object.keys(parameters || {}).forEach(function (name) {
                    operation.setParameter(name, parameters[name]);
                });
                await operation.invoke();
            } catch (error) {
                throw odataError(error);
            } finally {
                operation.destroy();
                target.destroy();
            }
        }

        /** value help pools, read once per session */
        masterData() {
            if (!this.masterDataPromise) {
                const keys = Object.keys(VALUE_HELPS);
                this.masterDataPromise = Promise.all(
                    keys.map(
                        function (key) {
                            return this.readList("/" + VALUE_HELPS[key][0], VALUE_HELPS[key][1]);
                        }.bind(this)
                    )
                )
                    .then(function (lists) {
                        const pools = {};
                        keys.forEach(function (key, index) {
                            pools[key] = lists[index];
                        });
                        return masterDataModule.createMasterData(pools);
                    })
                    .catch(
                        function (error) {
                            this.masterDataPromise = undefined;
                            throw odataError(error);
                        }.bind(this)
                    );
            }
            return this.masterDataPromise;
        }

        async catalog() {
            const masterData = await this.masterData();
            const pools = masterData.pools;
            return {
                processProfiles: pools.processProfiles,
                processTeams: pools.processTeams || [],
                variants: (pools.variants || []).filter(function (v) {
                    return v.PilotScope === "PILOT";
                }),
                releasesInTest: (pools.releases || []).filter(function (r) {
                    return r.ReleaseStatus === "IN_TEST";
                })
            };
        }

        /** POST TestCase: new draft (defaults of the process profile are set by the backend) */
        async createDraft(options) {
            const list = this.model.bindList("/TestCase", undefined, undefined, undefined, { $$updateGroupId: "$auto" });
            const initial = { NaturalLanguageInput: options.text || "" };
            if (options.processProfile) {
                initial.ProcessProfile = options.processProfile;
            }
            if (options.title) {
                initial.Title = options.title;
            }
            const context = list.create(initial, true);
            try {
                await context.created();
                return await context.requestProperty("TestCaseUUID");
            } catch (error) {
                throw odataError(error);
            } finally {
                list.destroy();
            }
        }

        /**
         * PATCH TestCase (title, process reference) and TestCaseData (fields); the backend determinations run on each change.
         * The process reference goes first: the path decides which documents are expected and how the expected value is derived.
         */
        async updateDraft(uuid, header, fields) {
            const bindings = [];
            const headerChanges = Object.keys(HEADER_FIELDS).filter(function (key) {
                return header && header[key] !== undefined && header[key] !== null;
            });
            try {
                if (header && (header.title || headerChanges.length)) {
                    const root = this.model.bindContext(this.draftPath(uuid), undefined, {
                        $$updateGroupId: "$auto",
                        $select: "Title," + Object.values(HEADER_FIELDS).join(",")
                    });
                    bindings.push(root);
                    const context = root.getBoundContext();
                    await context.requestObject();
                    const headerPatches = [];
                    if (header.title) {
                        headerPatches.push(context.setProperty("Title", header.title));
                    }
                    headerChanges
                        .filter(function (key) {
                            return key !== "predecessorTestCase";
                        })
                        .forEach(function (key) {
                            headerPatches.push(context.setProperty(HEADER_FIELDS[key], header[key]));
                        });
                    // the process reference is determined before the test data changes (own request)
                    await Promise.all(headerPatches);
                    if (headerChanges.indexOf("predecessorTestCase") > -1) {
                        // after the start object: the predecessor hands over its documents and test data
                        await context.setProperty("PredecessorTestCase", header.predecessorTestCase);
                    }
                }
                const names = Object.keys(fields || {});
                if (names.length) {
                    const data = this.model.bindContext(this.draftPath(uuid) + "/_TestCaseData", undefined, { $$updateGroupId: "$auto", $select: DATA_FIELDS.join(",") });
                    bindings.push(data);
                    const context = data.getBoundContext();
                    await context.requestObject();
                    await Promise.all(
                        names.map(function (name) {
                            let value = fields[name];
                            if (value !== null && value !== undefined && DECIMAL_FIELDS.indexOf(name) > -1) {
                                value = String(value);
                            }
                            return context.setProperty(name, value === undefined ? null : value);
                        })
                    );
                }
            } catch (error) {
                throw odataError(error);
            } finally {
                bindings.forEach(function (binding) {
                    binding.destroy();
                });
            }
        }

        analyzeDraft(uuid) {
            return this.invoke("analyze", this.draftPath(uuid));
        }

        validateDraft(uuid) {
            return this.invoke("validate", this.draftPath(uuid));
        }

        /** current values and validation findings of the draft (active = true: of the saved test case) */
        async readDraft(uuid, active) {
            const path = active ? this.activePath(uuid) : this.draftPath(uuid);
            const [testCase, values, findings] = await Promise.all([
                this.readObject(path, HEADER_SELECT),
                this.readObject(path + "/_TestCaseData", DATA_FIELDS.join(",")),
                this.readList(
                    path + "/_ValidationResult",
                    "ValidationUUID,IsActiveEntity,Sequence,FieldName,ValidationStatus,RuleID,ValidationMessage,SuggestedValue,SuggestedValues,Category",
                    [new Sorter("Sequence")]
                )
            ]);
            return { testCase: testCase, values: values, findings: findings };
        }

        /**
         * Result of a run of a saved test case with the findings of the result analysis (read-only): the given run
         * (External Execution ID, e.g. from the analytics of a release) or the latest one.
         *
         * @param {string} uuid TestCaseUUID
         * @param {string} [runId] External Execution ID
         * @returns {Promise<object>} {testCase, values, execution, steps, assertions, documents, findings, history}
         */
        async readResult(uuid, runId) {
            const path = this.activePath(uuid);
            const testCase = await this.readObject(path, RESULT_SELECT.header);
            const values = await this.readObject(path + "/_TestCaseData", DATA_FIELDS.join(","));
            let run = testCase.LatestExecutionUUID
                ? { self: path + "/_LatestExecution", steps: path + "/_LatestExecutionStep", assertions: path + "/_LatestTestAssertion", documents: path + "/_LatestDocumentReference", findings: path + "/_LatestResultFinding" }
                : undefined;
            if (runId) {
                const found = await this.readList("/Execution", "ExecutionUUID,IsActiveEntity,ExternalExecutionID", undefined, [
                    new Filter("TestCaseUUID", FilterOperator.EQ, uuid),
                    new Filter("ExternalExecutionID", FilterOperator.EQ, runId),
                    new Filter("IsActiveEntity", FilterOperator.EQ, true)
                ]);
                if (found.length) {
                    const self = "/Execution(ExecutionUUID=" + found[0].ExecutionUUID + ",IsActiveEntity=true)";
                    run = { self: self, steps: self + "/_ExecutionStep", assertions: self + "/_TestAssertion", documents: self + "/_DocumentReference", findings: self + "/_ResultFinding" };
                }
            }
            if (!run) {
                return { testCase: testCase, values: values, execution: null, steps: [], assertions: [], documents: [], findings: [], history: [] };
            }
            const bySequence = [new Sorter("Sequence")];
            const [execution, steps, assertions, documents, findings, history] = await Promise.all([
                this.readObject(run.self, RESULT_SELECT.execution),
                this.readList(run.steps, RESULT_SELECT.steps, bySequence),
                this.readList(run.assertions, RESULT_SELECT.assertions, bySequence),
                this.readList(run.documents, RESULT_SELECT.documents, bySequence),
                this.readList(run.findings, RESULT_SELECT.findings, bySequence),
                this.readList(path + "/_Execution", RESULT_SELECT.history, [new Sorter("StartedAt", true)])
            ]);
            return { testCase: testCase, values: values, execution: execution, steps: steps, assertions: assertions, documents: documents, findings: findings, history: history };
        }

        /** TestCaseUUID of a saved test case by its Case ID */
        async findTestCase(caseId) {
            const found = await this.readList("/TestCase", "TestCaseUUID,IsActiveEntity,CaseID", undefined, [
                new Filter("CaseID", FilterOperator.EQ, caseId),
                new Filter("IsActiveEntity", FilterOperator.EQ, true)
            ]);
            return found.length ? found[0].TestCaseUUID : undefined;
        }

        /** Save: Prepare (validation on save) and Activate (Case ID) */
        async saveDraft(uuid) {
            await this.invoke("Prepare", this.draftPath(uuid));
            await this.invoke("Activate", this.draftPath(uuid));
            const saved = await this.readObject(this.activePath(uuid), "TestCaseUUID,IsActiveEntity,CaseID");
            return { caseId: saved.CaseID };
        }

        approve(uuid) {
            return this.invoke("approve", this.activePath(uuid));
        }

        async startExecution(uuid) {
            await this.invoke("startExecution", this.activePath(uuid));
            const started = await this.readObject(this.activePath(uuid), "TestCaseUUID,IsActiveEntity,ExternalExecutionID,ExecutionStatus");
            return { externalExecutionId: started.ExternalExecutionID };
        }

        /* ---------------------------------------------------------------------------------------------- */
        /* Test package and team run                                                                       */
        /* ---------------------------------------------------------------------------------------------- */
        releasePath(releaseId) {
            return "/Release(ReleaseID='" + encodeURIComponent(String(releaseId).replace(/'/g, "''")) + "',IsActiveEntity=true)";
        }

        /** process model of the test design and the process picture, read once: steps of all processes, ways, processes, teams */
        processModel() {
            if (!this.processModelPromise) {
                this.processModelPromise = Promise.all([
                    this.readList("/ProcessStepVH", PROCESS_STEP_SELECT),
                    this.readList("/ProcessVariant", "VariantUUID,IsActiveEntity,ProcessID,Variant,VariantName,Description,PilotScope,IsDefault,Sequence", undefined, [
                        new Filter("IsActiveEntity", FilterOperator.EQ, true)
                    ]),
                    this.masterData()
                ])
                    .then(function (results) {
                        const pools = results[2].pools;
                        const names = new Map(
                            (pools.processTeams || []).map(function (t) {
                                return [t.ProcessTeam, t.ProcessTeamName];
                            })
                        );
                        return {
                            steps: results[0].map(function (step) {
                                return Object.assign({}, step, { TeamName: names.get(step.ResponsibleTeam) || "" });
                            }),
                            variants: results[1],
                            processes: pools.processes || [],
                            teams: pools.processTeams || []
                        };
                    })
                    .catch(
                        function (error) {
                            this.processModelPromise = undefined;
                            throw odataError(error);
                        }.bind(this)
                    );
            }
            return this.processModelPromise;
        }

        /** active test cases with the test object of their test data (device, contract, customer) */
        async testCases() {
            const rows = await this.readList(
                "/TestCase",
                TEST_CASE_SELECT,
                [new Sorter("CaseID")],
                [new Filter("IsActiveEntity", FilterOperator.EQ, true)],
                "_TestCaseData($select=TestCaseUUID,IsActiveEntity,ServiceReferenceEquipment,ServiceContract,SoldToParty)"
            );
            return rows.map(function (row) {
                const data = row._TestCaseData || {};
                return Object.assign({}, row, { equipment: data.ServiceReferenceEquipment || "", contract: data.ServiceContract || "", customer: data.SoldToParty || "", LatestResult: row.FinalResult || "" });
            });
        }

        releases() {
            return this.readList("/Release", RELEASE_SELECT, [new Sorter("TestStartDate")], [new Filter("IsActiveEntity", FilterOperator.EQ, true)]);
        }

        scopes() {
            return this.readList("/ReleaseScope", "ScopeUUID,IsActiveEntity,ReleaseID,ProcessTeam,ProcessID,IsRegressionRelevant", undefined, [new Filter("IsActiveEntity", FilterOperator.EQ, true)]);
        }

        /** test steps of a test case (the section of its way), draft or saved */
        draftSteps(uuid, active) {
            return this.readList((active ? this.activePath(uuid) : this.draftPath(uuid)) + "/_Step", "TestCaseStepUUID,IsActiveEntity,StepNo,ProcessStepID,ResponsibleTeam,IsHandover", [new Sorter("StepNo")]);
        }

        /** scope of a release from its predecessor release (action copyScopeFromPredecessor) */
        copyScope(releaseId) {
            return this.invoke("copyScopeFromPredecessor", this.releasePath(releaseId));
        }

        /** team run: regression run of one process team (action startTeamRegressionRun) */
        startTeamRun(releaseId, parameters) {
            return this.invoke("startTeamRegressionRun", this.releasePath(releaseId), parameters);
        }

        /** advances the running regression run of a release (action refreshRegressionRun) */
        refreshRun(releaseId) {
            return this.invoke("refreshRegressionRun", this.releasePath(releaseId));
        }

        /** latest regression run of a release with its items */
        async readRun(releaseId) {
            const release = await this.readObject(this.releasePath(releaseId), RELEASE_SELECT);
            if (!release.LatestRunUUID) {
                return { release: release, run: null, items: [] };
            }
            const runPath = "/RegressionRun(RunUUID=" + release.LatestRunUUID + ")";
            const [run, items] = await Promise.all([this.readObject(runPath, RUN_SELECT), this.readList(runPath + "/_Item", RUN_ITEM_SELECT, [new Sorter("Sequence")])]);
            return { release: release, run: run, items: items };
        }

        /** Discard (DELETE of the draft) */
        async discardDraft(uuid) {
            const binding = this.model.bindContext(this.draftPath(uuid), undefined, { $$groupId: "$direct", $select: "TestCaseUUID" });
            try {
                const context = binding.getBoundContext();
                await context.requestObject();
                await context.delete("$direct");
            } catch (error) {
                throw odataError(error);
            } finally {
                binding.destroy();
            }
        }
    }

    return TestCaseGateway;
});
