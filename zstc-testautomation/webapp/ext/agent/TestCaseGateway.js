sap.ui.define(["sap/ui/model/Sorter", "./core/masterData"], function (Sorter, masterDataModule) {
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
        processProfiles: ["ProcessProfileVH", "ProcessProfile,ProcessProfileName"]
    };

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
    /** Edm.Decimal values are strings in the OData V4 model */
    const DECIMAL_FIELDS = ["ServiceDuration", "ServicePartQuantity", "ExpectedNetAmount", "NetAmountTolerance"];

    function odataError(error) {
        const message = (error && error.error && error.error.message) || (error && error.message) || String(error);
        return new Error(message);
    }

    /**
     * Access of the service assistant to the OData V4 service ZUI_STC_TEST_CASE_O4 — exclusively through the OData V4
     * model of the app (no manual AJAX): value helps, draft create/update (PATCH), bound actions analyze · validate ·
     * Prepare · Activate · approve · startExecution, and draft discard. The same operations are the tool contract of a
     * Joule agent (docs/agent-konzept.md).
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

        async readList(path, select, sorters) {
            const binding = this.model.bindList(path, undefined, sorters, undefined, { $$groupId: "$direct", $select: select });
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
            return { processProfiles: masterData.pools.processProfiles };
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

        /** PATCH TestCase (title) and TestCaseData (fields); the backend determinations run on each change */
        async updateDraft(uuid, header, fields) {
            const changes = [];
            const bindings = [];
            if (header && header.title) {
                const root = this.model.bindContext(this.draftPath(uuid), undefined, { $$updateGroupId: "$auto", $select: "Title" });
                bindings.push(root);
                const context = root.getBoundContext();
                await context.requestObject();
                changes.push(context.setProperty("Title", header.title));
            }
            const names = Object.keys(fields || {});
            if (names.length) {
                const data = this.model.bindContext(this.draftPath(uuid) + "/_TestCaseData", undefined, { $$updateGroupId: "$auto", $select: DATA_FIELDS.join(",") });
                bindings.push(data);
                const context = data.getBoundContext();
                await context.requestObject();
                names.forEach(function (name) {
                    let value = fields[name];
                    if (value !== null && value !== undefined && DECIMAL_FIELDS.indexOf(name) > -1) {
                        value = String(value);
                    }
                    changes.push(context.setProperty(name, value === undefined ? null : value));
                });
            }
            try {
                await Promise.all(changes);
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
                this.readObject(path, "TestCaseUUID,IsActiveEntity,CaseID,Title,ProcessProfile,ValidationStatus,ApprovalStatus,ExecutionStatus,FinalResult"),
                this.readObject(path + "/_TestCaseData", DATA_FIELDS.join(",")),
                this.readList(
                    path + "/_ValidationResult",
                    "ValidationUUID,IsActiveEntity,Sequence,FieldName,ValidationStatus,RuleID,ValidationMessage,SuggestedValue,SuggestedValues,Category",
                    [new Sorter("Sequence")]
                )
            ]);
            return { testCase: testCase, values: values, findings: findings };
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
