# ⛪ Gemeinde-Mediathek

Eine Website für unsere Gemeinde, auf der alle **Bilder**, **Gottesdienstaufnahmen** (Audio & Video)
und Erinnerungen an einem Ort gesammelt werden – übersichtlich nach Kategorien und Alben sortiert.

## Was kann die App?

- **Anmeldung**
  - **Gemeinde-Passwort**: *ein* gemeinsames Passwort für alle Gemeindeglieder – sie dürfen alles
    ansehen, anhören und herunterladen. Der Admin legt es in der Verwaltung fest und kann es jederzeit
    ändern (dann werden alle abgemeldet) oder ausschalten.
  - **Admin** (eigenes Konto mit Benutzername): darf alles – Ordner anlegen, hochladen, Termine und
    Vermeldungen eintragen, Benutzer verwalten
  - Optional auch eigene Konten mit Rolle **Normal**
  - Ohne Anmeldung ist nichts zu sehen (auch die Bilder nicht) – gut für den Datenschutz.
- **Ordner, beliebig verschachtelt** – z. B. *Bilder › Jugend › Jugendfreizeit › Edersee 2026*.
  Ordner bekommen Symbol, Farbe und Beschreibung und lassen sich jederzeit umbenennen oder verschieben.
  Beim ersten Start sind schon vorhanden:
  - Bilder › Jugend › Jugendfreizeit / Jugendkurzfreizeit
  - Bilder › Kinder › Kindertag
  - Bilder › Gemeindefeste
  - Gottesdienste (als Predigtliste mit Prediger und Bibelstelle)
  - Texte & Dokumente
- **Gottesdienste**: ganze Gottesdienst-Aufnahmen (z. B. **M4A** oder MP3) als übersichtliche Liste nach Monaten –
  automatisch „Gottesdienst am …“ benannt, mit Wochentag und Spieldauer; ein Tipp spielt ab.
- **Hinzufügen**: Aufnahmen, Bilder, Videos und Dokumente (PDF, Word, Excel …) – und den Zielordner auswählen.
- **Schnelles, robustes Hochladen**: große Dateien werden in 8-MB-Stücke geteilt, 3 davon gleichzeitig gesendet;
  bricht die Verbindung kurz ab, wird nur das betroffene Stück automatisch wiederholt.
- **Automatisches Datum**: Beim Hochladen wird das Aufnahmedatum aus dem Foto gelesen
  (sonst aus dem Dateinamen, z. B. `IMG_20260815_…`). Man kann es vor dem Hochladen noch ändern.
  Bilder werden im Ordner nach Tagen gruppiert angezeigt.
- **Bearbeiten**: Titel, Datum, Beschreibung ändern, in einen anderen Ordner verschieben, löschen,
  ein Bild als Ordnerbild festlegen.
- **Aktuelles** (nur Admins tragen ein, alle sehen es – auch gleich auf der Startseite):
  - **Termine** wie Gottesdienst, Gemeindestunde, Abendmahl, Bibelstunde, Kindertag, Jugend, Orchester, Chor …
    mit Uhrzeit, Ort und Beschreibung
  - **Wiederkehrende Termine**: jede Woche, alle 2 Wochen oder monatlich
    (z. B. „Abendmahl jeden 1. Sonntag im Monat“) – optional mit Enddatum
  - Einzelne Termine einer Reihe **absagen** („Fällt aus“), ohne die ganze Reihe zu löschen
  - **Vermeldungen** mit „anzeigen ab / bis“ (ohne Enddatum 4 Wochen sichtbar),
    wichtige Vermeldungen werden hervorgehoben
  - Termine sortiert nach „Diese Woche“, „Nächste Woche“ und Monaten – und zum **Ausdrucken**
- **Vers des Tages** auf der Startseite: jeden Tag automatisch ein anderer Vers (Lutherbibel 1912, gemeinfrei);
  Admins können für einzelne Tage einen eigenen Vers festlegen, z. B. passend zur Predigt.
- **Gebetsanliegen**: schlichte Liste, die nur Admins schreiben; nicht mehr aktuelle Anliegen werden einfach gelöscht.
- **Suche** über Titel, Texte, Prediger, Bibelstellen, Ordnernamen und Jahreszahlen.
- Funktioniert auf Handy, Tablet und Computer und lässt sich auf dem Handy
  **zum Startbildschirm hinzufügen** – dann sieht sie aus wie eine App.

## Starten (lokal ausprobieren)

Voraussetzung: [Node.js](https://nodejs.org) ab Version 18.

```bash
npm install
ADMIN_PASSWORD="ein-sicheres-passwort" SESSION_SECRET="irgendein-langer-zufallstext" npm start
```

Dann im Browser öffnen: <http://localhost:3000> und anmelden mit
Benutzername **admin** und dem Passwort aus `ADMIN_PASSWORD`.
Unter **Verwaltung** legst du dann weitere Benutzer an.

## Einstellungen

| Variable          | Bedeutung                                          | Standard     |
|-------------------|----------------------------------------------------|--------------|
| `ADMIN_PASSWORD`  | Passwort für den ersten Admin `admin` (nur beim allerersten Start) | `gemeinde` |
| `SESSION_SECRET`  | Geheimer Schlüssel, damit Anmeldungen einen Neustart überleben | zufällig |
| `PORT`            | Port des Servers                                   | `3000`       |
| `TZ`              | Zeitzone für „heute“ bei Terminen, z. B. `Europe/Berlin` | Server-Zeitzone |
| `DATA_DIR` / `UPLOAD_DIR` | Speicherort für Datenbank / Dateien | `data/` / `uploads/` |
| `ADMIN_PASSWORD_RESET` | Notfall: setzt das Passwort von `admin` zurück (danach wieder entfernen) | – |
| `TRUST_PROXY` | `0` = App läuft ohne Reverse-Proxy (Standard: hinter Proxy) | – |
| `MAX_UPLOAD_MB`   | Maximale Größe pro Datei in MB                     | `2048`       |

## Wo liegen die Daten?

- `data/db.json` – Ordner, Texte, Termine, Vermeldungen, Beschreibungen und Benutzer (Passwörter nur verschlüsselt)
- `uploads/` – die hochgeladenen Dateien, sortiert nach Jahr und Monat (z. B. `uploads/2026/08/`)

**Für ein Backup einfach diese beiden Ordner sichern.**

## Online stellen

Die App läuft auf einem eigenen Server (Hetzner) mit **Coolify** unter
**https://gemeinde-mediathek.micha-apps.de**. Jeder Push auf den Branch
`claude/gemeinde-media-archive-9vqgft` wird automatisch live gestellt.

👉 **Alles zum Betrieb (Umgebungsvariablen, Speicherort, Sicherung): [BETRIEB.md](BETRIEB.md)**

> 💡 Bitte daran denken: Bevor Fotos von Personen – besonders von Kindern und Jugendlichen –
> öffentlich gezeigt werden, braucht es deren Einverständnis bzw. das der Eltern (DSGVO).

## Tests

```bash
npm test
```
