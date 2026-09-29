# Service-to-Cash Test Automation Assistant — UI5-Mockup

Standalone lauffähiger Mockup auf Basis von **SAP Fiori elements for OData V4 + Flexible Programming Model**.

- Er läuft auf Mock-Daten und ist architektur-treu zum späteren RAP-Service `ZUI_STC_TEST_CASE_O4`.
- Die Durchklick-Kette lautet: Describe → Extract → Validate → Clarify → Approve → Execute → Verify → Document.
- **Vor der App steht der Service-Assistent:** Ein Agent nimmt eine deutsche Störungsmeldung entgegen, z. B. „Heizkostenverteiler zeigt nichts an“ oder „Rauchmelder piept“. Er erfasst und validiert den Testfall, fragt bei Unklarheiten nach und übergibt nach Bestätigung an die App, die ihn startet.
  - Sprachmodell: Claude über claude.ai oder einen lokalen Proxy; ein regelbasierter Mock-Agent ist immer verfügbar.
  - Zielbild für SAP: ein Joule-Agent.

Einstiege:

- **Ausprobieren ohne Installation:** privates Artifact <https://claude.ai/artifact/PuLrAKkFiAYpWsmYz253UK>
- **Lokal starten, Klickpfade und Befehle:** [zstc-testautomation/README.md](zstc-testautomation/README.md)
- **Service-Assistent und Joule-Zielbild:** [docs/agent-konzept.md](docs/agent-konzept.md)
- **Messdienst-Szenarien** (Heizkostenverteiler, Rauchwarnmelder; fiktive Daten): [docs/messdienst-szenarien.md](docs/messdienst-szenarien.md)
- **Mock → Real:** [docs/mock-to-real-mapping.md](docs/mock-to-real-mapping.md)

## Stand

| Phase | Ergebnis |
|---|---|
| 1 — Architektur- & Mock-Contract-Validation | [docs/phase-1-architektur-und-mock-vertrag.md](docs/phase-1-architektur-und-mock-vertrag.md) |
| 2 — OData-V4-Mock-Vertrag, Mock-Daten, lauffähiges Skelett | umgesetzt: `tools/metadata/`, `webapp/localService/`, `mock-backend/` |
| 3 — Shell, Navigation, List Report, Object Page | umgesetzt: Overview (FPM Custom Page), Test Cases, Configuration |
| 4 — Tabellengetriebene Erfassung, Value Helps, Validierung | umgesetzt: Erfassung je Business Object, Type-ahead, ValidationEngine R1–R10, *Apply Suggestion* |
| 5 — Execution-Simulation, Document Flow, Assertions, Ergebnis | umgesetzt: MockExecutionProvider, ProcessFlow, VerificationService, 5 Ergebnisarten |
| 6 — Politur, Mock→Real-Mapping, Run-Anleitung | umgesetzt: README, Mapping-Tabelle, Hosted-Variante, E2E-Prüfung |
| Erweiterung — Agent vor der App, Messdienst-Domäne | umgesetzt: Service-Assistent (Startseite), Tools auf dem OData-Vertrag, lokaler Claude-Proxy, Mock-Agent, deutsche Extraktion, Messdienst-Stammdaten und -Profile, Regel R10 |

**Offen** (siehe Phase 1, Abschnitt 6, und [agent-konzept.md](docs/agent-konzept.md)):

- Figma-Abgleich; die Links der Make-Dateien fehlen noch (F-1).
- FPM-Explorer-Abgleich; dafür muss `ui5.sap.com` freigegeben werden (F-3, DoD-13).
- Reale Ausführung (F-8).
- Joule-Zielbild verifizieren: Joule Studio, API-Freigabe, Destination (F-14).
- Realer Messdienst-Prozess, z. B. Gewährleistung und Ferninspektion.

Projektauftrag: [prompt.md](prompt.md).
