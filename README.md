# Service-to-Cash Test Automation Assistant — UI5-Mockup

Standalone lauffähiger Mockup auf Basis von **SAP Fiori elements for OData V4 + Flexible Programming Model**.

- Er läuft auf Mock-Daten und ist architektur-treu zum späteren RAP-Service `ZUI_STC_TEST_CASE_O4`.
- Die Durchklick-Kette lautet: Describe → Extract → Validate → Clarify → Approve → Execute → Verify → Document.

- **Ausprobieren ohne Installation:** privates Artifact <https://claude.ai/artifact/PuLrAKkFiAYpWsmYz253UK>
- **Lokal starten, Klickpfade und Befehle:** [zstc-testautomation/README.md](zstc-testautomation/README.md)
- **Mock → Real:** [docs/mock-to-real-mapping.md](docs/mock-to-real-mapping.md)

## Stand

| Phase | Ergebnis |
|---|---|
| 1 — Architektur- & Mock-Contract-Validation | [docs/phase-1-architektur-und-mock-vertrag.md](docs/phase-1-architektur-und-mock-vertrag.md) |
| 2 — OData-V4-Mock-Vertrag, Mock-Daten, lauffähiges Skelett | umgesetzt: `tools/metadata/`, `webapp/localService/`, `mock-backend/` |
| 3 — Shell, Navigation, List Report, Object Page | umgesetzt: Overview (FPM Custom Page), Test Cases, Configuration |
| 4 — Tabellengetriebene Erfassung, Value Helps, Validierung | umgesetzt: Erfassung je Business Object, Type-ahead, ValidationEngine R1–R9, *Apply Suggestion* |
| 5 — Execution-Simulation, Document Flow, Assertions, Ergebnis | umgesetzt: MockExecutionProvider, ProcessFlow, VerificationService, 5 Ergebnisarten |
| 6 — Politur, Mock→Real-Mapping, Run-Anleitung | umgesetzt: README, Mapping-Tabelle, Hosted-Variante, E2E-Prüfung |

**Offen** (siehe Phase 1, Abschnitt 6):

- Figma-Abgleich; die Links der Make-Dateien fehlen noch (F-1).
- FPM-Explorer-Abgleich; dafür muss `ui5.sap.com` freigegeben werden (F-3, DoD-13).
- Reale Ausführung (F-8).

Projektauftrag: [prompt.md](prompt.md).
