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
  Pi lifecycle events (`session_start`, `agent_end`, `session_shutdown`) and shells
  out to the `kimetsu` binary to warm, load, and persist brain context around each
  session. Each call is capped by a timeout, so a slow or hung binary never stalls
  Pi. If the binary is not on `PATH`, every hook silently no-ops and Pi is
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

## Prerequisite

The `kimetsu` binary must be on `PATH`. Install it with:

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
| `session_start` | `kimetsu brain warm` then `kimetsu brain context-hook` |
| `agent_end` | `kimetsu brain stop-hook` |
| `session_shutdown` | `kimetsu brain session-end-hook` |

## Development

```sh
npm install
npm test
npm run typecheck
```

## Links

- **Website & docs:** [kimetsu.dev](https://kimetsu.dev)
- **Main project:** [github.com/RodCor/kimetsu](https://github.com/RodCor/kimetsu)

## License

MIT OR Apache-2.0
