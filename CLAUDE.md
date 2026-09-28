# CLAUDE.md — Projektgedächtnis

## Projekt
Service-to-Cash Test Automation Assistant — standalone lauffähiger **UI5-Mockup** (SAP Fiori elements for OData V4 + FPM) auf Mock-Daten, architektur-treu zum späteren RAP-Service `ZUI_STC_TEST_CASE_O4`.
Verbindlicher Auftrag: [`prompt.md`](prompt.md) (Regeln §2, Phasen §6, DoD §7, Anhänge A–E).

## Phasenstatus
| Phase | Stand |
|---|---|
| 1 — Architektur- & Mock-Contract-Validation | **geliefert, wartet auf Freigabe** → [`docs/phase-1-architektur-und-mock-vertrag.md`](docs/phase-1-architektur-und-mock-vertrag.md) |
| 2–6 | nicht begonnen. Phase 2 erst nach ausdrücklicher Freigabe von Phase 1 starten. |

## Arbeitsregeln (Kurzform aus `prompt.md` §2)
- Research-first mit offiziellen SAP-Quellen; keine Blogs als Source of Truth.
- Mock-Daten ja, Mock-Architektur nein.
- Nicht gegen SAP abgesicherte Namen tragen `⚠ NOCH ZU VERIFIZIEREN`.
- Nichts stillschweigend simulieren: `MockExecutionProvider` und `MockTestCaseExtractionService` sind klar als Mock benannt.
- Nach jeder Phase das Ergebnis vorlegen und stoppen.
- Legende der Belegstufen: siehe Abschnitt 1.2 im Phase-1-Dokument.

## Festgelegte Eckpunkte (vorbehaltlich Freigabe)
- SAPUI5 **1.136** LTS (S/4HANA 2025 / FES 2025), Theme `sap_horizon`.
- `@ui5/cli` 4.x, `@sap-ux/ui5-middleware-fe-mockserver` 2.4.x, `@sap-ux/preview-middleware` (FLP-Sandbox).
- Vertrag RAP-konform: Namespace `com.sap.gateway.srvd.zui_stc_test_case.v0001`, `<Alias>Type`, UUID + `IsActiveEntity`, Draft `Edit/Prepare/Activate/Discard`, `SAP__Messages`, `__OperationControl`, `__FieldControl`.
- Mock-Backend-Logik liegt in `zstc-testautomation/mock-backend/`, nicht in `webapp/`.

## Umgebungshinweise (Cloud-Sitzungen)
- Die Egress-Policy sperrte bisher SAP-Domains (`ui5.sap.com`, `api.sap.com`, `help.sap.com`, `learning.sap.com`, …). Nicht umgehen.
- Erreichbare Primärquellen:
  - `git clone https://github.com/SAP-docs/sapui5` (SAPUI5-Doku als Markdown)
  - `https://github.com/SAP/open-ux-odata` (FE-Mockserver)
  - npm `@sapui5/*`, `@sap-ux/*`
  - SAP Cloud SDK VDM (npm `@sap/cloud-sdk-vdm-*`, Maven `com.sap.cloud.sdk.s4hana`)
- Figma-MCP: Starter-Plan mit View-Seat, **max. 20 Aufrufe/Monat** — sparsam nutzen. Die Links der Make-Dateien fehlen noch.
