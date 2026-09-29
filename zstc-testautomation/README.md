# zstc.testautomation — Service-to-Cash Test Automation Assistant (Mockup)

Klickbarer Mockup auf Basis von **SAP Fiori elements for OData V4 + Flexible Programming Model** (SAPUI5 1.136, Theme `sap_horizon`).

- Er läuft komplett auf **Mock-Daten** über einen lokalen OData-V4-Mockserver.
- Der Vertrag entspricht dem späteren RAP-Service `ZUI_STC_TEST_CASE_O4`. Beim Wechsel auf das reale Backend bleibt das UI unverändert (siehe [Mock→Real-Mapping](../docs/mock-to-real-mapping.md)).
- Es wird **kein SAP-System** aufgerufen.

**Was ist Mock?**

- `MockTestCaseExtractionService`: Keyword-/Token-Matching, kein Sprachmodell.
- `MockExecutionProvider` mit `MockS4ServiceChain`: simulierte Service-to-Cash-Kette, keine SAP-Testautomatisierung.
- Mock-Nummernkreise und Mock-Preisliste.

Die Validierung (`ValidationEngine`) und die Verifikation (`VerificationService`) sind echte, deterministische Logik. Sie arbeiten hier auf Mock-Daten.

## Starten

### Gehostet (ohne Installation)

Privates Artifact: <https://claude.ai/artifact/PuLrAKkFiAYpWsmYz253UK>

- Diese Variante läuft komplett im Browser: SAPUI5-Runtime, App und Mockserver liegen im Artifact.
- Ein Neuladen der Seite setzt den Mock-Zustand zurück.
- Das Artifact enthält SAPUI5-Bibliotheken unter der SAP Developer License (`sap.fe.*`, `sap.suite.ui.*`, `sap.ui.export`). Es ist daher bewusst **privat** und nicht zum öffentlichen Teilen gedacht.
- Neu bauen mit `npm run build:hosted`. Das Ergebnis liegt in `dist-hosted/site/`.

### Lokal

**Voraussetzung:** Node.js ≥ 20.11. Netz braucht es nur für npm; die SAPUI5-Bibliotheken kommen beim ersten Start aus der npm-Registry.

```bash
npm install
npm start
```

`npm start` öffnet `http://localhost:8080/test/flp.html?sap-language=EN#ServiceTestCase-manage`, die App in der FLP-Sandbox.

- `sap-language=DE` stellt die App-Texte auf Deutsch um. Die Feldbezeichnungen kommen aus dem Service und bleiben englisch.
- Ein Neustart des Servers stellt den Ausgangszustand her (DoD-12).

## Klickpfade

Die Seed-Daten enthalten drei Testfälle:

- `STC-2026-000001`: Referenzlauf, PASSED
- `STC-2026-000002`: falsches Equipment, INVALID
- `STC-2026-000003`: Golden Case, vorerfasst

Die Golden-Belegnummern entstehen beim **ersten** Lauf je Sitzung. Jeder weitere Lauf zählt fortlaufend weiter.

### Golden Path (DoD-2)

1. **Overview** → *New Test Case*. Die Object Page öffnet sich im Entwurf. Prozessprofil `FS_TM` ist vorbelegt, dazu die Default-Werte aus der Konfiguration.
2. In *Describe Test Scenario* diesen Text einfügen und dann *Analyze* (Toolbar der Section *Input*) wählen:

   > Customer C700-C00 reports "System cooling partially failed" on equipment EL-100 at functional location H2POWC00-PROD. Reporter Michael Fischer, service team ICNT_1SUP-DE, priority medium. Plan on-site service P700_SERV_ONS 3 HR and spare part P700-SC-100 1 PC. Expected net value 3.693 EUR.

   Ergebnis:
   - 18 Felder sind gefüllt.
   - Functional Location, Referenzprodukt sowie Service- und Verkaufsorganisation werden abgeleitet.
   - *Test Case in Words* fasst den Fall zusammen.

   Alternativ lassen sich die Felder direkt per Type-ahead erfassen, z. B. `C700`, `H2POW`, `EL-1`, `P700`, `Fischer`.
3. **Validate** (Footer) → *Validation finished: 21 fields validated · 0 warnings · 0 errors*, Status `Valid`.
4. **Create** → Case ID `STC-2026-000004`.
5. **Approve**, dann **Start Execution**. Der Status aktualisiert sich alle 2 s; die sechs Schritte laufen sichtbar bis `Finished`.
6. **Ergebnis:**
   - Final Result `Passed`, 19 Assertions `Passed`.
   - *SAP Objects* und *Document Flow* zeigen **8000000010 · 8000000030 · 8000000031 · 9000000000 · 10000012 · 90000115**.
   - Nettowert 3.693,00 EUR.

**Schnellpfad:** `STC-2026-000003` öffnen → *Edit* → *Validate* → *Save* → *Approve* → *Start Execution*.

### Fehlerpfad (DoD-4)

1. `STC-2026-000002` → *Edit* → *Validate*.
2. Ergebnis:
   - Fehler am Feld *Equipment*: „Equipment EL-200 does not belong to functional location H2POWC00-PROD (installed at H2POWC01-PROD).“ Die Vorschläge sind `EL-100` und `EL-101`.
   - *Approve* bleibt deaktiviert.
3. In *Validation Issues* auf **Apply Suggestion** klicken. Der Wert (vorbelegt `EL-100`) wird übernommen, das Referenzprodukt folgt dem Equipment.
4. *Validate* → `Valid` → *Save* → *Approve* ist aktiv.

### Warnpfad (DoD-5)

1. *New Test Case* → diesen Text eingeben → *Analyze* → *Validate*:

   > Customer C700-C00 reports "Cooling pressure drop" on equipment EL-10, reported by Fischer. On-site service P700_SERV_ONS 3 HR, part P700-SC-100 1 PC, team ICNT_1SUP-DE, expected net value 3693 EUR.

2. Ergebnis:
   - Status `Ambiguous` mit zwei Warnungen samt Kandidatenlisten: `CP-700001, CP-700102` und `EL-100, EL-101`.
   - Die Functional Location wird trotzdem eindeutig abgeleitet, weil beide Equipments an `H2POWC00-PROD` hängen.

### Konfiguration (DoD-6)

1. Einen Testfall ohne Reporter erfassen → *Validate* → Fehler „Reporter is required …“.
2. **Overview → Configuration → Field Service – Time & Material** → *Edit* → in *Field Requirements* beim Reporter *Required* abwählen → *Save*.
3. Den Testfall öffnen → **Revalidate** → `Valid`, ohne Codeänderung.

### Ergebnisarten (DoD-7)

| Endergebnis | So erreichbar |
|---|---|
| `PASSED` | Golden Path |
| `PASSED_WITH_WARNING` | *Expected Net Value* 3.690,00 EUR mit *Net Value Tolerance* 5,00 EUR |
| `FAILED_FUNCTIONAL` | *Service Duration* 4 HR bei unveränderter Erwartung 3.693,00 EUR (Ist 4.693,00 EUR) |
| `FAILED_TECHNICAL` | *Service Part* `P700-SC-999` (Mock: Teil gesperrt, SIM-6) → Schritt Confirmation `Failed` |
| `BLOCKED` | *Cancel Execution*, solange die Ausführung läuft (SIM-7) |

Eine abgeschlossene Ausführung lässt sich mit *Start Execution* wiederholen; alle Läufe stehen im *Technical Log*.

### Nachrichtenkategorien (DoD-8)

| Kategorie | So auslösbar | Code |
|---|---|---|
| `VALIDATION_ERROR` | *Validate* mit Befunden (State-Messages je Feld, Message-Popover) | `ZSTC_TA/101…103` |
| `BUSINESS_ERROR` | *Analyze* ohne Szenariobeschreibung | `ZSTC_TA/201` |
| `AUTHORIZATION_ERROR` | Prozessprofil `FS_TM_4EYES` → *Approve* (Vier-Augen-Prinzip) | `ZSTC_TA/301` |
| `EXECUTION_ERROR` | Teil `P700-SC-999` → fehlgeschlagener Schritt | `ZSTC_TA/404` |
| `TECHNICAL_ERROR` | Prozessprofil `FS_TM_OUTAGE` → *Start Execution* (Provider nicht erreichbar) | `ZSTC_TA/501` |

## Befehle

| Befehl | Zweck |
|---|---|
| `npm start` | lokaler Server mit FLP-Sandbox und OData-V4-Mockserver |
| `npm test` | Unit-Tests (`node --test`, 30 Tests): ValidationEngine, Extraction, MockExecutionProvider, VerificationService, TestCaseService |
| `npm run build` | UI5-Build der App nach `dist/` (ohne Mock-Service) |
| `npm run build:hosted` | statische Hosted-Variante nach `dist-hosted/site/`: SAPUI5-Preloads, Themes mit eingebetteten Schriften, Browser-Mockserver |
| `npm run metadata` | erzeugt `webapp/localService/mainService/metadata.xml` aus `tools/metadata/contract.js` |
| `npm run seed` | erzeugt die Seed-Daten mit derselben Backend-Logik wie die App |

## Aufbau

```
zstc-testautomation/
├── webapp/                     App (unverändert beim Swap auf RAP)
│   ├── manifest.json           Routing: Overview (FPM), Test Cases (LR/OP), Configuration (LR/OP)
│   ├── ext/overview/           FPM Custom Page (Kennzahlen, Einstiege, Tabelle)
│   ├── ext/capture/            Custom Subsection „Test Case in Words“
│   ├── ext/documentflow/       Custom Section Document Flow (sap.suite.ui.commons.ProcessFlow)
│   ├── ext/controller/         Controller Extension der Object Page (Status-Polling)
│   └── localService/mainService/
│       ├── metadata.xml        Vertrag ZUI_STC_TEST_CASE_O4 inkl. UI-Annotationen (generiert)
│       └── data/               Mock-Daten (*.json) und dünne Handler (*.js) → mock-backend
├── mock-backend/               Verhalten des Mock-Backends (Node.js, nicht im UI-Bundle)
│   ├── services/               TestCaseService, ConfigurationService, Repository, Mockserver-Adapter
│   ├── validation/             ValidationEngine (Regeln R1–R9)
│   ├── extraction/             ITestCaseExtractionService / MockTestCaseExtractionService
│   ├── execution/              ITestExecutionProvider / MockExecutionProvider, MockS4ServiceChain
│   ├── verification/           VerificationService
│   └── test/                   Unit-Tests
├── tools/metadata/             Vertragsquelle und EDMX-Generator
├── tools/seed/                 Seed-Generator
└── tools/hosted/               Hosted-Variante (Browser-Mockserver, Seite, Build)
```
