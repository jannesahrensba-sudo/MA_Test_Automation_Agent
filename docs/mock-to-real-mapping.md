# Mock → Real-Mapping

**Service-to-Cash Test Automation Assistant · `zstc.testautomation`**

Diese Tabelle ordnet jeden Mock-Baustein des Mockups seinem realen Andockziel zu. Sie vervollständigt die Vorab-Zuordnung aus [Phase 1, Abschnitt 5](phase-1-architektur-und-mock-vertrag.md#5-reale-andock-ziele-vorab-mapping-mock--real).

Belegstufen wie in Phase 1 (Abschnitt 1.2):

- ✅P: Primärquelle
- ✅S: SAP-Suchauszug
- 🟡: teilbestätigt
- ⚠: **NOCH ZU VERIFIZIEREN**
- 🧪: Mock bzw. Projektvorschlag

## 1. Grundsatz des Swaps

Das UI bleibt unverändert. Es bindet nur an den Vertrag `ZUI_STC_TEST_CASE_O4`, also an Entitäten, Actions, Value-Help-Mengen und Annotationen.

Beim Wechsel auf das reale System passiert Folgendes:

- `ui5-mock.yaml` wird durch eine Konfiguration **ohne** `sap-fe-mockserver` ersetzt.
- `fiori-tools-proxy` leitet auf das Backend weiter, oder die App wird embedded deployt.
- Die Logik der Mock-Handler (`webapp/localService/mainService/data/*.js` → `mock-backend/`) wandert in RAP-Behavior-Implementierungen und Adapter.

| Mock-Baustein | Reales Ziel | Belegstufe | Aufwand beim Swap |
|---|---|---|---|
| `ui5-mock.yaml` mit `sap-fe-mockserver` | `ui5.yaml` mit `fiori-tools-proxy` (`@sap/ux-ui5-tooling`) oder Embedded Deployment in S/4HANA | ✅P (Tooling) | gering |
| Service-URL `/sap/opu/odata4/sap/zui_stc_test_case_o4/srvd/sap/zui_stc_test_case/0001/` | RAP Service Binding `ZUI_STC_TEST_CASE_O4` (OData V4 – UI) unter derselben URL | 🧪 (Name) · URL-Schema ✅P | gering |
| `metadata.xml` (generiert aus `tools/metadata/contract.js`) | CDS-Projektion, Metadata Extensions, Service Definition `ZUI_STC_TEST_CASE` | 🧪 | mittel (Modellierung) |
| Hosted-Variante (`tools/hosted/`, Browser-Mockserver) | entfällt; nur Demo-Hülle ohne Backend | 🧪 | – |

## 2. Business Objects und Verhalten

| Mock | Real | Belegstufe |
|---|---|---|
| Entität `TestCase` (Draft Root, UUID + `IsActiveEntity`) | RAP BO Root, managed, mit Draft (`with draft`), UUID-Schlüssel | 🧪 · Draft-Muster ✅P |
| `TestCaseData` (1:1-Komposition), `ValidationResult`, `Execution`, `ExecutionStep`, `DocumentReference`, `TestAssertion` | Kompositionen des BO; `Execution`-Teilbaum read-only | 🧪 |
| `ProcessProfile` / `FieldRequirement` | eigenes Konfigurations-BO (Customizing-Charakter) | 🧪 |
| Draft-Aktionen `Edit`, `Prepare`, `Activate`, `Discard` (Mockserver-Standard) | RAP-Draft-Aktionen gleichen Namens | ✅P |
| `onDraftPrepare` → `TestCaseService.prepare` (Validierung beim Sichern, blockiert nicht) | `draft determine action Prepare` mit Validations als Hinweise | 🟡 (Konzept, F-10) |
| Case ID beim Aktivieren (`onActivated`, Nummernkreis `STC-<Jahr>-######`) | Determination bzw. Late Numbering, eigener Nummernkreis | 🧪 |
| `__OperationControl` (Instance Feature Control, z. B. `approve` nur bei `VALID`) | `features: instance` in der Behavior Definition, `get_instance_features` | ✅P (Muster) |
| `__FieldControl` aus `FieldRequirement` (7 = Pflicht, 3 = optional, 0 = ausgeblendet) | dynamisches Feature Control bzw. virtuelle Elemente mit `Common.FieldControl` | ✅P (Annotation) · Umsetzung 🧪 |
| `__EntityControl` (Updatable/Deletable) | `UpdateRestrictions`/`DeleteRestrictions` über Feature Control | ✅P (Muster) |
| Actions `analyze`, `validate`, `approve`, `startExecution`, `refreshExecution`, `cancelExecution`, `revalidate`, `applySuggestion` | gebundene RAP-Actions gleichen Namens | 🧪 |
| Side Effects (Annotationen im Vertrag) | `side effects` in der Behavior Definition bzw. `@Common.SideEffects` | ✅P |
| State-Messages `SAP__Messages`, Transition-Messages über `sap-messages` | RAP-Messages (`reported`) mit `%element`-Targets | ✅P |
| Message-Klasse `ZSTC_TA` (100–999, fünf Kategorien) | ABAP-Nachrichtenklasse `ZSTC_TA` | 🧪 |

## 3. Die vier Verantwortlichkeiten

| Verantwortung | Mock (Datei) | Real | Belegstufe |
|---|---|---|---|
| AI/Extraction | `MockTestCaseExtractionService` (`mock-backend/extraction/`): reines Keyword-/Token-Matching gegen die Pools (IDs und deutsches Messdienst-Vokabular, `germanMetering.js`), **kein Sprachmodell** | eigene Implementierung hinter `ITestCaseExtractionService`, z. B. über SAP AI Core oder einen anderen LLM-Dienst; kein SAP-Standard | 🧪 / ⚠ |
| Agent vor der App | Service-Assistent (`webapp/ext/agent/`): Tools auf dem OData-Vertrag, Sprachmodell über die claude.ai-Capability `sample` (Hosted) bzw. lokalen Proxy zur Claude API; Mock-Agent (regelbasiert) als Rückfall | Joule-Agent (Joule Studio, SAP Build) mit Skills/Actions auf dem Web-API-Binding des Service; Details in [agent-konzept.md](agent-konzept.md) | ⚠ (F-14) |
| OData/Validation | `ValidationEngine` (`mock-backend/validation/`), Regeln R1–R11 (R10: Leistung und Ersatzteil passen zum Gerätetyp, R11: Servicevertrag), deterministisch; im `TestCaseService` zusätzlich R12 (Vorgänger-Testfall) und R13 (mögliche Dublette, nur Hinweis) | RAP-Validations und -Actions im Facade-BO, Lookups über released CDS (Abschnitt 4) | 🧪 · CDS ⚠ |
| SAP Test Automation | `MockExecutionProvider` + `MockS4ServiceChain` (`mock-backend/execution/`) | Adapter hinter `ITestExecutionProvider`: Cloud ALM (`CALM_TEST_AUTOMATION`) mit Provider (TAT, Tricentis) oder ein API-Ketten-Provider nur für Testsysteme | ✅S / ⚠ (F-8) |
| Verification | `VerificationService` (`mock-backend/verification/`) | dieselbe Logik; liest die realen Belege über released APIs (Abschnitt 5) | 🧪 · APIs ✅P |

**Die fünf offenen Punkte der Standard-Testautomatisierung.** Im Mock sind sie als Methoden von `ITestExecutionProvider` gekapselt:

| # | Methode | Mock | Real |
|---|---|---|---|
| 1 | `start` | liefert `MOCK-<Datum>-<Nr>` | externer Start in Cloud ALM/TAT ⚠ |
| 2 | Testdaten-Übergabe | validierter Datensatz (20 Felder) als Parameter von `start` | Datenvarianten im Testplan ✅S; externe Übergabe ⚠ |
| 3 | `getStatus` | zeitbasierte Simulation, 6 Schritte à 2 s (SIM-1) | Status-Synchronisation Cloud ALM ↔ Provider ✅S; Abruf durch Dritte ⚠ |
| 4 | `getResult` | technisches Ergebnis + Log | wie 3 ⚠ |
| 5 | `getCreatedDocuments` | Belegnummern aus Mock-Nummernkreisen (SIM-2) | nicht belegt ⚠ → Fallback Document Correlation (Abschnitt 5) |

## 4. Value Helps → CDS

Das UI kennt nur die Facade-Namen. Die reale Basis wird im Backend verdrahtet. Details stehen in Phase 1, Abschnitt 3.7.

| Facade (Mock-Pool) | Reale Basis | Belegstufe |
|---|---|---|
| `CustomerVH` | `I_Customer`, VH-View `I_Customer_VH` | Felder ✅P · View 🟡 |
| `ContactPersonVH` | `I_BusinessPartner` plus Kontaktbeziehung | Felder ✅P · CDS ⚠ |
| `FunctionalLocationVH` (inkl. `SuperiorFunctionalLocation`: Liegenschaft → Nutzeinheit) | `I_FunctionalLocation`, Kundenbezug über Partnerrolle; Hierarchie über übergeordneten Technischen Platz | Felder ✅P · Kundenbezug ⚠ · Hierarchiefeld 🟡 |
| `EquipmentVH` | `I_Equipment`, VH-View `I_EquipmentStdVH` | Felder ✅P · View 🟡 |
| `ProductVH` (Referenzprodukt, Leistung, Teil; `ProductGroup` für R10) | `I_Product` plus Beschreibung, Produkttyp als Konstante; Produktgruppe = Warengruppe | 🟡 · Gerätetyp-Zuordnung ⚠ |
| `SalesOrganizationVH` | `I_SalesOrganization` | 🟡 |
| `ServiceOrganizationVH`, `ServiceTeamVH` | Organisationsmodell, Responsibility Management | ⚠ (F-4) |
| `ServiceDocumentPriorityVH`, `ServiceRequestTypeVH` | Code-List-CDS bzw. Vorgangsarten-Customizing | ⚠ |
| `UnitOfMeasureVH`, `CurrencyVH` | `I_UnitOfMeasure`, `I_Currency` | 🟡 |
| `ProcessProfileVH`, `TestCaseFieldVH`, Code-Listen (`*StatusVH`, `ValidationRuleVH` …) | eigene CDS-Views auf dem Projekt-Customizing | 🧪 |

## 5. Belege, Korrelation und Verification

| Mock (`MockS4ServiceChain`) | Reale API und Felder | Belegstufe |
|---|---|---|
| Service Request (Nummernkreis ab 8000000010) | `API_SERVICE_REQUEST_SRV`, `A_ServiceRequest` | ✅P |
| Service Quotation (ab 8000000030) | `API_SERVICE_QUOTATION_SRV;v=0002`, `A_ServiceQuotation` | ✅P |
| Service Order (gemeinsamer Kreis mit Quotation) | `API_SERVICE_ORDER_SRV` (V2, abgekündigt) bzw. V4-Nachfolger `OP_SERVICEORDER_0001` ab 2025 | ✅P / ✅S |
| Service Confirmation (ab 9000000000) | Service-Confirmation-API (V4 ab 2025, Hinweis 3625686) | ✅S · V2-Namen ✅P |
| Billing Document Request (ab 10000012) | `API_BILLING_DOCUMENT_REQUEST_SRV` | ✅P |
| Billing Document (ab 90000115) | `API_BILLING_DOCUMENT_SRV`, `A_BillingDocument.TotalNetAmount` | ✅P |
| Korrelation Case ID (`CorrelationReference`) | `PurchaseOrderByCustomer` (SR, Order, Confirmation, BDR, Billing), bei der Quotation `ServiceQtanExtReference` | ✅P · Kopiersteuerung ⚠ |
| `PredecessorDocumentID` / `SuccessorDocumentID` | `to_Order`, `ReferenceServiceRequest`, `ServiceQtanSuccessorOrder`, `to_Confirmation`, `ReferenceServiceOrder`, `ReferenceDocument`, `ReferenceSDDocument` | ✅P |
| BDR-Vorgänger je Profil (`FS_TM`: Confirmation, `FS_FIXPRICE`: Order) | abrechnungsartabhängig | ⚠ (F-7) |
| Belegstatus (vereinfacht, SIM-4) | reale Statusfelder, z. B. `ServiceOrderIsCompleted`, `OverallBillingStatus` (Phase 1, 5.3) | ✅P (V2) |
| Mock-Preisliste (SIM-3: 1.000 EUR/HR, 693 EUR/PC; Messdienst 69/59 EUR/HR, Ersatzgeräte 35–45 EUR) | Preisfindung (Konditionen) im S/4HANA-System | 🧪 (F-12) |
| Determination „erwarteter Nettowert aus der Mock-Preisliste, wenn leer“ | Preissimulation im S/4HANA-System (API offen) | ⚠ |
| Mock-Nummernkreise (SIM-2) | Nummernkreis-Customizing je Belegart | 🧪 |
| SIM-6 (gesperrtes Teil `P700-SC-999`) | echte Fehler aus Warenausgang oder Rückmeldung | 🧪 |
| `ExternalURL` (im Mock leer) | Fiori-Absprung, z. B. Manage Service Orders F3571A, Create Billing Documents F0798 | ✅S / ⚠ |

**Fallback Document Correlation.** Liefert der Provider keine Belegnummern, gilt:

1. Die Eingaben sind `ExternalExecutionID`, Case ID (als `PurchaseOrderByCustomer`), `SoldToParty` und ein Zeitfenster.
2. `$filter` auf `A_ServiceRequest` liefert den Einstiegsbeleg.
3. Die Verweisfelder oben rekonstruieren den Document Flow.

## 6. UI-Bausteine (bleiben beim Swap unverändert)

| Baustein | Technik | Belegstufe |
|---|---|---|
| Service-Assistent (Startseite) | FPM Custom Page `sap.fe.core.fpm` mit `macros:Page`, Chat (`FeedListItem`), Entwurfskarte; Zugriff nur über das OData-V4-Modell; Übergabe per `routing.navigateToRoute` auf die Object Page | ✅P (Bausteine) · Agent ⚠ |
| Overview | FPM Custom Page `sap.fe.core.fpm` mit `macros:Page` und `macros:Table` (Route `Overview`, `contextPattern: ""`) | ✅P |
| Test Cases, Configuration | List Report + Object Page (`sap.fe.templates`) | ✅P |
| „Test Case in Words“ | FPM Custom Subsection (Fragment + Formatter, reine Anzeige) | ✅P |
| Document Flow | FPM Custom Section mit `sap.suite.ui.commons.ProcessFlow` | ✅P |
| Status-Polling | Controller Extension der Object Page, `EditFlow.invokeAction` für `refreshExecution` | ✅P |
| Prozessbild (Testfall, Geschäftsprozess, Service-Assistent) | App-Control `ext/process/ProcessPicture.js` (`sap.ui.core.Control`, SVG; Layout in `pictureLayout.js`), Daten per Aggregation-Binding an `_ProcessStep`, `_LatestExecutionStep`, `_LatestTestAssertion` bzw. `_Step`; in FPM Custom Subsection/Section | 🧪 · Standard-Alternative `sap.suite.ui.commons.networkgraph` ⚠ (P-18) |
| Testpaket und Teamlauf im Service-Assistenten | Agenten-Kern `core/testDesign.js`, `core/testPackage.js`, `core/teamRun.js`; Zugriff nur über das OData-V4-Modell (`TestCaseGateway`) | 🧪 · Agent ⚠ |
| FLP-Sandbox (lokal) | `@sap-ux/preview-middleware`; real: SAP Fiori launchpad mit Semantic Object `ServiceTestCase`, Action `manage` | ✅P · Intent 🧪 |

## 7. Prozessteams, Prozesse und Releases

Konzept und Validierung: [prozessteams-releases.md](prozessteams-releases.md).

| Mock | Real | Belegstufe |
|---|---|---|
| `ProcessTeam` + `TeamMember` (Rollen `PROCESS_OWNER`, `TEST_EXECUTOR`) | Teams im Responsibility Management: Teamkategorie = Geschäftsprozess, Teamtyp = Teilprozess, Mitgliedsfunktionen = Rollen; App „Manage Teams and Responsibilities“ | Konzept ✅S · eigene Kategorien/Funktionen ⚠ |
| Rollenprüfung `requireRole` vor `approve`, `startExecution` und im Regressionslauf (Meldungen 302, 303) | Instanzberechtigung des RAP-BO (`authorization master ( instance )`) mit Berechtigungsobjekt bzw. Abfrage der Teamfunktion | 🧪 · Umsetzung ⚠ |
| `BusinessProcess` + `ProcessStep` + `ProcessVariant` + `ProcessVersion` | eigenes Projekt-BO; fachlich abgeglichen mit Solution Process und Prozessablauf in SAP Cloud ALM bzw. SAP Signavio | 🧪 · Cloud-ALM-Begriffe ✅S |
| `TestCaseStep`, `TestCaseVersion` (Snapshot, Inhalts-Hash, Freigabe je Version) | Kompositionen des Testfall-BO; Versionierung per Determination beim Aktivieren | 🧪 |
| `Release` + `ReleaseScope` (Zwischentabelle Release × Prozessteam × Prozess) | eigenes BO; Abgleich mit Releases/Timeboxes und Testplänen in SAP Cloud ALM | 🧪 · Cloud ALM ✅S |
| Release-Typen FPS/SPS/Release/Cloud-Release/HFC mit SAP-Terminen | Release-Kalender laut SAP-Release-Information (SAP for Me) | Zyklus ✅S · Termine ⚠ |
| Actions `copyScopeFromPredecessor`, `startRegressionRun`, `refreshRegressionRun`; automatischer Lauf bei Status „In Test“ | RAP-Actions; Regressionslauf als Application Job oder Testplan-Ausführung über `CALM_TEST_AUTOMATION` | 🧪 / ⚠ |
| Lesemodelle `ReleaseTestCase`, `ReleaseStepCoverage`, `RegressionRunItem` (mit stabilen, inhaltsbasierten Schlüsseln) | CDS-Views über Testfällen, Ausführungen und Scope | 🧪 |
| `ServiceContractVH` (Vertragsfindung, SIM-9) | `API_SERVICE_CONTRACT_SRV`: `A_ServiceContract`, `A_ServiceContractItem`, `A_ServiceContrItemObjectList` | ✅P (VDM) · Findungslogik ✅S ([Service Contract Determination](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/c9b5e9de6e674fb99fff88d72c352291/468ba0aa9ed7616ae10000000a1553f7.html)) |
| Service Order mit Vertragsbezug | `A_ServiceOrder.ReferenceServiceContract` | ✅P (VDM) |
| Rechnungsplan → Fakturaanforderung (Weg 3) | `A_SrvcContrItmBillgReqItem` (`API_SERVICE_CONTRACT_SRV`) | Entität ✅P (VDM) · Ablauf ⚠ |
| FI-Beleg zur Faktura (SIM-11, Nummernkreis ab 1400000100) | `A_BillingDocument.AccountingDocument`; Lese-API für den Buchhaltungsbeleg offen. `API_JOURNALENTRYITEMBASIC_SRV` (`A_JournalEntryItemBasic`, Schlüssel `ID`) hat im VDM kein Feld `AccountingDocument` und eignet sich nicht für die Belegprüfung. | Feld ✅P · Lese-API ⚠ |
| Wegerkennung `processHints` (Schlüsselwörter) | Teil der Extraktion hinter `ITestCaseExtractionService` (Sprachmodell) | 🧪 |
| Startobjekt `StartObject` mit Vorbelegung aus dem Einstieg des Teams; Abschnitt des Weges von Start bis Ende | Determination im Testfall-BO über dieselben Prozessdaten | 🧪 |
| Vorgänger-Testfall `PredecessorTestCase`, Übernahme der Belege (`DocumentOrigin` = `TAKEN_OVER`, `OriginReference`) und der Testdaten; Regel R12, Meldung 211 | Determination und Validierung im RAP-BO; im echten Lauf übergibt der Vorgängerlauf die Belegnummern an das Testwerkzeug (Variablen bzw. Testdaten-Container ⚠) | 🧪 · Übergabe ans Werkzeug ⚠ |
| Regressionslauf mit Entscheidung `WAITING` für abhängige Testfälle | Reihenfolge im Testplan bzw. im Application Job | 🧪 · ⚠ |
| `ResultAnalysisService` → `ResultFinding` (Befund, Ursache, Evidenz, Konfidenz, Team, Empfehlung) und `Execution.AnalysisHeadline` | dieselben Regeln als Determination nach Laufende im RAP-BO; Evidenz aus den Belegen (APIs wie in Abschnitt 5) und dem Protokoll des Testwerkzeugs bzw. Application Log | 🧪 · Datenzugriff ⚠ |
| Kopfaktion „Ergebnis besprechen“ → Service-Assistent mit Tool `ergebnis_lesen` | Joule-Agent mit demselben Lese-Tool (OData-Lesezugriff auf Testfall, Lauf, Befunde) | 🧪 · Joule ⚠ |
| FPM-Seite *Analytics* (Auswertung je Release) aus `Release`, `ReleaseScope`, `ReleaseTestCase`, `ReleaseStepCoverage`, `Execution`, `ResultFinding` | analytische CDS-Views (Cube/Query) mit Fiori-Analyseseite oder SAP Analytics Cloud; im Mockup bewusst Standard-Controls `sap.m` und `sap.suite.ui.microchart` | 🧪 · Zielwerkzeug ⚠ |
| Action `startTeamRegressionRun` (Parameter `ProcessTeam` Pflicht, `ProcessID`, `RunReason`, `IncludeDependents`; Lauf mit `Trigger = TEAM_RUN`, Team und Anlass); abhängige Testfälle anderer Teams über `PredecessorTestCase` | gebundene RAP-Action mit Parameterstruktur (abstrakte Entität); Auslöser real eher nach dem Transportimport bzw. aus der CI; Ausführung wie der Regressionslauf | 🧪 / ⚠ (P-20) |
| Navigation `TestCase/_ProcessStep` (Schritte des Prozesses für das Prozessbild) | Assoziation im Testfall-BO auf die Prozessschritte | 🧪 |
| Regel R13 (mögliche Dublette: gleicher Abschnitt, gleicher Weg, gleiches Gerät bzw. gleicher Vertrag; INFO) | RAP-Validation mit Hinweis-Meldung (`%msg` mit Severity Information) | 🧪 |
| Generierte Messdienst-Stammdaten (`tools/seed/generate-masterdata.js`) und generierter Testfallbestand (`tools/seed/generate-seed.js`, Testdesign des Agenten) | echte Stammdaten des Testsystems; echte Testfälle aus dem Altwerkzeug über die Importvorlage | 🧪 (fiktiv) |
| Prozessteam „New End to End Prozess“ (`PT-E2E`) für Fakturierung und FI | Team im Responsibility Management (wie die anderen Prozessteams) | Zuordnung laut Fachbereich (06.10.2026) · Abbildung ⚠ |
