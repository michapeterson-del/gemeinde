# ⛪ Gemeinde-Mediathek

Eine Website für unsere Gemeinde, auf der alle **Bilder**, **Gottesdienstaufnahmen** (Audio & Video)
und Erinnerungen an einem Ort gesammelt werden – übersichtlich nach Kategorien und Alben sortiert.

## Was kann die App?

- **Anmeldung mit zwei Rollen**
  - **Admin**: darf alles – Ordner anlegen, hochladen, Texte schreiben, Benutzer verwalten
  - **Normal**: darf alles ansehen, anhören und herunterladen
  - Ohne Anmeldung ist nichts zu sehen (auch die Bilder nicht) – gut für den Datenschutz.
- **Ordner, beliebig verschachtelt** – z. B. *Bilder › Jugend › Jugendfreizeit › Edersee 2026*.
  Ordner bekommen Symbol, Farbe und Beschreibung und lassen sich jederzeit umbenennen oder verschieben.
  Beim ersten Start sind schon vorhanden:
  - Bilder › Jugend › Jugendfreizeit / Jugendkurzfreizeit
  - Bilder › Kinder › Kindertag
  - Bilder › Gemeindefeste
  - Gottesdienste (als Predigtliste mit Prediger und Bibelstelle)
  - Texte & Dokumente
- **Hinzufügen**: Bilder, Audio, Videos, Dokumente (PDF, Word, Excel …) oder einfach einen **Text** schreiben –
  und den Zielordner auswählen.
- **Automatisches Datum**: Beim Hochladen wird das Aufnahmedatum aus dem Foto gelesen
  (sonst aus dem Dateinamen, z. B. `IMG_20260815_…`). Man kann es vor dem Hochladen noch ändern.
  Bilder werden im Ordner nach Tagen gruppiert angezeigt.
- **Bearbeiten**: Titel, Datum, Beschreibung ändern, in einen anderen Ordner verschieben, löschen,
  ein Bild als Ordnerbild festlegen.
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
| `MAX_UPLOAD_MB`   | Maximale Größe pro Datei in MB                     | `2048`       |

## Wo liegen die Daten?

- `data/db.json` – Ordner, Texte, Beschreibungen und Benutzer (Passwörter nur verschlüsselt)
- `uploads/` – die hochgeladenen Dateien, sortiert nach Jahr und Monat (z. B. `uploads/2026/08/`)

**Für ein Backup einfach diese beiden Ordner sichern.**

## Online stellen

Die Seite braucht einen kleinen Server mit Node.js und genug Speicherplatz für die Medien
(Gottesdienst-Videos werden schnell groß). Möglichkeiten:

- ein günstiger V-Server (z. B. bei Hetzner, Netcup, Strato) mit einer eigenen Domain
- ein Raspberry Pi oder NAS im Gemeindehaus
- Plattformen wie Render oder Railway – wichtig: einen **dauerhaften Speicher (Volume)**
  für `data/` und `uploads/` einrichten

Online immer **HTTPS** verwenden (z. B. über Caddy oder nginx mit Let's Encrypt).

> 💡 Bitte daran denken: Bevor Fotos von Personen – besonders von Kindern und Jugendlichen –
> öffentlich gezeigt werden, braucht es deren Einverständnis bzw. das der Eltern (DSGVO).

## Tests

```bash
npm test
```
