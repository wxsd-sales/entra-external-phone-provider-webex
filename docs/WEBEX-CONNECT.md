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
- Keep the trigger's default reply, e.g. `{"response":[{"code":"1002","description":"Queued","transid":"..."}]}`.
  Code `1001`/`1002` means accepted. Any other code (such as `7001` Authentication failed) is a failure.

Example webhook URLs for the CoE test flows (profile defaults):
SMS `https://hooks.us.webexconnect.io/events/Z98OR24X1T`, voice `https://hooks.us.webexconnect.io/events/IURFQ5I6YY`.

Example body (SMS):

```json
{"channel":"sms","to":"+15551234567","text":"Your code is 012345.","locale":"en-US","correlationId":"b1c2d3e4-0000-0000-0000-000000000000"}
```

Example body (voice): same fields, with `"channel":"voice"` and
`"text":"Your code is 0, 1, 2, 3, 4, 5. Your code is 0, 1, 2, 3, 4, 5."`.

## 2. Deploy

```powershell
.\Setup-Epp.ps1   # choose provider: webexconnect; paste the two flow URLs when asked
```

After setup, in the Azure portal go to **Key Vault > Secrets > `webexconnect-api-key` > New Version**,
paste the Connect API key and leave the version **enabled**.

## Status mapping

| Connect result | Function returns |
|---|---|
| 2xx + response code `1001`/`1002` (Queued) | 200 |
| `status: blocked` (custom flow reply) | 422 |
| Other Connect codes, unknown body, invalid JSON | 502 |
| Connect 429 | 429 |
| Connect other 4xx | 400 |

A 200 means Connect accepted the request, not that the handset received it. Check the Connect logs.
