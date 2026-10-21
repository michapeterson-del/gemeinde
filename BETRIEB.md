# Betrieb auf dem eigenen Server (Hetzner + Coolify)

Die Gemeinde-Mediathek läuft auf einem eigenen Server mit **Coolify**.
Adresse: **https://gemeinde-mediathek.micha-apps.de**

## Deploy

- Coolify ist per GitHub App mit diesem Repo verbunden und baut **automatisch neu**, sobald auf den
  Branch **`claude/gemeinde-media-archive-9vqgft`** gepusht wird. Änderungen auf anderen Branches gehen
  nicht live.
- Build über Railpack/Nixpacks (Node ≥ 20). Start: `npm start` – die App lauscht auf `process.env.PORT`
  (Standard 3000).
- Die App läuft hinter dem Reverse-Proxy **Traefik** (HTTPS außen, HTTP intern). Echte Besucher-IP und
  HTTPS werden über die Proxy-Header erkannt (`trust proxy`). Nur falls die App einmal **ohne** Proxy läuft:
  `TRUST_PROXY=0` setzen.
- Healthcheck (falls in Coolify gewünscht): `GET /api/me` → 200.
- Während eines Deploys ist die App kurz nicht erreichbar. Laufende Uploads pausieren und setzen danach
  automatisch fort (bis zu 5 Minuten).

## Umgebungsvariablen (in Coolify pflegen – nie im Code, keine `.env` committen)

| Variable | Zweck | Empfohlen |
|---|---|---|
| `DATA_DIR` | Ordner für die Datenbankdatei `db.json` (Benutzer, Ordner, Termine, Gebetsanliegen …) | `/var/data/db` |
| `UPLOAD_DIR` | Ordner für hochgeladene Dateien (Aufnahmen, Bilder, Dokumente) | `/var/data/uploads` |
| `SESSION_SECRET` | Geheimer Schlüssel für Anmeldungen – sonst muss man sich nach jedem Neustart neu anmelden | langer Zufallstext |
| `ADMIN_PASSWORD` | Passwort für den Haupt-Admin `admin` – **nur beim allerersten Start** | sicheres Passwort |
| `TZ` | Zeitzone für „heute“ (Termine, Vers des Tages) | `Europe/Berlin` |
| `ADMIN_PASSWORD_RESET` | **Nur im Notfall:** setzt das Passwort von `admin` zurück (wirkt pro Wert einmal), danach wieder entfernen | – |
| `MAX_UPLOAD_MB` | Maximale Dateigröße in MB | `2048` (Standard) |

> ⚠️ `DATA_DIR` und `UPLOAD_DIR` müssen auf das **dauerhafte Volume unter `/var/data`** zeigen. Fehlen sie,
> schreibt die App ins Container-Dateisystem – dann wären die Daten nach dem nächsten Deploy weg.
> In diesem Fall zeigt die App im Log und in der **Verwaltung** eine rote Warnung.

## Daten & Sicherung

- Alles Wichtige liegt im Volume **`/var/data`**:
  - `/var/data/db/db.json` – alle Inhalte außer den Dateien
  - `/var/data/uploads/JJJJ/MM/…` – die Dateien
- Für ein Backup genügt es, `/var/data` zu sichern (z. B. über die Backup-Funktion des Servers oder ein
  `tar` des Volumes). `db.json` ist klein; die Uploads machen den Großteil aus.
- Die App braucht **keine** Postgres-Datenbank.

## Hilfe

- **Admin-Passwort vergessen:** in Coolify `ADMIN_PASSWORD_RESET` mit einem neuen Passwort (mind. 6 Zeichen)
  setzen, neu deployen, mit `admin` anmelden, Variable wieder löschen.
- **„Zu viele Fehlversuche“:** 5 Minuten warten oder die App in Coolify neu starten.
- **Fehler nach einem Deploy:** In Coolify die Logs der Anwendung ansehen – die App schreibt beim Start
  verständliche Hinweise (z. B. zum Speicherort oder zum Admin-Passwort).
