# ⛪ Gemeinde-Mediathek

Eine Website für unsere Gemeinde, auf der alle **Bilder**, **Gottesdienstaufnahmen** (Audio & Video)
und Erinnerungen an einem Ort gesammelt werden – übersichtlich nach Kategorien und Alben sortiert.

## Was kann die Seite?

- **Kategorien** wie *Gottesdienste*, *Jugend*, *Kinder*, *Gemeindetage & Feste*, *Musik & Chor*
  (frei änderbar und erweiterbar, mit Symbol und Farbe)
- **Alben** mit schönem Titel, Datum, Ort, Beschreibung und Schlagworten
  – z. B. „Jugendfreizeit am See“ oder „Erntedankfest 2026“
- **Gottesdienste** mit Prediger, Bibelstelle und Predigtreihe – als übersichtliche Predigtliste
- **Bildergalerie** mit Vollbildansicht (Pfeiltasten / Wischen auf dem Handy)
- **Audio- und Videoplayer** direkt im Browser, inkl. Download
- **Suche** nach Titel, Prediger, Bibelstelle, Schlagwort … und Filter nach Jahr
- **Hochladen per Drag & Drop** – auch viele Fotos auf einmal, mit Fortschrittsanzeige
- Titelbild und Beschriftungen für jedes Bild festlegen
- Funktioniert auf Handy, Tablet und Computer, auch im Dunkelmodus
- Ansehen kann jeder, **hochladen und bearbeiten nur mit Passwort**

## Starten (lokal ausprobieren)

Voraussetzung: [Node.js](https://nodejs.org) ab Version 18.

```bash
npm install
ADMIN_PASSWORD="ein-sicheres-passwort" npm start
```

Dann im Browser öffnen: <http://localhost:3000>
Über **Anmelden** oben rechts kommt man mit dem Passwort in die Verwaltung.

## Einstellungen

| Variable          | Bedeutung                                          | Standard     |
|-------------------|----------------------------------------------------|--------------|
| `ADMIN_PASSWORD`  | Passwort für Mitarbeiter (unbedingt setzen!)       | `gemeinde`   |
| `SESSION_SECRET`  | Geheimer Schlüssel, damit Anmeldungen einen Neustart überleben | zufällig |
| `PORT`            | Port des Servers                                   | `3000`       |
| `MAX_UPLOAD_MB`   | Maximale Größe pro Datei in MB                     | `2048`       |

## Wo liegen die Daten?

- `data/db.json` – alle Alben, Kategorien und Beschreibungen
- `uploads/` – die hochgeladenen Bilder, Audio- und Videodateien

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
