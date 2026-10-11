# 🚀 Anleitung: Gemeinde-Mediathek bei Render online stellen

Diese Anleitung führt dich Schritt für Schritt dorthin, dass die Mediathek unter einer
Internet-Adresse erreichbar ist und alle sie aufs Handy legen können.
Dauer: etwa **20–30 Minuten**. Programmieren musst du nichts.

> ℹ️ Render ändert seine Webseite ab und zu. Wenn ein Knopf etwas anders heißt,
> such nach dem ähnlichsten Begriff – der Ablauf bleibt gleich.

---

## ✅ Was du brauchst

- [ ] Dein **GitHub-Konto** (dort liegt die App schon: `michapeterson-del/gemeinde`)
- [ ] Eine **Kreditkarte** (für Render, siehe Kosten unten)
- [ ] Ein **sicheres Admin-Passwort**, das du dir merkst (mindestens 6 Zeichen, besser 12+)

## 💶 Was kostet das?

| Was | Preis (ca., monatlich) |
|---|---|
| Server „Starter“ | ca. 7 $ |
| Speicher für Fotos & Aufnahmen, 10 GB | ca. 2,50 $ (0,25 $ pro GB) |
| **Zusammen** | **ca. 9,50 $ im Monat** |

Die aktuellen Preise stehen auf <https://render.com/pricing>.

> ⚠️ **Bitte nicht den kostenlosen Plan („Free“) nehmen!** Dort gibt es keinen dauerhaften
> Speicher – bei jedem Neustart wären alle hochgeladenen Fotos, Texte und Termine weg.
> Die mitgelieferte Einstellung wählt deshalb automatisch „Starter“ mit Speicher.

---

## Schritt 1 – App in den Haupt-Zweig übernehmen

Die App liegt im Moment auf dem Zweig `claude/gemeinde-media-archive-9vqgft`.
Am einfachsten ist es, sie vorher in den Haupt-Zweig `main` zu übernehmen:

1. Auf GitHub dein Projekt **gemeinde** öffnen.
2. Oben erscheint meist ein gelber Hinweis mit **„Compare & pull request“** – draufklicken.
   (Falls nicht: Reiter **Pull requests** → **New pull request** → bei „compare“ den Zweig
   `claude/gemeinde-media-archive-9vqgft` wählen.)
3. **Create pull request** → danach **Merge pull request** → **Confirm merge**.

> 💡 Du kannst mich auch bitten, den Pull Request für dich anzulegen – dann musst du nur noch auf „Merge“ klicken.

## Schritt 2 – Bei Render anmelden

1. <https://render.com> öffnen → **Get Started** bzw. **Sign Up**.
2. **„Sign up with GitHub“** wählen und Render den Zugriff erlauben.
3. Wenn gefragt wird, auf welche Projekte Render zugreifen darf:
   **„Only select repositories“** → `gemeinde` auswählen → bestätigen.
4. Unter **Billing** (Abrechnung) die Kreditkarte hinterlegen.

## Schritt 3 – App mit dem „Blueprint“ anlegen

In der App liegt eine Datei `render.yaml`. Das ist ein fertiger Bauplan – Render liest daraus
alle Einstellungen (Server in Frankfurt, Speicher, Zeitzone usw.).

1. Im Render-Dashboard oben auf **New +** → **Blueprint**.
2. Das Projekt **michapeterson-del/gemeinde** auswählen → **Connect**.
3. **Blueprint Name**: z. B. `Gemeinde-Mediathek`. **Branch**: `main`.
4. Render zeigt an, was angelegt wird: einen Web Service **gemeinde-mediathek** mit Disk **daten**.
5. Bei **ADMIN_PASSWORD** dein Admin-Passwort eintragen.
   *(SESSION_SECRET erzeugt Render selbst – da musst du nichts tun.)*
6. **Apply** (bzw. **Deploy Blueprint**) klicken.

Jetzt baut Render die App. Das dauert ein paar Minuten. Unter **Events** bzw. **Logs** siehst du
den Fortschritt. Fertig ist es, wenn dort **„Live“** steht und im Log
`Gemeinde-Mediathek läuft auf …` erscheint.

## Schritt 4 – Zum ersten Mal anmelden

1. Oben auf der Seite des Dienstes steht die Adresse, etwa
   `https://gemeinde-mediathek.onrender.com` (manchmal mit ein paar Zeichen extra) → öffnen.
2. Anmelden mit
   - Benutzername: **admin**
   - Passwort: das aus Schritt 3
3. Oben rechts bzw. unten auf **Konto** → bei Bedarf Passwort ändern.
4. **Verwaltung** → Ordner anpassen und **Benutzer** für die Gemeinde anlegen
   (Rolle **Normal** = nur ansehen, **Admin** = darf alles).

> ℹ️ `ADMIN_PASSWORD` gilt nur beim **allerersten Start**. Wenn du es später bei Render änderst,
> passiert nichts – das Passwort änderst du in der App unter **Konto**.

🎉 **Geschafft – die Mediathek ist online!**

---

## Schritt 5 (empfohlen) – Eigene Adresse, z. B. `mediathek.eure-gemeinde.de`

Wenn eure Gemeinde schon eine Internet-Adresse (Domain) hat:

1. Bei Render im Dienst **gemeinde-mediathek** → **Settings** → **Custom Domains** → **Add Custom Domain**.
2. `mediathek.eure-gemeinde.de` eintragen → speichern.
3. Render zeigt einen Eintrag an, etwa: **CNAME** → `gemeinde-mediathek.onrender.com`.
4. Beim Anbieter eurer Domain (z. B. IONOS, Strato, All-Inkl) in den **DNS-Einstellungen**
   genau diesen **CNAME-Eintrag** für `mediathek` anlegen.
5. Zurück bei Render auf **Verify** klicken. Das sichere Schloss (HTTPS) richtet Render
   automatisch ein. Es kann bis zu einigen Stunden dauern, bis alles greift.

## Schritt 6 – Auf die Handys bringen

Schick den Gemeindemitgliedern die Adresse und ihre Zugangsdaten. Dann:

- **iPhone:** Adresse in **Safari** öffnen → Teilen-Symbol ⬆️ → **„Zum Home-Bildschirm“**.
- **Android:** Adresse in **Chrome** öffnen → Menü ⋮ → **„App installieren“** bzw.
  **„Zum Startbildschirm hinzufügen“**.

Ab dann gibt es ein ⛪-Symbol auf dem Handy, das sich wie eine App öffnet.

---

## 🔄 Updates

Render ist so eingestellt, dass jede Änderung im Zweig `main` automatisch übernommen wird
(„Auto-Deploy“). Während eines Updates ist die App **ca. 1–2 Minuten nicht erreichbar** –
das ist bei Render mit dauerhaftem Speicher normal. Die Daten bleiben dabei erhalten.

## 💾 Datensicherung

- Render macht laut eigener Beschreibung **täglich automatisch Sicherungen (Snapshots)** des Speichers.
  Wiederherstellen: Dienst → **Disks** → Snapshot auswählen → **Restore**.
- Zusätzlich empfehle ich ab und zu eine eigene Sicherung. Im Dienst → **Shell** öffnen und eingeben:

  ```bash
  tar czf /var/data/sicherung-$(date +%F).tar.gz -C /var/data db
  ```

  Das sichert alle Texte, Termine, Ordner und Benutzer (ohne die großen Foto-Dateien).

## 📦 Speicher wird voll?

Wie voll der Speicher ist, siehst du in der App unter **Verwaltung → 💾 Speicher**
(ab 75 % erscheint dort ein Hinweis).

Vergrößern: bei Render im Dienst → **Disks** → Größe erhöhen (z. B. auf 20 GB). Vergrößern geht jederzeit,
**verkleinern nicht**. Jedes GB kostet etwa 0,25 $ im Monat.

> 💡 Gottesdienst-**Videos** sind sehr groß. Günstiger ist es, Videos auf YouTube
> („nicht gelistet“) hochzuladen und in der Mediathek nur **Fotos und Audio-Aufnahmen** zu speichern.

---

## 🆘 Hilfe – wenn etwas nicht klappt

**„Ich habe das Admin-Passwort vergessen“**
1. Render → Dienst → **Environment** → **Add Environment Variable**
2. Name: `ADMIN_PASSWORD_RESET`, Wert: ein neues Passwort (mind. 6 Zeichen) → **Save Changes**
3. Render startet neu → mit **admin** und dem neuen Passwort anmelden.
4. **Wichtig:** Die Variable `ADMIN_PASSWORD_RESET` danach **wieder löschen** und speichern.

**Die Seite zeigt einen Fehler / „Deploy failed“**
→ Dienst → **Logs** öffnen. Die letzten roten Zeilen zeigen den Grund.
Kopiere sie mir einfach in den Chat – ich helfe dir weiter.

**Nach einem Update sind alle abgemeldet**
→ Das passiert nur, wenn sich `SESSION_SECRET` geändert hat. Einfach neu anmelden.

**Ein großes Video lässt sich nicht hochladen**
→ Erst mit einer kleineren Datei ausprobieren. Für große Videos lieber YouTube verwenden (siehe oben).
