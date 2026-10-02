'use strict';
/**
 * Seed definition of the process teams, business processes and releases (mock data, fictional).
 *
 * Process teams follow the currently known processes: repair, installation, quotation, meter reading.
 * Only the service repair process is modeled in the mockup (pilot: standard service path, three ways from the process
 * picture). Warranty, requote, in-house repair and the solution quotation are later API extensions (not executable).
 * Team assignments that are not confirmed are marked ASSUMED (to be confirmed) or OPEN (no team known yet).
 *
 * Release dates of SAP are planning information from public sources (⚠ NOCH ZU VERIFIZIEREN, see
 * docs/prozessteams-releases.md); internal releases are examples of the release cadence of the process teams.
 */

const TEAMS = [
    {
        ProcessTeam: 'PT-REPARATUR',
        ProcessTeamName: 'Prozessteam Reparatur',
        ProcessArea: 'Service – Reparatur',
        Description: 'Verantwortet den Service-Reparaturprozess (Pilot): Störungsmeldung, Auftrag, Durchführung und Rückmeldung.'
    },
    {
        ProcessTeam: 'PT-ANGEBOT',
        ProcessTeamName: 'Prozessteam Angebot',
        ProcessArea: 'Vertrieb – Angebot',
        Description: 'Verantwortet den Angebotsprozess. Im Reparaturprozess Übergabe bei Weg 2 (Service Quotation, Kundenentscheidung) – Zuordnung ist eine Annahme.'
    },
    {
        ProcessTeam: 'PT-MONTAGE',
        ProcessTeamName: 'Prozessteam Montage',
        ProcessArea: 'Service – Montage',
        Description: 'Verantwortet den Montageprozess (Erst- und Austauschmontage). Prozessschritte noch nicht modelliert.'
    },
    {
        ProcessTeam: 'PT-ABLESUNG',
        ProcessTeamName: 'Prozessteam Ablesung',
        ProcessArea: 'Messdienst – Ablesung',
        Description: 'Verantwortet die Ablesung (messdienstspezifisch). Prozessschritte und Abbildung im SAP-System noch offen.'
    }
];

// [team, user, role, note] — business responsibility and execution authorization are separate rows
const MEMBERS = [
    ['PT-REPARATUR', 'REP_LEAD', 'PROCESS_OWNER', 'Teamleitung'],
    ['PT-REPARATUR', 'QA_LEAD', 'PROCESS_OWNER', 'Zweite Prozessverantwortung (Vier-Augen-Freigaben)'],
    ['PT-REPARATUR', 'DEMO_USER', 'PROCESS_OWNER', 'Mockup-Benutzer: fachliche Verantwortung'],
    ['PT-REPARATUR', 'DEMO_USER', 'TEST_EXECUTOR', 'Mockup-Benutzer: Ausführungsberechtigung'],
    ['PT-REPARATUR', 'REP_TESTER', 'TEST_EXECUTOR', ''],
    ['PT-ANGEBOT', 'ANG_LEAD', 'PROCESS_OWNER', 'Teamleitung'],
    ['PT-ANGEBOT', 'ANG_TESTER', 'TEST_EXECUTOR', ''],
    ['PT-MONTAGE', 'MON_LEAD', 'PROCESS_OWNER', 'Teamleitung'],
    ['PT-MONTAGE', 'MON_TESTER', 'TEST_EXECUTOR', ''],
    ['PT-ABLESUNG', 'ABL_LEAD', 'PROCESS_OWNER', 'Teamleitung'],
    ['PT-ABLESUNG', 'ABL_TESTER', 'TEST_EXECUTOR', '']
];

const REPAIR = 'SRV-REP';

/** Variants (ways through the process picture) of the service repair process: [code, name, pilot scope, default, description, version] */
const REPAIR_VARIANTS = [
    ['W1_REQUEST', 'Weg 1 – Service Request ohne Angebot', 'PILOT', false, 'Kundenanliegen → Service Request → Service Order → Durchführung → Rückmeldung → Faktura.', 1],
    ['W2_QUOTATION', 'Weg 2 – Angebot, Kunde akzeptiert', 'PILOT', true, 'Service Request → Service Quotation → Kunde akzeptiert → Service Order → … → Faktura (Golden Path).', 1],
    ['W2_REJECTED', 'Weg 2 – Angebot, Kunde lehnt ab', 'PILOT', false, 'Service Request → Service Quotation → Kunde lehnt ab: Prozessende ohne Auftrag.', 1],
    ['W3_CONTRACT', 'Weg 3 – Serviceleistung aus Vertrag (Vertragsfindung)', 'PILOT', false, 'Service Contract → Vertragsfindung → Service Order → Durchführung → Rückmeldung → Faktura.', 2],
    ['W3_BILLING_PLAN', 'Weg 3 – Vertragsabrechnung über Rechnungsplan', 'PILOT', false, 'Service Contract → Rechnungsplan → Billing Document Request → Faktura.', 2],
    ['WARRANTY', 'Garantie (spätere API-Erweiterung)', 'LATER', false, 'Garantieprüfung im Reparaturprozess – nicht im Pilot.', 2],
    ['REQUOTE', 'Requote (spätere API-Erweiterung)', 'LATER', false, 'Angebot überarbeiten und erneut senden – nicht im Pilot.', 2],
    ['IN_HOUSE_REPAIR', 'In-House Repair (spätere API-Erweiterung)', 'LATER', false, 'Reparatur im Werk – nicht im Pilot.', 2],
    ['SOLUTION_QUOTATION', 'Solution Quotation (Produkte plus Services, später)', 'LATER', false, 'Im Prozessbild ausgegraut – nicht im Pilot.', 2]
];

const W1 = 'W1_REQUEST';
const W2 = 'W2_QUOTATION';
const W2R = 'W2_REJECTED';
const W3 = 'W3_CONTRACT';
const W3B = 'W3_BILLING_PLAN';

/**
 * Process steps of the service repair process:
 * [sequence, step ID, name, BO, expected status, team, team assignment, variants, pilot, automation, action, expected result, SAP reference, note, version]
 */
const REPAIR_STEPS = [
    [10, 'REP-010', 'Kundenanliegen als Service Request erfassen', 'SERVICE_REQUEST', 'Completed', 'PT-REPARATUR', 'ASSIGNED', [W1, W2, W2R, 'WARRANTY', 'REQUOTE', 'IN_HOUSE_REPAIR', 'SOLUTION_QUOTATION'], 'PILOT', 'AUTOMATED',
        'Service Request mit den Testdaten anlegen: Kunde, Referenzobjekt, Problembeschreibung, Priorität.', 'Service Request angelegt und abgeschlossen; Case ID als Kundenreferenz.', 'A_ServiceRequest (API_SERVICE_REQUEST_SRV)', '', 1],
    [20, 'REP-020', 'Entscheidung: Angebot nötig?', '', '', 'PT-REPARATUR', 'ASSIGNED', [W1, W2, W2R, 'REQUOTE', 'SOLUTION_QUOTATION'], 'PILOT', 'DECISION',
        'Entscheidung gemäß Prozessvariante: Nein → Weg 1 (Auftrag), Ja → Weg 2 (Angebot).', 'Pfad der Prozessvariante wird fortgesetzt.', '', 'Im Prozessbild zusätzlich „Ja, Produkte plus Services“ → Solution Quotation (später).', 1],
    [30, 'REP-030', 'Service Quotation anlegen und an den Kunden senden', 'SERVICE_QUOTATION', 'Released', 'PT-ANGEBOT', 'ASSUMED', [W2, W2R, 'REQUOTE'], 'PILOT', 'AUTOMATED',
        'Service Quotation zum Service Request mit Leistungs- und Ersatzteilposition anlegen und freigeben.', 'Angebot freigegeben; Nettowert gemäß Preisfindung.', 'A_ServiceQuotation (API_SERVICE_QUOTATION_SRV)', 'Teamzuordnung ist eine Annahme (Angebotsprozess) – fachlich zu bestätigen.', 1],
    [40, 'REP-040', 'Kunde akzeptiert das Angebot', 'SERVICE_QUOTATION', 'Accepted', 'PT-ANGEBOT', 'ASSUMED', [W2, 'REQUOTE'], 'PILOT', 'AUTOMATED',
        'Kundenentscheidung buchen: Angebot angenommen.', 'Angebot angenommen (Accepted); Folgeauftrag wird angelegt.', 'A_ServiceQuotation.ServiceQuotationIsAccepted', '', 1],
    [41, 'REP-041', 'Kunde lehnt das Angebot ab (Prozessende)', 'SERVICE_QUOTATION', 'Rejected', 'PT-ANGEBOT', 'ASSUMED', [W2R], 'PILOT', 'AUTOMATED',
        'Kundenentscheidung buchen: Angebot abgelehnt.', 'Angebot abgelehnt (Rejected); kein Folgeauftrag.', 'A_ServiceQuotation.ServiceQuotationIsRejected', '', 1],
    [50, 'REP-050', 'Vertragsfindung: gültigen Servicevertrag ermitteln', 'SERVICE_CONTRACT', 'Released', 'PT-REPARATUR', 'ASSUMED', [W3, W3B], 'PILOT', 'AUTOMATED',
        'Servicevertrag zum Referenzobjekt ermitteln: freigegeben, gültig, Objektliste deckt das Gerät ab.', 'Gültiger Servicevertrag ermittelt; sonst ist der Testlauf blockiert (Vorbedingung).', 'A_ServiceContract, A_ServiceContrItemObjectList (API_SERVICE_CONTRACT_SRV)', 'Verantwortung für Serviceverträge ist eine Annahme.', 2],
    [60, 'REP-060', 'Service Order anlegen (aus Request, Angebot oder Vertrag)', 'SERVICE_ORDER', 'Completed', 'PT-REPARATUR', 'ASSIGNED', [W1, W2, W3, 'WARRANTY', 'REQUOTE'], 'PILOT', 'AUTOMATED',
        'Service Order mit Leistungs- und Ersatzteilposition anlegen und freigeben; Referenz auf Vorgänger bzw. Vertrag.', 'Auftrag freigegeben, nach der Rückmeldung abgeschlossen; bei Weg 3 mit Vertragsreferenz.', 'A_ServiceOrder (OP_SERVICEORDER_0001; V2 API_SERVICE_ORDER_SRV)', '', 1],
    [70, 'REP-070', 'Durchführung durch Techniker oder SAP Field Service Management', '', '', 'PT-REPARATUR', 'ASSIGNED', [W1, W2, W3, 'WARRANTY', 'REQUOTE'], 'PILOT', 'MANUAL',
        'Einsatz vor Ort durchführen (Techniker bzw. SAP FSM).', 'Einsatz durchgeführt; Ergebnis über die Rückmeldung geprüft.', 'FSM-Integration (A_ServiceOrder.FSMServiceCall) ⚠', 'Im Pilot nicht automatisiert.', 1],
    [80, 'REP-080', 'Service Confirmation (Aufwand) buchen', 'SERVICE_CONFIRMATION', 'Completed', 'PT-REPARATUR', 'ASSIGNED', [W1, W2, W3, 'WARRANTY', 'REQUOTE'], 'PILOT', 'AUTOMATED',
        'Service Confirmation mit Ist-Dauer und Ersatzteil buchen und abschließen.', 'Rückmeldung abgeschlossen; Ist-Dauer = Plan-Dauer.', 'A_ServiceConfirmation (API_SERVICE_CONFIRMATION_SRV)', '', 1],
    [90, 'REP-090', 'Freigabe zur Fakturierung (Billing Document Request)', 'BILLING_DOC_REQUEST', 'Billed', '', 'OPEN', [W1, W2, W3, 'REQUOTE'], 'PILOT', 'AUTOMATED',
        'Freigabe zur Fakturierung: Fakturaanforderung aus der Rückmeldung (Aufwand) bzw. dem Auftrag (Festpreis) erzeugen.', 'Fakturaanforderung zum Vorgänger mit dem erwarteten Nettowert.', 'A_BillingDocumentRequest (API_BILLING_DOCUMENT_REQUEST_SRV); App „Release for Billing“', 'Verantwortliches Prozessteam offen.', 1],
    [95, 'REP-095', 'Rechnungsplan des Vertrags abrechnen (Billing Document Request)', 'BILLING_DOC_REQUEST', 'Billed', '', 'OPEN', [W3B], 'PILOT', 'AUTOMATED',
        'Fällige Rechnungsplanposition des Servicevertrags abrechnen.', 'Fakturaanforderung über den Rechnungsplanbetrag des Vertrags.', 'A_SrvcContrItmBillgReqItem (API_SERVICE_CONTRACT_SRV)', 'Verantwortliches Prozessteam offen.', 2],
    [100, 'REP-100', 'Faktura (SD) erzeugen', 'BILLING_DOCUMENT', 'Posted', '', 'OPEN', [W1, W2, W3, W3B, 'REQUOTE'], 'PILOT', 'AUTOMATED',
        'Faktura aus der Fakturaanforderung erzeugen.', 'Faktura gebucht; Nettowert = erwarteter Nettowert ± Toleranz.', 'A_BillingDocument (API_BILLING_DOCUMENT_SRV)', 'Verantwortliches Prozessteam offen.', 1],
    [110, 'REP-110', 'Buchhaltungsbeleg (FI) prüfen', 'ACCOUNTING_DOCUMENT', 'Posted', '', 'OPEN', [W1, W2, W3, W3B, 'REQUOTE'], 'PILOT', 'AUTOMATED',
        'Übergabe der Faktura an die Buchhaltung prüfen.', 'Buchhaltungsbeleg zur Faktura vorhanden.', 'A_BillingDocument.AccountingDocument; Lese-API Journal Entry ⚠', 'Optionales Endobjekt; verantwortliches Prozessteam offen.', 1],
    [15, 'REP-200', 'Garantieprüfung', '', '', 'PT-REPARATUR', 'ASSUMED', ['WARRANTY'], 'LATER', 'PLANNED',
        '', '', 'Garantieabwicklung im Serviceauftrag ⚠ API zu prüfen', 'Spätere API-Erweiterung.', 2],
    [35, 'REP-210', 'Requote: Angebot überarbeiten und erneut senden', 'SERVICE_QUOTATION', '', 'PT-ANGEBOT', 'ASSUMED', ['REQUOTE'], 'LATER', 'PLANNED',
        '', '', 'Requote ⚠ (laut Recherche ab SAP S/4HANA 2023 FPS02)', 'Spätere API-Erweiterung.', 2],
    [58, 'REP-220', 'In-House Repair (Reparatur im Werk)', '', '', 'PT-REPARATUR', 'ASSUMED', ['IN_HOUSE_REPAIR'], 'LATER', 'PLANNED',
        '', '', 'A_ServiceOrder.ReferenceInHouseRepair (VDM); In-House-Repair-API ⚠', 'Spätere API-Erweiterung.', 2],
    [32, 'REP-230', 'Solution Quotation (Produkte plus Services)', '', '', 'PT-ANGEBOT', 'ASSUMED', ['SOLUTION_QUOTATION'], 'LATER', 'PLANNED',
        '', '', 'Solution Quotation ⚠', 'Im Prozessbild ausgegraut: nicht im Pilot.', 2]
];

const PROCESSES = [
    {
        ProcessID: REPAIR,
        ProcessName: 'Service-Reparaturprozess',
        ProcessArea: 'Service',
        OwnerTeam: 'PT-REPARATUR',
        PilotScope: 'PILOT',
        Description:
            'Reparatur nach Kundenanliegen in drei Wegen: (1) Service Request ohne Angebot, (2) Angebot für eine Serviceleistung (Kunde akzeptiert oder lehnt ab), (3) Serviceleistung aus einem Vertrag (Vertragsfindung) bzw. Vertragsabrechnung über den Rechnungsplan. Abrechnung nach Aufwand (Rückmeldung) oder Festpreis (Auftrag).',
        SAPReference:
            'SAP S/4HANA Service: Service Request, Service Quotation, Service Order, Service Confirmation, Service Contract, Fakturaanforderung, Faktura (released APIs, siehe Prozessschritte). Scope Items im SAP Signavio Process Navigator ⚠ prüfen.',
        versions: [
            { at: '2026-03-02T09:00:00Z', note: 'Erstmodellierung: Wege 1 und 2 (Service Request, Angebot), Faktura und FI-Beleg.' },
            { at: '2026-09-14T09:00:00Z', note: 'Weg 3 ergänzt (Vertragsfindung, Rechnungsplan); spätere Erweiterungen Garantie, Requote, In-House Repair, Solution Quotation erfasst.' }
        ]
    },
    {
        ProcessID: 'MON',
        ProcessName: 'Montageprozess',
        ProcessArea: 'Service',
        OwnerTeam: 'PT-MONTAGE',
        PilotScope: 'LATER',
        Description: 'Erst- und Austauschmontage von Messgeräten und Rauchwarnmeldern. Prozessschritte noch nicht modelliert (Zuordnung offen).',
        SAPReference: 'Offen.',
        versions: [{ at: '2026-03-02T09:00:00Z', note: 'Prozess angelegt; Schritte offen.' }]
    },
    {
        ProcessID: 'ANG',
        ProcessName: 'Angebotsprozess',
        ProcessArea: 'Vertrieb',
        OwnerTeam: 'PT-ANGEBOT',
        PilotScope: 'LATER',
        Description: 'Angebotserstellung und Kundenentscheidung. Schnittstelle zum Service-Reparaturprozess über Weg 2 (REP-030, REP-040, REP-041). Eigene Prozessschritte noch nicht modelliert.',
        SAPReference: 'Offen.',
        versions: [{ at: '2026-03-02T09:00:00Z', note: 'Prozess angelegt; Schritte offen.' }]
    },
    {
        ProcessID: 'ABL',
        ProcessName: 'Ablesung',
        ProcessArea: 'Messdienst',
        OwnerTeam: 'PT-ABLESUNG',
        PilotScope: 'LATER',
        Description: 'Ablesung von Heizkostenverteilern und Zählern für die Verbrauchsabrechnung (messdienstspezifisch). Prozessschritte und Abbildung im SAP-System offen.',
        SAPReference: 'Offen.',
        versions: [{ at: '2026-03-02T09:00:00Z', note: 'Prozess angelegt; Schritte offen.' }]
    }
];

const SAP_SOURCE = 'SAP-Termine: öffentliche Release-Informationen (Stand Recherche 10/2026), ⚠ unverbindlich – vor der Planung in SAP for Me bzw. der Release Information Note prüfen.';
const INTERNAL_SOURCE = 'Interner Release-Kalender der Prozessteams (Beispiel, fiktiv).';

const RELEASES = [
    {
        ReleaseID: 'S4-2025-FPS01',
        ReleaseName: 'SAP S/4HANA 2025 FPS01',
        ReleaseType: 'SAP_FPS',
        SAPProductVersion: 'SAP S/4HANA 2025',
        FeaturePackStack: 'FPS01',
        ReleaseStatus: 'RELEASED',
        SAPAvailabilityDate: '2026-02-25',
        TestStartDate: '2026-03-02',
        TestEndDate: '2026-03-27',
        GoLiveDate: '2026-04-11',
        PredecessorRelease: '',
        AutoRegression: true,
        Description: 'Produktiver Stand (Annahme für das Mockup). Vor Einführung des Testassistenten: keine Läufe im Mockup.',
        SourceNote: SAP_SOURCE
    },
    {
        ReleaseID: 'INT-2026.10',
        ReleaseName: 'Prozessrelease Oktober 2026',
        ReleaseType: 'INTERNAL',
        SAPProductVersion: 'SAP S/4HANA 2025',
        FeaturePackStack: 'FPS01',
        ReleaseStatus: 'IN_TEST',
        SAPAvailabilityDate: null,
        TestStartDate: '2026-09-28',
        TestEndDate: '2026-10-16',
        GoLiveDate: '2026-10-19',
        PredecessorRelease: 'S4-2025-FPS01',
        AutoRegression: true,
        Description: 'Interner Release der Prozessteams (DevOps): Änderungen der Teams auf Basis FPS01, Regression je Team und Prozess.',
        SourceNote: INTERNAL_SOURCE
    },
    {
        ReleaseID: 'S4-2025-FPS02',
        ReleaseName: 'SAP S/4HANA 2025 FPS02',
        ReleaseType: 'SAP_FPS',
        SAPProductVersion: 'SAP S/4HANA 2025',
        FeaturePackStack: 'FPS02',
        ReleaseStatus: 'PLANNED',
        SAPAvailabilityDate: '2026-10-28',
        TestStartDate: '2026-11-02',
        TestEndDate: '2026-11-27',
        GoLiveDate: '2026-12-05',
        PredecessorRelease: 'INT-2026.10',
        AutoRegression: true,
        Description: 'Feature Package Stack 02: Regression des gesamten Scopes nach dem Upgrade. Scope über „Copy Scope from Predecessor“ übernehmen.',
        SourceNote: SAP_SOURCE
    },
    {
        ReleaseID: 'INT-2026.12',
        ReleaseName: 'Prozessrelease Dezember 2026',
        ReleaseType: 'INTERNAL',
        SAPProductVersion: 'SAP S/4HANA 2025',
        FeaturePackStack: 'FPS02',
        ReleaseStatus: 'PLANNED',
        SAPAvailabilityDate: null,
        TestStartDate: '2026-12-07',
        TestEndDate: '2026-12-18',
        GoLiveDate: '2026-12-21',
        PredecessorRelease: 'S4-2025-FPS02',
        AutoRegression: true,
        Description: 'Interner Release der Prozessteams auf Basis FPS02.',
        SourceNote: INTERNAL_SOURCE
    },
    {
        ReleaseID: 'S4-2025-FPS03',
        ReleaseName: 'SAP S/4HANA 2025 FPS03',
        ReleaseType: 'SAP_FPS',
        SAPProductVersion: 'SAP S/4HANA 2025',
        FeaturePackStack: 'FPS03',
        ReleaseStatus: 'PLANNED',
        SAPAvailabilityDate: '2027-02-24',
        TestStartDate: '2027-03-01',
        TestEndDate: '2027-03-26',
        GoLiveDate: '2027-04-10',
        PredecessorRelease: 'INT-2026.12',
        AutoRegression: true,
        Description: 'Letzter Feature Package Stack des Releases 2025; danach Support Package Stacks (SPS04 ff.).',
        SourceNote: SAP_SOURCE
    },
    {
        ReleaseID: 'S4-2027',
        ReleaseName: 'SAP S/4HANA 2027 (Upgrade)',
        ReleaseType: 'SAP_RELEASE',
        SAPProductVersion: 'SAP S/4HANA 2027',
        FeaturePackStack: 'Initial',
        ReleaseStatus: 'PLANNED',
        SAPAvailabilityDate: '2027-10-13',
        TestStartDate: '2028-01-10',
        TestEndDate: '2028-03-03',
        GoLiveDate: '2028-03-18',
        PredecessorRelease: 'S4-2025-FPS03',
        AutoRegression: true,
        Description: 'Nächstes Release im Zwei-Jahres-Zyklus: Upgrade-Projekt mit vollständiger Regression.',
        SourceNote: SAP_SOURCE
    }
];

// [release, team, process, process version, regression relevant, note]
const SCOPES = [
    ['S4-2025-FPS01', 'PT-REPARATUR', REPAIR, 1, true, 'Ausgangsstand'],
    ['INT-2026.10', 'PT-REPARATUR', REPAIR, 2, true, 'Teilprozess Reparatur und E2E-Wege 1–3'],
    ['INT-2026.10', 'PT-ANGEBOT', REPAIR, 2, true, 'Übergabe Weg 2: Angebot und Kundenentscheidung'],
    ['INT-2026.10', 'PT-ANGEBOT', 'ANG', 1, false, 'Angebotsprozess noch nicht modelliert'],
    ['INT-2026.10', 'PT-MONTAGE', 'MON', 1, false, 'Montageprozess noch nicht modelliert'],
    ['INT-2026.10', 'PT-ABLESUNG', 'ABL', 1, false, 'Ablesung noch nicht modelliert']
];

module.exports = { TEAMS, MEMBERS, PROCESSES, REPAIR, REPAIR_STEPS, REPAIR_VARIANTS, RELEASES, SCOPES };
