# CLAUDE.md — Projektgedächtnis

## Projekt
Service-to-Cash Test Automation Assistant — standalone lauffähiger **UI5-Mockup** (SAP Fiori elements for OData V4 + FPM) auf Mock-Daten, architektur-treu zum späteren RAP-Service `ZUI_STC_TEST_CASE_O4`.
Verbindlicher Auftrag: [`prompt.md`](prompt.md) (Regeln §2, Phasen §6, DoD §7, Anhänge A–E).

## Phasenstatus
| Phase | Stand |
|---|---|
| 1 — Architektur- & Mock-Contract-Validation | geliefert → [`docs/phase-1-architektur-und-mock-vertrag.md`](docs/phase-1-architektur-und-mock-vertrag.md) |
| 2–6 — Mockup | umgesetzt (auf Wunsch „Mockup, auf den ich zugreifen kann“ zusammengefasst) → [`zstc-testautomation/README.md`](zstc-testautomation/README.md), [`docs/mock-to-real-mapping.md`](docs/mock-to-real-mapping.md) |
| Erweiterung Agent + Messdienst | umgesetzt (Wunsch: Joule- oder anderen Agenten vorschalten, deutsche Problembeschreibung, Bezug Brunata Metrona) → [`docs/agent-konzept.md`](docs/agent-konzept.md), [`docs/messdienst-szenarien.md`](docs/messdienst-szenarien.md) |
| Erweiterung Prozessteams + Releases | umgesetzt (Wunsch: Prozessteams Reparatur/Montage/Angebot/Ablesung, Zwischentabelle zu Releases nach SAP-Zyklen (FPS), Rückverfolgbarkeit bis Prozessschritt, Pilot Reparaturprozess mit drei Wegen, Rollen, Versionen, Regression je Release) → [`docs/prozessteams-releases.md`](docs/prozessteams-releases.md) |
| Erweiterung E2E-Team, Startpunkt, Ergebnis besprechen, Auswertung | umgesetzt (Wunsch 06.10.2026: Fakturieren + FI-Beleg → Team „New End to End Prozess“ `PT-E2E`; Zielsystem SAP S/4HANA 2025; wählbarer Startpunkt je Team, auch direkt ab Quote; Agenten-Absprung „hinten raus“ zum validierten Besprechen der Ergebnisse; Auswertungsdashboard) → Abschnitte 6.3, 11, 12 in `docs/prozessteams-releases.md`. **Bestehende Testfälle liegen als Excel beim Nutzer, wurden aber nicht mitgeliefert** → Vorlage [`docs/vorlagen/testfall-import-vorlage.xlsx`](docs/vorlagen/testfall-import-vorlage.xlsx) (Generator `zstc-testautomation/tools/templates/import_template.py`, braucht `openpyxl`) bzw. `.csv`; nichts erfinden |

Gehostete Variante (privates Artifact, enthält SAPUI5 unter SAP Developer License — Nutzer hat „privat veröffentlichen“ gewählt, nicht öffentlich teilen): https://claude.ai/artifact/PuLrAKkFiAYpWsmYz253UK — Update: `npm run build:hosted`, dann denselben Artifact-Link neu veröffentlichen (`root` = `dist-hosted/site`, 177 Begleitdateien, `.properties` mit contentType `text/plain`). Bei gleicher SAPUI5-Version reichen die geänderten Dateien (`app/*`, `mockserver.js`, `boot.js`, `launcher/Launcher.js`, `resources/zstc-i18n-preload.js`); nicht übergebene Dateien bleiben erhalten. `capabilities` weglassen, dann bleibt `{sample: {}}` gespeichert (Service-Assistent nutzt Claude über die claude.ai-Capability `sample`). Stand: Version 3 vom 02.10.2026 (Prozessteams und Releases).

## Arbeitsregeln (Kurzform aus `prompt.md` §2)
- Research-first mit offiziellen SAP-Quellen; keine Blogs als Source of Truth.
- Mock-Daten ja, Mock-Architektur nein.
- Nicht gegen SAP abgesicherte Namen tragen `⚠ NOCH ZU VERIFIZIEREN`.
- Nichts stillschweigend simulieren: `MockExecutionProvider`, `MockTestCaseExtractionService` und der Mock-Agent (regelbasiert) sind klar als Mock benannt; der aktive Agent-Modus steht sichtbar auf der Seite.
- Keine Schlüssel und keine Modell-ID im Repo: der lokale Claude-Proxy liest `ANTHROPIC_API_KEY` und `ANTHROPIC_MODEL` nur aus der Umgebung.
- Messdienst-Daten sind fiktiv; keine Marken, Logos oder Namen von Brunata Metrona in der App (Bezug nur fachlich in den Docs).
- Nach jeder Phase das Ergebnis vorlegen und stoppen.
- Legende der Belegstufen: siehe Abschnitt 1.2 im Phase-1-Dokument.

## Festgelegte Eckpunkte
- SAPUI5 **1.136** LTS (S/4HANA 2025 / FES 2025), Theme `sap_horizon`.
- `@ui5/cli` 4.x, `@sap-ux/ui5-middleware-fe-mockserver` 2.4.x, `@sap-ux/preview-middleware` (FLP-Sandbox).
- Vertrag RAP-konform: Namespace `com.sap.gateway.srvd.zui_stc_test_case.v0001`, `<Alias>Type`, UUID + `IsActiveEntity`, Draft `Edit/Prepare/Activate/Discard`, `SAP__Messages`, `__OperationControl`, `__FieldControl`.
- Mock-Backend-Logik liegt in `zstc-testautomation/mock-backend/`, nicht in `webapp/`.

## Arbeitsweise im Projekt `zstc-testautomation/`
- Vertrag ändern: `tools/metadata/contract.js` → `npm run metadata`; danach Mockserver neu starten. Stand: `@sap-ux/annotation-converter` meldet 0 Diagnosen (Prüfskript lag nur in der Sitzung, nicht im Repo).
- Seed-Daten: `npm run seed` (nutzt dieselben Services wie die App; deterministische UUIDs/Uhr).
- Tests: `npm test` (78 Unit-Tests: `mock-backend/test/`, `test/agent/` inkl. `result.test.js`, `analytics.test.js`). E2E wurde mit Playwright gegen `ui5 serve` und die Hosted-Variante (CSP-Emulation) gefahren — Agent in allen drei Modi (Mock-Agent, lokaler Proxy gegen Fake-Upstream, simuliertes `window.claude`); echte Claude-Antworten wurden nicht getestet (kein API-Key, Viewer nicht automatisierbar).
- Service-Assistent: `webapp/ext/agent/` (Seite, OData-Gateway, Transports), `webapp/ext/agent/core/` (UI5-freier Kern, in Node testbar über `test/agent/helpers.js`), `tools/agent-proxy/middleware.js` (UI5-Middleware in `ui5-mock.yaml`, offizielles SDK `@anthropic-ai/sdk`).
- Routing: Service-Assistent ist Startseite (`:?query:`), Overview liegt auf `Overview:?query:`; zweite FPM-Seite ohne Kontext braucht `"contextPattern": ""` im Target, sonst bindet FE `/Overview`.
- Mockserver-Handler bleiben dünn (`webapp/localService/mainService/data/*.js`); Logik in `mock-backend/services/`.
- Abgeleitete Felder (Status, Criticality, `__OperationControl`, `__FieldControl`) werden beim Schreiben gespeichert (`syncDerived`) und beim Lesen neu berechnet — `$select`/`$filter` laufen vor `onAfterRead`.
- Fiori-elements-Verhalten: Info-Transition-Messages öffnen einen Dialog → für Erfolg `numericSeverity 1` (Toast).
- FE 1.136: In Tabellen auf Object Pages von Draft-Objekten **keine Zellen-Criticality** (`DataField.Criticality`) – beim Edit/Save loggt FE sonst „Failed to drill-down into _X(…)“. Status-Farbe als Zeilen-Highlight (`UI.LineItem@UI.Criticality`). Prüfskript: alle Sections rendern (scrollen), Edit, Save, Fehler zählen.
- OP-Tabellen sortieren: ReferenceFacet zielt auf `_X/@UI.PresentationVariant`; `controlConfiguration` bleibt auf dem LineItem-Pfad. Zeilen aus Lesemodellen navigieren über Manifest-`navigation` + `routing.onBeforeNavigation` (`ext/controller/traceNavigation.js`).
- Lesemodelle (`ReleaseTestCase`, `ReleaseStepCoverage`) werden bei jeder Änderung neu berechnet (`TraceabilityService.refreshAll`); Schlüssel per `stableUUID` aus dem Inhalt, damit gecachte Zeilen gültig bleiben.
- Prozessmodell: Pfad = Schritte des Weges (`Variants`) nach `Sequence`; Abschnitt = Start..Ende (`catalog.section`, Vertragsfindung vor dem Start bleibt); Ausführungsplan = automatisierte Pilot-Schritte mit Business Object; Übergabe = Teamwechsel entlang des Pfads. Start vorbelegt mit dem ersten Planschritt des Teams; Start ab Rückmeldung/Fakturaanforderung/Faktura braucht `PredecessorTestCase` (R12, Meldung 211), Belege `DocumentOrigin = TAKEN_OVER`; Regressionslauf: abhängige Testfälle `WAITING`. Rollen `PROCESS_OWNER`/`TEST_EXECUTOR` je Team, Prüfung serverseitig (`executionCheck`, `requireRole`). Benutzer im Mock: `DEMO_USER` (PO+TE im Team Reparatur, TE im Team E2E).
- Ergebnisanalyse: `mock-backend/analysis/ResultAnalysisService.js` → `ResultFinding` (+ `Execution.AnalysisHeadline`), deterministisch, nur Evidenz des Laufs; deutsche Texte für Agent/Dashboard in `webapp/ext/agent/core/resultReport.js` (fügt keine Ursachen hinzu). Absprung: Kopfaktion `ResultActions.discuss` → Route `AgentPage` mit `?analyze=<uuid>&n=<nonce>`; die Seite liest die Query per `patternMatched` und beim Start per `getRouteInfoByHash`.
- Schrittabdeckung: Entscheidungen/manuelle Schritte gelten als abgedeckt, wenn der Lauf einen späteren Schritt erreicht hat (nie „failed“ wegen späterer Fehler).
- Manifest-Ausdrucksbindungen (Custom Actions `visible`/`enabled`) auf OData-V4-Eigenschaften mit `%{…}` (Rohwert); `${…}` formatiert mit dem Eigenschaftstyp → FormatException beim Zieltyp boolean, Button bleibt sichtbar.
- Dashboard `ext/analytics/` (FPM, Route `Analytics:?query:` mit `release=`): `sap.suite.ui.microchart` steht **nicht lazy** im Manifest (Hosted-Variante hat nur Library-Preloads). InteractiveLineChart braucht Container fester Höhe (≥ 106 px, FlexBox `renderType="Bare"`); RadialMicroChart erst nach dem Laden zeigen (sonst NaN-Pfade); `MessageStrip type="None"` gibt es nicht.
- Nummernkreise nach Seed: Case ab `STC-2026-000015`, Ausführung `0008`, FI-Beleg ab `1400000100`; Golden-Belegnummern unverändert. Seed STC-7 hat einen zweiten, fehlgeschlagenen Lauf (Version 2) → Regressionslauf auf FPS02 endet mit 1 Fehlschlag und FE-Warndialog.

## Umgebungshinweise (Cloud-Sitzungen)
- Die Egress-Policy sperrte bisher SAP-Domains (`ui5.sap.com`, `api.sap.com`, `help.sap.com`, `learning.sap.com`, …) und `brunata-metrona.de`. Nicht umgehen; WebSearch-Auszüge funktionieren.
- Erreichbare Primärquellen:
  - `git clone https://github.com/SAP-docs/sapui5` (SAPUI5-Doku als Markdown)
  - `https://github.com/SAP/open-ux-odata` (FE-Mockserver)
  - npm `@sapui5/*`, `@sap-ux/*` (SAPUI5-Quellen liegen nach `ui5 serve` unter `~/.ui5/framework/packages/`)
  - SAP Cloud SDK VDM (npm `@sap/cloud-sdk-vdm-*`, Maven `com.sap.cloud.sdk.s4hana`)
- Figma-MCP: Starter-Plan mit View-Seat, **max. 20 Aufrufe/Monat** — sparsam nutzen. Die Links der Make-Dateien fehlen noch.
