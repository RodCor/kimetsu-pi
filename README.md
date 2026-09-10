<div align="center">

<img src="https://raw.githubusercontent.com/RodCor/kimetsu/main/docs/assets/kimetsu-logo.png" alt="Kimetsu logo" width="180" />

# kimetsu-pi

### Memory for your Pi agent that gets sharper every run.

</div>

**kimetsu-pi** brings [Kimetsu](https://kimetsu.dev) — a local-first memory brain
for coding agents — to the [Pi](https://pi.dev) coding agent.

Coding agents are brilliant and forgetful: every session starts from zero. Kimetsu
is a sidecar brain that captures the lessons your agent earns, learns which ones
actually help, and hands them back before the next task. The memory pipeline makes
**no LLM calls** — storage and retrieval are 100% local, free, and offline-capable.

Learn more at **[kimetsu.dev](https://kimetsu.dev)**.

## What it is

Pi has no MCP layer, so this package brings Kimetsu to Pi through Pi's own
extension points:

- **Extension** (`extensions/kimetsu.ts`) — a TypeScript Pi extension that hooks
  Pi lifecycle events (`session_start`, `before_agent_start`, `agent_end`,
  `session_shutdown`) and shells
  out to the `kimetsu` binary to warm, load, and persist brain context around each
  session. Interactive hooks have a 10-second timeout; session saving has a
  separate five-minute limit for model-based distillation. If the binary is not
  on `PATH`, every hook silently no-ops and Pi is
  completely unaffected.
- **Skill** (`skills/kimetsu-brain/SKILL.md`) — a Pi skill that teaches the agent
  when and how to consult and record memories during a task.

## Why Kimetsu

- **Remembers what matters** — conventions, failure patterns, the exact command
  that regenerates your schema. Captured once, retrieved by meaning.
- **Speaks first** — proactive session-start digests, episodic resumes, and
  pre-task context, so the agent's first turn already knows your repo.
- **Learns what helps** — cited memories get promoted; stale advice decays and is
  pruned.
- **Model-free retrieval** — FTS5 + local embeddings + local reranking. Zero API
  cost, works offline.
- **Stays yours** — one SQLite file per project. No cloud, no vector DB, no
  telemetry. Back it up with `cp`.

## Benchmarks

| | |
|---:|---|
| **89.4%** | LoCoMo, the long-conversation memory benchmark |
| **83.0%** | LongMemEval, the public long-term-memory benchmark |
| **73.3%** | BEAM 100K memory benchmark |
| **13×** | cheaper per solved task ($0.19 vs $2.47 on a Terminal-Bench slice) |
| **~1M** | memories in ~3 GB RAM with sub-2s retrieval, one SQLite file |

## Prerequisites

Install current Pi (Node.js 22.19 or newer):

```sh
npm install -g @earendil-works/pi-coding-agent
```

The `kimetsu` v2.7.0 or newer binary must be on `PATH`. Install it with:

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

## Development

```sh
npm ci
npm test
npm run typecheck
```

To run the optional CLI integration test, set `KIMETSU_TEST_BINARY` to the
absolute path of a Kimetsu 2.8.0+ executable named `kimetsu` (`kimetsu.exe` on
Windows), then run `npm run test:integration`. This command fails if the binary
is missing. It creates an isolated temporary brain, uses
lexical retrieval without model calls, and verifies correction, context
filtering, citation, and session persistence.

The fixture anchors a new Git repository and gives subprocesses temporary homes,
caches, and user-brain paths. It removes inherited Git/Kimetsu overrides and
credentials before initialization. Never run integration commands against your
normal project or home brain.

CI requires the real CLI test on Linux, macOS, and Windows using checksum-pinned
Kimetsu 2.8.0 binaries and the minimum supported Node version. The `required checks`
gate also requires typechecking, tests, the dependency audit, and package dry-run.
Release tags must match the package version and point to a commit on `main` with
successful CI. Wait for that commit's CI before tagging; a release started too
early must be rerun after CI passes.

## Links

- **Website & docs:** [kimetsu.dev](https://kimetsu.dev)
- **Main project:** [github.com/RodCor/kimetsu](https://github.com/RodCor/kimetsu)

## License

MIT OR Apache-2.0
