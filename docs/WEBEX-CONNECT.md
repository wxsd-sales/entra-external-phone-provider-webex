# Webex Connect provider

Delivers Entra OTPs through two Webex Connect flows (SMS and voice).

```
Entra -> Azure Function /api/SendOtp -> Connect webhook (header: key=<API key>) -> SMS / Voice node
```

## 1. Build two flows in Webex Connect

Each flow starts with an inbound **Custom API / webhook trigger** and receives this JSON:

| Field | Example | Use |
|---|---|---|
| `channel` | `sms` or `voice` | informational |
| `to` | `+15551234567` | recipient (E.164) |
| `text` | `Your code is 012345.` | SMS body, or TTS text (digits already spelled out, repeated twice, for voice) |
| `locale` | `en-US` | voice language |
| `correlationId` | GUID | put in your flow logs for tracing |

- **SMS flow:** trigger -> SMS node (`to`, `text`) -> end.
- **Voice flow:** trigger -> Voice node with Text-to-Speech (`to`, `text`, `locale`) -> end.
- Copy each flow's webhook URL. Enable API-key auth on the trigger and create a key.
- Keep the trigger's default reply (`{"transactionId": "..."}`), which the adapter treats as "accepted".
  A flow may instead return `{"status": "accepted|queued"}`, `{"status": "blocked"}` or `{"status": "failed"}`.

## 2. Deploy

```powershell
.\Setup-Epp.ps1   # choose provider: webexconnect; paste the two flow URLs when asked
```

After setup, in the Azure portal go to **Key Vault > Secrets > `webexconnect-api-key` > New Version**,
paste the Connect API key and leave the version **enabled**.

## Status mapping

| Connect result | Function returns |
|---|---|
| 2xx + `transactionId` / accepted status | 200 |
| `status: blocked` | 422 |
| `status: failed`, unknown body, invalid JSON | 502 |
| Connect 429 | 429 |
| Connect other 4xx | 400 |

A 200 means Connect accepted the request, not that the handset received it. Check the Connect logs.
