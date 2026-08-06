# Paket-Sendungsverfolgung fuer Home Assistant

[![HACS](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz)
[![HA Version](https://img.shields.io/badge/Home%20Assistant-2024.1%2B-blue.svg)](https://www.home-assistant.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)


## Features

- **DHL** Sendungsverfolgung (kein API-Key noetig)

## Installation via HACS

1. HACS -> Integrationen -> Menue -> Benutzerdefinierte Repositories
2. URL: `https://github.com/Noack1978/ha-parcel-tracking`
3. Kategorie: Integration -> Hinzufuegen
4. "Paket-Sendungsverfolgung" suchen -> Herunterladen
5. HA neu starten

Die Lovelace-Karte wird automatisch als Ressource registriert.

## Einrichtung

1. Einstellungen -> Geraete & Dienste -> "Paket-Sendungsverfolgung" hinzufuegen
2. API-Key optional (nur fuer Sandbox / Unified API)
3. Karte im Dashboard: `type: custom:parcel-tracking-card`

## Carrier-Erkennung

| Format | Carrier |
|---|---|
| `00` + 18 Stellen | DHL Paket |
| `JJD...` | DHL Express |

## Automation

```yaml
alias: Paket-Benachrichtigung
triggers:
  - trigger: event
    event_type: parcel_tracking_status_changed
actions:
  - action: notify.send_message
    target:
      entity_id: notify.mein_handy   # Notify-Entity, seit HA 2026.5
    data:
      title: Paket
      message: >
        {% if trigger.event.data.status == 'out-for-delivery' %}
          {{ trigger.event.data.label }} trifft heute ein.
        {% else %}
          {{ trigger.event.data.label }} wurde zugestellt.
        {% endif %}
mode: parallel
max: 10
```

## Changelog

### v1.1.0-beta.1
- 🔄 Kompatibilität mit neuen HA-Notify-Entities (seit HA 2026.5 ersetzt `mobile_app` bei manchen Geräten den festen Dienst `notify.mobile_app_xxx` durch eine Notify-Entity `notify.<gerät>`)
- Archiv-Erinnerung erkennt automatisch, ob das konfigurierte Notify-Ziel eine Entity oder ein klassischer Dienst ist
- Beispiel-Automation in der README auf `notify.send_message` aktualisiert

## Lizenz

MIT - siehe [LICENSE](LICENSE)
