# Deliver Entra SMS and voice OTPs with Webex Connect

This proof of concept lets Microsoft Entra ID send one-time passcodes (OTPs) by SMS and voice
through **Cisco Webex Connect**, using Microsoft's Bring Your Own Telephony (BYOT) feature.

```
Entra ID --> Azure Function (/api/SendOtp, in your subscription) --> Webex Connect flow --> SMS / phone call
```

> **Status:** proof of concept, not production-hardened. Run it in a **test tenant** first.
> Entra policy changes affect your existing SMS and voice users, so read Microsoft's
> [customer guide](Set%20up%20SMS%20and%20voice%20with%20your%20own%20telephony%20provider%20by%20using%20APIs%20-%20BYOT.md)
> before Part 3.

## What you need

| Item | Notes |
|---|---|
| Microsoft Entra tenant + Azure subscription | A test tenant is recommended. |
| Entra roles | **Privileged Role Administrator** (setup) and **Authentication Policy Administrator** (activation). |
| Azure permissions | Create resources and assign roles in the subscription. |
| Tools | PowerShell 7+ and Azure CLI 2.60+ (or Azure Cloud Shell in PowerShell mode). |
| Webex Connect account | With SMS and voice (text-to-speech) enabled, and a sender ID/number and voice caller ID. |
| Microsoft enablement | Confirm with Microsoft that BYOT is available to your tenant. |

## Part 1: Create two Webex Connect flows

Create one flow per channel, each starting with an inbound **webhook trigger** with service-key authentication.
Create a **service key** for the service that owns them. Full detail: [WEBEX-CONNECT.md](WEBEX-CONNECT.md).

The function sends this JSON, with your key in an HTTP header named `key`:

```json
{ "channel": "sms", "to": "+15551234567", "text": "Your code is 012345.", "locale": "en-US", "correlationId": "..." }
```

- **SMS flow:** trigger, then an SMS node (destination `to`, message `text`).
- **Voice flow:** trigger, then a Voice node reading `text` aloud to `to` in the `locale` language.
- Keep the default reply (`{"response":[{"code":"1002","description":"Queued",...}]}`). Code `1001` or `1002` means accepted.

Test each flow with a number you control before continuing:

```bash
curl -i -X POST '<your flow webhook URL>' -H 'key: <service key>' -H 'Content-Type: application/json' \
  -d '{"channel":"sms","to":"+1YOURNUMBER","text":"Your code is 012345.","locale":"en-US","correlationId":"test-1"}'
```

## Part 2: Deploy the Azure Function

In PowerShell 7 (or Cloud Shell), run:

```powershell
$repository = 'wxsd-sales/entra-external-phone-provider-webex'
$revision   = '4bcab4b0ec222b02a77025e2bfb3954fe423a7f7'

Invoke-WebRequest `
    -Uri "https://raw.githubusercontent.com/$repository/$revision/setup/Setup-Epp.ps1" `
    -OutFile .\Setup-Epp.ps1

# Review the downloaded script before running it.
.\Setup-Epp.ps1 -SourceRepository $repository -SourceRef $revision `
    -Provider webexconnect -Language javascript `
    -PackagePath "https://github.com/$repository/releases/download/epp-packages-4-1-javascript/released-package.zip"
```

Setup asks for your tenant, subscription, region and hosting plan (the default, FC1, scales to zero), then asks for
the **SMS flow URL** and **voice flow URL** from Part 1. Review the plan and approve it.
Save the deployment summary: you need its **endpoint URL** and **application (client) ID**.

Then add your service key. It is never entered in setup:

1. Azure portal > **Key Vault** (created by setup) > **Secrets** > `webexconnect-api-key` > **New Version**.
2. Paste the Webex Connect service key and leave the new version **enabled**.

## Part 3: Connect Entra and test

1. Send Microsoft your tenant ID and application ID if they ask for authorization of the endpoint.
2. Follow Steps 4 and 5 of Microsoft's customer guide to update the SMS and voice authentication method policies.
   Start in **evaluation mode** (checks the endpoint without sending), then test live with a test user and
   authorized numbers, then roll out gradually with `migrationPercentage`.
3. Confirm both the function's response and actual delivery of the SMS and call.

Setup never activates the policies for you.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Connect returns code `7001` | Wrong or inactive service key, or a key from a different service. |
| Entra shows a delivery failure, function returns 502 | Key Vault secret missing or not enabled, or the flow returned a code other than `1001`/`1002`. |
| Function returns 400 | Phone number not in E.164 format, or Connect rejected the request. |
| Function returns 429 | Connect throttling. |
| Function returns 422 | Flow reported the request as blocked. |
| A `200` but no message | `200` means Connect *accepted* the request. Check the flow's logs in Webex Connect. |

See also [Monitoring](MONITORING.md) and [setup troubleshooting](../setup/docs/Troubleshooting.md).
