# zstc.testautomation — Service-to-Cash Test Automation Assistant (Mockup)

Klickbarer Mockup auf Basis von **SAP Fiori elements for OData V4 + Flexible Programming Model** (SAPUI5 1.136, Theme `sap_horizon`).

- Er läuft komplett auf **Mock-Daten** über einen lokalen OData-V4-Mockserver.
- Der Vertrag entspricht dem späteren RAP-Service `ZUI_STC_TEST_CASE_O4`. Beim Wechsel auf das reale Backend bleibt das UI unverändert (siehe [Mock→Real-Mapping](../docs/mock-to-real-mapping.md)).
- Es wird **kein SAP-System** aufgerufen.

**Startseite ist der Service-Assistent** (Agent vor der App, [Konzept und Joule-Zielbild](../docs/agent-konzept.md)):

1. Eine Störung wird auf Deutsch geschildert, etwa ein Heizkostenverteiler ohne Anzeige oder ein Rauchmelder, der piept.
2. Der Agent erfasst daraus einen Testfall und validiert ihn gegen die Stammdaten.
3. Er fragt nach, wenn etwas fehlt oder mehrdeutig ist.
4. Nach Bestätigung übergibt er an die App: speichern, freigeben, Ausführung starten.

Fachdomäne sind Messdienst-Störungen mit fiktiven Stammdaten ([Messdienst-Szenarien](../docs/messdienst-szenarien.md)). Die bisherige H2-Referenzdomäne bleibt erhalten.

**Prozessteams, Prozesse und Releases** ([Konzept](../docs/prozessteams-releases.md)):

- Jeder Testfall gehört zu einem Prozessteam, einem Prozess und einem Weg durch den Prozess. Er läuft **ab einem wählbaren Startobjekt** (vorbelegt mit dem Einstieg des Teams, z. B. direkt ab dem Angebot) **bis zu einem wählbaren Endobjekt**. Wer mitten im Prozess startet, übernimmt Belege und Testdaten eines Vorgänger-Testfalls.
- Fakturierung und FI-Beleg verantwortet das Prozessteam **New End to End Prozess** (`PT-E2E`). Zielsystem ist SAP S/4HANA 2025 (Takt nach Feature Package Stacks).
- Rückverfolgbarkeit: Prozessteam → Prozess → Prozessschritt → Testfall → Testlauf → Ergebnis.
- Pilot ist der Service-Reparaturprozess mit drei Wegen (ohne Angebot, mit Angebot, aus Vertrag).
- Releases (SAP-Release, FPS, SPS, Cloud-Release, interne Releases der Prozessteams) haben einen Scope aus Team × Prozess und starten bei Testbeginn automatisch einen Regressionslauf.
- Freigabe und Ausführung prüft das Backend gegen die Rollen im Prozessteam.

**Ergebnisse besprechen und auswerten:**

- Nach jedem Lauf erstellt das Backend eine deterministische **Ergebnisanalyse**: Befund, wahrscheinliche Ursache mit Evidenz und Konfidenz, zuständiges Team, Empfehlung, Vergleich mit dem vorigen Lauf.
- **Ergebnis besprechen** auf dem Testfall öffnet den Service-Assistenten mit diesem Ergebnis (Agenten-Absprung).
- Die Seite **Analytics** (Auswertung) zeigt je Release Kennzahlen, Ergebnis je Prozessteam, Verlauf, Fehlerbilder mit Absprung zum Assistenten und die Abdeckung je Prozessschritt.

**Was ist Mock?**

- `MockTestCaseExtractionService`: Keyword-/Token-Matching (englische IDs und deutsches Messdienst-Vokabular), kein Sprachmodell.
- Mock-Agent (regelbasiert): der Service-Assistent ohne Sprachmodell. Er ist immer verfügbar und so gekennzeichnet. Mit Claude arbeitet der Agent über die claude.ai-Capability `sample` (Hosted-Variante) oder über den lokalen Proxy (siehe unten).
- `MockExecutionProvider` mit `MockS4ServiceChain`: simulierte Service-to-Cash-Kette, keine SAP-Testautomatisierung. Die Kette folgt dem Weg des Testfalls, inklusive Vertragsfindung, Rechnungsplan und FI-Beleg.
- Wegerkennung aus dem Text (`processHints`): Schlüsselwortregeln wie „Angebot“, „Wartungsvertrag“, „bis zum Auftrag“, kein Sprachmodell.
- Regressionslauf eines Release: startet je Testfall eine Mock-Ausführung.
- Mock-Nummernkreise und Mock-Preisliste.

Die Validierung (`ValidationEngine`, Regeln R1–R12) und die Verifikation (`VerificationService`) sind echte, deterministische Logik. Dasselbe gilt für Rollenprüfung, Versionierung, Übergabe zwischen Testfällen, die Ergebnisanalyse (`ResultAnalysisService`) und die Release-Auswertung. Sie arbeiten hier auf Mock-Daten.

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

`npm start` öffnet `http://localhost:8080/test/flp.html?sap-language=EN#ServiceTestCase-manage`, die App in der FLP-Sandbox. Sie startet mit dem Service-Assistenten; die Übersicht erreichen Sie über **Overview**.

- `sap-language=DE` stellt die App-Texte auf Deutsch um. Die Feldbezeichnungen kommen aus dem Service und bleiben englisch. Der Service-Assistent spricht immer Deutsch.
- Ein Neustart des Servers stellt den Ausgangszustand her (DoD-12).

### Service-Assistent lokal mit Claude

Ohne weitere Einstellung arbeitet der Service-Assistent als **Mock-Agent (regelbasiert)**. Für Claude startet ihn der lokale Proxy `/agent-api` (`tools/agent-proxy/middleware.js`, offizielles SDK `@anthropic-ai/sdk`):

```bash
export ANTHROPIC_API_KEY=...        # Claude-API-Schlüssel, bleibt auf dem lokalen Server
export ANTHROPIC_MODEL=...          # Modell-ID laut Modellübersicht von Anthropic
npm start
```

- Schlüssel und Modell stehen nur in der Umgebung des lokalen Servers, nie im Frontend oder im Repository.
- Der Proxy nimmt nur Anfragen von `localhost` an. Er setzt `max_tokens`, Prompt-Caching und den Refusal-Fallback (`fallbacks: "default"`).
- Optionale Umgebungsvariablen:
  - `ANTHROPIC_EFFORT` (`low` … `max`)
  - `ANTHROPIC_FALLBACKS=off`
  - `AGENT_PROXY_ALLOW_REMOTE=1`
  - `ANTHROPIC_BASE_URL` (z. B. für ein Gateway)
- Hinter einem Unternehmens-Proxy braucht Node.js ≥ 22.21 zusätzlich `NODE_USE_ENV_PROXY=1`.

In der Hosted-Variante braucht es keinen Schlüssel. Im claude.ai-Viewer nutzt der Agent Claude über das Konto der Betrachterin; bei der ersten Nachricht wird um Zustimmung gebeten.

## Klickpfade

Die Seed-Daten enthalten vierzehn Testfälle:

| Case ID | Domäne | Weg | Inhalt |
|---|---|---|---|
| `STC-2026-000001` | H2 | Weg 2 | Referenzlauf, PASSED |
| `STC-2026-000002` | H2 | – | falsches Equipment, INVALID; Altfall ohne Prozessbezug (Zuordnung offen) |
| `STC-2026-000003` | H2 | Weg 2 | Golden Case, vorerfasst |
| `STC-2026-000004` | Messdienst | Weg 1 | Referenzlauf HKV-Tausch, PASSED; danach geändert (Version 2, neue Freigabe nötig) |
| `STC-2026-000005` | Messdienst | Weg 1 | falsches Ersatzteil für Rauchwarnmelder, INVALID (R10) |
| `STC-2026-000006` | Messdienst | Weg 2 | Golden Case Rauchwarnmelder, vorerfasst |
| `STC-2026-000007` | Messdienst | Weg 1 | Warmwasserzähler bis zum FI-Beleg (E2E mit Team New End to End Prozess): erster Lauf PASSED; in Version 2 Einsatzdauer erhöht, Erwartung nicht angepasst → zweiter Lauf FAILED_FUNCTIONAL mit Ergebnisanalyse (Regression) |
| `STC-2026-000008` | Messdienst | Weg 2 abgelehnt | Angebot für RWM-Tausch abgelehnt, PASSED |
| `STC-2026-000009` | Messdienst | Weg 3 | abgelaufener Gerätemietvertrag, INVALID (R11) |
| `STC-2026-000010` | Messdienst | Weg 3 | RWM-Tausch aus dem Servicevertrag, freigegeben |
| `STC-2026-000011` | Messdienst | Weg 3 Rechnungsplan | Vertragsabrechnung RWM-Service, freigegeben |
| `STC-2026-000012` | Messdienst | Weg 2 | Team Angebot, Start direkt ab dem Angebot bis zur Kundenannahme, freigegeben (Start durch `DEMO_USER` wird abgelehnt) |
| `STC-2026-000013` | Messdienst | Weg 1 | Team Reparatur bis zur Rückmeldung, PASSED; übergibt an `STC-2026-000014` |
| `STC-2026-000014` | Messdienst | Weg 1 | Team New End to End Prozess ab Fakturaanforderung bis FI-Beleg, Vorgänger `STC-2026-000013`, PASSED (Belege übernommen) |

Neue Testfälle bekommen ab `STC-2026-000015` fortlaufende Nummern, neue Läufe ab `MOCK-…-0008`. Die Golden-Belegnummern entstehen beim **ersten** Lauf je Sitzung; jeder weitere Lauf zählt fortlaufend weiter.

### Service-Assistent: Störungsmeldung → Start in der App (Agent)

1. Die App öffnet mit dem **Service-Assistenten**. Oben steht der aktive Modus:
   - *Mock-Agent (regelbasiert)*
   - *Claude* – lokaler Proxy oder claude.ai
2. Unter *Beispiele* den Eintrag *Heizkostenverteiler zeigt nichts an* wählen oder selbst schreiben:

   > Frau Müller aus der Musterstraße 12 in München (1. OG links) meldet über Petra Wagner von der Hausverwaltung, dass der Heizkostenverteiler im Wohnzimmer nichts mehr anzeigt – das Display ist komplett dunkel.

3. *Senden*. Der Agent erkennt das Profil *Messdienst – Störung Heizkostenverteiler*, legt den Entwurf an, befüllt ihn und validiert. Das *Agent-Protokoll* zeigt jeden Schritt.
   - Ergebnis: **Gültig**
   - Gerät `HKV-0815-031` in der Nutzeinheit `LG-0815-NE03`, Kunde `MD-100010`, Meldende Petra Wagner
   - Team `MD-TEAM-MUC`, 1 Std. Monteureinsatz + Ersatzgerät, erwarteter Nettowert 108,00 EUR
   - Prozessbezug: Prozessteam Reparatur, Weg 1 (Störung ohne Angebot), Lauf bis Faktura, Zuordnung „zugeordnet“
4. **Übernehmen & starten**: Der Testfall wird gespeichert (`STC-2026-000015`), freigegeben und gestartet. Danach öffnet sich die Object Page der App. Sie zeigt den laufenden Status, dann Final Result `Passed` und den Belegfluss.

**Rückfragen:** Das Beispiel *Mehrdeutig: HKV bei Müller* ergibt die Fragen „Welches Gerät?“ (Wohnzimmer, Schlafzimmer, Bad) und „Meldender fehlt“. Die Antwort „Im Schlafzimmer, gemeldet von Petra Wagner“ macht den Entwurf gültig. *Im Formular öffnen* zeigt den Entwurf auf der Object Page; zurück bleibt die Unterhaltung erhalten.

**Rauchwarnmelder:** *Rauchmelder piept* ergibt Profil `MD_RWM_STOER`, Priorität hoch und 94,00 EUR. *Rauchwarnmelder abgerissen (Köln)* ergibt die Nutzeinheit Nowak und das Monteurteam Köln.

**Weg und Endobjekt:**

- *Weg 3: Rauchwarnmelder laut Wartungsvertrag* ergibt Weg 3 und den ermittelten Servicevertrag `4100000001`.
- Die Antwort „nur bis zum Auftrag“ verkürzt den Lauf auf die Service Order; Testschritte und Erwartung werden neu ermittelt.
- „mit Angebot, der Kunde lehnt ab“ wechselt auf Weg 2 abgelehnt.
- „Bitte direkt ab dem Angebot testen“ setzt *Start from* = Angebot und Weg 2. „ab der Fakturaanforderung“ braucht einen Vorgänger-Testfall; der Agent fragt nach und schlägt passende Testfälle vor.

### Ergebnis besprechen und Auswertung

1. **Testfall `STC-2026-000007`** öffnen (Liste *Test Cases* oder Übersicht). Der Abschnitt *Result Analysis* zeigt die Befunde des letzten Laufs, *Execution* die Kernaussage.
2. **Ergebnis besprechen** (Kopfzeile): Der Service-Assistent öffnet mit dem Ergebnis. Rechts: Ergebnis *Fachlich fehlgeschlagen*, Kernaussage und Befunde mit Konfidenz; links der Bericht:
   - Nettowert 183,00 EUR statt 114,00 EUR; die Belege sind so bepreist, wie die Testdaten es vorgeben; die Erwartung weicht um genau 1 Std. MD-SRV-STOER ab (Konfidenz hoch, zuständig Prozessteam Reparatur).
   - Regression gegenüber dem vorigen Lauf: in Version 2 wurde die Einsatzdauer geändert.
3. **Fragen → Wer ist zuständig?** bzw. „Was hat sich seit dem letzten Lauf geändert?“ → *Senden*. Mit Claude sind freie Rückfragen möglich; die Antworten stützen sich auf dieselben Befunde.
4. **Auswertung** (im Ergebnis-Panel; oder Übersicht → *Analytics*; oder Release → *Analytics*): Release `INT-2026.10` mit Bestehensquote 83 %, Schrittabdeckung 75 %, Ergebnis je Prozessteam, Verlauf, Fehlerbildern und Abdeckung je Prozessschritt. **Besprechen** an einem Fehlerbild führt zurück zum Assistenten.
5. **Besprechung beenden** kehrt zum Testfall-Entwurf zurück. Im Chat startet „Ergebnis von STC-2026-000014 besprechen“ die Besprechung direkt (Übergabefall mit übernommenen Belegen).

### Prozessteams, Prozesse und Releases

1. **Overview → Process Teams → Prozessteam Reparatur:** Mitglieder mit Rollen (*Process Owner* gibt frei, *Test Executor* führt aus), verantwortete Prozessschritte und eigene Prozesse.
2. **Overview → Processes → Service-Reparaturprozess:**
   - Schritte REP-010 … REP-110 mit verantwortlichem Team, Zuordnung (zugeordnet, Annahme, offen), Übergaben und Automatisierung.
   - Die fünf Wege des Pilots und vier spätere Erweiterungen (Garantie, Requote, In-House Repair, Solution Quotation).
   - Versionshistorie: Version 2 ergänzt Weg 3.
3. **Overview → Releases → Prozessrelease Oktober 2026** (`INT-2026.10`, In Test):
   - **Start Regression Run** startet alle freigegebenen Testfälle des Scope. Nicht ausführbare Testfälle werden mit Begründung übersprungen.
   - Der Lauf aktualisiert sich bis zum Ende. Danach zeigt der Kopf Pass Rate und Step Coverage.
   - *Test Cases in Scope* und *Coverage per Process Step* zeigen das Ergebnis je Testfall und je Prozessschritt. Eine Zeile öffnet den Testfall bzw. den Prozess.
4. **Release `S4-2025-FPS02`** (Planned):
   - **Copy Scope from Predecessor** übernimmt sechs Scope-Zeilen.
   - **Edit** → *Release Status* „In Test“ → **Save**: Der Regressionslauf startet automatisch.
5. **Testfall `STC-2026-000012`** (Team Angebot, *Start from* Angebot) → **Start Execution**: Das Backend lehnt ab, weil `DEMO_USER` im Team Angebot keine Ausführungsberechtigung hat.
6. **Testfall `STC-2026-000014`** (Team New End to End Prozess): *Start from* Fakturaanforderung, *Predecessor Test Case* `STC-2026-000013`, *Takes Over* Rückmeldung. *SAP Objects* zeigt Service Request, Service Order und Rückmeldung mit Herkunft *Taken over*.
7. **Testfall `STC-2026-000010`** → **Edit** → *Process Variant* auf Weg 1 ändern:
   - Testschritte, Servicevertrag und erwarteter Nettowert werden neu ermittelt.
   - **Save** erzeugt Version 2 und widerruft die Freigabe. *Approve* gibt die neue Version frei.
8. **Test Cases** (Liste): Filter nach Prozessteam, Prozess, Weg und Zuordnung. Die Kachel *Assignment Open* auf der Übersicht zählt die Testfälle mit offener Zuordnung; in der Liste filtert man dafür nach *Process Assignment* = Open.

### Golden Path (DoD-2)

1. **Overview** (Schaltfläche auf dem Service-Assistenten) → *New Test Case*. Die Object Page öffnet sich im Entwurf. Prozessprofil `FS_TM` ist vorbelegt, dazu die Default-Werte aus der Konfiguration.
2. In *Describe Test Scenario* diesen Text einfügen und dann *Analyze* (Toolbar der Section *Input*) wählen:

   > Customer C700-C00 reports "System cooling partially failed" on equipment EL-100 at functional location H2POWC00-PROD. Reporter Michael Fischer, service team ICNT_1SUP-DE, priority medium. Plan on-site service P700_SERV_ONS 3 HR and spare part P700-SC-100 1 PC. Expected net value 3.693 EUR.

   Ergebnis:
   - 18 Felder sind gefüllt.
   - Functional Location, Referenzprodukt sowie Service- und Verkaufsorganisation werden abgeleitet.
   - *Test Case in Words* fasst den Fall zusammen.

   Alternativ lassen sich die Felder direkt per Type-ahead erfassen, z. B. `C700`, `H2POW`, `EL-1`, `P700`, `Fischer`.
3. **Validate** (Footer) → *Validation finished: 21 fields validated · 0 warnings · 0 errors*, Status `Valid`.
4. **Create** → Case ID `STC-2026-000015` (bzw. die nächste freie Nummer). *Process Reference* zeigt Team Reparatur, Weg 2 (Standardweg: Angebot, Kunde akzeptiert) und die sieben abgeleiteten Testschritte.
5. **Approve**, dann **Start Execution**. Der Status aktualisiert sich alle 2 s; die sieben Schritte laufen sichtbar bis `Finished`. Die Ausführung gehört zum Release `INT-2026.10` (In Test).
6. **Ergebnis:**
   - Final Result `Passed`, 20 Assertions `Passed`.
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
| `npm start` | lokaler Server mit FLP-Sandbox, OData-V4-Mockserver und Agent-Proxy `/agent-api` |
| `npm test` | Unit-Tests (`node --test`, 81 Tests): ValidationEngine, Extraction (inkl. Deutsch/Messdienst), MockExecutionProvider, VerificationService, TestCaseService, Messdienst-Szenarien, Prozesse/Releases (Wege, Start und Übergabe, Versionen, Rollen, Regressionslauf), Ergebnisanalyse, Agent-Kern (Mock-Agent, Tools, Messages-API-Schleife, `sample`-Transport, Ergebnis besprechen), Auswertungsmodell, lokaler Claude-Proxy gegen Fake-Upstream |
| `npm run build` | UI5-Build der App nach `dist/` (ohne Mock-Service) |
| `npm run build:hosted` | statische Hosted-Variante nach `dist-hosted/site/`: SAPUI5-Preloads, Themes mit eingebetteten Schriften, Browser-Mockserver |
| `npm run metadata` | erzeugt `webapp/localService/mainService/metadata.xml` aus `tools/metadata/contract.js` |
| `npm run seed` | erzeugt die Seed-Daten mit derselben Backend-Logik wie die App |
| `python3 tools/templates/import_template.py` | erzeugt die Excel-Importvorlage `docs/vorlagen/testfall-import-vorlage.xlsx` aus den Codelisten (braucht `openpyxl`) |

## Aufbau

```
zstc-testautomation/
├── webapp/                     App (unverändert beim Swap auf RAP)
│   ├── manifest.json           Routing: Service-Assistent (Start, FPM), Overview (FPM), Analytics (FPM), Test Cases, Configuration, Process Teams, Processes, Releases (je LR/OP)
│   ├── ext/agent/              Service-Assistent: Seite, OData-Gateway, Transports (claude.ai / Proxy / Mock-Agent)
│   │   └── core/               Agent-Kern ohne UI5-Abhängigkeit: Instruktionen, Tools, Messages-API-Schleife, Mock-Agent, Stammdatensuche, Ergebnis besprechen (resultReport)
│   ├── ext/analytics/          FPM Custom Page Analytics: Auswertung je Release (sap.m, sap.suite.ui.microchart), Rechenmodell ohne UI5
│   ├── ext/overview/           FPM Custom Page (Kennzahlen, Einstiege, Tabelle)
│   ├── ext/capture/            Custom Subsection „Test Case in Words“
│   ├── ext/documentflow/       Custom Section Document Flow (sap.suite.ui.commons.ProcessFlow)
│   ├── ext/controller/         Controller Extensions: Status-Polling (Testfall, Regressionslauf), Navigation aus Lesemodellen; Kopfaktionen „Ergebnis besprechen“ und „Analytics“
│   └── localService/mainService/
│       ├── metadata.xml        Vertrag ZUI_STC_TEST_CASE_O4 inkl. UI-Annotationen (generiert)
│       └── data/               Mock-Daten (*.json) und dünne Handler (*.js) → mock-backend
├── mock-backend/               Verhalten des Mock-Backends (Node.js, nicht im UI-Bundle)
│   ├── services/               TestCaseService, ConfigurationService, ProcessService, ReleaseService, TraceabilityService, Repository, Mockserver-Adapter
│   ├── process/                Prozesskatalog (Wege, Pfade, Endobjekte, Übergaben), Zuordnungsstatus, Rollenprüfung
│   ├── validation/             ValidationEngine (Regeln R1–R12)
│   ├── extraction/             ITestCaseExtractionService / MockTestCaseExtractionService, Wegerkennung (processHints)
│   ├── execution/              ITestExecutionProvider / MockExecutionProvider, MockS4ServiceChain
│   ├── verification/           VerificationService
│   ├── analysis/               ResultAnalysisService (Befund, Ursache, Evidenz, Konfidenz, Team, Empfehlung)
│   └── test/                   Unit-Tests
├── test/agent/                 Unit-Tests des Agent-Kerns (Node, In-Memory-Gateway auf dem Mock-Backend)
├── tools/agent-proxy/          lokaler Entwicklungs-Proxy zur Claude API (UI5-Middleware, Schlüssel nur serverseitig)
├── tools/metadata/             Vertragsquelle und EDMX-Generator
├── tools/seed/                 Seed-Generator, Prozesskatalog (Teams, Prozesse, Schritte, Wege, Releases, Scope)
├── tools/templates/            Excel-Importvorlage für bestehende Testfälle
└── tools/hosted/               Hosted-Variante (Browser-Mockserver, Seite, Build)
```
