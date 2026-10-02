sap.ui.define(["./textMatching"], function (textMatching) {
    "use strict";

    /**
     * Master data search of the agent on the value help pools of the OData service (CustomerVH, FunctionalLocationVH,
     * EquipmentVH, ContactPersonVH, ServiceTeamVH, ProductVH). Pure module: the pools are read by the gateway.
     *
     * Devices are also found through their location: address and superior property, resident, floor, room and customer.
     * In the real system the search runs on the value help views ($search / contains); the ranking stays the same.
     */

    const MAX_HITS = 8;
    const DEVICE_TYPE_LABEL = { "MD-HKV": "Heizkostenverteiler", "MD-RWM": "Rauchwarnmelder", "MD-WZ": "Wasserzähler" };
    /** German names of the end objects ("Lauf bis") */
    const END_OBJECT_LABEL = {
        SERVICE_REQUEST: "Service Request",
        SERVICE_QUOTATION: "Angebot",
        SERVICE_ORDER: "Serviceauftrag",
        SERVICE_CONFIRMATION: "Rückmeldung",
        BILLING_DOC_REQUEST: "Fakturaanforderung",
        BILLING_DOCUMENT: "Faktura",
        ACCOUNTING_DOCUMENT: "Buchhaltungsbeleg (FI)"
    };

    function index(list, key) {
        const map = new Map();
        (list || []).forEach(function (entry) {
            map.set(entry[key], entry);
        });
        return map;
    }

    /**
     * @param {object} pools value help pools
     * @returns {object} search API: search(type, text, customer), describe(field, id), lookups
     */
    function createMasterData(pools) {
        const customers = index(pools.customers, "Customer");
        const locations = index(pools.functionalLocations, "FunctionalLocation");
        const products = index(pools.products, "Product");
        const organizations = index(pools.serviceOrganizations, "ServiceOrganization");

        const customerText = function (id) {
            const c = customers.get(id);
            return c ? id + " " + c.CustomerName + " " + c.CityName : id || "";
        };
        const locationText = function (id) {
            const fl = locations.get(id);
            if (!fl) {
                return id || "";
            }
            const superior = fl.SuperiorFunctionalLocation ? locations.get(fl.SuperiorFunctionalLocation) : undefined;
            return [fl.FunctionalLocation, fl.FunctionalLocationName, superior ? superior.FunctionalLocationName : ""].join(" ");
        };
        const deviceType = function (material) {
            const product = products.get(material);
            return product ? DEVICE_TYPE_LABEL[product.ProductGroup] || product.ProductDescription : "";
        };

        const TYPES = {
            geraet: {
                pool: pools.equipments,
                text: function (e) {
                    return [e.Equipment, e.EquipmentName, e.SerialNumber, e.Material, deviceType(e.Material), locationText(e.FunctionalLocation), customerText(e.Customer)].join(" ");
                },
                hit: function (e) {
                    return {
                        id: e.Equipment,
                        bezeichnung: e.EquipmentName,
                        geraetetyp: e.Material,
                        nutzeinheit: e.FunctionalLocation + " (" + ((locations.get(e.FunctionalLocation) || {}).FunctionalLocationName || "") + ")",
                        liegenschaft: ((locations.get((locations.get(e.FunctionalLocation) || {}).SuperiorFunctionalLocation) || {}).FunctionalLocationName) || "",
                        kunde: e.Customer
                    };
                }
            },
            nutzeinheit: {
                pool: (pools.functionalLocations || []).filter(function (f) {
                    return f.SuperiorFunctionalLocation;
                }),
                text: function (f) {
                    return locationText(f.FunctionalLocation) + " " + customerText(f.Customer);
                },
                hit: function (f) {
                    return {
                        id: f.FunctionalLocation,
                        bezeichnung: f.FunctionalLocationName,
                        liegenschaft: ((locations.get(f.SuperiorFunctionalLocation) || {}).FunctionalLocationName) || "",
                        kunde: f.Customer
                    };
                }
            },
            liegenschaft: {
                pool: (pools.functionalLocations || []).filter(function (f) {
                    return !f.SuperiorFunctionalLocation;
                }),
                text: function (f) {
                    return f.FunctionalLocation + " " + f.FunctionalLocationName + " " + customerText(f.Customer);
                },
                hit: function (f) {
                    return { id: f.FunctionalLocation, bezeichnung: f.FunctionalLocationName, kunde: f.Customer };
                }
            },
            kunde: {
                pool: pools.customers,
                text: function (c) {
                    return customerText(c.Customer);
                },
                hit: function (c) {
                    return { id: c.Customer, bezeichnung: c.CustomerName, ort: c.CityName };
                }
            },
            ansprechpartner: {
                pool: pools.contacts,
                text: function (c) {
                    return c.BusinessPartner + " " + c.BusinessPartnerFullName + " " + customerText(c.Customer);
                },
                hit: function (c) {
                    return { id: c.BusinessPartner, bezeichnung: c.BusinessPartnerFullName, kunde: c.Customer };
                }
            },
            serviceteam: {
                pool: pools.serviceTeams,
                text: function (t) {
                    const org = organizations.get(t.ServiceOrganization);
                    return [t.RespyMgmtServiceTeam, t.RespyMgmtServiceTeamName, t.ServiceOrganization, org ? org.ServiceOrganizationName : ""].join(" ");
                },
                hit: function (t) {
                    return { id: t.RespyMgmtServiceTeam, bezeichnung: t.RespyMgmtServiceTeamName, serviceorganisation: t.ServiceOrganization };
                }
            },
            servicevertrag: {
                pool: pools.serviceContracts,
                text: function (c) {
                    return [c.ServiceContract, c.ServiceContractDescription, "Vertrag Servicevertrag Wartungsvertrag", locationText(c.ServiceRefFunctionalLocation), customerText(c.SoldToParty)].join(" ");
                },
                hit: function (c) {
                    return {
                        id: c.ServiceContract,
                        bezeichnung: c.ServiceContractDescription,
                        kunde: c.SoldToParty,
                        objekt: c.ServiceRefFunctionalLocation,
                        gueltig: (c.ServiceContractStartDate || "") + " bis " + (c.ServiceContractEndDate || ""),
                        freigegeben: c.ServiceContractIsReleased === true
                    };
                }
            },
            produkt: {
                pool: pools.products,
                text: function (p) {
                    return [p.Product, p.ProductDescription, p.ProductType === "SERV" ? "Leistung Service" : p.ProductType === "ERSA" ? "Ersatzteil Ersatzgeraet" : "Geraet", p.ProductGroup, DEVICE_TYPE_LABEL[p.ProductGroup] || ""].join(" ");
                },
                hit: function (p) {
                    return { id: p.Product, bezeichnung: p.ProductDescription, produkttyp: p.ProductType, produktgruppe: p.ProductGroup || "", einheit: p.BaseUnit };
                }
            }
        };

        /**
         * @param {string} type geraet | nutzeinheit | liegenschaft | kunde | ansprechpartner | serviceteam | servicevertrag | produkt
         * @param {string} text search terms
         * @param {string} [customer] only entries of this customer
         * @returns {object} hits (best first) and whether the best hit is unambiguous
         */
        function search(type, text, customer) {
            const definition = TYPES[type];
            if (!definition) {
                throw new Error("Unbekannter Suchtyp " + type + ". Erlaubt: " + Object.keys(TYPES).join(", "));
            }
            const pool = (definition.pool || []).filter(function (entry) {
                return !customer || !("Customer" in entry) || entry.Customer === customer;
            });
            const ranked = textMatching.rank(pool, text, definition.text, MAX_HITS);
            return {
                typ: type,
                suchtext: text,
                treffer: ranked.map(function (r) {
                    return Object.assign(definition.hit(r.entry), { passend: r.matched + "/" + textMatching.tokens(text).length });
                }),
                eindeutig: ranked.length === 1 || (ranked.length > 1 && ranked[0].score > ranked[1].score)
            };
        }

        /** readable text of a value, e.g. "HKV-0815-031 · Heizkostenverteiler Wohnzimmer" */
        function describe(field, id) {
            if (id === null || id === undefined || id === "") {
                return "";
            }
            const find = function (list, key) {
                return (list || []).find(function (e) {
                    return String(e[key]) === String(id);
                });
            };
            let text;
            switch (field) {
                case "SoldToParty":
                    text = (find(pools.customers, "Customer") || {}).CustomerName;
                    break;
                case "ServiceRequestReporter":
                    text = (find(pools.contacts, "BusinessPartner") || {}).BusinessPartnerFullName;
                    break;
                case "ServiceRefFunctionalLocation": {
                    const fl = locations.get(id);
                    const superior = fl && locations.get(fl.SuperiorFunctionalLocation);
                    text = fl ? (superior ? superior.FunctionalLocationName + ", " : "") + fl.FunctionalLocationName : undefined;
                    break;
                }
                case "ServiceReferenceEquipment":
                    text = (find(pools.equipments, "Equipment") || {}).EquipmentName;
                    break;
                case "ReferenceProduct":
                case "ServiceProduct":
                case "ServicePart":
                    text = (products.get(id) || {}).ProductDescription;
                    break;
                case "RespyMgmtServiceTeam":
                    text = (find(pools.serviceTeams, "RespyMgmtServiceTeam") || {}).RespyMgmtServiceTeamName;
                    break;
                case "ServiceOrganization":
                    text = (organizations.get(id) || {}).ServiceOrganizationName;
                    break;
                case "ServiceDocumentPriority":
                    text = (find(pools.priorities, "ServiceDocumentPriority") || {}).ServiceDocumentPriorityName;
                    break;
                case "ProcessProfile":
                    text = (find(pools.processProfiles, "ProcessProfile") || {}).ProcessProfileName;
                    break;
                case "ProcessTeam":
                    text = (find(pools.processTeams, "ProcessTeam") || {}).ProcessTeamName;
                    break;
                case "BusinessProcess":
                    text = (find(pools.processes, "ProcessID") || {}).ProcessName;
                    break;
                case "ProcessVariant":
                    text = (find(pools.variants, "Variant") || {}).VariantName;
                    break;
                case "EndObject":
                    // the German name is enough ("bis Faktura")
                    return END_OBJECT_LABEL[id] || String(id);
                case "ServiceContract":
                    text = (find(pools.serviceContracts, "ServiceContract") || {}).ServiceContractDescription;
                    break;
                default:
                    text = undefined;
            }
            return text ? id + " · " + text : String(id);
        }

        return { search: search, describe: describe, types: Object.keys(TYPES), pools: pools };
    }

    return { createMasterData: createMasterData, DEVICE_TYPE_LABEL: DEVICE_TYPE_LABEL, END_OBJECT_LABEL: END_OBJECT_LABEL };
});
