# Remote Access — Mac Mini Hermes Gateway

Team members can access the shared Mac Mini's Hermes gateway remotely via SSH tunnels.
This gives you full access to the `hey-mgmt` agent, cron pipelines, and all CLI tools.

## Architecture

```
Your machine                          Mac Mini (10.167.225.62)
┌──────────────────┐     SSH tunnel   ┌──────────────────────────┐
│ Hermes CLI     │ ──────────────── │ Hermes Gateway :18789  │
│ (remote mode)    │   port 18789     │  ├── agent: hey-mgmt│
│                  │                  │  ├── cron jobs (5)        │
└──────────────────┘                  │  ├── Slack channel bind   │
                                      │  └── knowledge base       │
                                      └──────────────────────────┘
```

## Quick Start (team member)

### 1. Get SSH access

Generate a key if you don't have one:

```bash
ssh-keygen -t ed25519 -C "your-name@hey-mgmt"
```

Share your public key with the team lead:

```bash
cat ~/.ssh/id_ed25519.pub
```

The team lead adds it on the Mac Mini:

```bash
bash scripts/manage-team-ssh.sh add <your-name> "<your-public-key>"
```

### 2. Install Hermes CLI

Follow [docs.hermes.ai/install](https://docs.hermes.ai/install).

### 3. Run the setup script

```bash
bash scripts/remote-access-setup.sh
```

This will:
- Verify your SSH connection
- Configure Hermes in remote mode
- Create a tunnel helper script at `~/.hermes/tunnel-mac-mini.sh`

### 4. Connect

Open two terminals:

**Terminal 1 — tunnel (keep open):**
```bash
~/.hermes/tunnel-mac-mini.sh
```

**Terminal 2 — use Hermes:**
```bash
hermes status    # verify connection
hermes chat      # start a session
```

## Admin Setup (on Mac Mini)

### Enable SSH (one-time)

1. Open **System Settings** > **General** > **Sharing**
2. Toggle **Remote Login** to ON
3. Set "Allow access for" to **All users**
4. Verify: `ssh localhost echo "ok"` should print `ok`

### Manage SSH keys

```bash
# List who has access
bash scripts/manage-team-ssh.sh list

# Add a member
bash scripts/manage-team-ssh.sh add alice "ssh-ed25519 AAAA... alice@hey-mgmt"

# Remove a member
bash scripts/manage-team-ssh.sh remove alice
```

### Gateway auth token

The gateway token is in `~/.hermes/hermes.json` under `gateway.auth.token`.
Share this token with team members during setup — they'll need it to authenticate.

To rotate the token:

```bash
hermes doctor --generate-gateway-token
# Then update the config and notify team members
```

### Monitor active sessions

```bash
hermes status         # overview
hermes status --all   # detailed session list
hermes logs --follow  # live gateway logs
```

### Security audit

```bash
hermes security audit --deep
```

## Environment Variables

Team members can override defaults via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MAC_MINI_HOST` | `10.167.225.62` | Mac Mini IP address |
| `MAC_MINI_USER` | `hey-mgmt` | SSH username |
| `MAC_MINI_SSH_PORT` | `22` | SSH port |
| `GATEWAY_PORT` | `18789` | Hermes gateway port |

## Troubleshooting

### "Connection refused" on SSH

Remote Login may be off. On the Mac Mini:
- System Settings > General > Sharing > Remote Login: ON

### "Connection refused" on port 18789

The Hermes gateway may not be running:

```bash
# On the Mac Mini
hermes status
# If gateway is down:
hermes gateway start
```

### "Unauthorized" from Hermes

The auth token doesn't match. Ask the team lead for the current token and update:

```bash
# In your ~/.hermes/hermes.json
# Update gateway.remote.token
```

### Tunnel disconnects frequently

The tunnel script uses `ServerAliveInterval=60`. If your network is unreliable,
consider using `autossh` for automatic reconnection:

```bash
brew install autossh
autossh -M 0 -N -L 18789:127.0.0.1:18789 hey-mgmt@10.167.225.62
```

## Future: Tailscale Migration

When the team is ready, we'll migrate from SSH tunnels to Tailscale Serve
for a more seamless experience (no manual tunnel management). The Hermes
gateway has native Tailscale support — see [docs.hermes.ai/gateway/remote](https://docs.hermes.ai/gateway/remote).
