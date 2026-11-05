# Hermes Activity Pipeline Architecture

## Current Production Topology

```mermaid
graph TB
    subgraph Slack["Slack"]
        DM["DM + allowlisted mentions"]
        BTN["Approval buttons"]
    end

    subgraph OC["Hermes"]
        GW["Gateway"]
        AG["Agent: hey-mgmt"]
        CRON["Cron jobs"]
    end

    subgraph CLI["hey CLI"]
        POLL["activity poll"]
        PREP["prepare-candidates"]
        FIN["finalize-candidates"]
        NOTIFY["activity notify"]
        ACT["activity approve/reject"]
    end

    subgraph Repo["hey-mgmt repo"]
        CONTENT["content/ + workspace/"]
        RUNTIME[".runtime/ + .hey/"]
    end

    DM --> GW --> AG
    CRON --> AG
    AG --> POLL --> RUNTIME
    AG --> PREP --> RUNTIME
    AG --> FIN --> RUNTIME
    AG --> NOTIFY --> Slack
    AG --> ACT --> CONTENT
    BTN --> AG
```

## Deprecated Path

```mermaid
graph LR
    LEGACY["run.mjs + app.mjs<br/>full Slack bot + setInterval loops"] --> FALLBACK["Break-glass only"]
```

`run.mjs` is intentionally gated by `SUPEREARN_ENABLE_LEGACY_ACTIVITY_RUNTIME=1`.

## Key Differences from the Legacy Runtime

| Aspect | Legacy | Current |
| --- | --- | --- |
| Conversational Slack | custom Bolt bot | Hermes native Slack |
| Scheduler | `setInterval` loops | Hermes cron |
| Approval flow | handled inside full runtime | native Slack text commands |
| Repo reasoning | legacy `SlackAgentService` | repo-scoped Hermes agent |
| Normal background workload | full runtime + sidecars | Hermes gateway + cron |
| Fallback behavior | same as default | explicitly gated break-glass path |
