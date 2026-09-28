# Claude-Code-Prompt — Service-to-Cash Test Automation Assistant
## Voll funktionsfähiger, standalone lauffähiger **UI5-Mockup** (SAP Fiori elements for OData V4 + FPM)

> **So verwenden:** Diese Datei ins Projektverzeichnis legen (z. B. als `CLAUDE.md` oder `prompt.md`) und Claude Code darauf ansetzen. Optionale MCP-Stellen sind mit `<<SAP_MCP>>` / `<<FIGMA>>` markiert. Für den Mockup ist **kein** SAP-System nötig; die MCP-Server verbessern nur die Genauigkeit (echte Namen, Design-Referenz) und die spätere Umschaltung auf das reale Backend.

---

## 0. Mission

Entwickle einen **Mockup des „Service-to-Cash Test Automation Assistant"**, der zwei Bedingungen gleichzeitig erfüllt:

1. **Voll funktionsfähig & eigenständig lauffähig** — die App startet lokal ohne SAP-System (`npm install` → `ui5 serve` / `npm start`), läuft komplett auf **Mock-Daten** und ist end-to-end durchklickbar: `Describe → Extract → Validate → Clarify → Approve → Execute → Verify → Document`. Jeder Button tut etwas, jede Ampel ist deterministisch, jeder Beleg erscheint, das Ergebnis wird berechnet.
2. **Architektur-treu & umschaltbar** — es ist **echtes SAP Fiori elements for OData V4 mit Flexible Programming Model**, kein React-/Dashboard-Nachbau. Datenmodell, Entitäts- und Feldnamen, OData-Service-Zuschnitt und die Kapselung von Extraction/Execution sind so gebaut, dass später der Mock-OData-Service durch den realen RAP-Service `ZUI_STC_TEST_CASE_O4` und die realen released APIs **ersetzt** werden kann, ohne die UI neu zu schreiben.

Kurz: **Mock-Daten ja — Mock-Architektur nein.** Was der User sieht und klickt, ist fertig; was dahinter liegt, ist die spätere Produktivarchitektur, vorerst mit lokalem Mock-Backend.

---

## 1. Rolle

Übernimm die Rolle eines **Senior SAP S/4HANA Solution Architect und SAP Fiori/UI5 Developer** mit tiefer Erfahrung in: SAP S/4HANA Service, Fiori elements, SAPUI5, Flexible Programming Model (FPM), OData V4, ABAP RAP, CDS Views, SAP Gateway, Embedded Fiori Deployment, S/4HANA-APIs, Service-to-Cash, Testautomatisierung, sowie — soweit nötig — SAP Build / BTP. Du kennst insbesondere die **lokale Fiori-elements-Entwicklung mit Mock-Server** (Ausführen einer FE-App ohne Backend über lokale Metadaten + Mock-Daten).

---

## 2. Betriebsregeln (nicht verhandelbar)

### 2.1 Research-first
Bevor du Code erzeugst, prüfe die aktuellen offiziellen SAP-Quellen — besonders zu den UI-Patterns und zum lokalen Mock-Betrieb. Primärquelle UI: **FPM Explorer** (`https://ui5.sap.com/test-resources/sap/fe/core/fpmExplorer/index.html`). Zusätzlich: SAPUI5 SDK, SAP Help Portal, SAP Fiori Design Guidelines, SAP Business Accelerator Hub, OData-V4-Doku, Doku zum **Fiori-elements-Mock-Server** und zum UI5-Tooling (`ui5 serve`). Keine Blogs als Source of Truth, wenn SAP es selbst dokumentiert.

### 2.2 Was „voll funktionsfähiger Mockup" konkret heißt
- Die App **läuft** nach `npm install` + einem Start-Befehl standalone im Browser, **ohne** Netz zu SAP.
- Das Backend wird durch einen **lokalen OData-V4-Mock-Server** ersetzt (aktueller SAP-Standard für FE-Apps ohne Backend — genaues Paket/Version gegen aktuelle Doku bestätigen). Er liefert Metadaten + Mock-Daten und behandelt **Actions** und **Value Helps** über Mock-Handler, sodass Validierung, Approval, Execution und Ergebnisermittlung real funktionieren.
- **State** (Draft, Statusübergänge, erzeugte Belege, Assertions) wird zur Laufzeit im Mock-Server/Modell gehalten — der Durchlauf ist wiederholbar und in sich konsistent.
- Ein **README** beschreibt Install + Start + einen kompletten Klick-Pfad durch den Golden Test Case.

### 2.3 Nichts erfinden — angepasst an den Mock-Kontext
- **Mock-DATEN sind erlaubt und erwünscht** (Kunden, Equipments, Belegnummern usw.). Sie sind klar als Mock erkennbar (eigene Datei/Ordner) und orientieren sich am Golden Test Case (Anhang C).
- **Mock-VERTRÄGE (Interface/Namen) müssen realistisch sein:** Entitäts-, Feld- und Service-Namen folgen **echten released SAP-Objekten**, nicht Fantasie. Wo ein Name nicht gegen reale SAP-Doku/-System abgesichert ist, kennzeichne ihn als **`⚠ NOCH ZU VERIFIZIEREN`**.
- **Erfinde niemals als „real" ausgegebene:** OData Services, Entity Sets, CDS Views, API-Endpunkte, Transaktionen, Business Objects, Test-Automation-Schnittstellen, Actions, SAPUI5 Controls. Der Mock-Service `ZUI_STC_TEST_CASE_O4` ist ausdrücklich **Projektvorschlag/Mock**, kein existierender SAP-Standard.
- **Simuliere nichts stillschweigend:** Execution, Extraction und Testautomatisierung laufen über klar benannte **Mock-Provider** (`MockExecutionProvider`, `MockTestCaseExtractionService`), nicht als versteckte Fake-Logik. Besonders die 5 offenen Punkte der Standard-Testautomatisierung (externer Start, Testdaten-Übergabe, Status, Ergebnis, Belegnummern-Rückgabe) werden im Mock **explizit als Mock** dargestellt und als real zu klärender Punkt markiert.

### 2.4 MCP-Nutzung (im Mock optional, aber nützlich)
- **`<<FIGMA>>` Figma-MCP:** In Claude Code die beiden Figma-Make-Designs als **visuelle/flow-Referenz** lesen (die Make-Quelldateien sind dort über die MCP-Resource-Links lesbar). Rollen: „**LLM Joule Figma Design**" = der zu ersetzende Dialog-Ansatz; „**Redesign Navigation and Workflow**" (Screens: Overview, TestCases, NewTestCase, UnifiedTestData, Validation, Approval, Execution, TestResult, Configuration) = **Zielaufbau für Navigation + Monitoring**. Übernimm die **Fiori-Designsprache**, nicht die shadcn/React-Optik.
- **`<<SAP_MCP>>` SAP-MCP (falls vorhanden):** nur zur Erhöhung der Genauigkeit — echte released Entitäts-/Feldnamen, `$metadata`, CDS-/Value-Help-Referenzen abgreifen, damit der Mock-Vertrag den echten Namen entspricht. Für das Laufenlassen des Mockups **nicht erforderlich**.

### 2.5 Phasen & Stopp
Arbeite in den Phasen unter §6. **Nach Phase 1 (Architektur- & Mock-Contract-Validation) kurz stoppen** und Ergebnis vorlegen. Keine Massenproduktion vorab.

### 2.6 Fiori-native, orientiert am FPM Explorer
Nutze List Report, Object Page, Custom/FPM-Pages, Custom Sections, **Building Blocks**, Extension Points, Controller Extensions, echte **Value Helps**, Message Strip/Popover, Semantic/Object Status, Side Effects, Draft Handling, Actions. Freestyle SAPUI5 nur, wo FE/FPM nicht ausreicht (z. B. die Document-Flow-Visualisierung). Bindung über `sap.ui.model.odata.v4.ODataModel` bzw. die von FE erzeugte Binding-Architektur — **kein manuelles AJAX**.

### 2.7 Swap-Readiness ist ein Deliverable
Liefere in der letzten Phase eine **Mock → Real Mapping-Tabelle**: welcher Mock-EntitySet/Property/Action/Value-Help später auf welchen realen RAP-Service / welche released API / welche CDS-Value-Help-View zeigt (mit `⚠ ZU VERIFIZIEREN`, wo offen). Ziel: Umschalten = Konfiguration + Backend, **kein UI-Rewrite**.

### 2.8 Code-Qualität, Clean Core, Security
Strukturiert, wartbar, upgrade-stabil, Clean-Core-orientiert. Keine überladenen Controller; deterministische Geschäftslogik in klar benannten, ersetzbaren Services/Handlern. Keine Passwörter/Keys/Credentials im Frontend. **Ausschließlich für TESTSYSTEME/Demo** konzipiert.

### 2.9 Ausgabeformat je Phase
1. **Architektur/Entscheidung erklären.** 2. **Projektstruktur zeigen** (Baum). 3. **Jede Datei vollständig ausgeben** — Dateipfad als Überschrift, darunter vollständiger Inhalt. Am Ende: **lauffähig** + README.

---

## 3. Zielarchitektur (real) und was der Mock ersetzt

Der Mock bildet die **linke, fachliche Seite** vollständig und funktionsfähig ab; die rechte, systemnahe Seite wird durch Mock-Provider ersetzt und ist als solche gekennzeichnet.

```
┌──────────────────────────────────────────────┐
│ Fiori elements for OData V4 + FPM  ← ECHT      │  voll funktionsfähig
│ Service-to-Cash Test Automation Assistant      │
└───────────────┬────────────────────────────────┘
                │ OData V4
┌───────────────▼────────────────────────────────┐
│ ZUI_STC_TEST_CASE_O4  (Facade)                  │
│  real: RAP-Service   │  mock: lokaler OData-V4-  │  ← im Mock: lokaler Mock-Server
│  Test Case · Validation · Required Fields ·      │
│  Master-Data-Lookups · Business Rules · Results  │
└───────────────┬────────────────────────────────┘
                │ Human Approval
┌───────────────▼────────────────────────────────┐
│ Execution Adapter — ITestExecutionProvider       │
│  real: SAP-Testautomatisierung │ mock: MockExecutionProvider
└───────────────┬────────────────────────────────┘
                │
┌───────────────▼────────────────────────────────┐
│ SAP S/4HANA Service (Belegkette)  ← im Mock simuliert
│ Service Request→Quotation→Order→Confirmation→BDR→Billing
└───────────────┬────────────────────────────────┘
                │
┌───────────────▼────────────────────────────────┐
│ Result / Verification Layer  ← ECHT (auf Mock-Daten)
│ Expected vs Actual · Document IDs · Status · Flow · Logs
└──────────────────────────────────────────────────┘
```

**Vier getrennte Verantwortlichkeiten (zentrale Idee):** AI/Extraction · OData/Validation · SAP Test Automation · Verification. Im Mock sind **Validation** und **Verification** echt (deterministisch, auf Mock-Daten), **Extraction** und **Test Automation** laufen über Mock-Provider.

---

## 4. Kontext aus der Vorarbeit (verbindlich einarbeiten)

- **Zielmodul:** S/4HANA **Service (CRMS4, One-Order)**. Belegkette laut vorliegendem E2E-Prozessmodell: Service Request *(Scope TBD, ggf. Notification)* → Service Quotation (Field Service Fix Price/T&M) → Service Order (App F3571A) → Confirmation → Release for Billing (F3573) → Billing (F0798). Diese Kette ist der „Golden Path" für die Testfälle.
- **Service Request zuerst.** Bekannte released Kopf-Felder (gegen Zielrelease zu bestätigen): `ServiceRequestType, SoldToParty, ServiceRequestDescription, ServiceRequestReporter, ServiceDocumentPriority, ServiceOrganization, SalesOrganizationOrgUnitID, ServiceProfile, ResponseProfile` + Referenzobjekt (Equipment/Functional Location) + optional `RequestedServiceStart/EndDateTime`. **Pflichtfelder sind customizing-getrieben** (Vorgangsart + Unvollständigkeit) → **nicht hardcodieren**, sondern aus der `FieldRequirement`-Config lesen (Anhang B/§5).
- **Kein KI-Dialog — deterministische, tabellengetriebene Erfassung** (siehe §5.3): Tabellen der (Pflicht-)Felder je Objekt, Text dazwischen, sodass eine Case-Beschreibung entsteht; Value-Help-Vorschläge aus den zugehörigen Quellen; **Abgleich-Button** → Lücken + konkrete Vorschläge.
- **Value-Help-Quellen** (Vorschlag, je Release zu bestätigen; im Mock als lokale Pools): Kunde→`I_Customer/I_BusinessPartner`; Melder→BP-Kontakt; Equipment→`I_Equipment`; Functional Location→`I_FunctionalLocation`; Material/Serviceprodukt→`I_Product`; Sales Org→`I_SalesOrganization`; Priorität→Code-List-CDS; **Service Team/Org → `⚠ ZU VERIFIZIEREN`**.
- **Monitoring/Result** orientiert sich an „Redesign Navigation and Workflow" (Document Flow der Belege + Expected-vs-Actual).

---

## 5. Funktionsumfang des Mockups (muss klickbar funktionieren)

### 5.1 App-Shell & Navigation
Wenige Hauptseiten: **Overview · Test Cases · New Test Case · Configuration**. Zusätzliche Workflow-Schritte (Validation, Approval, Execution, Test Result) als Sections/Sub-Views der Test-Case-Object-Page bzw. eigene FPM-Views entsprechend dem Redesign.

### 5.2 List Report `Test Cases` (FE, echt)
Spalten: Case ID, Scenario, Process Profile, Created At, Validation Status, Execution Status, Final Result, Duration. Filter: Case ID, Result, Date, Process Profile, Created By. Mit `SemanticStatus`/`ObjectStatus` für die Ampeln. Aus Mock-Daten befüllt, inkl. mind. 1 fertig durchgelaufener Case (grün) + 1 offener.

### 5.3 New Test Case — deterministische, tabellengetriebene Erfassung (Kern, ohne KI)
- **Struktur:** FPM-Custom/Object-Page mit **Form-/Field-Building-Blocks**, gruppiert je Business Object (Start: Service Request; danach Order/Confirmation-relevante Felder). Jedes Feld hängt an einer **echten Value Help** mit **Type-ahead**, die Treffer aus dem zugehörigen Mock-Pool zieht.
- **Case-Beschreibung:** erklärender Text zwischen den Feldgruppen, sodass die Eingaben zu einer lesbaren Fallbeschreibung zusammenwachsen. Zusätzlich **optionales** großes Freitextfeld „Describe Test Scenario" + Button `Analyze`, der über `ITestCaseExtractionService` → `MockTestCaseExtractionService` läuft (**reines Keyword-/Token-Matching gegen die Mock-Pools, kein Sprachmodell**) und die Felder vorbelegt. Der strukturierte Weg ist der primäre, der Freitext ist Komfort.
- **Abgleich-Button** (`validate`): führt **deterministische** Prüfungen aus und liefert ein **Message-Popover** mit Ampel je Feld + konkreten Vorschlägen:
  - **Vollständigkeit** gegen `FieldRequirement` (pro ProcessProfile/BusinessObject).
  - **Relationship-Validation** (nicht nur Existenz): Kunde → Functional Location → Equipment → Reference Product. Beispiel-Meldung: *„Equipment EL-100 gehört nicht zu Functional Location H2POWC00-PROD → ERROR"* + Vorschlagsliste plausibler Werte.
  - **Ampel:** `Success` (eindeutig validiert) · `Warning` (mehrere plausible Treffer) · `Error` (fehlt/ungültig). Ausdrücklich **keine** „AI-Confidence".

### 5.4 Approval (Human-in-the-loop)
`approve` erst möglich, wenn `ValidationStatus = VALID`. Danach `ApprovalStatus = APPROVED`. Erst dann ist `startExecution` freigeschaltet.

### 5.5 Execution (Mock, aber funktionsecht)
`startExecution` erzeugt **nicht** direkt Belege, sondern übergibt den validierten Datensatz an `ITestExecutionProvider` → `MockExecutionProvider`. Dieser simuliert einen **asynchronen Lauf**: vergibt eine `ExternalExecutionID`, durchläuft Statusübergänge (Running → Finished) mit sichtbaren `ExecutionStep`s je Business Object, und erzeugt am Ende die **Belegnummern** der Kette. Status ist über eine `refreshExecution`/Polling-Action abrufbar. Die 5 offenen Automatisierungs-Fragen (Start/Testdaten/Status/Ergebnis/Belegnummern) sind im Provider **als Mock kommentiert** und als real zu klärend markiert.

### 5.6 Verification & Result (echt, auf Mock-Daten)
Nach „Finished" liest die Result-Schicht die (Mock-)Belege und rechnet **Expected vs Actual** je Feld (SoldToParty, Equipment, FunctionalLocation, ServiceProduct, Quantity, Unit, ServiceDuration, ServicePart, Status, NetValue, DocumentFlow). Gesamtergebnis: `PASSED · PASSED_WITH_WARNING · FAILED_FUNCTIONAL · FAILED_TECHNICAL · BLOCKED`.

### 5.7 Test-Case Object Page (Result-Nachweis)
Header: Case ID, Scenario, Process Profile, Validation, Execution Status, Final Result. Sections: Input · Validated Test Data · Validation Issues · SAP Objects · Execution · **Document Flow** (Service Request → Quotation → Order → Confirmation → Billing Doc Request → Billing, je mit Belegnummer + ✓/Status) · **Test Assertions** (`Field | Expected | Actual | Result`) · Technical Log.

### 5.8 Configuration
Pflege-View für `FieldRequirement` (ProcessProfile, BusinessObject, FieldName, Required, ValidationRule, DefaultValue, SourceType, Active), damit sich Pflichtfelder ohne Code ändern lassen.

### 5.9 Fehler & Messages
Backend-/Mock-Fehler als SAP-konforme Messages, Kategorien: `VALIDATION_ERROR, BUSINESS_ERROR, AUTHORIZATION_ERROR, EXECUTION_ERROR, TECHNICAL_ERROR`.

---

## 6. Phasen (Mockup-Aufbau)

**Phase 1 — Architektur- & Mock-Contract-Validation  ⟵ danach STOPPEN**
Liefere: (1) empfohlene UI-/Mock-Architektur (FE OData V4 + FPM + welcher Mock-Server), (2) den geplanten **OData-V4-Mock-Vertrag** (Entities/Sets/Actions/Value-Help-Assoziationen, benannt nach realen SAP-Konventionen), (3) Edition-/Release-Annahmen und was davon den Mock beeinflusst (z. B. V2 vs. V4 der späteren Service-APIs, inkl. Hinweis, dass der V4-Service-Order-Nachfolger erst ab neueren Releases existiert), (4) an welche realen released APIs/CDS-Value-Helps der Mock später andockt, (5) offene Fragen/Blocker, (6) **Definition of Done** für den Mockup (siehe unten).
Schließe mit der Tabelle **Thema | Empfohlene Lösung | SAP-Standard bestätigt (Quelle/MCP) | Offene Frage | Risiko** und einem **Go / No-Go** (was sofort baubar ist, was gegen ein reales System zu verifizieren ist). **Dann STOPP.**

**Phase 2 — OData-V4-Mock-Vertrag + Mock-Daten + lauffähiges Skelett**
Lokale Metadaten/Annotationen für `ZUI_STC_TEST_CASE_O4`, Mock-Daten (Anhang C), Mock-Server-Konfiguration, UI5-Projektgerüst (`manifest.json`, `ui5.yaml`, `package.json`, `Component.js`). **Ergebnis: App startet und zeigt leeren List Report auf Mock-Daten.**

**Phase 3 — Shell, Navigation, List Report, Object Page**

**Phase 4 — New Test Case (tabellengetrieben) + Value Helps + deterministische Validierung**

**Phase 5 — Execution-Simulation + Document Flow + Assertions + Result**

**Phase 6 — Politur + Swap-Readiness (Mock→Real Mapping) + README/Run-Anleitung**

---

## 7. Definition of Done (Mockup)
- `npm install` + Start-Befehl → App läuft lokal im Browser, **kein** SAP nötig.
- Golden Test Case (Anhang C) ist end-to-end durchklickbar: Erfassen → Abgleich (Ampel + Vorschläge) → Approve → Execute → Belege + Document Flow → Assertions → `PASSED`.
- Value Helps liefern echte Trefferlisten aus Mock-Pools; Relationship-Fehler wird korrekt als `ERROR` erkannt.
- Reine Fiori-elements/FPM-Optik (Abgleich am FPM Explorer), keine React-/Dashboard-Optik.
- README + **Mock→Real Mapping-Tabelle** vorhanden; alle nicht gegen SAP gesicherten Verträge tragen `⚠ ZU VERIFIZIEREN`.

---

# Anhänge (Referenz)

## Anhang A — Datenmodell (OData-V4-Mock-Vertrag)
**TestCase:** TestCaseUUID, CaseID, ScenarioID, Title, Description, NaturalLanguageInput, ProcessProfile, Status, ValidationStatus, ApprovalStatus, ExecutionStatus, FinalResult, CreatedBy, CreatedAt, ChangedAt, ApprovedBy, ApprovedAt, ExecutionStartedAt, ExecutionFinishedAt, ExecutionDuration, ExternalExecutionID.
**TestCaseData** (strukturierte fachliche Daten). **ValidationResult** (ValidationUUID, TestCaseUUID, Category, FieldName, ProposedValue, ResolvedValue, Source, ValidationStatus, ValidationMessage, Severity). **Execution** (ExecutionUUID, TestCaseUUID, ExecutionProvider, ExternalExecutionID, Status, StartedAt, FinishedAt, TechnicalResult, FunctionalResult). **ExecutionStep** (StepUUID, ExecutionUUID, Sequence, BusinessObjectType, ExpectedStatus, ActualStatus, ExecutionStatus, StartedAt, FinishedAt, Message). **DocumentReference** (DocumentReferenceUUID, ExecutionUUID, BusinessObjectType, DocumentID, DocumentItem, PredecessorDocumentID, LifecycleStatus, ExternalURL, ValidationStatus). **TestAssertion** (AssertionUUID, ExecutionUUID, BusinessObjectType, Field, ExpectedValue, ActualValue, Tolerance, Result, Message).
Root/Compositions als RAP-taugliche Struktur modellieren (Root = TestCase, Compositions zu Data/Validation/Execution; Execution→Steps/DocumentReferences/Assertions). Actions: `analyze, validate, approve, startExecution, refreshExecution, cancelExecution, revalidate` (im Mock über Mock-Handler).

## Anhang B — FieldRequirement (Pflichtfeld-Config)
ProcessProfile, BusinessObject, FieldName, Required, ValidationRule, DefaultValue, SourceType, Active. Wird von der Validierung gelesen; über die Configuration-View pflegbar.

## Anhang C — Golden Test Case + Mock-Pools
**Fall H2-STC-001:** Customer *North Sea Energy – H2 Power – 00* (`C700-C00`); Description *System cooling partially failed*; Reporter *Michael Fischer*; Service Team `ICNT_1SUP-DE`; Priority *Medium*; Functional Location `H2POWC00-PROD`; Equipment `EL-100`; Reference Product `P700-EL-100`; Service Product `P700_SERV_ONS`; Service Qty `3 HR`; Service Part `P700-SC-100`; Part Qty `1 PC`; Expected Net Value `3.693 EUR`.
**Belegnummern (erst bei Execution vergeben, Mock):** Service Request 8000000010 · Quotation 8000000030 · Order 8000000031 · Confirmation 9000000000 · Billing Doc Request 10000012 · Billing 90000115. **Case ID** z. B. `STC-2026-000001` (≠ SAP-Belegnummer; klammert alle Belege).
**Mock-Pools für Value Helps:** je Objekt mehrere plausible Einträge (inkl. bewusst 1 „falsches" Equipment, das nicht zur FunctLoc passt, um den ERROR-Pfad zu zeigen).

## Anhang D — Reale Andock-Ziele (für Swap, je Release verifizieren)
Service Request (`A_ServiceRequest`-Felder s. §4) · Service Quotation (aktuell empfohlene API prüfen: V2 evtl. deprecated → V4) · Service Order (V2 `API_SERVICE_ORDER_SRV`; V4-Nachfolger erst in neueren Releases) · Service Confirmation · Billing (`A_BillingDocument`). Master-Data-Value-Helps s. §4. Test-Automatisierung (SAP S/4HANA Test Automation Tool / Cloud ALM Test Automation API) — Verfügbarkeit je **Edition** prüfen; der zentrale Ablauf *Start → ExternalExecutionID → Status → erzeugte Belege → Result* ist gegen dokumentierte APIs zu prüfen, und falls unvollständig: Lücke + benötigter Adapter + Document-Correlation-Fallback (ExternalExecutionID + Case ID als externe Referenz + Customer + Timestamp → OData-Query → Document-Flow-Rekonstruktion; Referenzfeld je Serviceobjekt prüfen, keine Kundenfelder ohne Extension-Kennzeichnung).

## Anhang E — Naming (Projektvorschläge, keine SAP-Standardobjekte)
Projekt `zstc.testautomation` · Verzeichnis `zstc-testautomation/` · App Title „Service-to-Cash Test Automation Assistant" · Semantic Object `ServiceTestCase` · Action `manage` · OData-Facade `ZUI_STC_TEST_CASE_O4` · Extraction `ITestCaseExtractionService`/`MockTestCaseExtractionService` · Execution `ITestExecutionProvider`/`MockExecutionProvider`.

---

## Deine erste Aufgabe
Beginne **nicht** mit vollständigem Coding. Führe zuerst **Phase 1 — Architektur- & Mock-Contract-Validation** durch (empfohlene FE/FPM-+-Mock-Server-Architektur, geplanter OData-V4-Mock-Vertrag mit realistischen SAP-Namen, Edition-/Release-Einfluss, reale Andock-Ziele, offene Fragen, **Definition of Done**), schließe mit der **Tabelle** und dem **Go/No-Go** ab — und **stoppe** zur Freigabe.
