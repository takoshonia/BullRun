# AI provider pool and failover

GeoBridge accepts an ordered list of provider connections. Native adapters support OpenAI, Google Gemini, Anthropic Claude and xAI Grok. Other services can use the OpenAI-compatible Chat Completions adapter with a configured HTTPS base URL. Model IDs are administrator supplied; they are not selected from a hard-coded list. The chosen provider/model must support its adapter's structured JSON schema format. A service with a different protocol needs its own adapter.

Each connection has its own name, provider, model, private key file and quota group. Add any number of connections; the application imposes no connection-count cap. Actual generation has a bounded total deadline and attempt budget, so it does not try an unlimited number during one request.

## Setup on the live server

In DigitalOcean → geobridge-backend → Web Console, as root, run:

```sh
python3 /root/configure-geobridge-ai.py
```

Choose **1 Add/update connection**, enter a unique name, provider, exact model ID, quota group and the hidden API key. For another compatible provider, enter its HTTPS API base URL. Repeat for additional keys. New entries go at the end of the list. **5 Move to first** changes the preferred connection; repeat to establish the desired order. The menu also lists, disables, enables and removes connections. Removing a connection removes its configuration; its private key file is retained until deliberately deleted by the administrator.

Configuration is stored at `/app/data/ai/providers.json` inside the persistent Docker volume. Key files are separate, private `0600` files in `/app/data/ai/`, owned by the container's Node user. Configuration changes apply at runtime. The helper imports an existing file-based OpenAI connection when creating the first pool. Existing environment-only OpenAI configuration continues to work if no pool file exists. An existing pool file takes precedence, including when all its entries are disabled. A malformed pool fails closed and uses the template rather than unexpectedly routing to another account.

For local development set `GEOBRIDGE_AI_POOL_FILE` in `.env` to an absolute path to a private JSON file. Example metadata (replace key paths and model IDs):

```json
{
  "connections": [
    {"id":"primary-gemini","provider":"gemini","model":"your-gemini-model","keyFile":"/private/gemini.key","quotaGroup":"google-project-a"},
    {"id":"backup-claude","provider":"claude","model":"your-claude-model","keyFile":"/private/claude.key","quotaGroup":"anthropic-account-a"},
    {"id":"backup-grok","provider":"grok","model":"your-grok-model","keyFile":"/private/grok.key","quotaGroup":"xai-team-a"},
    {"id":"another-service","provider":"compatible","model":"your-model","keyFile":"/private/other.key","quotaGroup":"other-account-a","baseUrl":"https://provider.example/v1"}
  ]
}
```

Alternatively, `keyEnv` can name an existing server environment variable. Never add real keys or a private pool file to Git, browser code, chat, or public hosting settings.

## Selection and limits

For each explanation batch the router tries connections in order, skipping those in cooldown. A valid response is used immediately. A rejected key, temporary rate limit, exhausted credits, outage, timeout, refusal, unsupported model/format, or failed evidence validation can move the request to the next available connection. Both saved report explanations and individual finding explanations use this routing.

Temporary rate limits honor `Retry-After` (seconds or HTTP date). Without that header they cool down for one minute. Exhausted quota/credits and rejected credentials cool down for at least an hour. Other failed connections cool down for 30 seconds or more. Cooldowns persist in SQLite across restarts. Bad credentials affect only that key/model; account-level quota exhaustion affects its quota group; temporary rate limits affect that group/model. Rotating an invalid key changes its credential identity. Funding an exhausted account can require waiting for its existing cooldown to expire.

Keys in the same provider project/account must use the same quota group; another key does not create additional capacity for a shared quota. Provider defaults group all connections for that provider conservatively. Use separate groups only for independently provisioned accounts/quotas. Obtain approved capacity or credits when needed; cycling keys cannot restore exhausted shared capacity.

Each provider attempt has a ten-second timeout within the existing overall 45-second deadline. A report has an attempt budget based on its batch count, with five spare failover attempts and a minimum budget of ten. If all eligible connections are unavailable, the complete English template is saved. There is no endless retry loop and no guarantee that an external AI provider will always answer. Report creation and evidence remain available.

Successful narrative versions record actual provider, model and connection per batch, together with sanitised failover/cooldown reasons. API keys and provider error bodies are never saved in reports. Provider-independent validation preserves references, verdicts and expected/observed facts. Text remains advisory.

Custom HTTPS endpoints are operator-only configuration. Credential-bearing URLs, redirects and private-network targets are rejected. Use trusted services only: configured providers receive redacted audit finding text, and each service has its own data-handling terms. OpenAI-specific `store:false` is applied only to the OpenAI adapter; other adapters use their own APIs.

Official format references: [Gemini](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [Claude](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Grok](https://docs.x.ai/developers/model-capabilities/text/structured-outputs), [OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs).
