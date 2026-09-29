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

Gehostete Variante (privates Artifact, enthält SAPUI5 unter SAP Developer License — Nutzer hat „privat veröffentlichen“ gewählt, nicht öffentlich teilen): https://claude.ai/artifact/PuLrAKkFiAYpWsmYz253UK — Update: `npm run build:hosted`, dann denselben Artifact-Link neu veröffentlichen (177 Begleitdateien aus `dist-hosted/site`, `.properties` mit contentType `text/plain`) und `capabilities: {sample: {}}` beibehalten (Service-Assistent nutzt Claude über die claude.ai-Capability `sample`).

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
- Tests: `npm test` (50 Unit-Tests: `mock-backend/test/`, `test/agent/`). E2E wurde mit Playwright gegen `ui5 serve` und die Hosted-Variante (CSP-Emulation) gefahren — Agent in allen drei Modi (Mock-Agent, lokaler Proxy gegen Fake-Upstream, simuliertes `window.claude`); echte Claude-Antworten wurden nicht getestet (kein API-Key, Viewer nicht automatisierbar).
- Service-Assistent: `webapp/ext/agent/` (Seite, OData-Gateway, Transports), `webapp/ext/agent/core/` (UI5-freier Kern, in Node testbar über `test/agent/helpers.js`), `tools/agent-proxy/middleware.js` (UI5-Middleware in `ui5-mock.yaml`, offizielles SDK `@anthropic-ai/sdk`).
- Routing: Service-Assistent ist Startseite (`:?query:`), Overview liegt auf `Overview:?query:`; zweite FPM-Seite ohne Kontext braucht `"contextPattern": ""` im Target, sonst bindet FE `/Overview`.
- Mockserver-Handler bleiben dünn (`webapp/localService/mainService/data/*.js`); Logik in `mock-backend/services/`.
- Abgeleitete Felder (Status, Criticality, `__OperationControl`, `__FieldControl`) werden beim Schreiben gespeichert (`syncDerived`) und beim Lesen neu berechnet — `$select`/`$filter` laufen vor `onAfterRead`.
- Fiori-elements-Verhalten: Info-Transition-Messages öffnen einen Dialog → für Erfolg `numericSeverity 1` (Toast).

## Umgebungshinweise (Cloud-Sitzungen)
- Die Egress-Policy sperrte bisher SAP-Domains (`ui5.sap.com`, `api.sap.com`, `help.sap.com`, `learning.sap.com`, …) und `brunata-metrona.de`. Nicht umgehen; WebSearch-Auszüge funktionieren.
- Erreichbare Primärquellen:
  - `git clone https://github.com/SAP-docs/sapui5` (SAPUI5-Doku als Markdown)
  - `https://github.com/SAP/open-ux-odata` (FE-Mockserver)
  - npm `@sapui5/*`, `@sap-ux/*` (SAPUI5-Quellen liegen nach `ui5 serve` unter `~/.ui5/framework/packages/`)
  - SAP Cloud SDK VDM (npm `@sap/cloud-sdk-vdm-*`, Maven `com.sap.cloud.sdk.s4hana`)
- Figma-MCP: Starter-Plan mit View-Seat, **max. 20 Aufrufe/Monat** — sparsam nutzen. Die Links der Make-Dateien fehlen noch.
