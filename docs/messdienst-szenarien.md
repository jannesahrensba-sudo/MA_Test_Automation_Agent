# Messdienst-Szenarien: Heizkostenverteiler und Rauchwarnmelder

Stand: 29.09.2026 · Fachdomäne des [Service-Assistenten](agent-konzept.md)

## 1. Fachlicher Bezug

Die Prozesslogik ist an Messdienstleistern wie **Brunata Metrona** ausgerichtet. Grundlage ist deren öffentlich beschriebenes Leistungsspektrum:

- **Heizkostenverteiler (HKV):** elektronisch, per Funk ablesbar. Bei einem Defekt, etwa einem LC-Display ohne Anzeige oder einer Fehleranzeige, informiert der Bewohner die Hausverwaltung bzw. den Vermieter. Danach wird das Gerät getauscht.
- **Rauchwarnmelder (RWM):** Funk-Rauchwarnmelder mit Ferninspektion. Die Inspektion geht per Fernabfrage, die Wartung nur vor Ort. Typische Meldungen sind Demontage, Hindernis im Umfeld und verschmutzte Rauchkammer. Bei beeinträchtigter Rauchkammer wird der Melder getauscht.
- **Service:** Eine 24/7-Hotline hilft direkt oder veranlasst einen Monteureinsatz vor Ort.

> **Belegstufe C, ⚠ NOCH ZU VERIFIZIEREN:**
>
> - Die Egress-Policy dieser Umgebung sperrt brunata-metrona.de. Verwendet wurden nur Auszüge aus Suchergebnissen, keine abgerufenen Seiten.
> - Der konkrete Serviceprozess im S/4HANA-System des Messdienstleisters ist nicht bekannt, z. B. Vertragsleistung, Gewährleistung, Kostenübernahme.

**Alle Stammdaten in diesem Mockup sind fiktiv.**

- Hausverwaltungen, Adressen, Bewohner, Gerätenummern und Preise sind erfunden.
- Die App verwendet keine Namen, Logos oder Markenzeichen von Brunata Metrona.

## 2. Abbildung auf S/4HANA Service

| Messdienst | S/4HANA-Service-Objekt (Feld im Testfall) | Mock-Daten |
|---|---|---|
| Hausverwaltung / WEG (Auftraggeber) | Auftraggeber (`SoldToParty`) | `MD-100010` Hausverwaltung Musterfeld GmbH (München), `MD-100020` Wohnbau Beispielstadt eG (Köln), `MD-100030` WEG Parkweg 7 (Leipzig) |
| Ansprechpartner der Hausverwaltung, Hausmeister | Meldender (`ServiceRequestReporter`) | Petra Wagner, Stefan Brandl, Aylin Demir, Thomas Wagner, Jens Richter |
| Liegenschaft (Adresse) | Technischer Platz, Gebäude-Ebene | `LG-0815` Musterstraße 12, `LG-2040` Lindenallee 5, `LG-3100` Parkweg 7 |
| Nutzeinheit (Wohnung, Bewohner) | Technischer Platz, Unterebene (`SuperiorFunctionalLocation` = Liegenschaft) → `ServiceRefFunctionalLocation` | z. B. `LG-0815-NE03` „NE 03 · 1. OG links · Nutzer Müller“ |
| Gerät | Equipment (`ServiceReferenceEquipment`) | z. B. `HKV-0815-031` Heizkostenverteiler Wohnzimmer, `RWM-0815-022` Rauchwarnmelder Kinderzimmer; insgesamt 21 Geräte |
| Gerätetyp | Referenzprodukt (`ReferenceProduct`) mit Produktgruppe | `MD-HKV-FUNK` (MD-HKV), `MD-RWM-FUNK` (MD-RWM), `MD-WZ-FUNK` (MD-WZ) |
| Monteureinsatz | Serviceprodukt (`ServiceProduct`) | `MD-SRV-STOER` Monteureinsatz Störungsbehebung (Gruppe MD, für alle Geräte), `MD-SRV-RWM` Rauchwarnmelder-Service vor Ort (Gruppe MD-RWM) |
| Ersatzgerät | Serviceteil (`ServicePart`) | `MD-ERS-HKV`, `MD-ERS-RWM`, `MD-ERS-WZ`; `MD-ERS-HKV-ALT` (Mock: gesperrt, SIM-6) |
| Monteurteam der Region | Verantwortliches Serviceteam (`RespyMgmtServiceTeam`) | `MD-TEAM-MUC`, `MD-TEAM-CGN`, `MD-TEAM-LEJ` |
| Serviceorganisation / Vertrieb | `ServiceOrganization`, `SalesOrganization` | `SO-MD-SUED`, `SO-MD-WEST`, `SO-MD-OST`; Verkaufsorganisation `2010` |

Die Belegkette bleibt die bestehende Service-to-Cash-Kette: Service Request → Angebot → Auftrag → Rückmeldung → Fakturaanforderung → Faktura. Sie wird durch MockS4ServiceChain simuliert.

## 3. Prozessprofile (Konfiguration, ohne Codeänderung anpassbar)

| Profil | Name | Vorbelegungen (FieldRequirement.DefaultValue) |
|---|---|---|
| `MD_HKV_STOER` | Messdienst – Störung Heizkostenverteiler | Verkaufsorganisation 2010 · `MD-SRV-STOER` 1 Std. · Ersatzteil `MD-ERS-HKV` 1 Stk. · Priorität 5 |
| `MD_RWM_STOER` | Messdienst – Störung Rauchwarnmelder | Verkaufsorganisation 2010 · `MD-SRV-RWM` 1 Std. · Ersatzteil `MD-ERS-RWM` 1 Stk. · Priorität 3 (hoch) |

## 4. Regeln und Ableitungen

**Neue Validierungsregel R10 (Gerätetyp):**

- Serviceprodukt und Ersatzteil müssen zur Produktgruppe des Geräts passen oder zu deren übergeordneter Gruppe (`MD` passt zu `MD-HKV`).
- Beispiel: Ein Ersatz-Heizkostenverteiler für einen Rauchwarnmelder ist ein Fehler, der Vorschlag lautet `MD-ERS-RWM`.
- Ein H2-Serviceprodukt an einem Messgerät ist ebenfalls ein Fehler.

**Determinations beim Ändern:**

- Nutzeinheit, Kunde und Gerätetyp folgen aus dem Gerät.
- Die Serviceorganisation folgt aus dem Team.
- Der **erwartete Nettowert** wird aus der Mock-Preisliste berechnet, wenn er leer ist. Leeren berechnet neu.
- Für eine Preissimulation im Realsystem ist die API noch offen: ⚠ NOCH ZU VERIFIZIEREN.

**Mock-Extraktion (Backend-Aktion `analyze`)** versteht deutsche Störungsmeldungen:

- Adresse (auch „Musterstr. 12“), Bewohner, Geschoss/Seite und Nummer der Nutzeinheit
- Gerätetyp und Raum
- Symptome: Display ohne Anzeige, Fehleranzeige, Warnton, Fehlalarm, demontiert, beschädigt, Rauchkammer verschmutzt, Batterie, unplausibler Verbrauch
- Dringlichkeit: sehr dringend → 1, dringend → 3, nicht dringend → 9
- Das Team ergibt sich aus der Region des Kunden (Mock-Heuristik).
- Gesperrte Teile werden nie vorgeschlagen.

## 5. Mock-Preisliste (SIM-3, fiktiv)

| Produkt | Preis |
|---|---|
| `MD-SRV-STOER` Monteureinsatz | 69,00 EUR / Std. |
| `MD-SRV-RWM` Rauchwarnmelder-Service | 59,00 EUR / Std. |
| `MD-ERS-HKV` Ersatzgerät HKV | 39,00 EUR / Stk. |
| `MD-ERS-RWM` Ersatzgerät RWM | 35,00 EUR / Stk. |
| `MD-ERS-WZ` Ersatzgerät Wasserzähler | 45,00 EUR / Stk. |

HKV-Störung: 1 Std. + 1 Ersatzgerät = **108,00 EUR**. RWM-Störung: **94,00 EUR**.

## 6. Seed-Testfälle

| Case ID | Szenario | Stand |
|---|---|---|
| `STC-2026-000004` | Referenzlauf: HKV in Köln mit Fehleranzeige getauscht (`MD_HKV_STOER`) | ausgeführt, PASSED |
| `STC-2026-000005` | Negativfall: Ersatz-HKV für einen Rauchwarnmelder (`MD_RWM_STOER`) | INVALID (R10), Vorschlag `MD-ERS-RWM` |
| `STC-2026-000006` | Golden Case Messdienst: Rauchwarnmelder piept (`MD_RWM_STOER`) | erfasst, noch nicht validiert |

## 7. Beispielmeldungen für den Service-Assistenten

| Meldung | Ergebnis |
|---|---|
| „Frau Müller aus der Musterstraße 12 in München (1. OG links) meldet über Petra Wagner von der Hausverwaltung, dass der Heizkostenverteiler im Wohnzimmer nichts mehr anzeigt – das Display ist komplett dunkel.“ | `HKV-0815-031`, Gültig, 108,00 EUR |
| „Im Kinderzimmer der Wohnung Yilmaz (Musterstraße 12, EG rechts) piept der Rauchmelder alle paar Sekunden, obwohl kein Rauch da ist. Bitte dringend jemanden schicken. Gemeldet von Hausmeister Stefan Brandl.“ | `RWM-0815-022`, Priorität 3, Gültig, 94,00 EUR |
| „Bei Familie Müller in der Musterstraße 12 funktioniert ein Heizkostenverteiler nicht.“ | Rückfragen: Welches Gerät (Wohnzimmer, Schlafzimmer, Bad)? Wer ist Meldender? |
| „Lindenallee 5 in Köln, Herr Nowak: der Rauchwarnmelder im Flur ist abgerissen und liegt auf dem Boden. Meldung von Aylin Demir.“ | `RWM-2040-021`, Team Köln, Gültig |
| „Musterstraße 12, 1. OG links (Müller): der Warmwasserzähler im Bad ist defekt. Gemeldet von Petra Wagner.“ | Profil HKV → R10 korrigiert das Ersatzteil auf `MD-ERS-WZ`, Gültig |

## 8. Grenzen des Modells

Nicht abgebildet sind:

- Gewährleistung und Vertragsleistung ohne Faktura
- Ferninspektion als eigener Prozess
- Nutzerwechsel und Zwischenablesung
- unterjährige Verbrauchsinformation

Der Tausch vor Ort ist immer der Service-to-Cash-Pfad mit Faktura an die Hausverwaltung. Weitere Profile lassen sich über die Konfiguration ergänzen, etwa „Austausch in Gewährleistung“ mit eigenem Execution Provider. Das hängt vom realen Prozess ab: ⚠ NOCH ZU VERIFIZIEREN.
