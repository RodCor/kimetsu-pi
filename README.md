<div align="center">

<img src="https://raw.githubusercontent.com/RodCor/kimetsu/main/docs/assets/kimetsu-logo.png" alt="Kimetsu logo" width="180" />

# kimetsu-pi

### Memory for your Pi agent that gets sharper every run.

</div>

**kimetsu-pi** brings [Kimetsu](https://kimetsu.dev) — a local-first memory brain
for coding agents — to the [Pi](https://pi.dev) coding agent.

Kimetsu carries useful lessons between sessions and retrieves relevant project
knowledge before a task. Storage and retrieval run locally without LLM API calls.
Automatic lesson extraction can use a configured model; its cost and connectivity
depend on that configuration.

Learn more at **[kimetsu.dev](https://kimetsu.dev)**.

## What it is

This package connects Kimetsu through Pi's native extension and skill interfaces:

- **Extension** (`extensions/kimetsu.ts`) — a TypeScript Pi extension that hooks
  Pi lifecycle events and invokes the `kimetsu` binary to warm, load, and persist
  brain context around each session. Interactive hooks have a 10-second timeout;
  session saving has a
  separate five-minute limit for model-based distillation. If the binary is not
  on `PATH`, every hook silently no-ops and Pi is
  completely unaffected.
- **Skill** (`skills/kimetsu-brain/SKILL.md`) — a Pi skill that teaches the agent
  to reuse injected context, correct outdated memories, cite memories that
  actually helped during a task, and use the peer memory network only when
  asked.

## What's new in 0.2.0

- Peer network tools for Kimetsu 2.11.0: `kimetsu_network_status` and
  `kimetsu_network_request`, plus `/kimetsu-network-status`,
  `/kimetsu-network-request`, and `/kimetsu-network-share`.
- `kimetsu --version` is checked before any network command. Older binaries,
  and builds compiled without `network`, explain the gap and leave every
  socket closed.
- Sharing stays a terminal command. The extension never starts it. Request
  listens only while that call runs, with the relay off, discovery off unless
  asked, and router port mapping off unless asked.

## Previously in 0.1.5

- Pi 1.2.0 compatibility: custom-triggered turns expire old memory without
  treating background notifications as user prompts.
- Integration tests exercise Pi's real loader, event runner, model-message
  conversion, and session saving with the Kimetsu 2.8.0 CLI in isolated fixtures.
- Refreshed development dependencies and removed the source-map-js advisory.

## Previously in 0.1.4

- Fresh memory per task: older raw injections are excluded from model requests
  and new summaries, including after corrections, queued user messages, and
  branch changes.
- Session saving gets up to five minutes, while interactive hooks retain their
  10-second limits.
- Updated guidance for memory reuse, corrections, and usefulness feedback.
- Verified with Pi 0.85.1 and Kimetsu 2.8.0 on Linux, macOS, and Windows; updated
  dependencies, isolated integration tests, and protected CI and release gates.

## Why Kimetsu

- **Remembers project knowledge** — conventions, failure patterns, and useful
  commands stay available across sessions.
- **Speaks first** — proactive session-start digests, episodic resumes, and
  pre-task context, so the agent's first turn already knows your repo.
- **Learns what helps** — citations provide usefulness feedback; maintenance
  identifies memories that may need pruning.
- **Local retrieval** — lexical search in the default lean build, with optional
  local embeddings and reranking. No LLM API calls for retrieval.
- **Stays yours** — a local SQLite brain per project, with optional user-wide
  memory. No hosted vector database is required.

For Kimetsu's benchmark results, datasets, and evaluation limits, see the
[core project's benchmark notes](https://github.com/RodCor/kimetsu#benchmarks-vs-other-memory-systems).
Those evaluate the memory system; this package's CI verifies its Pi integration.

## Prerequisites

Install current Pi (Node.js 22.19 or newer):

```sh
npm install -g @earendil-works/pi-coding-agent
```

The `kimetsu` binary must be on `PATH`. Memory hooks work on Kimetsu 2.7.0 and
newer. This package targets Kimetsu 2.11.0 for the peer network; the extension
checks `kimetsu --version` and skips network commands on anything older.
Install Kimetsu with:

```sh
npm install -g kimetsu-ai
```

or via cargo or a prebuilt archive — see the
**[install guide](https://kimetsu.dev/docs/)** for all options. If the binary is
absent, the extension silently no-ops and Pi is unaffected.

## Install

```sh
pi install npm:kimetsu-pi
```

From the Git project whose memory you want to use, initialize Kimetsu if that
project does not already have a brain:

```sh
cd /path/to/your/project
kimetsu init
kimetsu brain status
```

Start Pi in that project, or run `/reload` in an existing Pi session to load the
extension and skill. Confirm installation with `pi list`.

## Upgrade

For an installation that follows the latest npm version:

```sh
pi update npm:kimetsu-pi
```

For a pinned installation, select this version explicitly:

```sh
pi install npm:kimetsu-pi@0.2.0
```

Then restart Pi or run `/reload`. Pi package updates and Kimetsu CLI updates are
separate; use `npm install -g kimetsu-ai@latest` if the CLI also needs updating.

## What it does on each event

| Pi lifecycle event | Kimetsu command run |
| --- | --- |
| `session_start` | `kimetsu brain warm` |
| `before_agent_start` | `kimetsu brain context-hook --warm-on-first-prompt` |
| `context` | Filters earlier Kimetsu injections out of each model request |
| `session_before_compact`, `session_before_tree` | Excludes Kimetsu injections from new summaries |
| `session_tree` | Expires the previous branch's active injection |
| `agent_end` | `kimetsu brain stop-hook` |
| `session_shutdown` | `kimetsu brain session-end-hook` |

The extension uses Pi's `SessionManager` identity, so `/new`, `/resume`, and
`/fork` keep separate Kimetsu warm-start and deduplication state. It also passes
Pi's persisted JSONL transcript to the stop and session-end hooks, enabling
Kimetsu's configured distiller and automatic work-episode capture.

Only the current task's Kimetsu injection is sent to the model. Older injections
remain in the saved transcript but are filtered from subsequent model requests,
including when retrieval returns no context. Ordinary conversation and other
extensions' messages are preserved. Queued user messages expire the previous
injection; tool continuations keep it. New compaction and branch summaries omit
raw Kimetsu injections. This does not rewrite earlier assistant answers or
existing summaries.

Session saving can make two model calls, so it may take longer than retrieval.
Pi awaits it when closing or switching a session, for up to five minutes; it
normally finishes sooner. The longer deadline applies only to
`session-end-hook`. Prompt retrieval, warm-up, and `stop-hook` retain their
10-second limits. Saving remains best-effort and needs a clean shutdown.

The bundled skill teaches the agent to reuse relevant injected context, fetch
missing evidence, correct existing memories, and cite only memories that
actually helped. Run `kimetsu brain status` from the project directory to inspect
the brain. Automatic model-based distillation requires configuration.

## Peer network

Kimetsu 2.11.0 adds a peer memory network to release and npm builds. Pi has no
MCP, so this package shells out to the local `kimetsu` binary. Nothing listens
until `share` or `request` runs. The relay stays off. Packs are signed and
scrubbed, and only the repo mount is exchanged. An unknown signer is
quarantined and stays out of retrieval.

Create a network on one machine, then join it on another. These commands write
keys and do not open a socket:

```sh
kimetsu network invite
kimetsu network join <code>
kimetsu network status
kimetsu network leave
```

`invite` prints a join code. The code does not include the admin key. `status`
reports whether this machine has joined and always leaves listening off.

To send memories, the user runs this in a terminal from the project directory
and leaves it running until the other machine has fetched the pack:

```sh
kimetsu network share
```

That process listens until Ctrl-C. It prints a `peer:` line
(`endpoint-id@host:port`). The extension does not run `share` for you.
`/kimetsu-network-share` prints the same instructions and does not open a
socket. Add `--map-ports` only when you want UPnP or NAT-PMP to open a UDP
port. That stays off by default.

On the machine that should receive the pack, either ask Pi to call
`kimetsu_network_request` or run:

```sh
/kimetsu-network-request <endpoint-id>@host:port
```

The same fetch from a shell, with discovery and port mapping left off:

```sh
kimetsu network request --json --no-mdns --peer <endpoint-id>@host:port
```

`kimetsu_network_status` is the read-only check. Both tools no-op, with an
explanation, when `kimetsu --version` is older than 2.11.0 or when
`kimetsu network status --json` reports `"compiled": false`. A request is
killed if it runs longer than 60 seconds or if Pi cancels the call, so the
socket does not outlive the command.

## Development

```sh
npm ci
npm test
npm run typecheck
```

To run the optional CLI integration test, set `KIMETSU_TEST_BINARY` to the
absolute path of a Kimetsu executable named `kimetsu` (`kimetsu.exe` on
Windows), then run `npm run test:integration`. This command fails if the binary
is missing. It creates an isolated temporary brain, uses
lexical retrieval without model calls, and verifies correction, context
filtering, citation, and session persistence. It also runs the network status
and request tools. A binary older than 2.11.0 must degrade without listening.
A 2.11.0 or newer binary must report `listening: false` from
`kimetsu network status --json`.

The fixture anchors a new Git repository and gives subprocesses temporary homes,
caches, and user-brain paths. It removes inherited Git/Kimetsu overrides and
credentials before initialization. Never run integration commands against your
normal project or home brain.

CI requires the real CLI test on Linux, macOS, and Windows using checksum-pinned
Kimetsu 2.11.0 binaries and the minimum supported Node version. Those binaries
include the `network` command, so CI runs the peer-network tools against a
capable CLI. The `required checks`
gate also requires typechecking, tests, the dependency audit, and package dry-run.
Release tags must match the package version and point to a commit on `main` with
successful CI. Wait for that commit's CI before tagging; a release started too
early must be rerun after CI passes.

## Links

- **Website & docs:** [kimetsu.dev](https://kimetsu.dev)
- **Main project:** [github.com/RodCor/kimetsu](https://github.com/RodCor/kimetsu)

## License

MIT OR Apache-2.0
