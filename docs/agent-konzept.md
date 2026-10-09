# Service-Assistent: Agent vor der App (Joule-Zielbild und Umsetzung im Mockup)

Stand: 09.10.2026 · gehört zu [prompt.md](../prompt.md) · Belegstufen wie in [Phase 1, Abschnitt 1.2](phase-1-architektur-und-mock-vertrag.md)

## 1. Ziel

Ein Agent steht **vor** der App:

1. Die Nutzerin schildert eine Störung auf Deutsch, z. B. „Heizkostenverteiler im Wohnzimmer zeigt nichts an“ oder „Rauchmelder piept“.
2. Der Agent erfasst daraus einen Testfall-Entwurf.
3. Er prüft ihn gegen Stammdaten und Validierung und fragt nach, wenn etwas fehlt oder mehrdeutig ist.
4. Nach Bestätigung übergibt er den Testfall an die App: speichern, freigeben, Ausführung starten.

Die App übernimmt ab da. Die Object Page zeigt Fortschritt, Belegfluss, Assertions und Endergebnis.

Seit dem 09.10.2026 kann der Agent außerdem:

- **mehrere Testfälle auf einmal** anlegen (Testpaket), z. B. „Zum nächsten Release möchte ich jeden Prozess durchtesten. Leg mir dafür Testfälle an, welche auf die Prozessbeschreibung passen.“ (Abschnitt 3.3b);
- **alle Testfälle eines Prozessteams** ausführen, z. B. nach einer Code-Änderung im Standardreparaturprozess (Abschnitt 3.3c);
- zu jedem Entwurf ein **Prozessbild** zeigen: welche Schritte der Testfall durchläuft (Details in [prozessteams-releases.md, Abschnitt 15](prozessteams-releases.md#15-prozessbild)).

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
  Chat · Entwurfskarte bzw. Ergebnis-Panel · Protokoll     AgentPage.view.xml / .controller.js
  Absprung ?analyze=<TestCaseUUID> aus Testfall/Auswertung ext/controller/ResultActions.js, ext/analytics/
        │
        ▼
  AgentSession (Unterhaltung, Entwurf, Testpaket,        core/AgentSession.js, core/resultReport.js
               Teamlauf oder Ergebnis)                   core/testDesign.js, core/testPackage.js, core/teamRun.js
  Prozessbild (App-Control, SVG)                         ext/process/ProcessPicture.js, ext/process/pictureLayout.js
    ├─ Transport „claude“ ─ claude.ai-Capability sample   transports.js  (Hosted-Variante im claude.ai-Viewer)
    │                     └ lokaler Proxy /agent-api      tools/agent-proxy/middleware.js (npm start, Key nur serverseitig)
    └─ Transport „rules“  ─ Mock-Agent (regelbasiert)     core/RuleBasedAgent.js
        │
        ▼
  Tools (gleiche Definition für alle Transports)          core/agentTools.js
        │
        ▼
  TestCaseGateway: OData-V4-Modell der App                TestCaseGateway.js
        │  Wertehilfen · POST/PATCH (Draft) · validate · Prepare/Activate · approve · startExecution · Ergebnis lesen
        │  Prozessmodell lesen · Release-Actions copyScopeFromPredecessor, startTeamRegressionRun, refreshRegressionRun
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
| `stammdaten_suchen` (Typ `servicevertrag`) | Servicevertrag zu Kunde, Liegenschaft oder Gerät (Weg 3) | GET `ServiceContractVH` | Vertrag mit Gültigkeit und Freigabe |
| `testfall_entwurf_erfassen` | Entwurf anlegen oder aktualisieren und validieren; mit `prozessvariante` (Weg), `start_objekt` (Start ab), `bis_objekt` (Endobjekt), `vorgaenger_testfall`, `prozessteam` und `voraussetzungen` | POST `TestCase` (Draft, mit Prozessprofil) · PATCH `TestCase` (Prozessbezug, zuerst; Vorgänger danach) · PATCH `TestCaseData` · Aktion `validate` · GET `_TestCaseData`, `_ValidationResult` | aktuelle Werte (mit Texten), Prozessbezug (Team, Weg, Start ab, Lauf bis, Vorgänger, Teststufe, Zuordnung), Validierungsstatus, Befunde mit Vorschlägen |
| `prozessmodell_lesen` | Prozessbeschreibung lesen: Prozesse, Wege (Pilot oder später), Schritte je Weg mit Team, Automatisierung und Beleg, vorhandene Testfälle je Weg; Prozesse ohne Schritte als „nicht modelliert“ gekennzeichnet; ändert nichts | GET `BusinessProcessVH`, `ProcessStepVH`, `ProcessVariant`, `ProcessTeamVH`, `TestCase` (mit `_TestCaseData`) | Prozesse mit Wegen, Schritten, Teams und Testfällen |
| `testpaket_entwerfen` | Testpaket für ein Release entwerfen (Abschnitt 3.3b): Release (leer = nächstes geplantes), Prozesse (leer = Scope des Release), Teilprozesse ja/nein | wie `testfall_entwurf_erfassen`, je Entwurf: POST `TestCase` (Draft) · PATCH Prozessbezug · PATCH `TestCaseData` · `validate`; GET `Release`, `ReleaseScope` | Entwürfe mit Status, Korrekturen und Hinweisen; Prüfung des Pakets (Abdeckung, Wege, Teams, Überschneidungen, Dubletten); nicht angelegte Prozesse/Wege mit Grund |
| `teamlauf_vorbereiten` | Lauf aller Testfälle eines Prozessteams oder Prozesses vorbereiten (Abschnitt 3.3c): Team, Prozess, Release, Anlass, abhängige Testfälle ja/nein | GET `Release`, `ReleaseScope`, `TestCase` (mit Status, Freigabe, Vorgänger) | Vorschau: läuft, wird übersprungen (Grund) oder wartet auf den Vorgänger; abhängige Testfälle anderer Teams |
| `ergebnis_lesen` | Ergebnis des letzten Laufs eines gespeicherten Testfalls lesen (ohne `case_id`: der besprochene Testfall); ändert nichts | GET `TestCase` (Filter `CaseID`) · `_LatestExecution`, `_LatestExecutionStep`, `_LatestTestAssertion`, `_LatestDocumentReference`, `_LatestResultFinding`, `_Execution` | Lauf (Release, Version, Ergebnis), Schritte, abweichende Prüfungen, Belege mit Herkunft, Befunde der Ergebnisanalyse (Ursache, Konfidenz, Evidenz, Team, Empfehlung), Historie |

Die Übergabe ist **kein Tool**. Speichern (`Prepare`, `Activate`), `approve` und `startExecution` löst allein die Schaltfläche **Übernehmen & starten** aus; beim Testpaket die Schaltfläche **Paket speichern**, beim Teamlauf **Teamlauf starten**. So bleibt der Mensch im Prozess. Auch die Plattformhinweise zu page tools verlangen das: Destruktives gehört hinter einen eigenen Bestätigungsschritt.

**Backend-Ableitungen**, die das Tool nutzt (RAP-Determinations in `TestCaseService`):

- Nutzeinheit und Kunde folgen aus dem Gerät.
- Die Serviceorganisation folgt aus dem Serviceteam.
- Der Gerätetyp (Referenzprodukt) folgt aus dem Gerät.
- Die Vorbelegungen kommen aus dem Prozessprofil (1 Std. Einsatz, 1 Ersatzgerät).
- Der erwartete Nettowert kommt aus der Mock-Preisliste, wenn er leer ist. Bei Weg 3 Rechnungsplan kommt er aus dem Rechnungsplan des Vertrags.
- Prozessbezug: Team des Benutzers und Standardweg als Vorbelegung. Bei Weg 3 ermittelt das Backend den Servicevertrag (Vertragsfindung). Testschritte und Teststufe folgen aus Weg und Endobjekt.
- Ändert sich der Weg, ermittelt das Backend Testschritte, Vertrag und Erwartung neu. Eine bestehende Freigabe wird widerrufen.

### 3.3 Regeln für den Agenten (Instruktionen in `core/prompts.js`)

- **Keine erfundenen IDs:** Nur IDs aus Suchergebnissen oder dem Kontext verwenden. Bei mehreren gleich guten Treffern nachfragen, höchstens zwei Fragen, Kandidaten als Auswahl.
- **Prozessprofil nach Gerätetyp:** Heizkostenverteiler → `MD_HKV_STOER`, Rauchwarnmelder → `MD_RWM_STOER`, Szenarien außerhalb des Messdienstes → `FS_TM`.
- **Fachlogik:** Leistung und Ersatzteil passen zum Gerätetyp (Regel R10). Der Meldende ist Ansprechpartner der Hausverwaltung, nicht der Bewohner. Die Problembeschreibung hat höchstens 40 Zeichen. Rauchwarnmelder bekommen Priorität hoch.
- **Kontext:** Jede Nutzernachricht beginnt mit einem Kontextblock der App (aktueller Entwurf, Befunde). So bleibt der Stand auch bei zustandslosen Aufrufen erhalten.
- **Prozessbezug:** Weg nach Wortlaut wählen: Angebot → `W2_QUOTATION`, Angebot abgelehnt → `W2_REJECTED`, Wartungs-, Service- oder Mietvertrag → `W3_CONTRACT`, Rechnungsplan → `W3_BILLING_PLAN`, Störung ohne Angebot → `W1_REQUEST`. `bis_objekt` nur auf ausdrücklichen Wunsch („bis zum Auftrag“). Garantie, Requote und In-House Repair sind nicht ausführbar.
- **Keine Freigabe und kein Start durch den Agenten.** Freigabe und Start prüfen die Rollen im Prozessteam serverseitig. Die Ausführung gehört automatisch zum Release, der für Team und Prozess im Test ist.
- **Start und Übergabe:** `start_objekt` nur auf ausdrücklichen Wunsch („direkt ab dem Angebot“); ohne Angabe startet der Lauf beim Einstieg des Teams. Braucht der Start einen Vorgänger (Regel R12), nimmt der Agent einen Vorschlag des Befunds oder fragt nach.
- **Testpaket und Teamlauf:** Wunsch nach Testfällen für ein Release oder jeden Prozess → `testpaket_entwerfen`; Wunsch, die Testfälle eines Teams oder Prozesses auszuführen → `teamlauf_vorbereiten`. Prozesse ohne Prozessschritte bekommen keine Testfälle; der Agent erfindet keine Schritte, Wege oder Teams. Gespeichert bzw. gestartet wird nur über die Schaltflächen.

### 3.3a Ergebnis besprechen (Absprung „hinten raus“)

- **Einstieg:** Kopfaktion **Ergebnis besprechen** auf dem Testfall (letzter Lauf), **Besprechen** auf der Seite *Analytics* (genau der Lauf, der für das Release zählt) oder im Chat „Ergebnis von STC-… besprechen“. Die Seite öffnet sich mit `?analyze=<TestCaseUUID>[&run=<Lauf>]&n=<Nonce>`; die Nonce verhindert, dass die Zurück-Navigation die Besprechung erneut öffnet. Ist der besprochene Lauf nicht der neueste, sagt der Bericht das.
- **Grundlage:** die deterministische Ergebnisanalyse des Backends (`ResultFinding`). Der erste Bericht kommt immer aus diesen Befunden (gekennzeichnet „Ergebnisanalyse (deterministisch)“), unabhängig vom Modus.
- **Mock-Agent:** beantwortet Fragen zu Ursache, Zuständigkeit, Vergleich mit dem letzten Lauf, Sicherheit, Empfehlung, Nettowert, Belegen, Schritten, Prüfungen, Übergabe und Testdaten – ausschließlich aus den Befunden (`core/resultReport.js`).
- **Claude:** eigene Instruktionen (`resultReport.instructions`): Ursachen nur mit Evidenz nennen, Vermutungen als Vermutung kennzeichnen und sagen, wie man sie prüft; keine Belege, Transaktionen, Customizing-Einstellungen oder Systemmeldungen erfinden; nichts ändern. Kontextblock = Befunde des Laufs; einziges Tool = `ergebnis_lesen`.
- **Grenze:** Der Assistent ändert in der Besprechung nichts. Korrekturen macht der Mensch im Testfall (neue Version, neue Validierung und Freigabe).

### 3.3b Testpaket: mehrere Testfälle aus der Prozessbeschreibung

- **Einstieg:** Chat, z. B. „Zum nächsten Release möchte ich jeden Prozess durchtesten. Leg mir dafür Testfälle an, welche auf die Prozessbeschreibung passen.“ oder das Beispiel *Testpaket für das nächste Release*. Erkannt werden Release (nächstes geplantes, Release-ID, „FPS03“, Monat, „Release in Test“) und genannte Prozesse (`core/testPackage.js`).
- **Testdesign** (`core/testDesign.js`, UI5-frei, auch vom Seed genutzt): je Pilot-Weg ein End-to-End-Testfall, je weiterem Prozessteam ein Teilprozess-Testfall ab seinem Einstieg; Testdaten aus zusammengehörigen Stammdaten (noch nicht genutzte Geräte, Kunden und Gerätetypen verteilt, Ansprechpartner des Kunden, Serviceteam der Region, gültiger Vertrag). Prozesse ohne Schritte und Wege außerhalb des Pilots werden mit Grund gemeldet.
- **Backend:** Jeder Entwurf entsteht über den OData-Vertrag und wird validiert (R1–R13). Eindeutige Korrekturen (R5/R10 Gerätetyp, R12 Vorgänger: erster Vorschlag) übernimmt der Assistent und nennt sie.
- **Prüfung des Pakets:** Abdeckung der automatisierten Schritte, alle Pilot-Wege, jedes Team mit eigenem Testfall, Überschneidungen mit vorhandenen Testfällen, Dubletten, ungültige Entwürfe ([prozessteams-releases.md, Abschnitt 18](prozessteams-releases.md#18-validierung-der-testfälle)).
- **Panel rechts:** Entwürfe mit Auswahl, Status und Hinweisen, **Prozessbild** je Entwurf (Dialog), **Im Formular öffnen**, Abdeckung des Pakets als Prozessbild. **Paket speichern** speichert die ausgewählten Entwürfe, verwirft die übrigen, gibt frei, wo der Benutzer Prozessverantwortung hat (Server prüft), und übernimmt bei Bedarf den Scope des Vorgänger-Release.

### 3.3c Teamlauf nach einer Code-Änderung

- **Einstieg:** Chat, z. B. „Möchte den Standardreparaturprozess testen, habe dort was im Coding angepasst. Nimm alle Testfälle, die dem Prozessteam zugeordnet sind, vor.“ oder das Beispiel *Teamlauf nach Code-Änderung*. Erkannt werden Team bzw. Prozess (ohne Team: das Team, dem der Prozess gehört), Anlass und „mit abhängigen Testfällen“ (`core/teamRun.js`).
- **Vorschau:** je Testfall läuft / wird übersprungen (Grund wie im Server) / wartet auf den Vorgänger; abhängige Testfälle anderer Teams nur auf Wunsch (Auswahl im Panel).
- **Start nur über „Teamlauf starten“:** Release-Action `startTeamRegressionRun` (Prozessteam, Prozess, Anlass, abhängige Testfälle) auf dem Release in Test; der Server prüft Gültigkeit, Freigabe, Version, Zuordnung, Vorgänger und die Rolle `TEST_EXECUTOR` je Team. Fortschritt per `refreshRegressionRun` alle zwei Sekunden.
- **Ergebnis:** Zusammenfassung mit deutschem Grund je übersprungenem Testfall; **Besprechen** öffnet genau den fehlgeschlagenen Lauf in der Ergebnisanalyse (Abschnitt 3.3a), **Auswertung** das Release-Dashboard. Dieselbe Action steht in der App auf der Release-Seite (*Start Team Run*).

### 3.4 Transports

| Transport | Wann | Sprachmodell | Zugangsdaten |
|---|---|---|---|
| claude.ai `sample` | Hosted-Variante im claude.ai-Artifact-Viewer. Wird per `window.claude.use("sample")` erkannt, Tools über `sample.limits().tools` | Claude auf dem Konto der Betrachterin. Die erste Nachricht fragt nach Zustimmung. | keine in der Seite. Die Plattform ruft die Tools der Seite auf. |
| Lokaler Proxy `/agent-api` | `npm start` mit gesetzten Umgebungsvariablen | Claude über die Messages API (offizielles SDK `@anthropic-ai/sdk`) | `ANTHROPIC_API_KEY` und `ANTHROPIC_MODEL` nur in der Umgebung des lokalen Servers. Nur Anfragen von localhost. |
| Mock-Agent (regelbasiert) | immer, und als Rückfall | **keins**: Backend-Aktion `analyze` (MockTestCaseExtractionService, deutsches Stichwortvokabular, Wegerkennung `processHints`) und deterministische Rückfragen; Antworten wie „mit Angebot“, „über den Wartungsvertrag“ oder „nur bis zum Auftrag“ ändern Weg und Endobjekt | – |

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
| Tools `stammdaten_suchen`, `testfall_entwurf_erfassen`, `ergebnis_lesen`, `prozessmodell_lesen`, `testpaket_entwerfen`, `teamlauf_vorbereiten` | Joule Skills/Actions auf dem Web-API-Binding von `ZUI_STC_TEST_CASE_O4`; Wertehilfen über `$search` | ⚠ |
| Testdesign im Agenten-Kern (`core/testDesign.js`) | Regeln mit den Prozessteams abstimmen; Prozessmodell aus SAP Signavio bzw. SAP Cloud ALM als Quelle | ⚠ |
| Teamlauf aus dem Chat (`startTeamRegressionRun`) | Auslöser nach Transportimport bzw. aus der CI; Cloud-ALM-Testplan | ⚠ |
| Ergebnisanalyse (`ResultAnalysisService`) als Grundlage der Besprechung | Determination im RAP-BO nach Laufende; der Agent bespricht nur deren Befunde | ⚠ Datenzugriff |
| Mock-Agent (Backend-`analyze` mit Stichwortabgleich) | `ITestCaseExtractionService` mit LLM im Backend (z. B. ABAP-KI-Funktionen) – Alternative oder Ergänzung zum Agenten | ⚠ |
| Übergabe per Schaltfläche (Prepare, Activate, approve, startExecution) | dieselben RAP-Aktionen, ausgelöst durch die Nutzerin in der App oder per Joule-Bestätigungsdialog | Vertrag steht |
| Fiktive Messdienst-Stammdaten | Stammdaten des Messdienstleisters (Liegenschaften, Nutzeinheiten, Geräte) in S/4HANA bzw. im Vorsystem | ⚠ |

## 5. Prüfung

| Was | Wie |
|---|---|
| Unit-Tests (`npm test`, 97 gesamt) | **Testpaket** (Release-Erkennung, Planung je Weg und Team, Validierung des Pakets, Speichern mit Freigabe nur im eigenen Team, Scope-Übernahme), **Teamlauf** (Erkennung von Team, Prozess und Anlass, Vorschau, Start, Fortschritt, abhängige Testfälle, Tool), **Prozessbild** (Abschnitt je Weg/Start/Ende wie im Backend, Ergebnisse, Layout), Proxy (Status, Bereinigung der Anfrage, eine Runde über das SDK gegen einen Fake-Upstream), Stammdatensuche, Mock-Agent (gültig, Rückfragen, Auto-Korrektur R10, kein Entwurf ohne Ort/Gerät, Prozessbezug, Wegwechsel per Antwort, Start ab Angebot, Vorgänger-Testfall, Wartungsvertrag mit Vertragsfindung bis zum Start), Tool-Normalisierung (inkl. Weg, Start und Endobjekt), Rechnungsplan-Weg über das Tool, Messages-API-Schleife (nur ergänzen, `is_error`, Refusal), `sample`-Transport mit simulierter Plattform, **Ergebnis besprechen** (Bericht, Rückfragen, Übergabefall, Absprung aus dem Chat, `ergebnis_lesen` mit eigenen Instruktionen) |
| E2E (Playwright, lokal) | **Ergebnis besprechen:** Testfall `STC-2026-000007` → Kopfaktion → Bericht mit Ursache, Konfidenz und Team → Fragen „Wer ist zuständig?“ und „Was hat sich seit dem letzten Lauf geändert?“ → Auswertung → Besprechen → zurück zum Assistenten (DE und EN). **Mock-Agent:** deutsche Meldung → Gültig → Übernehmen & starten → Object Page `Passed` (108,00 EUR). **Rückfragen:** Gerät mehrdeutig, Meldender fehlt → Antwort → Gültig, Entwurf im Formular, Chat bleibt erhalten. **Lokaler Proxy:** gegen einen skriptgesteuerten Fake-Upstream mit echter SDK-Anfrage (`x-api-key`, Fallback-Beta, Caching) → `Passed` (94,00 EUR). **claude.ai `sample`:** simuliertes `window.claude` ruft die Tools der Seite auf. **Prozessbezug:** Beispiel „Weg 3: Rauchwarnmelder laut Wartungsvertrag“ → Vertrag `4100000001`, Gültig → „nur bis zum Auftrag“ → Lauf bis Serviceauftrag → Übernehmen & starten → `Passed` |
| E2E Testpaket und Teamlauf (Playwright, lokal) | „Zum nächsten Release jeden Prozess durchtesten“ → 7 gültige Entwürfe für `S4-2025-FPS02`, Abdeckung 11 von 11, Montage/Angebotsprozess/Ablesung als nicht modelliert gemeldet → Prozessbild-Dialog → einen Entwurf abwählen → **Paket speichern** (6 gespeichert, 4 freigegeben, Scope übernommen). „Standardreparaturprozess … im Coding angepasst …“ → Vorschau (mit dem gespeicherten Paket) 15 laufen, 5 übersprungen → mit abhängigen Testfällen (+1 wartet auf seinen Vorgänger) → **Teamlauf starten** → 15 bestanden, 1 fehlgeschlagen (`STC-2026-000007`), 5 übersprungen (94 %) → **Besprechen** öffnet genau diesen Lauf. Release-Seite: *Start Team Run* mit Parameterdialog |
| Nicht geprüft | echte Antworten von Claude. In dieser Umgebung gibt es keinen API-Schlüssel, und der claude.ai-Viewer ist nicht automatisierbar. |

## 6. Quellen (Suchergebnisse, keine Primärquellen)

- SAP: [Joule Studio (Produktseite)](https://www.sap.com/sea/products/artificial-intelligence/joule-studio.html)
- SAP Community: [Agent builder in Joule Studio is now generally available](https://community.sap.com/t5/artificial-intelligence-blogs-posts/agent-builder-in-joule-studio-is-now-generally-available-build-your-own/ba-p/14289282) – Blog, Belegstufe C
- SAP Community: [Build, Deploy, and Extend AI Agents with Joule Studio](https://community.sap.com/t5/technology-blog-posts-by-sap/build-deploy-and-extend-ai-agents-with-joule-studio/ba-p/14105964) – Blog, Belegstufe C
- SAP Architecture Center: [Joule Skills](https://architecture.learning.sap.com/docs/golden-path/ai-golden-path/build-and-deliver/joule-skills) – gesperrt, nur Titel und Auszug
- SAP Community: [Building Custom AI Agents with SAP Joule Studio – Part 1](https://community.sap.com/t5/technology-blog-posts-by-members/building-custom-ai-agents-with-sap-joule-studio-a-practical-guide-part-1/ba-p/14402428) – Blog, Belegstufe C
- Anthropic: Messages API mit Tool-Use, offizielles SDK `@anthropic-ai/sdk` (verwendet im lokalen Proxy)
