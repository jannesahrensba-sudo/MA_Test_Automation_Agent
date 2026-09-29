# Service-Assistent: Agent vor der App (Joule-Zielbild und Umsetzung im Mockup)

Stand: 29.09.2026 · gehört zu [prompt.md](../prompt.md) · Belegstufen wie in [Phase 1, Abschnitt 1.2](phase-1-architektur-und-mock-vertrag.md)

## 1. Ziel

Ein Agent steht **vor** der App:

1. Die Nutzerin schildert eine Störung auf Deutsch, z. B. „Heizkostenverteiler im Wohnzimmer zeigt nichts an“ oder „Rauchmelder piept“.
2. Der Agent erfasst daraus einen Testfall-Entwurf.
3. Er prüft ihn gegen Stammdaten und Validierung und fragt nach, wenn etwas fehlt oder mehrdeutig ist.
4. Nach Bestätigung übergibt er den Testfall an die App: speichern, freigeben, Ausführung starten.

Die App übernimmt ab da. Die Object Page zeigt Fortschritt, Belegfluss, Assertions und Endergebnis.

Fachlich ist der Agent auf **Messdienst-Störungen** ausgerichtet: Heizkostenverteiler, Rauchwarnmelder und Wasserzähler. Die Prozesslogik orientiert sich am öffentlich beschriebenen Leistungsspektrum von Messdienstleistern wie Brunata Metrona. Alle Stammdaten sind **fiktiv**, siehe [messdienst-szenarien.md](messdienst-szenarien.md).

## 2. Zielbild SAP: Joule-Agent

> Alle Aussagen in diesem Abschnitt beruhen auf Suchergebnissen: SAP-Community-Blogs, sap.com-Produktseiten und PDF-Titel auf api.sap.com. Die Primärquellen (help.sap.com, api.sap.com, learning.sap.com) sperrt die Egress-Policy dieser Umgebung. Deshalb gilt für den ganzen Abschnitt: **⚠ NOCH ZU VERIFIZIEREN** (Belegstufe C).

| Baustein | Zielbild | Status |
|---|---|---|
| Joule Studio (SAP Build) | Baut **Joule Skills** (ein fokussierter, deterministischer Schritt, ruft eine Action/API) und **Joule Agents** (planen, wählen Skills als Tools, fassen zusammen). Der Agent Builder soll allgemein verfügbar sein. | ⚠ |
| Actions | Action-Projekte aus einem OData-V4-Service. Die Verbindung zu S/4HANA läuft über eine BTP-Destination. | ⚠ |
| Tools des Agenten | Je Tool ein Skill bzw. eine Action auf dem RAP-Service `ZUI_STC_TEST_CASE_O4` (API-Veröffentlichung als Web-API-Binding, Name offen). | ⚠ |
| Sprache | Deutsch steht in der Liste der von Joule unterstützten Sprachen. | ⚠ |
| Identität | Principal Propagation: Der Agent handelt mit den Berechtigungen der Nutzerin in S/4HANA. | ⚠ |
| Übergabe an die App | Joule öffnet die Fiori-App per Navigation auf die Object Page des Testfalls. | ⚠ |
| Fachwissen | Störungsbilder und Serviceprozesse des Messdienstes als Instruktionen und ggf. Document Grounding. | ⚠ |

**Offene Punkte für das Zielbild (F-14):**

- Verfügbarkeit und Lizenz von Joule und Joule Studio in der Zielumgebung (S/4HANA Cloud Private Edition oder On-Premise mit BTP).
- API-Freigabe des RAP-Service. Kann eine Action draft-fähige RAP-BOs bedienen, oder braucht es ein eigenes Web-API-Binding ohne Draft?
- Destination und Principal Propagation.
- Evaluationsset deutscher Störungsmeldungen.
- **Datenschutz**: Bewohnernamen sind personenbezogene Daten. Im realen Betrieb nur die nötigen Angaben übergeben.

## 3. Umsetzung im Mockup

### 3.1 Aufbau

```
Service-Assistent (Startseite, FPM Custom Page)          webapp/ext/agent/
  Chat · Entwurfskarte · Agent-Protokoll                   AgentPage.view.xml / .controller.js
        │
        ▼
  AgentSession (Unterhaltung, Entwurf, Schritte)          core/AgentSession.js
    ├─ Transport „claude“ ─ claude.ai-Capability sample   transports.js  (Hosted-Variante im claude.ai-Viewer)
    │                     └ lokaler Proxy /agent-api      tools/agent-proxy/middleware.js (npm start, Key nur serverseitig)
    └─ Transport „rules“  ─ Mock-Agent (regelbasiert)     core/RuleBasedAgent.js
        │
        ▼
  Tools (gleiche Definition für alle Transports)          core/agentTools.js
        │
        ▼
  TestCaseGateway: OData-V4-Modell der App                TestCaseGateway.js
        │  Wertehilfen · POST/PATCH (Draft) · validate · Prepare/Activate · approve · startExecution
        ▼
  ZUI_STC_TEST_CASE_O4 (Mock-Service; Logik in mock-backend/)
```

- **Mock-Daten ja, Mock-Architektur nein:** Der Agent greift nur über den OData-Vertrag zu, genau wie die App und später Joule.
- Die Tools sind kleine, deterministische Service-Aufrufe.
- Das Sprachmodell übernimmt Sprachverständnis und Formulierung.

### 3.2 Tools (Tool-Vertrag, auch für Joule)

| Tool | Zweck | OData-Operationen | Ergebnis |
|---|---|---|---|
| `stammdaten_suchen` | 1–6 Suchen je Aufruf. Typen: `geraet` (auch über Adresse, Bewohner, Geschoss, Raum), `nutzeinheit`, `liegenschaft`, `kunde`, `ansprechpartner`, `serviceteam`, `produkt` | GET auf `CustomerVH`, `FunctionalLocationVH`, `EquipmentVH`, `ContactPersonVH`, `ServiceTeamVH`, `ProductVH` … | bis zu 8 Treffer je Suche (ID, Bezeichnung, Beziehungen) und `eindeutig` |
| `testfall_entwurf_erfassen` | Entwurf anlegen oder aktualisieren und validieren | POST `TestCase` (Draft, mit Prozessprofil) · PATCH `TestCaseData` · Aktion `validate` · GET `_TestCaseData`, `_ValidationResult` | aktuelle Werte (mit Texten), Validierungsstatus, Befunde mit Vorschlägen |

Die Übergabe ist **kein Tool**. Speichern (`Prepare`, `Activate`), `approve` und `startExecution` löst allein die Schaltfläche **Übernehmen & starten** aus. So bleibt der Mensch im Prozess. Auch die Plattformhinweise zu page tools verlangen das: Destruktives gehört hinter einen eigenen Bestätigungsschritt.

**Backend-Ableitungen**, die das Tool nutzt (RAP-Determinations in `TestCaseService`):

- Nutzeinheit und Kunde folgen aus dem Gerät.
- Die Serviceorganisation folgt aus dem Serviceteam.
- Der Gerätetyp (Referenzprodukt) folgt aus dem Gerät.
- Die Vorbelegungen kommen aus dem Prozessprofil (1 Std. Einsatz, 1 Ersatzgerät).
- Der erwartete Nettowert kommt aus der Mock-Preisliste, wenn er leer ist.

### 3.3 Regeln für den Agenten (Instruktionen in `core/prompts.js`)

- **Keine erfundenen IDs:** Nur IDs aus Suchergebnissen oder dem Kontext verwenden. Bei mehreren gleich guten Treffern nachfragen, höchstens zwei Fragen, Kandidaten als Auswahl.
- **Prozessprofil nach Gerätetyp:** Heizkostenverteiler → `MD_HKV_STOER`, Rauchwarnmelder → `MD_RWM_STOER`, Szenarien außerhalb des Messdienstes → `FS_TM`.
- **Fachlogik:** Leistung und Ersatzteil passen zum Gerätetyp (Regel R10). Der Meldende ist Ansprechpartner der Hausverwaltung, nicht der Bewohner. Die Problembeschreibung hat höchstens 40 Zeichen. Rauchwarnmelder bekommen Priorität hoch.
- **Kontext:** Jede Nutzernachricht beginnt mit einem Kontextblock der App (aktueller Entwurf, Befunde). So bleibt der Stand auch bei zustandslosen Aufrufen erhalten.
- **Keine Freigabe und kein Start durch den Agenten.**

### 3.4 Transports

| Transport | Wann | Sprachmodell | Zugangsdaten |
|---|---|---|---|
| claude.ai `sample` | Hosted-Variante im claude.ai-Artifact-Viewer. Wird per `window.claude.use("sample")` erkannt, Tools über `sample.limits().tools` | Claude auf dem Konto der Betrachterin. Die erste Nachricht fragt nach Zustimmung. | keine in der Seite. Die Plattform ruft die Tools der Seite auf. |
| Lokaler Proxy `/agent-api` | `npm start` mit gesetzten Umgebungsvariablen | Claude über die Messages API (offizielles SDK `@anthropic-ai/sdk`) | `ANTHROPIC_API_KEY` und `ANTHROPIC_MODEL` nur in der Umgebung des lokalen Servers. Nur Anfragen von localhost. |
| Mock-Agent (regelbasiert) | immer, und als Rückfall | **keins**: Backend-Aktion `analyze` (MockTestCaseExtractionService, deutsches Stichwortvokabular) und deterministische Rückfragen | – |

Der lokale Proxy setzt serverseitig:

- `max_tokens`
- automatisches Prompt-Caching
- optional `output_config.effort` (`ANTHROPIC_EFFORT`)
- den Refusal-Fallback `fallbacks: "default"`, abschaltbar mit `ANTHROPIC_FALLBACKS=off`

Die Tool-Schleife läuft in der Seite (`core/messagesLoop.js`), weil die Tools die OData-Schnittstelle der App aufrufen. Der Verlauf wird nur ergänzt, nie nachträglich geändert. Abgelehnte oder abgebrochene Runden werden auf den Stand vor der Runde zurückgesetzt.

**Nicht still simuliert:** Der aktive Modus steht immer oben auf der Seite und an jeder Antwort. Der Mock-Agent ist als „Mock-Agent (regelbasiert, ohne Sprachmodell)“ gekennzeichnet.

## 4. Mock → Real

| Mockup | Real (Zielbild) | Status |
|---|---|---|
| Service-Assistent als FPM Custom Page (Startseite) | Joule-Panel im Fiori Launchpad; die App bleibt unverändert | ⚠ |
| Claude über claude.ai `sample` bzw. lokalen Proxy | Joule Agent (Joule Studio); Sprachmodell über SAP Generative AI Hub | ⚠ |
| Tools `stammdaten_suchen`, `testfall_entwurf_erfassen` | Joule Skills/Actions auf dem Web-API-Binding von `ZUI_STC_TEST_CASE_O4`; Wertehilfen über `$search` | ⚠ |
| Mock-Agent (Backend-`analyze` mit Stichwortabgleich) | `ITestCaseExtractionService` mit LLM im Backend (z. B. ABAP-KI-Funktionen) – Alternative oder Ergänzung zum Agenten | ⚠ |
| Übergabe per Schaltfläche (Prepare, Activate, approve, startExecution) | dieselben RAP-Aktionen, ausgelöst durch die Nutzerin in der App oder per Joule-Bestätigungsdialog | Vertrag steht |
| Fiktive Messdienst-Stammdaten | Stammdaten des Messdienstleisters (Liegenschaften, Nutzeinheiten, Geräte) in S/4HANA bzw. im Vorsystem | ⚠ |

## 5. Prüfung

| Was | Wie |
|---|---|
| Unit-Tests (`npm test`, 50) | Proxy (Status, Bereinigung der Anfrage, eine Runde über das SDK gegen einen Fake-Upstream), Stammdatensuche, Mock-Agent (gültig, Rückfragen, Auto-Korrektur R10, kein Entwurf ohne Ort/Gerät), Tool-Normalisierung, Messages-API-Schleife (nur ergänzen, `is_error`, Refusal), `sample`-Transport mit simulierter Plattform |
| E2E (Playwright, lokal) | **Mock-Agent:** deutsche Meldung → Gültig → Übernehmen & starten → Object Page `Passed` (108,00 EUR). **Rückfragen:** Gerät mehrdeutig, Meldender fehlt → Antwort → Gültig, Entwurf im Formular, Chat bleibt erhalten. **Lokaler Proxy:** gegen einen skriptgesteuerten Fake-Upstream mit echter SDK-Anfrage (`x-api-key`, Fallback-Beta, Caching) → `Passed` (94,00 EUR). **claude.ai `sample`:** simuliertes `window.claude` ruft die Tools der Seite auf |
| Nicht geprüft | echte Antworten von Claude. In dieser Umgebung gibt es keinen API-Schlüssel, und der claude.ai-Viewer ist nicht automatisierbar. |

## 6. Quellen (Suchergebnisse, keine Primärquellen)

- SAP: [Joule Studio (Produktseite)](https://www.sap.com/sea/products/artificial-intelligence/joule-studio.html)
- SAP Community: [Agent builder in Joule Studio is now generally available](https://community.sap.com/t5/artificial-intelligence-blogs-posts/agent-builder-in-joule-studio-is-now-generally-available-build-your-own/ba-p/14289282) – Blog, Belegstufe C
- SAP Community: [Build, Deploy, and Extend AI Agents with Joule Studio](https://community.sap.com/t5/technology-blog-posts-by-sap/build-deploy-and-extend-ai-agents-with-joule-studio/ba-p/14105964) – Blog, Belegstufe C
- SAP Architecture Center: [Joule Skills](https://architecture.learning.sap.com/docs/golden-path/ai-golden-path/build-and-deliver/joule-skills) – gesperrt, nur Titel und Auszug
- SAP Community: [Building Custom AI Agents with SAP Joule Studio – Part 1](https://community.sap.com/t5/technology-blog-posts-by-members/building-custom-ai-agents-with-sap-joule-studio-a-practical-guide-part-1/ba-p/14402428) – Blog, Belegstufe C
- Anthropic: Messages API mit Tool-Use, offizielles SDK `@anthropic-ai/sdk` (verwendet im lokalen Proxy)
