# StatPearls Integration (Option A - Proxy/Context Injection)

The Ahava platform uses StatPearls peer-reviewed medical content to enhance AI triage. Before the AI (Gemini/Claude) analyzes symptoms, medical context from StatPearls is fetched and injected into the prompt.

## How It Works

1. Patient submits symptoms (e.g. "chest pain and shortness of breath")
2. Backend extracts search keywords (e.g. "chest pain shortness breath")
3. StatPearls service fetches relevant medical content from NCBI StatPearls
4. Context is injected into the triage prompt as reference material
5. AI uses this context to improve triage accuracy (possible conditions, reasoning)

## Configuration

### Built-in Mode (Default)

When `STATPEARLS_SERVICE_URL` is **not set**, the backend fetches directly from NCBI StatPearls (https://www.ncbi.nlm.nih.gov/books/NBK430685/). No extra deployment required.

- **Pros**: Works out of the box, no extra services
- **Cons**: Adds ~2–5 seconds to triage (NCBI fetch); subject to NCBI rate limits

### StatPearls HTTP Service (Optional)

When `STATPEARLS_SERVICE_URL` is set, the backend calls:

```
POST {STATPEARLS_SERVICE_URL}/disease-info
Content-Type: application/json
Body: { "query": "chest pain shortness breath" }
```

Expected response:

```json
{
  "content": "## Introduction\n...\n## Diagnosis\n...",
  "text": "alternative field name"
}
```

Use this when you deploy the StatPearls MCP (or equivalent) behind an HTTP wrapper.

## Deploying StatPearls MCP as HTTP Service

The [StatPearls MCP Server](https://github.com/jpoles1/statpearls-mcp) (jpoles1/statpearls-mcp) uses stdio transport. To use it with Ahava:

1. **Option A: HTTP wrapper** – Build a small HTTP service that:
   - Spawns StatPearls MCP as subprocess (requires Bun)
   - Accepts POST `/disease-info` with `{ query }`
   - Uses MCP client to call `statpearls_disease_info` tool
   - Returns the result as `{ content: "..." }`

2. **Option B: Use built-in NCBI fetch** – No MCP deployment needed; the backend fetches from NCBI directly.

## Docker / Deployment

The backend includes StatPearls support by default. No extra containers are required for the built-in NCBI fetch.

If you run a StatPearls HTTP service, deploy it separately (e.g. Cloud Run, Railway) and set:

```
STATPEARLS_SERVICE_URL=https://your-statpearls-service.example.com
```

## Disabling StatPearls

If StatPearls fetch fails (timeout, network error), triage proceeds without medical context. To fully disable StatPearls, you would need to add a `STATPEARLS_DISABLED=true` env var and guard the `getMedicalContext` call; this can be added if requested.
