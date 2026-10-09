'use strict';
/**
 * Generates additional FICTIONAL metering-service master data (Messdienst) into the value help files of the mock service
 * (webapp/localService/mainService/data/*VH.json): property managers in six cities with their contact persons, properties
 * (Liegenschaften) with usage units (Nutzeinheiten) and devices (heat cost allocators, smoke alarms, hot water meters),
 * regional service teams and service contracts (smoke alarm service with an annual billing plan, device rental; one
 * expired and one unreleased contract for negative tests).
 *
 * All names, addresses and numbers are invented ("Beispiel", "Probe", "Exempla", "Test" in the company names); nothing
 * refers to a real company or person. Surnames and street names are chosen so that they do not collide with the
 * hand-written master data (Musterstraße 12, Lindenallee 5, Parkweg 7 and their residents) the examples and E2E tests use.
 *
 * Deterministic and idempotent: rows of earlier runs (generated key ranges) are replaced, hand-written rows stay.
 * Run before the seed: node tools/seed/generate-masterdata.js && node tools/seed/generate-seed.js
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../webapp/localService/mainService/data');

/** generated key ranges (everything else in the files is hand-written and stays untouched) */
const GENERATED = {
    CustomerVH: (row) => /^MD-2\d{5}$/.test(row.Customer),
    ContactPersonVH: (row) => /^MD-CP-4\d{3}$/.test(row.BusinessPartner),
    FunctionalLocationVH: (row) => /^LG-5\d{3}(-NE\d{2})?$/.test(row.FunctionalLocation),
    EquipmentVH: (row) => /^(HKV|RWM|WZ)-5\d{3}-\d{3}$/.test(row.Equipment),
    ServiceTeamVH: (row) => /^MD-TEAM-(BRE|BER|FRA|STR|HAJ|DRS)$/.test(row.RespyMgmtServiceTeam),
    ServiceOrganizationVH: (row) => row.ServiceOrganization === 'SO-MD-NORD',
    ServiceContractVH: (row) => /^41000001\d{2}$/.test(row.ServiceContract)
};

const SERVICE_ORGANIZATIONS = [{ ServiceOrganization: 'SO-MD-NORD', ServiceOrganizationName: 'Serviceorganisation Messdienst Nord', SalesOrganization: '2010' }];

/**
 * regional technician teams; the service team of a report is derived from the city of the customer (team name contains the
 * city) — no city of the H2 field service teams (Hamburg, Rostock), so the derivation stays unique
 */
const SERVICE_TEAMS = [
    ['MD-TEAM-BRE', 'Monteurteam Bremen', 'SO-MD-NORD'],
    ['MD-TEAM-BER', 'Monteurteam Berlin', 'SO-MD-OST'],
    ['MD-TEAM-FRA', 'Monteurteam Frankfurt am Main', 'SO-MD-WEST'],
    ['MD-TEAM-STR', 'Monteurteam Stuttgart', 'SO-MD-SUED'],
    ['MD-TEAM-HAJ', 'Monteurteam Hannover', 'SO-MD-NORD'],
    ['MD-TEAM-DRS', 'Monteurteam Dresden', 'SO-MD-OST']
];

/**
 * Customers (property managers) with contact persons and properties. A property lists its usage units [location, resident]
 * and its service contracts: RWM = smoke alarm service (annual billing plan), HKV = device rental of the heat cost
 * allocators (monthly), RWM_EXPIRED = expired smoke alarm contract, RWM_PREPARED = smoke alarm contract not yet released.
 */
const CUSTOMERS = [
    {
        id: 'MD-200010',
        name: 'Hausverwaltung Beispielhof GmbH',
        city: 'Bremen',
        contacts: [
            ['MD-CP-4011', 'Sabine', 'Krämer'],
            ['MD-CP-4012', 'Oliver', 'Seidel']
        ],
        properties: [
            {
                id: 'LG-5101',
                street: 'Ahornweg 3',
                zip: '28195',
                plant: '2140',
                units: [
                    ['EG links', 'Kowalski'],
                    ['EG rechts', 'Schulz'],
                    ['1. OG links', 'Öztürk']
                ],
                contracts: ['RWM', 'HKV']
            },
            {
                id: 'LG-5102',
                street: 'Birkenhof 21',
                zip: '28217',
                plant: '2140',
                units: [
                    ['EG', 'Lorenz'],
                    ['1. OG', 'Peters'],
                    ['2. OG', 'Reuter']
                ],
                contracts: ['RWM_EXPIRED']
            }
        ]
    },
    {
        id: 'MD-200020',
        name: 'Wohnungsgenossenschaft Probestadt eG',
        city: 'Berlin',
        contacts: [
            ['MD-CP-4021', 'Katrin', 'Ebert'],
            ['MD-CP-4022', 'Dennis', 'Albrecht']
        ],
        properties: [
            {
                id: 'LG-5201',
                street: 'Kastanienstraße 8',
                zip: '10115',
                plant: '2150',
                units: [
                    ['EG links', 'Krüger'],
                    ['EG rechts', 'Neumann'],
                    ['1. OG links', 'Albers']
                ],
                contracts: ['RWM']
            },
            {
                id: 'LG-5202',
                street: 'Ulmenring 5',
                zip: '12043',
                plant: '2150',
                units: [
                    ['EG', 'Dietrich'],
                    ['1. OG', 'Engelke'],
                    ['2. OG', 'Grabowski']
                ],
                contracts: []
            }
        ]
    },
    {
        id: 'MD-200030',
        name: 'Immobilienverwaltung Beispielgarten GmbH',
        city: 'Frankfurt am Main',
        contacts: [
            ['MD-CP-4031', 'Monika', 'Fuchs'],
            ['MD-CP-4032', 'Tobias', 'Hensel']
        ],
        properties: [
            {
                id: 'LG-5301',
                street: 'Erlenstraße 30',
                zip: '60311',
                plant: '2160',
                units: [
                    ['EG', 'Hartmann'],
                    ['1. OG', 'Schmitt'],
                    ['2. OG', 'Heinze']
                ],
                contracts: ['RWM_PREPARED']
            }
        ]
    },
    {
        id: 'MD-200040',
        name: 'WEG Am Testpark 4',
        city: 'Stuttgart',
        contacts: [
            ['MD-CP-4041', 'Elif', 'Kaya'],
            ['MD-CP-4042', 'Martin', 'Pohl']
        ],
        properties: [
            {
                id: 'LG-5401',
                street: 'Am Eichenpark 14',
                zip: '70173',
                plant: '2170',
                units: [
                    ['EG links', 'Jansen'],
                    ['EG rechts', 'Kühn'],
                    ['1. OG', 'Marquardt']
                ],
                contracts: ['RWM', 'HKV']
            }
        ]
    },
    {
        id: 'MD-200050',
        name: 'Hausverwaltung Exempla KG',
        city: 'Hannover',
        contacts: [
            ['MD-CP-4051', 'Julia', 'Wiegand'],
            ['MD-CP-4052', 'Frank', 'Ludwig']
        ],
        properties: [
            {
                id: 'LG-5501',
                street: 'Weidenweg 11',
                zip: '30159',
                plant: '2140',
                units: [
                    ['EG', 'Petrović'],
                    ['1. OG', 'Quast'],
                    ['2. OG', 'Thiel']
                ],
                contracts: ['RWM']
            }
        ]
    },
    {
        id: 'MD-200060',
        name: 'Siedlungswerk Beispieltal eG',
        city: 'Dresden',
        contacts: [
            ['MD-CP-4061', 'Birgit', 'Lehnert'],
            ['MD-CP-4062', 'Ralf', 'Winkler']
        ],
        properties: [
            {
                id: 'LG-5601',
                street: 'Ebereschenplatz 2',
                zip: '01067',
                plant: '2150',
                units: [
                    ['EG links', 'Voigt'],
                    ['EG rechts', 'Wendt'],
                    ['1. OG', 'Ziegler']
                ],
                contracts: ['HKV']
            }
        ]
    }
];

const DEVICE = {
    HKV: { prefix: 'HKV', serial: '2', material: 'MD-HKV-FUNK', label: 'Heizkostenverteiler' },
    RWM: { prefix: 'RWM', serial: '4', material: 'MD-RWM-FUNK', label: 'Rauchwarnmelder' },
    WZ: { prefix: 'WZ', serial: '6', material: 'MD-WZ-FUNK', label: 'Warmwasserzähler' }
};

/** devices of the n-th usage unit of a property (1-based): rooms per device type */
function devicesOfUnit(n) {
    return {
        HKV: ['Wohnzimmer', 'Schlafzimmer', ...(n === 2 ? ['Küche'] : n === 3 ? ['Arbeitszimmer'] : [])],
        RWM: ['Schlafzimmer', 'Flur', ...(n === 2 ? ['Kinderzimmer'] : [])],
        WZ: ['Bad']
    };
}

const CONTRACTS = {
    RWM: { product: 'MD-SRV-RWM-VTR', title: 'RWM-Service', start: '2025-01-01', end: '2027-12-31', released: true, rule: 'jährlich im Voraus (Jahrespauschale)', perDevice: 9.9, device: 'RWM' },
    HKV: { product: 'MD-SRV-HKV-VTR', title: 'Gerätemiete HKV', start: '2025-07-01', end: '2028-06-30', released: true, rule: 'monatlich', perDevice: 1.75, device: 'HKV' },
    RWM_EXPIRED: { product: 'MD-SRV-RWM-VTR', title: 'RWM-Service', suffix: ' (abgelaufen)', start: '2023-01-01', end: '2026-03-31', released: true, rule: 'jährlich im Voraus (Jahrespauschale)', perDevice: 9.9, device: 'RWM' },
    RWM_PREPARED: { product: 'MD-SRV-RWM-VTR', title: 'RWM-Service', suffix: ' (in Vorbereitung)', start: '2027-01-01', end: '2029-12-31', released: false, rule: 'jährlich im Voraus (Jahrespauschale)', perDevice: 9.9, device: 'RWM' }
};

function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function generate() {
    const rows = {
        CustomerVH: [],
        ContactPersonVH: [],
        FunctionalLocationVH: [],
        EquipmentVH: [],
        ServiceTeamVH: SERVICE_TEAMS.map(([id, name, org]) => ({ RespyMgmtServiceTeam: id, RespyMgmtServiceTeamName: name, ServiceOrganization: org })),
        ServiceOrganizationVH: SERVICE_ORGANIZATIONS.map((org) => ({ ...org })),
        ServiceContractVH: []
    };
    let contractNo = 100;
    for (const customer of CUSTOMERS) {
        rows.CustomerVH.push({ Customer: customer.id, CustomerName: customer.name, CityName: customer.city, Country: 'DE' });
        for (const [id, first, last] of customer.contacts) {
            rows.ContactPersonVH.push({ BusinessPartner: id, BusinessPartnerFullName: `${first} ${last}`, FirstName: first, LastName: last, Customer: customer.id });
        }
        for (const property of customer.properties) {
            const digits = property.id.slice(3);
            rows.FunctionalLocationVH.push({
                FunctionalLocation: property.id,
                FunctionalLocationName: `${property.street}, ${property.zip} ${customer.city}`,
                Customer: customer.id,
                MaintenancePlant: property.plant,
                SuperiorFunctionalLocation: ''
            });
            const count = { HKV: 0, RWM: 0, WZ: 0 };
            property.units.forEach(([location, resident], index) => {
                const unitNo = String(index + 1).padStart(2, '0');
                const unit = `${property.id}-NE${unitNo}`;
                rows.FunctionalLocationVH.push({
                    FunctionalLocation: unit,
                    FunctionalLocationName: `NE ${unitNo} · ${location} · Nutzer ${resident}`,
                    Customer: customer.id,
                    MaintenancePlant: property.plant,
                    SuperiorFunctionalLocation: property.id
                });
                const devices = devicesOfUnit(index + 1);
                for (const type of ['HKV', 'RWM', 'WZ']) {
                    devices[type].forEach((room, position) => {
                        const device = DEVICE[type];
                        // like the hand-written devices: <type>-<property>-<unit><position>, serial <type digit><property><unit><position>
                        const suffix = `${unitNo}${position + 1}`;
                        rows.EquipmentVH.push({
                            Equipment: `${device.prefix}-${digits}-${suffix}`,
                            EquipmentName: `${device.label} ${room}`,
                            FunctionalLocation: unit,
                            Material: device.material,
                            SerialNumber: `${device.serial}${digits}${suffix}`,
                            Customer: customer.id
                        });
                        count[type]++;
                    });
                }
            });
            for (const kind of property.contracts) {
                const contract = CONTRACTS[kind];
                contractNo++;
                rows.ServiceContractVH.push({
                    ServiceContract: String(4100000000 + contractNo),
                    ServiceContractDescription: `${contract.title} ${property.street}${contract.suffix || ''}`,
                    SoldToParty: customer.id,
                    ServiceRefFunctionalLocation: property.id,
                    Product: contract.product,
                    ServiceContractStartDate: contract.start,
                    ServiceContractEndDate: contract.end,
                    ServiceContractIsReleased: contract.released,
                    BillingPlanRule: contract.rule,
                    BillingPlanNetAmount: round2(count[contract.device] * contract.perDevice),
                    TransactionCurrency: 'EUR'
                });
            }
        }
    }
    return rows;
}

function main() {
    const generated = generate();
    for (const [set, isGenerated] of Object.entries(GENERATED)) {
        const file = path.join(DATA_DIR, `${set}.json`);
        const handWritten = JSON.parse(fs.readFileSync(file, 'utf8')).filter((row) => !isGenerated(row));
        const all = [...handWritten, ...generated[set]];
        fs.writeFileSync(file, `${JSON.stringify(all, null, 4)}\n`);
        console.log(`${set}.json: ${handWritten.length} hand-written + ${generated[set].length} generated rows`);
    }
}

if (require.main === module) {
    main();
}

module.exports = { generate, CUSTOMERS, SERVICE_TEAMS };
