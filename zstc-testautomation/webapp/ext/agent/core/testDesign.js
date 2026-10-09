sap.ui.define(["./textMatching"], function (textMatching) {
    "use strict";

    /**
     * Test design from the process model ("Testpaket"): test case proposals that fit the process description.
     *
     *   - one end-to-end test case per pilot way of a modeled process: from the first automated step of the way up to its
     *     last document (e.g. Service Request → … → accounting document), owned by the team of the first step;
     *   - one sub-process test case per further process team with automated steps: from the team's entry into the path up to
     *     its last own document (e.g. the quotation team: quotation up to the customer decision). A way whose entry needs no
     *     predecessor document is preferred (rule R12); otherwise the proposal is marked and the predecessor is taken from
     *     the suggestions of the validation;
     *   - ways outside the pilot and processes without process steps get no test case: they are reported with the reason
     *     (nothing about the process is invented).
     *
     * Test data come from the master data pools (fictional metering-service data): devices that no existing test case
     * uses, spread over the customers (regions) and device types; ways with a contract take a released, valid contract.
     * The backend determines start defaults, test steps, defaults of the process profile and the expected net value and
     * validates every draft (R1–R13) — the proposals only carry what the process description and the master data give.
     *
     * Pure module (no UI5 APIs): used by the service assistant and by the seed generator (generated test case portfolio).
     */

    const AUTOMATED = "AUTOMATED";
    const PILOT = "PILOT";
    const MAX_TITLE = 80;
    const MAX_DESCRIPTION = 40;

    const DEVICE_TYPES = {
        HKV: {
            group: "MD-HKV",
            profile: "MD_HKV_STOER",
            label: "Heizkostenverteiler",
            short: "HKV",
            priority: "5",
            faults: ["Display ohne Anzeige", "Fehlercode im Display", "Plombe beschädigt", "Funk gestört"]
        },
        RWM: {
            group: "MD-RWM",
            profile: "MD_RWM_STOER",
            label: "Rauchwarnmelder",
            short: "RWM",
            priority: "3",
            faults: ["Warnton ohne Rauch", "Melder demontiert", "Kammer verschmutzt", "Fehlalarm nachts"]
        },
        WZ: {
            group: "MD-WZ",
            profile: "MD_HKV_STOER",
            label: "Warmwasserzähler",
            short: "WZ",
            priority: "5",
            faults: ["keine Anzeige", "Stand unplausibel", "Plombe fehlt"]
        }
    };
    const DEVICE_ORDER = ["HKV", "RWM", "WZ"];
    /** device type of a contract product (smoke alarm service, device rental) */
    const CONTRACT_DEVICE = { "MD-SRV-RWM-VTR": "RWM", "MD-SRV-HKV-VTR": "HKV" };
    /** short codes of the pilot ways for scenario IDs (other ways: their code) */
    const WAY_CODE = { W1_REQUEST: "W1", W2_QUOTATION: "W2", W2_REJECTED: "W2R", W3_CONTRACT: "W3", W3_BILLING_PLAN: "W3RP" };
    const OBJECT_SHORT = {
        SERVICE_CONTRACT: "Vertrag",
        SERVICE_REQUEST: "Service Request",
        SERVICE_QUOTATION: "Angebot",
        SERVICE_ORDER: "Auftrag",
        SERVICE_CONFIRMATION: "Rückmeldung",
        BILLING_DOC_REQUEST: "Fakturaanforderung",
        BILLING_DOCUMENT: "Faktura",
        ACCOUNTING_DOCUMENT: "FI-Beleg"
    };
    /** the FI check reads the posting of a billing document of the same run: never a start object */
    const NO_START = ["ACCOUNTING_DOCUMENT"];

    function trim(value) {
        return value === null || value === undefined ? "" : String(value).trim();
    }

    function fit(text, max) {
        const value = trim(text);
        return value.length <= max ? value : value.slice(0, max - 1).trim() + "…";
    }

    function variantsOf(step) {
        return String(step.Variants || "")
            .split(",")
            .map(trim)
            .filter(Boolean);
    }

    function bySequence(a, b) {
        return (Number(a.Sequence) || 0) - (Number(b.Sequence) || 0) || String(a.StepID).localeCompare(String(b.StepID));
    }

    /** all steps of a way in process order (design path incl. decisions and manual steps) */
    function wayPath(steps, variant) {
        return steps
            .filter(function (step) {
                return variantsOf(step).indexOf(variant) > -1;
            })
            .sort(bySequence);
    }

    /** automated pilot steps with a business object (what an automated run executes) */
    function planSteps(path) {
        return path.filter(function (step) {
            return step.BusinessObjectType && step.Automation === AUTOMATED && step.PilotScope === PILOT;
        });
    }

    /** business objects with documents along a path (unique, path order) */
    function documentsOf(path) {
        const types = [];
        path.forEach(function (step) {
            if (step.BusinessObjectType && types.indexOf(step.BusinessObjectType) === -1) {
                types.push(step.BusinessObjectType);
            }
        });
        return types;
    }

    /**
     * Document a start needs from a predecessor test case — the same rule as the backend (R12, processCatalog.requiredPredecessor):
     * a confirmation needs the order, a billing document request the confirmation (or nothing on a way without an order,
     * the billing plan of a contract), a billing document the billing document request.
     *
     * @param {object[]} path steps of the way
     * @param {string} startObject start object
     * @returns {string} business object type of the predecessor document, "" when none is needed
     */
    function requiredPredecessor(path, startObject) {
        switch (startObject) {
            case "SERVICE_CONFIRMATION":
                return "SERVICE_ORDER";
            case "BILLING_DOC_REQUEST":
                return documentsOf(path).indexOf("SERVICE_ORDER") > -1 ? "SERVICE_CONFIRMATION" : "";
            case "BILLING_DOCUMENT":
                return "BILLING_DOC_REQUEST";
            default:
                return "";
        }
    }

    /**
     * Segment of a team along the automated plan of a way: from its entry up to the last step before the next team takes over.
     *
     * @param {object[]} path steps of the way
     * @param {string} team process team
     * @returns {{start: string, end: string, steps: object[]}|undefined} segment
     */
    function teamSegment(path, team) {
        const plan = planSteps(path);
        const first = plan.findIndex(function (step) {
            return step.ResponsibleTeam === team && NO_START.indexOf(step.BusinessObjectType) === -1;
        });
        if (first === -1) {
            return undefined;
        }
        let last = first;
        while (last + 1 < plan.length && plan[last + 1].ResponsibleTeam === team) {
            last++;
        }
        return { start: plan[first].BusinessObjectType, end: plan[last].BusinessObjectType, steps: plan.slice(first, last + 1) };
    }

    /** kind of test data a way needs: a contract only (billing plan), a device under a contract, or a device */
    function dataKind(path) {
        const documents = documentsOf(planSteps(path));
        if (documents[0] === "SERVICE_CONTRACT") {
            return documents.indexOf("SERVICE_ORDER") === -1 && documents.indexOf("SERVICE_REQUEST") === -1 ? "CONTRACT" : "DEVICE_UNDER_CONTRACT";
        }
        return "DEVICE";
    }

    /** "Weg 3 – Serviceleistung aus Vertrag (Vertragsfindung)" → "Weg 3 – Serviceleistung aus Vertrag" */
    function shortWayName(variant) {
        return trim(String(variant.VariantName || variant.Variant).replace(/\s*\(.*\)\s*$/, ""));
    }

    /** "Prozessteam Angebot" → "Angebot"; long names by the team ID ("Prozessteam New End to End Prozess", PT-E2E → "E2E") */
    function shortTeamName(teamName, team) {
        const name = trim(String(teamName || "").replace(/^Prozessteam\s+/i, ""));
        return name && name.length <= 12 ? name : trim(String(team || name).replace(/^PT-/, ""));
    }

    /**
     * Selection of test data over the whole package: devices no existing test case uses, customers (regions) in turn.
     *
     * @param {object} input input of plan()
     * @returns {object} picker
     */
    function createPicker(input) {
        const pools = input.pools || {};
        const groupOf = new Map(
            (pools.products || []).map(function (p) {
                return [p.Product, p.ProductGroup];
            })
        );
        const locations = new Map(
            (pools.functionalLocations || []).map(function (f) {
                return [f.FunctionalLocation, f];
            })
        );
        const customerOrder = new Map(
            (pools.customers || []).map(function (c, index) {
                return [c.Customer, index];
            })
        );
        const existing = input.existing || [];
        const usedEquipment = new Set(
            existing
                .map(function (e) {
                    return e.equipment;
                })
                .filter(Boolean)
        );
        const usedContracts = new Set(
            existing
                .map(function (e) {
                    return e.contract;
                })
                .filter(Boolean)
        );
        const existingUse = new Map();
        existing.forEach(function (e) {
            if (e.customer) {
                existingUse.set(e.customer, (existingUse.get(e.customer) || 0) + 1);
            }
        });
        const packageUse = new Map();

        const deviceTypeOf = function (equipment) {
            const group = groupOf.get(equipment.Material);
            return Object.keys(DEVICE_TYPES).find(function (type) {
                return DEVICE_TYPES[type].group === group;
            });
        };
        const propertyOf = function (equipment) {
            const unit = locations.get(equipment.FunctionalLocation);
            return unit && unit.SuperiorFunctionalLocation ? unit.SuperiorFunctionalLocation : equipment.FunctionalLocation;
        };
        const rank = function (customer) {
            return [packageUse.get(customer) || 0, existingUse.get(customer) || 0, customerOrder.has(customer) ? customerOrder.get(customer) : 9999];
        };
        const compare = function (a, b) {
            const ra = rank(a);
            const rb = rank(b);
            for (let i = 0; i < ra.length; i++) {
                if (ra[i] !== rb[i]) {
                    return ra[i] - rb[i];
                }
            }
            return 0;
        };
        const isValidContract = function (contract, referenceDate) {
            return (
                contract.ServiceContractIsReleased === true &&
                (!contract.ServiceContractStartDate || referenceDate >= contract.ServiceContractStartDate) &&
                (!contract.ServiceContractEndDate || referenceDate <= contract.ServiceContractEndDate)
            );
        };
        const take = function (customer, equipment, contract) {
            packageUse.set(customer, (packageUse.get(customer) || 0) + 1);
            if (equipment) {
                usedEquipment.add(equipment.Equipment);
            }
            if (contract) {
                usedContracts.add(contract.ServiceContract);
            }
        };

        return {
            locations: locations,
            deviceTypeOf: deviceTypeOf,
            propertyOf: propertyOf,
            /** unused device of a type (optionally in a property), from the customer used least so far */
            device: function (type, property) {
                const candidates = (pools.equipments || []).filter(function (e) {
                    return !usedEquipment.has(e.Equipment) && deviceTypeOf(e) === type && (!property || propertyOf(e) === property);
                });
                if (!candidates.length) {
                    return undefined;
                }
                const best = candidates.slice().sort(function (a, b) {
                    return compare(a.Customer, b.Customer);
                })[0];
                take(best.Customer, best);
                return best;
            },
            /** released contract, valid on the reference date, with at least one unused device of its type (unless contractOnly) */
            contract: function (referenceDate, contractOnly) {
                const candidates = (pools.serviceContracts || []).filter(function (c) {
                    if (!isValidContract(c, referenceDate) || usedContracts.has(c.ServiceContract)) {
                        return false;
                    }
                    if (contractOnly) {
                        return true;
                    }
                    const type = CONTRACT_DEVICE[c.Product];
                    return (pools.equipments || []).some(function (e) {
                        return !usedEquipment.has(e.Equipment) && (!type || deviceTypeOf(e) === type) && propertyOf(e) === c.ServiceRefFunctionalLocation;
                    });
                });
                if (!candidates.length) {
                    return undefined;
                }
                const best = candidates.slice().sort(function (a, b) {
                    return compare(a.SoldToParty, b.SoldToParty) || String(a.ServiceContract).localeCompare(String(b.ServiceContract));
                })[0];
                if (contractOnly) {
                    take(best.SoldToParty, undefined, best);
                } else {
                    usedContracts.add(best.ServiceContract);
                }
                return best;
            },
            contacts: function (customer) {
                return (pools.contacts || [])
                    .filter(function (c) {
                        return c.Customer === customer;
                    })
                    .sort(function (a, b) {
                        return String(a.BusinessPartner).localeCompare(String(b.BusinessPartner));
                    });
            },
            customer: function (id) {
                return (pools.customers || []).find(function (c) {
                    return c.Customer === id;
                });
            },
            /** regional service team: the team whose name contains the city of the customer */
            serviceTeam: function (customer) {
                const city = textMatching.normalize(customer && customer.CityName);
                return city
                    ? (pools.serviceTeams || []).find(function (t) {
                          return textMatching.normalize(t.RespyMgmtServiceTeamName).indexOf(city) > -1;
                      })
                    : undefined;
            },
            uses: function (customer) {
                return packageUse.get(customer) || 0;
            }
        };
    }

    /** test data of a device: customer, usage unit, reporter, problem description, priority, regional service team */
    function deviceData(picker, equipment, type, fault, contactIndex) {
        const device = DEVICE_TYPES[type];
        const customer = picker.customer(equipment.Customer) || { Customer: equipment.Customer };
        const contacts = picker.contacts(equipment.Customer);
        const reporter = contacts.length ? contacts[contactIndex % contacts.length] : undefined;
        const team = picker.serviceTeam(customer);
        const room = trim(String(equipment.EquipmentName || "").replace(device.label, "")) || equipment.EquipmentName;
        const data = {
            SoldToParty: equipment.Customer,
            ServiceRefFunctionalLocation: equipment.FunctionalLocation,
            ServiceReferenceEquipment: equipment.Equipment,
            ServiceRequestDescription: fit(device.short + " " + room + ": " + fault, MAX_DESCRIPTION),
            ServiceDocumentPriority: device.priority
        };
        if (reporter) {
            data.ServiceRequestReporter = reporter.BusinessPartner;
        }
        if (team) {
            data.RespyMgmtServiceTeam = team.RespyMgmtServiceTeam;
        }
        const unit = picker.locations.get(equipment.FunctionalLocation) || {};
        const property = picker.locations.get(unit.SuperiorFunctionalLocation) || {};
        return {
            data: data,
            room: room,
            city: customer.CityName || "",
            object: device.label + " " + room,
            facts:
                (property.FunctionalLocationName || "") +
                (unit.FunctionalLocationName ? ", " + unit.FunctionalLocationName : "") +
                ", " +
                equipment.EquipmentName +
                " (" +
                equipment.Equipment +
                ")" +
                (reporter ? ", gemeldet von " + reporter.BusinessPartnerFullName : "")
        };
    }

    /**
     * Proposals for one process.
     *
     * @param {object} input input
     * @param {object} input.process BusinessProcessVH row (ProcessID, ProcessName, OwnerTeam, ProcessVersion)
     * @param {object[]} input.steps ProcessStepVH rows (all processes or this one)
     * @param {object[]} input.variants ProcessVariant rows (Variant, VariantName, Description, PilotScope, IsDefault, Sequence)
     * @param {object[]} [input.teams] ProcessTeamVH rows (names)
     * @param {object} input.pools master data pools (customers, contacts, functionalLocations, equipments, products, serviceTeams, serviceContracts)
     * @param {object[]} [input.existing] existing test cases {CaseID, Title, ProcessTeam, BusinessProcess, ProcessVariant, StartObject, EndObject, ApprovalStatus, LatestResult, equipment, contract, customer}
     * @param {string} input.referenceDate YYYY-MM-DD (contract validity)
     * @param {string} [input.prefix] prefix of the scenario IDs (e.g. the release: "FPS02"), default "GEN"
     * @param {string} [input.releaseId] release the package is created for (texts only)
     * @param {boolean} [input.teamSections] sub-process test cases of the further teams (default true)
     * @param {object} [input.picker] shared data selection (several processes in one package)
     * @returns {{process: object, proposals: object[], skipped: object[]}} proposals and what was left out (with the reason)
     */
    function plan(input) {
        const process = input.process;
        const result = { process: process, proposals: [], skipped: [] };
        const steps = (input.steps || []).filter(function (s) {
            return !s.ProcessID || s.ProcessID === process.ProcessID;
        });
        if (!steps.length) {
            result.skipped.push({ kind: "PROCESS", id: process.ProcessID, name: process.ProcessName, reason: "NOT_MODELED" });
            return result;
        }
        const variants = (input.variants || [])
            .filter(function (v) {
                return !v.ProcessID || v.ProcessID === process.ProcessID;
            })
            .slice()
            .sort(function (a, b) {
                return (Number(a.Sequence) || 0) - (Number(b.Sequence) || 0) || String(a.Variant).localeCompare(String(b.Variant));
            });
        const teamNames = new Map(
            (input.teams || []).map(function (t) {
                return [t.ProcessTeam, t.ProcessTeamName];
            })
        );
        const picker = input.picker || createPicker(input);
        const prefix = trim(input.prefix) || "GEN";
        const scenarioIds = new Set();
        const scenarioId = function (code) {
            let id = fit(prefix + "-" + code, 20).replace("…", "");
            let n = 2;
            while (scenarioIds.has(id)) {
                id = fit(prefix + "-" + code, 17).replace("…", "") + "-" + n++;
            }
            scenarioIds.add(id);
            return id;
        };
        const overlaps = function (variant, start, end) {
            return (input.existing || [])
                .filter(function (e) {
                    return e.BusinessProcess === process.ProcessID && e.ProcessVariant === variant && (e.StartObject || "") === start && (e.EndObject || "") === end;
                })
                .map(function (e) {
                    return { CaseID: e.CaseID, Title: e.Title, ProcessTeam: e.ProcessTeam, ApprovalStatus: e.ApprovalStatus, LatestResult: e.LatestResult || "" };
                });
        };
        const releaseText = input.releaseId ? "Testpaket " + input.releaseId + ": " : "Testpaket: ";
        let deviceRotation = 0;
        let faultRotation = 0;

        /** test data and texts of a proposal; undefined when the master data have nothing that fits */
        const testData = function (path, team, preferredType) {
            const kind = dataKind(path);
            if (kind === "CONTRACT") {
                const contract = picker.contract(input.referenceDate, true);
                if (!contract) {
                    return undefined;
                }
                const type = CONTRACT_DEVICE[contract.Product] || "RWM";
                const property = picker.locations.get(contract.ServiceRefFunctionalLocation) || {};
                return {
                    profile: DEVICE_TYPES[type].profile,
                    deviceType: "",
                    data: {
                        SalesOrganization: "2010",
                        SoldToParty: contract.SoldToParty,
                        ServiceRefFunctionalLocation: contract.ServiceRefFunctionalLocation,
                        ServiceContract: contract.ServiceContract,
                        TransactionCurrency: "EUR",
                        NetAmountTolerance: 0
                    },
                    object: contract.ServiceContractDescription,
                    // the contract names the property: no city in the title
                    city: "",
                    facts: (property.FunctionalLocationName || contract.ServiceRefFunctionalLocation) + ", Servicevertrag " + contract.ServiceContract + " (" + contract.ServiceContractDescription + ", " + contract.BillingPlanRule + ")",
                    preconditions: "Rechnungsplanposition des Servicevertrags " + contract.ServiceContract + " ist fällig.",
                    contract: contract.ServiceContract
                };
            }
            if (kind === "DEVICE_UNDER_CONTRACT") {
                const contract = picker.contract(input.referenceDate, false);
                if (!contract) {
                    return undefined;
                }
                const type = CONTRACT_DEVICE[contract.Product] || "RWM";
                const equipment = picker.device(type, contract.ServiceRefFunctionalLocation);
                if (!equipment) {
                    return undefined;
                }
                const fault = DEVICE_TYPES[type].faults[faultRotation++ % DEVICE_TYPES[type].faults.length];
                const device = deviceData(picker, equipment, type, fault, picker.uses(equipment.Customer) - 1);
                device.data.ServiceContract = contract.ServiceContract;
                const property = picker.locations.get(contract.ServiceRefFunctionalLocation) || {};
                return Object.assign(device, {
                    profile: DEVICE_TYPES[type].profile,
                    deviceType: type,
                    facts: device.facts + ", Servicevertrag " + contract.ServiceContract + " (" + contract.ServiceContractDescription + ")",
                    preconditions: "Servicevertrag " + contract.ServiceContract + " ist freigegeben und deckt die Liegenschaft " + (property.FunctionalLocationName || contract.ServiceRefFunctionalLocation) + " ab.",
                    contract: contract.ServiceContract
                });
            }
            const order = preferredType ? [preferredType] : DEVICE_ORDER.slice(deviceRotation).concat(DEVICE_ORDER.slice(0, deviceRotation));
            for (const type of order.concat(DEVICE_ORDER)) {
                const equipment = picker.device(type);
                if (equipment) {
                    deviceRotation = (DEVICE_ORDER.indexOf(type) + 1) % DEVICE_ORDER.length;
                    const offer = planSteps(path).some(function (s) {
                        return s.BusinessObjectType === "SERVICE_QUOTATION";
                    });
                    const faults = DEVICE_TYPES[type].faults;
                    const fault = offer && team !== process.OwnerTeam ? "Angebot für Tausch" : faults[faultRotation++ % faults.length];
                    const device = deviceData(picker, equipment, type, fault, picker.uses(equipment.Customer) - 1);
                    return Object.assign(device, { profile: DEVICE_TYPES[type].profile, deviceType: type, preconditions: "" });
                }
            }
            return undefined;
        };

        const propose = function (spec) {
            const variant = spec.variant;
            const chosen = testData(spec.path, spec.team, spec.deviceType);
            if (!chosen) {
                result.skipped.push({ kind: spec.kind === "TEAM" ? "TEAM" : "WAY", id: spec.kind === "TEAM" ? spec.team : variant.Variant, name: spec.kind === "TEAM" ? teamNames.get(spec.team) || spec.team : variant.VariantName, reason: "NO_TEST_DATA" });
                return;
            }
            const section = spec.start === spec.end ? OBJECT_SHORT[spec.start] || spec.start : (OBJECT_SHORT[spec.start] || spec.start) + " bis " + (OBJECT_SHORT[spec.end] || spec.end);
            const where = chosen.city ? " (" + chosen.city + ")" : "";
            const title =
                spec.kind === "TEAM"
                    ? "Teilprozess " + shortTeamName(teamNames.get(spec.team), spec.team) + ": " + section + " – " + chosen.object + where
                    : shortWayName(variant) + ": " + chosen.object + where;
            const handover = spec.predecessorObject ? " Übernimmt " + (OBJECT_SHORT[spec.predecessorObject] || spec.predecessorObject) + " eines Vorgänger-Testfalls (Vorschlag der Validierung, R12)." : "";
            const preconditions = [spec.preconditions, chosen.preconditions].filter(Boolean).join(" ");
            result.proposals.push({
                key: (spec.kind === "TEAM" ? "TEAM-" + spec.team + "-" : "WAY-") + variant.Variant,
                kind: spec.kind,
                process: process.ProcessID,
                team: spec.team,
                teamName: teamNames.get(spec.team) || spec.team,
                variant: variant.Variant,
                variantName: variant.VariantName || variant.Variant,
                startObject: spec.start,
                endObject: spec.end,
                predecessorObject: spec.predecessorObject || "",
                profile: chosen.profile,
                deviceType: chosen.deviceType,
                title: fit(title, MAX_TITLE),
                scenarioId: scenarioId(spec.code),
                description: fit(
                    releaseText +
                        "generiert aus der Prozessbeschreibung " +
                        process.ProcessID +
                        (process.ProcessVersion ? " (Version " + process.ProcessVersion + ")" : "") +
                        ", " +
                        (variant.VariantName || variant.Variant) +
                        (variant.Description ? ": " + variant.Description : ".") +
                        " Abschnitt: " +
                        section +
                        (spec.kind === "TEAM" ? " (Teilprozess " + (teamNames.get(spec.team) || spec.team) + ")." : " (vollständiger Weg).") +
                        handover +
                        " Testdaten (fiktiv): " +
                        chosen.facts +
                        ".",
                    1000
                ),
                preconditions: fit(preconditions, 1000),
                data: chosen.data,
                contract: chosen.contract || "",
                overlaps: overlaps(variant.Variant, spec.start, spec.end),
                steps: spec.path.map(function (s) {
                    return s.StepID;
                })
            });
        };

        const pilotWays = variants.filter(function (v) {
            return v.PilotScope === PILOT;
        });
        variants
            .filter(function (v) {
                return v.PilotScope !== PILOT;
            })
            .forEach(function (v) {
                result.skipped.push({ kind: "WAY", id: v.Variant, name: v.VariantName, reason: "LATER" });
            });

        // 1. one end-to-end test case per pilot way
        const owners = new Set();
        pilotWays.forEach(function (variant) {
            const path = wayPath(steps, variant.Variant);
            const automated = planSteps(path);
            if (!automated.length) {
                result.skipped.push({ kind: "WAY", id: variant.Variant, name: variant.VariantName, reason: "NO_AUTOMATED_STEP" });
                return;
            }
            const team = automated[0].ResponsibleTeam || process.OwnerTeam || "";
            owners.add(team);
            propose({
                kind: "WAY",
                variant: variant,
                path: path,
                team: team,
                start: automated[0].BusinessObjectType,
                end: automated[automated.length - 1].BusinessObjectType,
                code: WAY_CODE[variant.Variant] || variant.Variant
            });
        });

        // 2. one sub-process test case per further team (entry without a predecessor preferred)
        if (input.teamSections !== false) {
            const ordered = pilotWays.filter(function (v) {
                return v.IsDefault;
            }).concat(
                pilotWays.filter(function (v) {
                    return !v.IsDefault;
                })
            );
            const teams = [];
            ordered.forEach(function (variant) {
                planSteps(wayPath(steps, variant.Variant)).forEach(function (step) {
                    if (step.ResponsibleTeam && step.TeamAssignment !== "OPEN" && teams.indexOf(step.ResponsibleTeam) === -1 && !owners.has(step.ResponsibleTeam)) {
                        teams.push(step.ResponsibleTeam);
                    }
                });
            });
            teams.forEach(function (team) {
                let chosen;
                let fallback;
                ordered.forEach(function (variant) {
                    if (chosen) {
                        return;
                    }
                    const path = wayPath(steps, variant.Variant);
                    const segment = teamSegment(path, team);
                    if (!segment) {
                        return;
                    }
                    const predecessorObject = requiredPredecessor(path, segment.start);
                    if (!predecessorObject) {
                        chosen = { variant: variant, path: path, segment: segment };
                    } else if (!fallback) {
                        fallback = { variant: variant, path: path, segment: segment, predecessorObject: predecessorObject };
                    }
                });
                const pick = chosen || fallback;
                if (!pick) {
                    return;
                }
                const firstOther = planSteps(pick.path).find(function (s) {
                    return s.ResponsibleTeam !== team;
                });
                propose({
                    kind: "TEAM",
                    variant: pick.variant,
                    path: pick.path,
                    team: team,
                    start: pick.segment.start,
                    end: pick.segment.end,
                    predecessorObject: pick.predecessorObject,
                    preconditions:
                        firstOther && planSteps(pick.path).indexOf(firstOther) < planSteps(pick.path).indexOf(pick.segment.steps[0])
                            ? "Übergabe vom " + (teamNames.get(firstOther.ResponsibleTeam) || firstOther.ResponsibleTeam) + ": " + (OBJECT_SHORT[documentsOf(planSteps(pick.path))[0]] || "Vorgängerbeleg") + " liegt vor."
                            : "",
                    code: String(team).replace(/^PT-/, "").toUpperCase()
                });
            });
        }
        return result;
    }

    /**
     * Test package over several processes (e.g. "every process of the next release"): processes without process steps are
     * reported, the others are planned with one shared data selection.
     *
     * @param {object} input like plan(), with processes (BusinessProcessVH rows) instead of process
     * @returns {{proposals: object[], skipped: object[], processes: object[]}} package
     */
    function planPackage(input) {
        const picker = createPicker(input);
        const result = { proposals: [], skipped: [], processes: [] };
        (input.processes || []).forEach(function (process) {
            const planned = plan(Object.assign({}, input, { process: process, picker: picker }));
            result.processes.push({ process: process, proposals: planned.proposals.length, modeled: !planned.skipped.some(function (s) { return s.kind === "PROCESS"; }) });
            result.proposals = result.proposals.concat(planned.proposals);
            result.skipped = result.skipped.concat(
                planned.skipped.map(function (s) {
                    return Object.assign({ process: process.ProcessID, processName: process.ProcessName }, s);
                })
            );
        });
        return result;
    }

    return {
        DEVICE_TYPES: DEVICE_TYPES,
        OBJECT_SHORT: OBJECT_SHORT,
        wayPath: wayPath,
        planSteps: planSteps,
        documentsOf: documentsOf,
        requiredPredecessor: requiredPredecessor,
        teamSegment: teamSegment,
        dataKind: dataKind,
        createPicker: createPicker,
        plan: plan,
        planPackage: planPackage
    };
});
