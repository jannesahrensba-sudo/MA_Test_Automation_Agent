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

        async readList(path, select, sorters, filters) {
            const binding = this.model.bindList(path, undefined, sorters, filters, { $$groupId: "$direct", $select: select });
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

        async invoke(action, path) {
            const target = this.model.bindContext(path);
            const operation = this.model.bindContext(NS + "." + action + "(...)", target.getBoundContext(), { $$groupId: "$direct" });
            try {
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
         * Result of the latest run of a saved test case with the findings of the result analysis (read-only).
         *
         * @param {string} uuid TestCaseUUID
         * @returns {Promise<object>} {testCase, values, execution, steps, assertions, documents, findings, history}
         */
        async readResult(uuid) {
            const path = this.activePath(uuid);
            const testCase = await this.readObject(path, RESULT_SELECT.header);
            const values = await this.readObject(path + "/_TestCaseData", DATA_FIELDS.join(","));
            if (!testCase.LatestExecutionUUID) {
                return { testCase: testCase, values: values, execution: null, steps: [], assertions: [], documents: [], findings: [], history: [] };
            }
            const bySequence = [new Sorter("Sequence")];
            const [execution, steps, assertions, documents, findings, history] = await Promise.all([
                this.readObject(path + "/_LatestExecution", RESULT_SELECT.execution),
                this.readList(path + "/_LatestExecutionStep", RESULT_SELECT.steps, bySequence),
                this.readList(path + "/_LatestTestAssertion", RESULT_SELECT.assertions, bySequence),
                this.readList(path + "/_LatestDocumentReference", RESULT_SELECT.documents, bySequence),
                this.readList(path + "/_LatestResultFinding", RESULT_SELECT.findings, bySequence),
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
