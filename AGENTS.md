# AGENTS.md: Webex Connect OTP provider for Microsoft Entra (BYOT)

Handoff notes for anyone (human or AI) continuing this work. Read this first.

## Goal
Customer: Ameriprise Financial (CDW partner, opportunity 006KY000007XxaLYAS). Microsoft is retiring SMS/voice OTP
delivery from Entra ID by end of January 2027. Microsoft's replacement is **Bring Your Own Telephony (BYOT)**:
Entra calls an HTTPS endpoint (an Azure Function) that we host, and the function delivers the OTP.
Ameriprise already uses Webex Connect and wants it as the provider. We are building a PoC they can run themselves.

## How it works
```
Entra ID --(encrypted JWE, Microsoft-authenticated)--> Azure Function POST /api/SendOtp   [customer's Azure subscription]
   Function decrypts, then POSTs JSON to a Webex Connect webhook (HTTP header  key: <service key>)
   Webex Connect flow (one for SMS, one for voice) --> SMS node / Voice TTS node --> handset
```
Nothing runs on Webex except the two flows. The adapter code runs inside the Azure Function.

## Where everything lives
- Repo: `wxsd-sales/entra-external-phone-provider-webex` (fork of `Azure-Samples/ExternalPhoneProvider-AzureFunction-Sample`).
- **Adapter:** `javascript/src/functions/providers/webexconnect.js` (registered in `providers/index.js`). JS only; the Python and .NET runtimes have no Webex adapter.
- **Setup profile:** `setup/providers/webexconnect.json` (listed in `setup/providers/catalog.json`).
- **Tests:** `javascript/test/webexconnect.test.js` (`cd javascript && npm ci && npm test`). Four `setup/tests/*.ps1` files were edited to expect the extra catalog entry.
- **Docs:** `docs/WEBEX-CONNECT.md` (flow spec), `docs/WEBEX-CONNECT-QUICKSTART.md` (customer README).
- Upstream docs: `docs/Telephony provider guide- Bring Your Own Telephony (BYOT).md` (provider side) and `docs/Set up SMS and voice ... - BYOT.md` (customer side).

## How the flow URLs and service key reach the function
- **Flow URLs:** two places, same values.
  1. `setup/providers/webexconnect.json` `routes.global.smsEndpoint` / `voiceEndpoint` are the defaults. `Setup-Epp.ps1` copies them into the
     Function App settings `EPP_PROVIDER_SMS_ENDPOINT` / `EPP_PROVIDER_VOICE_ENDPOINT`. Currently set to the CoE test flows
     (SMS `.../events/Z98OR24X1T`, voice `.../events/IURFQ5I6YY` on `hooks.us.webexconnect.io`).
  2. The same profile declares required inputs `WEBEXCONNECT_SMS_URL` / `WEBEXCONNECT_VOICE_URL`. Setup **prompts for them** and stores them as
     Function App settings; the adapter prefers them over the route endpoints. So a customer pastes **their own** flow URLs during setup.
- **Service key:** never in the repo, setup args, or app settings. Setup creates a **disabled placeholder** Key Vault secret named
  `webexconnect-api-key`. After deployment, someone adds a **new enabled version** containing the Connect service key (Azure portal >
  Key Vault > Secrets). On each live request the Function's managed identity reads it and the adapter sends it as header `key`.
- The CoE test flows and key are Cisco's. **Ameriprise must build their own flows and service key in their Webex Connect tenant** (spec in
  `docs/WEBEX-CONNECT.md`). A service key was pasted in an earlier chat; treat it as exposed and rotate it.

## Status
Done and verified:
- Adapter, profile, tests merged to `main` (PR 1). CI green (setup tests on Ubuntu/Windows, JS 20/22, Python, .NET, ZIP build).
- Release ZIPs published by CI: `epp-packages-4-1-javascript` (also `-python`, `-dotnet`).
- Both Connect flows tested by hand with curl using the service key: SMS and voice both arrived. Connect reply is
  `{"response":[{"code":"1002","description":"Queued","transid":"..."}]}`; the adapter accepts codes `1001`/`1002`, fails others
  (e.g. `7001` Authentication failed, which means a wrong/inactive key).
- Customer quick start drafted (PR 2, may still be unmerged).

**Not done / not verified:**
1. **Never deployed to Azure.** `Setup-Epp.ps1` has not been run for `webexconnect`.
2. **Never tested end to end with Entra.** Only the adapter and Connect flows were tested, in isolation.
3. **Microsoft enablement is unknown** (biggest risk, see below).
4. Adapter behavior against real Entra requests (JWE decryption, evaluation mode) is only covered by the upstream sample's tests.

## What's left to do (in order)
1. **Get an Entra test tenant and Azure subscription.** Options: Microsoft 365 Developer Program sandbox, or a new tenant plus an Azure free
   account. You must hold **Privileged Role Administrator** (setup) and **Authentication Policy Administrator** (activation), and be able
   to create resources and assign roles in the subscription. Tools: PowerShell 7+ and Azure CLI 2.60+ (or Azure Cloud Shell, PowerShell mode).
2. **Ask Microsoft how a non-listed provider is enabled for BYOT.** The provider guide says the customer sends tenant ID and app ID to the
   provider to authorize; the Microsoft-listed providers (Infobip, Soprano, Telesign) use OAuth federation. Our adapter uses an API key, so
   likely no provider-side authorization step, but **confirm whether BYOT is enabled for arbitrary tenants/endpoints** (contact Microsoft
   via Ameriprise's account team or the Entra team). If this is gated, end-to-end testing may only be possible in Ameriprise's tenant.
3. **Deploy the Function.** Run the command in `docs/WEBEX-CONNECT-QUICKSTART.md` Part 2 (pinned to a commit and the 4.1 JS release ZIP). It
   prompts for tenant, subscription, region, plan (FC1 default), and the two flow URLs. Save the deployment summary (`endpointUrl`,
   `applicationId`). Setup creates the Function App, Key Vault, storage, identities and monitoring.
   - To redeploy after code changes: merge to `main`; the "Function ZIPs" workflow publishes a new release; rerun setup with the new
     `-PackagePath`/`-PackageReleaseTag` and the **same app ID and resource prefix**; update the commit pin and tag in the quick start.
4. **Add the service key** to Key Vault secret `webexconnect-api-key` (new enabled version). Do not enable the placeholder.
5. **Test.** Evaluation mode first (validates auth and decryption, sends nothing), then a live request to your own numbers. Note: live
   requests must come from Microsoft's authorized caller (Easy Auth); an ordinary Azure CLI token is rejected, so this goes through Entra.
6. **Activate** SMS and voice in the Entra authentication method policy (manual; setup never does it). Follow Steps 4 and 5 of the customer guide.
   Use evaluation mode and `migrationPercentage`; policy changes affect existing SMS/voice users.
7. **Hand to Ameriprise:** merge PR 2, give them the quick start. They build their own Connect flows/key, run setup, add the key.
8. Optional hardening: Connect error-code handling beyond 1001/1002, a blocked/fraud reply from the flow (maps to 422), monitoring docs.

## Gotchas
- Header name for the Connect key is `key` (confirmed working). Error `7001` = key rejected.
- Phone numbers must be E.164 (`+15551234567`); the adapter rejects others.
- Voice text has digits spelled out and the message repeated (shared `voiceMessage.js`).
- A `200` from the function means Connect **accepted** the request, not that the handset received it. Check Connect logs.
- Local macOS: `setup/tests/Certificates.Tests.ps1` fails on keychain (pre-existing, environmental); CI passes.
- Never commit service keys, phone numbers, OTPs, or decrypted payloads. Keep them out of logs.
- Forks need Actions enabled in the UI once (already done for this fork).
