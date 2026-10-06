# Prozessteams, Prozesse und Releases im Testassistenten

Stand: 06.10.2026 · gehört zu [prompt.md](../prompt.md) · Belegstufen wie in [Phase 1, Abschnitt 1.2](phase-1-architektur-und-mock-vertrag.md) · Umsetzung in [`zstc-testautomation/`](../zstc-testautomation/README.md)

Dieses Dokument beschreibt die Erweiterung des SAP-Testassistenten um den **Prozess- und Prozessteam-Bezug**. Ziel: Jedes Prozessteam kann seine verantworteten Prozesse gezielt vorbereiten, testen und die Ergebnisse nachvollziehen. Tests laufen zu jedem Release automatisch durch – im DevOps-Takt der Prozessteams und im Takt der SAP-Releases.

Alle Daten im Mockup sind **fiktiv**. Der fachliche Bezug zu BRUNATA-METRONA steht nur in den Dokumenten, nicht in der App.

---

## 1. Ergebnis in Kürze

| Anforderung | Umsetzung im Mockup | Stand |
|---|---|---|
| Prozessteams anhand der bekannten Prozesse: Reparatur, Montage, Angebot, Ablesung | Vier Prozessteams `PT-REPARATUR`, `PT-MONTAGE`, `PT-ANGEBOT`, `PT-ABLESUNG` mit Mitgliedern und Rollen | 🧪 umgesetzt |
| Fakturieren und FI-Beleg gehören zum Prozessteam „New End to End Prozess“ (Aussage vom 06.10.2026) | Fünftes Team `PT-E2E` verantwortet REP-090, REP-095, REP-100 und REP-110 (Zuordnung „zugeordnet“) | 🧪 umgesetzt |
| Zielsystem SAP S/4HANA 2025 | Releasetakt nach Feature Package Stacks (Abschnitt 3.1); Public-Edition-Takt nicht relevant | geklärt |
| Zwischentabelle, die Releases zugeordnet wird | `ReleaseScope` = Release × Prozessteam × Prozess (mit Prozessversion und Regressionskennzeichen) | 🧪 umgesetzt |
| Release-Zyklen der SAP als Ansatz (FPS …) | Release-Typen SAP-Release, FPS, SPS, Cloud-Release (YYMM), Hotfix Collection und interner Release; FPS-Termine 2025 als Planungsstand | 🧪 umgesetzt, Termine ⚠ |
| Rückverfolgbarkeit Prozessteam → Prozess → Teilprozess/Prozessschritt → Testfall → Testlauf/Ergebnis | Eindeutige IDs auf jeder Ebene, Prozessschritt-ID in Testschritten, Ausführungsschritten, Belegen und Assertions | 🧪 umgesetzt |
| Versionierte Prozess- und Testfallstände | Prozessversion bei jeder Aktivierung mit Änderung, Testfallversion über Inhalts-Hash, Historie mit Änderungszusammenfassung | 🧪 umgesetzt |
| Auswählen, bis zu welchem Objekt getestet wird | Feld „Run up to“ (`EndObject`): Service Request … Faktura … Buchhaltungsbeleg; nur Objekte auf dem Weg sind wählbar | 🧪 umgesetzt |
| Wählbarer Startpunkt je nach Start des Prozessteams, z. B. direkt ab dem Angebot | Feld „Start from“ (`StartObject`), vorbelegt mit dem Einstieg des Teams; Start mitten im Prozess übernimmt Belege und Testdaten eines Vorgänger-Testfalls (Abschnitt 6.3) | 🧪 umgesetzt |
| Pilot: Service-Reparaturprozess mit drei Wegen | Weg 1 ohne Angebot, Weg 2 Angebot angenommen/abgelehnt, Weg 3 Vertragsfindung und Rechnungsplan | 🧪 umgesetzt |
| Garantie, Requote, In-House Repair als spätere API-Erweiterung | Als Varianten und Schritte mit Status „Later“ erfasst, nicht ausführbar, in der Abdeckung ausgewiesen | 🧪 umgesetzt |
| Bestehende BRUNATA-Testfälle (als Excel) übernehmen | **Noch keine Testfälle mitgeliefert.** Excel-Importvorlage mit Auswahllisten und Zuordnungsregeln liegt bereit (Abschnitt 13); nichts erfunden | wartet auf die Excel-Datei |
| Fachliche Verantwortung und Ausführungsberechtigung getrennt | Rollen `PROCESS_OWNER` (freigeben) und `TEST_EXECUTOR` (ausführen) je Prozessteam | 🧪 umgesetzt |
| Berechtigung und Freigabe serverseitig vor jedem Lauf prüfen | Prüfung in den Actions `approve`, `startExecution` und im Regressionslauf (Meldungen 202–210, 302, 303) | 🧪 umgesetzt |
| Änderung an freigegebenem Testfall braucht neue Freigabe | Neue Version widerruft die Freigabe; Start nur mit freigegebener Version (Meldung 206) | 🧪 umgesetzt |
| Ergebnisse je Testlauf, Testfall und Prozessschritt | Status, Fehler, Ist-Werte und SAP-Belegnummern hängen am Lauf, am Testfall und am Prozessschritt | 🧪 umgesetzt |
| Nah am Standard, mit UI5-Elementen umsetzbar | SAP Fiori elements (List Report, Object Page) plus drei FPM-Seiten mit Standard-Controls; Abschnitt 9 | 🧪 umgesetzt |
| Agent kann Testszenarien mit Prozessbezug anlegen | Service-Assistent setzt Team, Weg, Start und Endobjekt; Rückfragen wie „nur bis zum Auftrag“ oder „direkt ab dem Angebot“ | 🧪 umgesetzt |
| Agenten-Absprung „hinten raus“: Ergebnisse validiert besprechen, mögliche Fehler feststellen | Deterministische Ergebnisanalyse je Lauf (Befund, wahrscheinliche Ursache, Evidenz, Konfidenz, zuständiges Team, Empfehlung) und Aktion **Ergebnis besprechen** zum Service-Assistenten (Abschnitt 11) | 🧪 umgesetzt |
| Auswertungsdashboard | FPM-Seite **Analytics/Auswertung** je Release: Kennzahlen, Ergebnis je Team, Verlauf, Fehlerbilder mit Absprung zum Assistenten, Abdeckung je Prozessschritt (Abschnitt 12) | 🧪 umgesetzt |

---

## 2. Validierung der Anforderungen

Die Anforderungen sind in sich schlüssig. Bei der Prüfung sind fünf Punkte aufgefallen, die das Mockup bewusst so löst:

1. **Ein Prozess, mehrere Teams.** Der Reparaturprozess berührt mehr als ein Team: Weg 2 erzeugt ein Angebot (Angebotsprozess), Weg 3 braucht einen Servicevertrag, die Fakturierung liegt eventuell bei einem Abrechnungsteam. Darum hat **jeder Prozessschritt ein verantwortliches Team** und das Prozessteam des Testfalls kann vom Prozesseigner abweichen.
   - **Übergaben** entstehen, wo das verantwortliche Team entlang des Weges wechselt.
   - Ein Testfall über mehrere Teams ist ein **End-to-End-Test** (`E2E`).
   - Ein Testfall innerhalb eines Teams ist ein **Teilprozesstest** (`SUB_PROCESS`). Die Teststufe ermittelt das Backend aus dem Weg.
2. **Unbekannte Zuordnungen kennzeichnen.** Fakturierung und FI-Beleg gehören laut Aussage vom 06.10.2026 zum Prozessteam „New End to End Prozess“ (`PT-E2E`). Welches Team die Schritte Angebot und Vertragsfindung verantwortet, ist weiterhin nicht bestätigt. Solche Zuordnungen tragen den Status:
   - `ASSUMED` („Annahme – zu bestätigen“), wenn ein Team plausibel ist;
   - `OPEN` („offen“), wenn kein Team bekannt ist.
   
   Ein Testfall mit offener Zuordnung lässt sich weder freigeben noch ausführen (Meldung 207).
3. **Ablesung ist messdienstspezifisch.** Ob die Ablesung überhaupt in SAP S/4HANA Service abgebildet ist, ist offen ⚠. Das Team ist angelegt, der Prozess `ABL` hat noch keine Schritte. Dasselbe gilt für Montage (`MON`) und den eigenständigen Angebotsprozess (`ANG`).
4. **Zwischentabelle.** Die Anforderung „Prozessteams auf einer Zwischentabelle speichern, die Releases zugeordnet wird“ ist als **Scope eines Release** umgesetzt (`ReleaseScope`):
   - Eine Zeile steht für „Team X testet Prozess Y (in Version Z) in diesem Release“.
   - Der Scope eines Folgerelease wird mit einer Action vom Vorgänger übernommen.
5. **Zwei Takte statt einem.** SAP liefert neue Funktionen in größeren Abständen (Abschnitt 3). Die Prozessteams ändern ihre Prozesse häufiger (DevOps). Das Mockup kennt deshalb neben den SAP-Releases **interne Releases** der Prozessteams. Beide laufen durch dieselbe automatische Regression.

---

## 3. SAP-Releasezyklen als Taktgeber

### 3.1 SAP S/4HANA und SAP S/4HANA Cloud Private Edition

| Aussage | Beleg |
|---|---|
| Ein neues Release erscheint alle zwei Jahre (2023, 2025, 2027). | ✅S [Release Cycles in SAP S/4HANA](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/8308e6d301d54584a33cd04a9861bc52/4e8cdcc8cbaf4b909217bda9965b7db4.html) |
| Je Release liefert SAP drei Feature Package Stacks (FPS01–FPS03) im Abstand von etwa sechs Monaten. | ✅S ebenda |
| Danach folgen Support Package Stacks (SPS04 ff.), ein- bis zweimal pro Jahr, mit Korrekturen und gesetzlichen Änderungen, in der Regel ohne neue Funktionen. | ✅S ebenda |
| Technisch sind FPS und SPS dasselbe. Ein FPS enthält zusätzlich neue Funktionen. | ✅S ebenda |
| SAP S/4HANA 2025 FPS01 ist verfügbar. Das Datum ist in den Suchauszügen widersprüchlich: 25.02.2026 bzw. 09.03.2026. | 🟡 [FPS01 Fully-Activated Appliance (sap.com, PDF)](https://www.sap.com/docs/download/2026/05/e4b96330-4e7f-0010-bca6-c68f7e60039b.pdf), [Getting Started With SAP S/4HANA 2025](https://help.sap.com/doc/819cdef021e44d7aad27b31c8bb1ebfc/2025/en-US/START_OP2025.pdf) · ⚠ |
| FPS02 ist für Oktober 2026 geplant, FPS03 für Februar 2027 – Planungsstand, den SAP jederzeit ändern kann. | ⚠ nur Suchzusammenfassung, keine SAP-Seite direkt gelesen |
| SAP S/4HANA 2025 läuft mit SAPUI5 1.136 (Long-Term Maintenance), passend zum Mockup. | ✅S [Getting Started With SAP S/4HANA 2025](https://help.sap.com/doc/819cdef021e44d7aad27b31c8bb1ebfc/2025/en-US/START_OP2025.pdf) |

### 3.2 SAP S/4HANA Cloud Public Edition (nicht das Zielsystem)

Das Zielsystem ist SAP S/4HANA 2025 (Aussage vom 06.10.2026). Der Takt der Public Edition steht hier nur zur Abgrenzung.

| Aussage | Beleg |
|---|---|
| Zwei Releases pro Jahr, im Februar und August, benannt nach `YYMM` (z. B. 2602, 2608). | 🟡 SAP-Community-Blogs von SAP: [Getting Ready for the 2608 Upgrade](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/getting-ready-for-the-2608-upgrade-of-the-sap-cloud-erp-public-edition/ba-p/14421165), [Releases, Updates and Hotfix](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/releases-updates-and-hotfix-a-short-guide-for-sap-s-4hana-cloud-delivery/ba-p/13544161) |
| Zwischen den Releases kommen Hotfix Collections (HFC) im Zwei-Wochen-Takt. | 🟡 ebenda |

### 3.3 Folgerung für den Testassistenten

- Jedes SAP-Release, jeder FPS bzw. SPS und jeder Cloud-Release ist ein **Release im Testassistenten**. Regressionstests laufen dabei über den **gesamten** regressionsrelevanten Scope.
- Zwischen zwei SAP-Lieferungen bündeln **interne Releases** die Änderungen der Prozessteams.
- Hotfix Collections sind als Release-Typ vorgesehen. Ob jede HFC einen Regressionslauf auslöst, entscheidet der Scope.
- Release-Typen im Mockup: `SAP_RELEASE`, `SAP_FPS`, `SAP_SPS`, `CLOUD_RELEASE`, `CLOUD_HFC`, `INTERNAL`.

Releases im Mockup (Termine der SAP-Lieferungen ⚠ Planungsstand, Tagesdaten teilweise angenommen):

| Release | Typ | Status | Testfenster | Bemerkung |
|---|---|---|---|---|
| `S4-2025-FPS01` | SAP FPS | Released | 02.03.–27.03.2026 | Produktiver Ausgangsstand (Annahme) |
| `INT-2026.10` | intern | **In Test** | 28.09.–16.10.2026 | Release der Prozessteams auf FPS01; Scope: Reparatur, Angebot, Montage, Ablesung |
| `S4-2025-FPS02` | SAP FPS | Planned | 02.11.–27.11.2026 | FPS02 laut Planung Oktober 2026 |
| `INT-2026.12` | intern | Planned | 07.12.–18.12.2026 | auf FPS02 |
| `S4-2025-FPS03` | SAP FPS | Planned | 01.03.–26.03.2027 | letzter FPS des Release 2025 |
| `S4-2027` | SAP-Release | Planned | 10.01.–03.03.2028 | Upgrade im Zwei-Jahres-Zyklus |

---

## 4. Abgleich mit SAP Cloud ALM (Zielbild)

SAP Cloud ALM ist das SAP-Werkzeug für Testmanagement. Das Mockup verwendet bewusst ähnliche Begriffe, damit ein späterer Anschluss naheliegt.

| Mockup 🧪 | SAP Cloud ALM | Beleg |
|---|---|---|
| Prozess / Prozessschritt | Solution Process, Prozessablaufdiagramm; Testfälle werden einem Solution Process zugeordnet | ✅S [Creating Manual Test Cases](https://help.sap.com/docs/cloud-alm/applicationhelp/creating-manual-test-cases), [SAP Test Management](https://support.sap.com/en/alm/sap-cloud-alm/implementation/sap-cloud-alm-implementation-expert-portal/testmanagement.html) |
| Testfall mit Testschritten | Test Case (manuell oder automatisiert), Aktivitäten und Aktionen | ✅S ebenda |
| Release-Scope + Regressionslauf | Test Plan: gruppiert Testfälle, ordnet Tester und Zeitfenster zu | ✅S [Preparing Test Plans in SAP Cloud ALM](https://learning.sap.com/courses/implementing-sap-s-4hana-cloud-private-edition/preparing-test-plans-in-sap-cloud-alm_f75b41fd-3b98-4b3c-bf78-6513dc97a88c) |
| Release | Releases und Timeboxes im Projekt; Anforderungen erhalten ein geplantes Release | ✅S [Projects and Setup](https://help.sap.com/docs/cloud-alm/applicationhelp/projects-and-setup) |
| Automatisierte Ausführung | Test Automation API für externe Testwerkzeuge | ✅S [Test Automation API](https://help.sap.com/docs/cloud-alm/apis/test-automation-api), [CALM_TEST_AUTOMATION](https://api.sap.com/api/CALM_TEST_AUTOMATION/overview) |
| Fehlgeschlagene Assertion | Defect | ⚠ Anbindung offen |

Offen ⚠: ob BRUNATA-METRONA SAP Cloud ALM einsetzt oder einsetzen will. Falls ja, wäre der Testassistent das **Werkzeug der Prozessteams** für Entwurf, Validierung und Ausführung, und Cloud ALM die **übergreifende Teststeuerung** (Test Plan, Sign-off, Defects).

---

## 5. Datenmodell (Mock-Vertrag `ZUI_STC_TEST_CASE_O4`) 🧪

```
ProcessTeam ──< TeamMember (Benutzer × Rolle)
     │ verantwortet
     ▼
BusinessProcess ──< ProcessStep (verantwortliches Team, Wege, Automatisierung, Pilot/Later)
     │          ──< ProcessVariant (Weg)        ──< ProcessVersion (Historie)
     ▼
TestCase (Team, Prozess, Weg, „Start from“, „Run up to“, Vorgänger, Teststufe, Version) ──< TestCaseStep (→ ProcessStepID)
     │                                                                                ──< TestCaseVersion (Historie)
     ▼
Execution (Release, Versionen, Lauftyp, Start, übernommen von, Analyse) ──< ExecutionStep / DocumentReference / TestAssertion (→ ProcessStepID)
                                                                        ──< ResultFinding (Befund, Ursache, Evidenz, Konfidenz, Team)

Release ──< ReleaseScope  = Zwischentabelle Release × Prozessteam × Prozess (Version, regressionsrelevant)
        ──< ReleaseTestCase, ReleaseStepCoverage   (Lesemodelle: Ergebnis je Testfall und je Prozessschritt)
        ──< RegressionRun ──< RegressionRunItem   (automatischer Lauf je Release)
```

| Entität | Rolle | Schlüssel / IDs |
|---|---|---|
| `ProcessTeam`, `TeamMember` | Draft-Objekt; Mitglieder mit Rolle | `ProcessTeam` (z. B. `PT-REPARATUR`), `UserID` × `TeamRole` |
| `BusinessProcess` | Draft-Objekt mit Schritten, Wegen und Versionen | `ProcessID` (`SRV-REP`), `StepID` (`REP-060`), `Variant` (`W2_QUOTATION`), `ProcessVersion` |
| `TestCase` | erweitert um den Prozessbezug | `CaseID` (`STC-2026-000013`), `Version`, `ApprovedVersion`, `ContentHash` |
| `TestCaseStep` | Testschritte; abgeleitet aus dem Weg oder manuell ergänzt | `StepNo`, `ProcessStepID`, Herkunft `StepSource` = `DERIVED`/`USER` |
| `TestCaseVersion` | Snapshot je Version mit Änderungszusammenfassung | `Version` |
| `Execution` (+ Schritte, Belege, Assertions) | Testlauf mit Release, Versionen, Lauftyp (`SINGLE`, `REGRESSION`), Startobjekt und Vorgängerlauf; Belege mit Herkunft (`CREATED`, `DETERMINED`, `TAKEN_OVER`) | `ExternalExecutionID`, `ReleaseID`, `ProcessStepID` je Ergebniszeile |
| `ResultFinding` | Ergebnisanalyse eines Laufs: ein Befund je Abweichung, Fehler, Übergabe oder Vergleich mit dem vorigen Lauf | `FindingCode`, `ProcessStepID`, `ResponsibleTeam`, `Confidence`; dazu `CaseID`, `ExternalExecutionID`, `ReleaseID` für die Auswertung je Release |
| `TestCaseVH` | Wertehilfe der gespeicherten Testfälle (Vorgänger-Testfall) | `CaseID` |
| `Release`, `ReleaseScope` | Draft-Objekt; Zwischentabelle | `ReleaseID` (`INT-2026.10`), Team × Prozess |
| `ReleaseTestCase`, `ReleaseStepCoverage` | Lesemodelle (im echten System CDS-Views) | stabile, aus dem Inhalt gebildete Schlüssel |
| `RegressionRun`, `RegressionRunItem` | Regressionslauf eines Release mit Entscheidung je Testfall (gestartet, übersprungen und warum) | `RunID` |

Alle Namen sind **Projektvorschlag/Mock**, keine SAP-Standardobjekte.

---

## 6. Pilot: Service-Reparaturprozess

### 6.1 Wege (Prozessvarianten)

Grundlage ist das Prozessbild (Miro) mit drei Wegen.

| Weg | Code | Ablauf | Standard-Endobjekt |
|---|---|---|---|
| 1 | `W1_REQUEST` | Kundenanliegen → Service Request → Service Order → Durchführung → Rückmeldung → Fakturaanforderung → Faktura | Faktura |
| 2 | `W2_QUOTATION` | Service Request → Service Quotation → Kunde akzeptiert → Service Order → … → Faktura (Standardweg) | Faktura |
| 2 | `W2_REJECTED` | Service Request → Service Quotation → Kunde lehnt ab → Prozessende | Angebot |
| 3 | `W3_CONTRACT` | Vertragsfindung → Service Order mit Vertragsbezug → Durchführung → Rückmeldung → Faktura | Faktura |
| 3 | `W3_BILLING_PLAN` | Servicevertrag → Rechnungsplan → Fakturaanforderung → Faktura | Faktura |
| später | `WARRANTY`, `REQUOTE`, `IN_HOUSE_REPAIR`, `SOLUTION_QUOTATION` | spätere API-Erweiterungen, nicht ausführbar | – |

„Run up to“ kann bis zum Buchhaltungsbeleg (FI) verlängert oder auf ein früheres Objekt des Weges verkürzt werden. So testet ein Team gezielt seinen Abschnitt. Liegt das gewählte Objekt nicht auf dem Weg, setzt das Backend das Ende des Weges ein und meldet das als Warnung am Feld (Meldung 109).

- Beispiel `STC-2026-000012`: Team Angebot, Weg 2 **ab dem Angebot** bis zur Kundenannahme. Der Lauf startet direkt mit dem Angebot; weil kein anderes Team beteiligt ist, ist es ein Teilprozesstest des Teams Angebot.
- Beispiel `STC-2026-000007`: Team Reparatur, Weg 1 bis zum Buchhaltungsbeleg. Ab der Fakturaanforderung ist das Team „New End to End Prozess“ zuständig; wegen dieser Übergabe ist es ein E2E-Test.
- Wo der Lauf beginnt, legt das Feld **„Start from“** fest (Abschnitt 6.3).

### 6.2 Prozessschritte und Teamzuordnung

| Schritt | Inhalt | Team | Zuordnung | Automatisierung | SAP-Bezug (Belegstufe siehe Prozessschritt in der App) |
|---|---|---|---|---|---|
| REP-010 | Service Request erfassen | Reparatur | zugeordnet | automatisiert | `A_ServiceRequest` |
| REP-020 | Entscheidung: Angebot nötig? | Reparatur | zugeordnet | Entscheidung | – |
| REP-030 | Service Quotation anlegen und senden | Angebot | **Annahme** | automatisiert | `A_ServiceQuotation` |
| REP-040 / REP-041 | Kunde akzeptiert / lehnt ab | Angebot | **Annahme** | automatisiert | `A_ServiceQuotation` |
| REP-050 | Vertragsfindung | Reparatur | **Annahme** | automatisiert | `A_ServiceContract`, Objektliste (`API_SERVICE_CONTRACT_SRV`) |
| REP-060 | Service Order anlegen | Reparatur | zugeordnet | automatisiert | `A_ServiceOrder`, `ReferenceServiceContract` |
| REP-070 | Durchführung (Techniker/FSM) | Reparatur | zugeordnet | manuell | FSM-Integration ⚠ |
| REP-080 | Service Confirmation buchen | Reparatur | zugeordnet | automatisiert | `A_ServiceConfirmation` |
| REP-090 / REP-095 | Fakturaanforderung (Rückmeldung bzw. Rechnungsplan) | New End to End Prozess | zugeordnet | automatisiert | `A_BillingDocumentRequest`, Rechnungsplan des Vertrags |
| REP-100 | Faktura | New End to End Prozess | zugeordnet | automatisiert | `A_BillingDocument` |
| REP-110 | Buchhaltungsbeleg (FI) prüfen | New End to End Prozess | zugeordnet | automatisiert | `A_BillingDocument.AccountingDocument`; Lese-API Journal Entry ⚠ |
| REP-200 … REP-230 | Garantie, Requote, In-House Repair, Solution Quotation | – | Annahme | später | APIs ⚠ |

Die Feldnamen `ReferenceServiceContract` (Service Order) und `AccountingDocument` (Faktura) sind gegen das SAP Cloud SDK VDM geprüft (✅P). Die Zuordnung von Fakturierung und FI zum Team „New End to End Prozess“ stammt aus der Aussage vom 06.10.2026. Die übrigen als „Annahme“ markierten Zuordnungen bleiben zu bestätigen.

### 6.3 Startpunkt und Übergabe zwischen Teams

Jedes Team testet ab der Stelle, an der es in den Prozess einsteigt. Das Feld **„Start from“** (`StartObject`) regelt das:

- **Vorbelegung:** der erste automatisierte Schritt des Teams auf dem Weg. Team Angebot startet beim Angebot, Team „New End to End Prozess“ bei der Fakturaanforderung, Team Reparatur beim Service Request.
- **Frei wählbar:** jedes Objekt des Weges vor dem Endobjekt. Der Buchhaltungsbeleg ist kein Start, denn er entsteht aus der Faktura desselben Laufs.
- **Direkt vom Angebot (Quote):** „Start from“ = Angebot. Der Lauf beginnt mit dem Angebot und braucht keinen Vorgänger-Testfall; im Mockup entsteht das Angebot ohne Service Request. Ob das im Zielsystem für die verwendeten Angebotsarten gilt, ist ⚠ noch zu verifizieren. Wer im Service-Assistenten „direkt ab dem Angebot“ schreibt, bekommt automatisch Weg 2.
- **Start mitten im Prozess:** Rückmeldung, Fakturaanforderung und Faktura brauchen einen Vorgängerbeleg. Der Testfall nennt dann einen **Vorgänger-Testfall** (`PredecessorTestCase`). Sein letzter erfolgreicher Lauf übergibt Belege und Testdaten.
  - Die Validierung prüft das mit Regel R12. Fehlt der Vorgänger, ist der Testfall ungültig; die Wertehilfe schlägt passende Testfälle vor.
  - Beim Start übernimmt der Lauf die Belege des Vorgängers (Herkunft „übernommen“) und erzeugt nur die eigenen. Die Verifikation prüft den Belegfluss über die Übergabe hinweg.
  - Hat der Vorgänger noch keinen erfolgreichen Lauf, lehnt das Backend den Start ab (Meldung 211).
  - Im Regressionslauf wartet ein solcher Testfall auf seinen Vorgänger (Entscheidung „Waiting for predecessor“). Scheitert der Vorgänger, wird er mit Begründung übersprungen.
- Wechselt der Start, entstehen Testschritte und Erwartung neu (Meldung 114); ein Endobjekt vor dem Start wird ersetzt (Meldung 109).

Beispiel im Mockup: `STC-2026-000013` (Team Reparatur, bis zur Rückmeldung) übergibt an `STC-2026-000014` (Team New End to End Prozess, ab Fakturaanforderung bis FI-Beleg). Der Lauf `MOCK-20260929-0006` übernimmt Service Request, Service Order und Rückmeldung und erzeugt Fakturaanforderung, Faktura und Buchhaltungsbeleg.

---

## 7. Verantwortung, Berechtigung und Freigabe

| Regel | Umsetzung | Meldung |
|---|---|---|
| Fachliche Verantwortung und Ausführung sind getrennte Rollen. | Rolle `PROCESS_OWNER` bzw. `TEST_EXECUTOR` je Prozessteam (`TeamMember`); jedes Team braucht mindestens einen Process Owner. | 120–124 |
| Freigeben darf nur der Process Owner des Teams. | Prüfung in der Action `approve` | 303 |
| Vier-Augen-Prinzip je Prozessprofil | Ersteller darf nicht freigeben, wenn das Profil es verlangt. | – |
| Ausführen darf nur ein Test Executor des Teams. | Prüfung in `startExecution` und für jeden Testfall im Regressionslauf | 302 |
| Vor jedem Lauf: freigegeben, freigegebene Version, Zuordnung nicht offen, im Release-Scope, mindestens ein automatisierter Schritt, kein laufender Lauf | Gemeinsame Prüfung `executionCheck` | 202, 206, 207, 209, 210, 401 |
| Änderung an einem freigegebenen Testfall braucht eine neue Freigabe. | Beim Sichern mit geändertem Inhalt entsteht eine neue Version; die Freigabe wird widerrufen. | 108, 206 |

Im Mockup ist der angemeldete Benutzer `DEMO_USER`. Er ist Process Owner und Test Executor im Team Reparatur, Test Executor im Team „New End to End Prozess“ und **nicht** Mitglied im Team Angebot. Am Seed-Testfall `STC-2026-000012` (Team Angebot) sieht man darum die serverseitige Ablehnung (Meldung 302). Testfälle des Teams „New End to End Prozess“ darf er ausführen, aber nicht freigeben (Meldung 303).

**Zielbild (⚠ zu verifizieren):** Prozessteams als Teams im SAP-Standard **Responsibility Management**.

- Dort repräsentiert eine Teamkategorie einen Geschäftsprozess und ein Teamtyp einen Teilprozess.
- Mitglieder haben Funktionen.
- Die App „Manage Teams and Responsibilities“ pflegt sie (✅S [Responsibility Management](https://help.sap.com/docs/SAP_S4HANA_CLOUD/a630d57fc5004c6383e7a81efee7a8bb/a4a31dc3e2824cb1afc7be8eafc07f5c.html), [Manage Teams and Responsibilities](https://help.sap.com/docs/SAP_S4HANA_CLOUD/a630d57fc5004c6383e7a81efee7a8bb/73c04858392e9244e10000000a4450e5.html), [Define a Team Type](https://help.sap.com/docs/SAP_S4HANA_CLOUD/a630d57fc5004c6383e7a81efee7a8bb/1d4e23dca6b14bf8b00f763b480e24d1.html)).
- Das Serviceteam im Testfall (`RespyMgmtServiceTeam`) stammt bereits aus Responsibility Management.

Offen:
- ob eigene Teamkategorien und Funktionen für Prozessteams angelegt werden können;
- wie die Rollen auf Berechtigungsobjekte bzw. die Instanzberechtigung des RAP-BO abgebildet werden.

---

## 8. Releases und automatische Regression

1. **Planen:** Release anlegen (Typ, SAP-Produktversion, FPS, Testfenster, Go-live, Vorgänger). Mit der Action **Copy Scope from Predecessor** übernimmt man den Scope des Vorgängers (Meldung 910).
2. **Scope pflegen:** In der Zwischentabelle steht je Team und Prozess die erwartete Prozessversion und ob die Kombination regressionsrelevant ist.
3. **Test starten:** Status auf **In Test** setzen. Ist **Auto Regression** gesetzt, startet beim Sichern automatisch ein Regressionslauf (Auslöser `TEST_START`). Alternativ startet man ihn manuell mit **Start Regression Run** (Meldung 911).
4. **Regressionslauf:** Für jeden Testfall im Scope wird die Ausführungsprüfung aus Abschnitt 7 durchlaufen.
   - Erfüllt der Testfall sie, startet ein Lauf mit Lauftyp `REGRESSION`.
   - Sonst wird er mit Begründung **übersprungen** (z. B. „Version 3 not approved“).
   - Braucht er die Belege eines Vorgänger-Testfalls im selben Lauf, **wartet** er, bis der Vorgänger bestanden hat (Abschnitt 6.3).
   - Der Lauf aktualisiert sich, bis alle Ausführungen fertig sind (Meldung 912). Die Seite fragt den Stand alle zwei Sekunden ab.
5. **Auswerten** (auf der Release-Seite und im Dashboard, Abschnitt 12):
   - **Pass Rate** und **Step Coverage** im Kopf (Fortschrittsbalken mit Ampel).
   - Ergebnis je Testfall im Release mit Hinweisen, z. B. „last run with version 1“ oder „designed for process version 1, scope expects 2“.
   - **Abdeckung je Prozessschritt**: Passed, Failed, Not executed, Not covered, Manual oder Later; dazu der letzte SAP-Beleg.
6. **Abschließen:** Status Released bzw. Closed. Der nächste Release übernimmt den Scope.

Die Step Coverage zählt nur messbare Schritte. Manuelle Schritte und spätere Erweiterungen bleiben außen vor, damit der Pilot eine erreichbare 100 % hat. Entscheidungen und manuelle Schritte gelten als abgedeckt, sobald ein Lauf einen späteren Schritt erreicht hat; scheitert der Lauf erst danach (z. B. bei der Faktura), ist nur der scheiternde Schritt rot.

**Zielbild (⚠):** Der Regressionslauf wird im echten System als Application Job eingeplant oder über einen SAP-Cloud-ALM-Testplan mit angebundenem Testwerkzeug gestartet. Die Prüfungen aus Abschnitt 7 bleiben im RAP-BO.

---

## 9. Umsetzung mit UI5- und Fiori-elements-Standardelementen

| Bedarf | Standardbaustein | Hinweis |
|---|---|---|
| Listen nach Team, Prozess, Weg, Zuordnung | List Report mit `UI.SelectionFields` und `UI.LineItem` | Testfälle, Prozessteams, Prozesse, Releases |
| Pflege von Team, Prozess, Release | Object Page mit Draft (`Edit`/`Activate`), Tabellen mit Inline-Erstellung | Mitglieder, Schritte, Wege, Scope |
| Sortierte Tabellen | `UI.PresentationVariant` als Ziel der ReferenceFacet | Schritte nach Sequenz, Scope nach Team |
| Kennzahlen im Kopf | `UI.DataPoint` mit Visualisierung Progress, `Criticality` und Einheit `%` | Pass Rate, Step Coverage |
| Status-Ampeln in Tabellen | Zeilen-Hervorhebung `UI.LineItem@UI.Criticality` | In Tabellen eines Draft-Objekts keine Zellen-Criticality: FE 1.136 meldet sonst beim Bearbeiten interne Drill-down-Fehler (im Mockup geprüft) |
| Actions nur, wenn sinnvoll | Bound Actions mit `Core.OperationAvailable` über `__OperationControl`, `Common.SideEffects` | Start/Refresh Regression Run, Copy Scope |
| Wertehilfen mit Abhängigkeiten | `Common.ValueList` mit In-/Out-Parametern und Konstantenfilter | Weg nur aus dem gewählten Prozess; Business Owner nur Process Owner des Teams |
| Navigation aus Lesemodellen zum Testfall | Manifest-`navigation` plus Controller-Erweiterung `routing.onBeforeNavigation` | Zeile in „Test Cases in Scope“ öffnet den Testfall |
| Laufenden Regressionslauf aktualisieren | Controller-Erweiterung der Object Page, die `refreshRegressionRun` alle zwei Sekunden aufruft | FE hat kein eingebautes Polling 🟡 |
| Einstieg je Rolle | FPM-Seiten Übersicht und Service-Assistent | Kacheln „Assignment Open“ und „Release in Test“ |
| Absprung zum Assistenten | Eigene Kopfaktion der Object Page (Manifest `content.header.actions`), Sichtbarkeit per Ausdrucksbindung | In Ausdrucksbindungen auf OData-V4-Eigenschaften Rohwerte `%{…}` verwenden; `${…}` formatiert mit dem Typ der Eigenschaft und scheitert am Zieltyp boolean (im Mockup geprüft) |
| Ergebnisanalyse am Testfall | Abschnitt „Result Analysis“ als Tabelle mit Zeilen-Hervorhebung, Kernaussage im Abschnitt „Execution“ | annotationsgetrieben |
| Auswertungsdashboard | FPM-Seite mit `sap.m` (GenericTile, Table, List) und `sap.suite.ui.microchart` (RadialMicroChart, StackedBarMicroChart, InteractiveDonutChart, InteractiveLineChart) | kein `sap.viz`; InteractiveLineChart braucht einen Container mit fester Höhe (mindestens 106 px) |

Alles außer den drei FPM-Seiten, der Kopfaktion und kleinen Controller-Erweiterungen ist **annotationsgetrieben**. Im echten System entstehen die Annotationen in den CDS-Metadata-Extensions des RAP-Service.

---

## 10. Service-Assistent mit Prozessbezug

Der Agent legt Testszenarien jetzt **mit Prozessbezug** an:

- **Team:** Das Backend setzt das Team des Benutzers. Nennt der Text ein Team („Prozessteam Angebot“), wird dieses übernommen.
- **Weg:** Das Backend leitet den Weg aus der Meldung ab:
  - „Angebot“ bzw. „Kostenvoranschlag“ → Weg 2;
  - „lehnt ab“ → Weg 2 abgelehnt;
  - „Wartungsvertrag“ → Weg 3;
  - „Rechnungsplan“ → Weg 3 Rechnungsplan;
  - eine Störungsmeldung ohne diese Wörter → Weg 1.
- **Endobjekt:** „bis zum Auftrag“, „bis zur Rückmeldung“, „mit Buchhaltungsbeleg“ usw.
- **Start:** „direkt ab dem Angebot“, „ab der Fakturaanforderung“ usw. Braucht der Start einen Vorgänger-Testfall, fragt der Agent nach (Vorschläge aus Regel R12).
- **Rückfragen:** Antworten wie „mit Angebot, der Kunde lehnt ab“ oder „nur bis zum Auftrag“ ändern Weg und Endobjekt. Das Backend ermittelt danach Testschritte, Servicevertrag und erwarteten Nettowert neu.
- **Claude-Modus:** Das Tool `testfall_entwurf_erfassen` hat die Parameter `prozessvariante`, `start_objekt`, `bis_objekt`, `vorgaenger_testfall`, `prozessteam` und `voraussetzungen`. Das Tool `ergebnis_lesen` liest das Ergebnis eines Laufs (Abschnitt 11).
- **Freigabe und Start:** Der Agent startet nichts selbst. Bei „Übernehmen & starten“ prüft das Backend Rollen, Freigabe und Release-Scope wie in der App. Die Ausführung gehört automatisch zum Release, der für das Team gerade im Test ist.

Beispiel im Menü „Beispiele“: **Weg 3: Rauchwarnmelder laut Wartungsvertrag**. Ergebnis:

- Der Servicevertrag `4100000001` wird ermittelt.
- Die Validierung ist gültig.
- Auf „nur bis zum Auftrag“ hin endet der Lauf bei der Service Order.

---

## 11. Ergebnisse besprechen: Ergebnisanalyse und Agenten-Absprung

Nach jedem Lauf analysiert das Backend das Ergebnis **deterministisch** (`ResultAnalysisService`, im Mockup 🧪). Grundlage sind nur die Daten des Laufs: Prüfungen (Soll/Ist), Belege, Schrittprotokoll, Testdaten, die Mock-Preisliste und der vorige Lauf desselben Testfalls. Ein Sprachmodell rät hier nichts.

Jeder Befund (`ResultFinding`) enthält:

| Feld | Bedeutung |
|---|---|
| Befund | was abweicht, z. B. „Net value 183.00 EUR instead of 114.00 EUR“ |
| Wahrscheinliche Ursache | aus der Evidenz abgeleitet, z. B. „die Erwartung weicht um 1 Stunde MD-SRV-STOER ab“ |
| Evidenz | die Prüfung oder Protokollzeile, auf der die Ursache beruht |
| Konfidenz | **hoch** = durch die Evidenz belegt · **mittel** = passt zu einer bekannten Ursache · **niedrig** = nur ein Hinweis |
| Prozessschritt, zuständiges Team | wo der Fehler auftritt und wer ihn klärt; Abweichungen zwischen Testdaten und Erwartung pflegt das Team des Testfalls |
| Empfehlung | nächster Schritt, z. B. Erwartung anpassen oder Material entsperren |

Erkannte Muster: Nettowert außerhalb oder innerhalb der Toleranz, Status- und Feldabweichung, unvollständiger Belegfluss, gesperrtes Ersatzteil, fehlende FI-Übergabe, ungültiger Servicevertrag, technischer Schrittfehler, Abbruch, Übergabe von einem Vorgänger, Regression, behoben, unverändert.

**Absprung zum Agenten („hinten raus“):**

- Auf dem Testfall öffnet die Kopfaktion **Ergebnis besprechen** den Service-Assistenten mit dem letzten Lauf. Sie erscheint, sobald ein Lauf beendet ist.
- Rechts stehen Ergebnis, Kernaussage und Befunde; links bespricht der Assistent sie. Das Menü **Fragen** schlägt typische Fragen vor: Warum? Wer ist zuständig? Was hat sich seit dem letzten Lauf geändert? Wie sicher ist das? Was soll ich tun? Welche Belege?
- **Mock-Agent (regelbasiert):** antwortet ausschließlich aus den Befunden, auf Deutsch.
- **Claude:** bekommt die Befunde als Kontext und das Tool `ergebnis_lesen` (auch für den Vorgänger-Testfall). Die Anweisungen verlangen: Ursachen nur mit Evidenz nennen, Vermutungen als Vermutung kennzeichnen, keine Belege, Transaktionen oder Customizing-Einstellungen erfinden, nichts ändern.
- Im Chat startet „Ergebnis von STC-2026-000007 besprechen“ dasselbe ohne Umweg über den Testfall.
- Korrekturen macht der Mensch im Testfall: Bearbeiten erzeugt eine neue Version, die neu validiert und freigegeben wird.

Seed-Beispiel: `STC-2026-000007`. Der zweite Lauf `MOCK-20261001-0007` scheitert, weil die Einsatzdauer in Version 2 auf 2 Stunden erhöht wurde, die Erwartung aber bei 114,00 EUR blieb. Die Analyse meldet die Abweichung mit Konfidenz **hoch** (Differenz = genau 1 Stunde der Leistung) und eine **Regression** gegenüber Version 1.

**Zielbild (⚠):** Dieselben Regeln laufen im RAP-Backend auf den echten Belegen und Protokollen; der Datenzugriff (Belege, Application Log, Testwerkzeug) ist noch zu klären. Als Agent kommt Joule mit denselben Werkzeugen in Frage ([agent-konzept.md](agent-konzept.md)).

---

## 12. Auswertungsdashboard

Die FPM-Seite **Analytics** (deutsch: Auswertung) zeigt je Release:

- **Kennzahlen:** Bestehensquote und Schrittabdeckung als Ringdiagramm, Testfälle im Umfang, ausgeführt, fehlgeschlagen, offene Befunde.
- **Ergebnis je Prozessteam:** gestapelter Balken bestanden / fehlgeschlagen / nicht ausgeführt. Teams ohne Testfall im Umfang erscheinen mit Hinweis.
- **Ergebnisverteilung** und **Bestehensquote im Verlauf** (Stand je Tag mit Läufen, letzter Lauf je Testfall).
- **Fehlerbilder:** gleiche Befunde (Code, Prozessschritt, Team) über alle Testfälle des Release zusammengefasst, mit Ursache, Empfehlung, Konfidenz und Button **Besprechen** zum Service-Assistenten.
- **Fehlgeschlagene Testfälle** mit Kernaussage der Analyse, **Besprechen** und **Öffnen**.
- **Abdeckung entlang des Prozesses** bis zum Prozessschritt (Rückverfolgung).

Erreichbar über die Übersicht (**Analytics**), die Kopfaktion **Analytics** eines Release und das Ergebnis-Panel des Assistenten. Grundlage sind die Lesemodelle des Service; berechnet wird nichts, was nicht auch auf der Release-Seite steht.

**Zielbild (⚠):** analytische CDS-Views bzw. eine Fiori-Analyseseite oder SAP Analytics Cloud; im Mockup bewusst eine FPM-Seite mit Standard-Controls.

---

## 13. Übernahme bestehender BRUNATA-Testfälle

**Die bestehenden Testfälle liegen als Excel vor (Aussage vom 06.10.2026), wurden aber noch nicht bereitgestellt.** Es wurde nichts erfunden.

Zwei gleichwertige Wege:

1. **Excel-Datei unverändert bereitstellen.** Die Spalten werden dann nach der Tabelle unten zugeordnet; Unklares wird als offene Zuordnung markiert, nicht geraten.
2. **Excel-Importvorlage ausfüllen:** [`vorlagen/testfall-import-vorlage.xlsx`](vorlagen/testfall-import-vorlage.xlsx) mit den Blättern *Anleitung*, *Testfälle* (eine Zeile je Testfall), *Testschritte* (eine Zeile je Schritt) und *Codes*. Auswahllisten für Prozessteam, Prozess, Weg, Start, Lauf bis, Prozessschritt und Prozessprofil kommen aus dem Mockup; unbekannte Werte sind erlaubt (Warnung statt Sperre) und werden als offene Zuordnung übernommen. Erzeugt wird sie von `zstc-testautomation/tools/templates/import_template.py` aus den Codelisten des Mockups.

Für eine maschinelle Übernahme gibt es weiter die flache CSV-Fassung [`vorlagen/testfall-import-vorlage.csv`](vorlagen/testfall-import-vorlage.csv): eine Zeile je Testschritt, Trennzeichen Semikolon, UTF-8.

| Spalte | Inhalt | Pflicht | Ziel im Mockup |
|---|---|---|---|
| `ExterneTestfallID` | ID im bisherigen Werkzeug | ja | `ExternalTestCaseID` |
| `Titel` | Kurztitel | ja | `Title` |
| `Prozessteam` | `PT-REPARATUR`, `PT-ANGEBOT`, `PT-MONTAGE`, `PT-ABLESUNG`, `PT-E2E` | nein | `ProcessTeam` |
| `Prozess` | `SRV-REP`, `ANG`, `MON`, `ABL` | nein | `BusinessProcess` |
| `Weg` | `W1_REQUEST` … `W3_BILLING_PLAN` | nein | `ProcessVariant` |
| `StartAb` (nur Excel) | Startobjekt, z. B. `SERVICE_QUOTATION`; leer = Einstieg des Teams | nein | `StartObject` |
| `LaufBis` | Endobjekt, z. B. `BILLING_DOCUMENT` | nein | `EndObject` |
| `VorgaengerTestfall` (nur Excel) | Testfall, dessen Belege übernommen werden | nein | `PredecessorTestCase` (nach Zuordnung der IDs) |
| `Prozessprofil` (nur Excel) | z. B. `MD_HKV_STOER`; leer = aus dem Gerätetyp | nein | `ProcessProfile` |
| `ErwarteterNettowert` (nur Excel) | in EUR, nur wenn bekannt | nein | `ExpectedNetAmount` |
| `Teststufe` | `SUB_PROCESS` oder `E2E` | nein | wird geprüft, nicht übernommen (Backend leitet sie ab) |
| `Voraussetzungen` | Vorbedingungen und Übergaben | nein | `Preconditions` |
| `Testdaten` | `Feld=Wert`, getrennt durch einen senkrechten Strich `\|` (Feldnamen aus `TestCaseData`) | nein | `TestCaseData` |
| `SchrittNr` | laufende Nummer | ja | `TestCaseStep.StepNo` |
| `ProzessschrittID` | z. B. `REP-060` | nein | `TestCaseStep.ProcessStepID` |
| `Aktion` | Was wird getan? | ja | `TestCaseStep.Action` |
| `ErwartetesErgebnis` | Was muss herauskommen? | ja | `TestCaseStep.ExpectedResult` |
| `FachlichVerantwortlich` | Benutzer mit Rolle Process Owner | nein | `BusinessOwner` |
| `Quelle` | Dokument bzw. Version der Vorlage | nein | Kommentar |
| `OffenePunkte` (nur Excel) | was unklar ist | nein | Hinweis der Zuordnung |
| `Beleg`, `Pruefwerte` (nur Excel, Testschritte) | Business Object und Prüfwerte des Schritts | nein | Erwartung der Verifikation |

Regeln bei der Übernahme:

- Fehlt Team, Prozess oder Weg oder ist der Wert unbekannt, bleibt das Feld leer. Die Zuordnung wird **offen** (`OPEN`) mit Hinweis, was fehlt.
- Ist das Team nur aus dem Kontext ableitbar, wird es mit **Annahme** (`ASSUMED`) gekennzeichnet und später fachlich bestätigt.
- Testschritte ohne Prozessschritt bleiben manuelle Schritte des Testfalls (`USER`) und gehen nicht in die Schrittabdeckung ein.
- Freigaben aus dem Altwerkzeug werden **nicht** übernommen. Jeder Testfall wird im Testassistenten neu freigegeben (Version 1).
- Startet ein Testfall mitten im Prozess, braucht er einen Vorgänger-Testfall (Abschnitt 6.3); fehlt er, bleibt der Testfall bis zur Klärung ungültig (Regel R12).

---

## 14. Offene Punkte und Annahmen

| Nr. | Punkt | Status |
|---|---|---|
| P-1 | Bestehende BRUNATA-Testfälle als Excel bereitstellen (unverändert oder in der Vorlage aus Abschnitt 13) | offen – wartet auf die Datei |
| P-2 | Teamzuordnung der Schritte Angebot (REP-030/040/041) und Vertragsfindung (REP-050) bestätigen | Annahme |
| P-3 | Verantwortliches Team für Fakturierung und FI-Beleg (REP-090 bis REP-110) | geklärt: Prozessteam „New End to End Prozess“ (06.10.2026) |
| P-4 | Prozessschritte für Montage, Angebot (eigenständig) und Ablesung modellieren; Abbildung der Ablesung im SAP-System klären | offen |
| P-5 | Zielsystem und Takt | geklärt: SAP S/4HANA 2025 mit FPS-Takt (06.10.2026); Betriebsform (Private Cloud oder On-Premise) für den Takt unerheblich |
| P-6 | FPS-Termine 2025 gegen SAP for Me bzw. die Release Information Note prüfen (FPS01-Datum widersprüchlich) | ⚠ |
| P-7 | Preisfindung bei Weg 3: Im Mockup gilt die Preisliste (Abrechnung nach Aufwand). Vertragskonditionen und kostenfreie Leistungen aus dem Vertrag sind nicht abgebildet. | Annahme ⚠ |
| P-8 | Lese-API für den Buchhaltungsbeleg festlegen. Geprüft: `API_JOURNALENTRYITEMBASIC_SRV` hat kein Feld `AccountingDocument` (VDM, ✅P) und scheidet aus. | ⚠ |
| P-9 | Prozessteams im Responsibility Management; Rollen als Berechtigungen im RAP-BO | ⚠ |
| P-10 | Einsatz von SAP Cloud ALM (Test Plan, Defects, Test Automation API) | ⚠ |
| P-11 | Regressionslauf im echten System: Application Job oder Cloud-ALM-Testplan | ⚠ |
| P-12 | Datenschutz: Bewohnernamen nur soweit nötig in Testdaten und Agent-Texten | Hinweis |
| P-13 | Startobjekt je Testfall (Lauf ab einem vorhandenen Beleg eines anderen Teams) | umgesetzt (Abschnitt 6.3) |
| P-14 | Startobjekt Angebot ohne Service Request: im Zielsystem für die verwendeten Angebotsarten prüfen | ⚠ |
| P-15 | Ergebnisanalyse im echten System: Zugriff auf Belege, Application Log und Protokolle des Testwerkzeugs; Freigabe der Regeln durch die Fachbereiche | ⚠ |
| P-16 | Dashboard im echten System: analytische CDS-Views, Fiori-Analyseseite oder SAP Analytics Cloud | ⚠ |
| P-17 | Agent im echten System: Joule mit denselben Werkzeugen; Datenschutz der Besprechungsinhalte | ⚠ |

---

## 15. Klickpfad im Mockup

1. **Übersicht → Process Teams → Prozessteam Reparatur.** Mitglieder und Rollen, verantwortete Prozessschritte, eigene Prozesse.
2. **Übersicht → Processes → Service-Reparaturprozess.**
   - Schritte mit verantwortlichem Team, Zuordnungsstatus, Übergaben und Automatisierung.
   - Die Wege und die Versionshistorie (Version 1 → 2: Weg 3 ergänzt).
3. **Übersicht → Releases → Prozessrelease Oktober 2026** (In Test):
   - **Start Regression Run** starten und beobachten.
   - Danach: Pass Rate, Testfälle im Scope, Abdeckung je Prozessschritt, übersprungene Testfälle mit Begründung.
4. **Release `S4-2025-FPS02` (Planned).**
   - **Copy Scope from Predecessor**.
   - **Edit**, dann Status **In Test** und sichern: Der Regressionslauf startet automatisch.
5. **Testfall `STC-2026-000012` (Team Angebot)** → **Start Execution**: Ablehnung, weil `DEMO_USER` im Team Angebot keine Ausführungsberechtigung hat.
6. **Testfall `STC-2026-000010` (Weg 3)** → **Edit**:
   - Weg auf Weg 1 ändern: Testschritte, Vertrag und erwarteter Wert werden neu ermittelt.
   - Beim Sichern entsteht eine neue Version, die Freigabe wird widerrufen.
7. **Service-Assistent → Beispiele → „Weg 3: Rauchwarnmelder laut Wartungsvertrag“** → Senden → „nur bis zum Auftrag“ → **Übernehmen & starten**.
8. **Testfall `STC-2026-000014`** (Team New End to End Prozess, Start ab Fakturaanforderung): Abschnitt „Process Reference“ zeigt den Vorgänger `STC-2026-000013`, „SAP Objects“ die übernommenen Belege (Herkunft *Taken over*).
9. **Service-Assistent → Beispiele → „Rauchmelder piept“**, im Text „Bitte direkt ab dem Angebot testen.“ ergänzen → Senden: Start ab Angebot, Weg 2, ohne Vorgänger-Testfall.
10. **Testfall `STC-2026-000007` → Ergebnis besprechen** → im Assistenten **Fragen → Wer ist zuständig?** → **Senden**; danach „Was hat sich seit dem letzten Lauf geändert?“.
11. **Auswertung** (im Ergebnis-Panel oder Übersicht → **Analytics**): Release `INT-2026.10`, Fehlerbild „Nettowert weicht von der Erwartung ab“ → **Besprechen**.
