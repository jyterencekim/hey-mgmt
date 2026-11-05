# Talking to Fisher

Fisher is the team's AI operations agent, running on the Mac Mini via Hermes. It lives in Slack and has full access to the `hey-mgmt` repo, knowledge base, and activity pipeline.

## Where Fisher listens

| Surface | How to reach Fisher |
|---------|-------------------|
| `#hey-mgmt-daily-weekly-sync` | @mention in channel |
| `#hey-mgmt-internal` | @mention in channel |
| `#hey-mgmt_dev` | @mention in channel |
| `#hey-mgmt_general` | @mention in channel |
| DMs | Message Fisher directly |

## Starting a conversation

**In a channel:** @mention Fisher with your question or request. Fisher replies in a thread.

**In a thread:** Once Fisher is in a thread, just reply normally — no @mention needed. Fisher will keep responding to all thread messages.

**In DMs:** Message Fisher directly. Each person gets their own isolated session.

## Visual feedback

Fisher reacts to your messages with:
- :eyes: — message received, reading it
- :hourglass_flowing_sand: — thinking/processing

## What Fisher can do

### Ask questions about the repo

```
@Fisher what tasks are active this iteration?
@Fisher summarize the Morpho custom strategy work
@Fisher what's in the Unifi due diligence report?
```

### Search the knowledge base

Fisher indexes Slack discussions, Confluence pages, Drive documents, and GitHub activity.

```
@Fisher what did the team discuss about vault rebalancing last week?
@Fisher any recent Confluence updates on the QA test matrix?
@Fisher search knowledge for "keeper bot"
```

### Check status

```
@Fisher what's the pipeline status?
@Fisher show active cron jobs
@Fisher run ./hey validate
```

In DMs, you can also use shorthand: `status`, `health`, `diagnose`.

### Manage activity updates

Fisher's digest and update notifications SHOULD expose buttons instead of requiring full-id text replies:

- `Reject` — reject a bad auto-generated update before it sticks
- `Revoke` — demote a promoted observation back to observation tier
- `Delete` — remove a low-value observation from the digest staging area

Manual CLI commands still exist as operator fallback, but buttons are the primary UX.

### Run CLI commands

Fisher can execute any `./hey` command in the repo workspace:

```
@Fisher run ./hey search "strategy config" --include-knowledge
@Fisher run ./hey db query "SELECT title FROM knowledge WHERE source='slack' ORDER BY date DESC LIMIT 5"
```

### Ask for repo help

```
@Fisher how does the activity pipeline work?
@Fisher what's in workspace/fisher/config/external-activity.yml?
@Fisher show me the last 5 commits
```

## What Fisher won't do without confirmation

In Slack DMs, authenticated Superearn team members are pre-approved, so Fisher can execute ordinary repo writes without an extra confirmation turn.

In allowlisted channels, or in DMs from senders Fisher cannot match to a trusted team member, writes to `content/` or `workspace/` still require explicit confirmation. Fisher will explain the proposed change and ask you to confirm before writing.

## Channel-specific behavior

Fisher adapts its tone per channel:

- #hey-mgmt-daily-weekly-sync — concise, action-oriented (standups, planning, reviews)
- #hey-mgmt-internal — bilingual Korean/English, strategy and research focus
- #hey-mgmt_dev — precise, technical, includes file paths and commands
- #hey-mgmt_general — flexible tone, matches the conversation

## Digests

Fisher posts twice-daily digests to `#hey-mgmt-internal` (12:00, 18:00 KST) summarizing:
- Promoted observations (matched to existing artifacts)
- New observations worth reviewing

Each digest item SHOULD include action buttons for `Reject`, `Revoke`, or `Delete`, not raw command hints.

## Tips

- **Be specific.** "What's the status of the Morpho task?" works better than "what's happening?"
- **Use threads.** Start with an @mention, then continue naturally in the thread.
- **Korean works.** Fisher understands and responds in Korean when you write in Korean.
- **Commands in DMs.** For quick status checks, DM Fisher directly — no channel noise.
- **Search is powerful.** Fisher can search across Slack history, Confluence, Drive, and GitHub via the knowledge base.

