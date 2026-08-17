# ECC CLI Reference

The `ecc` executable is the selective-install and operator CLI for ECC. The
canonical dispatcher is [`scripts/ecc.js`](../scripts/ecc.js). The published
package exposes `ecc` and `ecc-universal` through that dispatcher and retains
`ecc-install` as a legacy install entrypoint; see [`package.json`](../package.json)
for the binary map.

This reference covers the dispatcher and its subcommands. The package also
publishes `ecc-control-pane`, `ecc-memory-mcp`, and `ecc-plan-canvas` as
separate binaries; they are not `ecc` subcommands and expose their own
`--help` output.

## Invocation

```text
ecc <command> [args...]
ecc [install args...]
ecc --dry-run <command> [args...]
ecc help <command>
ecc --help
```

With no arguments, `ecc` prints help. A leading install flag or a recognized
legacy language name is routed to `install`; other unrecognized command names
fail with an error. `ecc-install` invokes the installer directly for existing
install flows.

`--dry-run` sets `ECC_DRY_RUN=1` before dispatch. The command must implement
that flag to produce a preview. Install, setup, repair, auto-update, and
uninstall have dry-run behavior. The `ito` bridge rejects dry-run because its
operations are delegated to a separately installed authenticated client.

`ecc help <command>` runs the selected command with `--help`. Command-specific
help is the authoritative list of options for that command.

## Command groups

### Setup and installation

| Command | Function |
|---|---|
| `setup` | Install or update the Claude plugin with scope and hook choices. |
| `welcome` | Display ECC welcome artwork and community links. |
| `install` | Install ECC content, including the guided multi-harness wizard. |
| `plan` | Resolve and display a selective-install plan. |
| `install-plan` | Compatibility alias for `plan`. |
| `catalog` | List install profiles, components, or component details. |
| `consult` | Recommend components and profiles for a natural-language query. |

### Lifecycle and repair

| Command | Function |
|---|---|
| `list-installed` | Inspect install-state records for the current context. |
| `doctor` | Diagnose missing or drifted ECC-managed files. |
| `repair` | Restore missing or drifted ECC-managed files. |
| `auto-update` | Pull ECC changes and reinstall the current managed targets. |
| `uninstall` | Remove files recorded in install-state. |
| `feedback` | Show routes for problems, feedback, and feature ideas. |

Lifecycle commands operate on ECC-managed state. They do not claim unrelated
files in a harness directory.

### Memory, sessions, and work items

| Command | Function |
|---|---|
| `memory` | Create, search, read, and validate the local Memory Vault. |
| `sessions` | List or inspect sessions in the SQLite state store. |
| `session-inspect` | Emit canonical session snapshots from supported history targets. |
| `work-items` | Track linked Linear, GitHub, handoff, and manual work items. |
| `status` | Query the SQLite state-store readiness summary. |
| `loop-status` | Inspect transcripts for stale loop wakeups and pending tool results. |

### Diagnostics and operations

| Command | Function |
|---|---|
| `control-pane` | Run the local ECC2 operator control pane. |
| `platform-audit` | Audit GitHub queues, discussions, roadmap, release, and security evidence. |
| `security-ioc-scan` | Scan dependency and AI-tool persistence surfaces for supply-chain IOCs. |

### Compute bridge

| Command | Function |
|---|---|
| `ito` | Invoke the separately installed canonical Itô compute CLI. |

## Command options

### `welcome`

```text
ecc welcome
```

Prints the ECC welcome artwork and community links. It accepts no command-specific
options.

### `setup`

```text
ecc setup [options]
```

| Option | Values | Effect |
|---|---|---|
| `--mode` | `claude-plugin` | Select the Claude plugin setup mode. |
| `--scope` | `user`, `project`, `local` | Select the plugin installation scope. |
| `--hooks` | `off`, `minimal`, `standard`, `strict` | Select the managed hook profile. |
| `--move-scope` | — | Move an existing plugin installation to the destination passed with `--scope`. |
| `--yes`, `-y` | — | Accept the final setup confirmation. |
| `--dry-run` | — | Inspect the setup plan without changing files. |
| `--json` | — | Emit machine-readable setup results. |

### `install`

```text
ecc install [options]
./install.sh [options]
```

The installer accepts a legacy language-selection mode and selective-install
options. Targets include `claude`, `claude-project`, `cursor`, `antigravity`,
`codex`, `gemini`, `opencode`, `codebuddy`, `joycode`, `qwen`, `zed`, `hermes`,
`kimi`, and `openclaw`.

| Option family | Examples | Effect |
|---|---|---|
| Profiles | `--profile minimal`, `--profile core`, `--profile full` | Select a named install profile. |
| Targets | `--target claude`, `--target cursor` | Select the harness destination. |
| Components | `--modules hooks-runtime`, `--skills tdd-workflow,security-review` | Select modules or skills. |
| Guided setup | `--guided`, `--harness claude --harness codex` | Run the multi-harness wizard. |
| Locale | `--locale <code>` | Install translated docs for Claude targets. |
| Planning | `--dry-run`, `--json` | Preview or serialize the install result. |
| Configuration | `--config <path>` | Use an explicit install configuration. |

`install.sh` is a shell wrapper around `scripts/install-apply.js`. When run
from a clone without `node_modules`, it installs Node dependencies with
`npm install --no-audit --no-fund` before delegating to the Node installer. That
bootstrap requires Node/npm and package-registry access. The wrapper does not
replace the installer or alter its target selection.

### `plan` and `install-plan`

```text
ecc plan [options]
ecc install-plan [options]
```

`install-plan` is the compatibility name for the same selective-install plan
surface. Common options are:

- `--family <family>`
- `--profile <profile>`
- `--modules <module,...>`
- repeatable `--with <component>` and `--without <component>`
- `--skills <skill,...>` or the `--skill <skill>` alias
- `--config <path>`
- `--target <target>`
- `--json`

The plan command inspects the resolved manifest; it does not apply the file
operations described by the plan.

### `catalog`

```text
ecc catalog profiles
ecc catalog components [--family <family>]
ecc catalog show <component-id>
```

Family names accept the aliases `baseline`/`baselines`, `language`/`languages`/
`lang`, `framework`/`frameworks`, `capability`/`capabilities`, `agent`/`agents`,
and `skill`/`skills`. `--json` selects machine-readable output and `--target`
filters the catalog for a harness target.

### `consult`

```text
ecc consult "security reviews" [--target claude] [--limit <n>] [--json]
```

`--target` defaults to `claude`; `--limit` defaults to `5`. The result contains
matching components, related profiles, and preview or install commands.
`consult` recommends; it does not apply an installation.

### Lifecycle commands

```text
ecc list-installed [--target <target>] [--json]
ecc doctor [--target <target>] [--json]
ecc repair [--target <target>] [--dry-run] [--json]
ecc auto-update [--target <target>] [--repo-root <path>] [--dry-run] [--json]
ecc uninstall [--target <target>] [--legacy-codex-sync] [--dry-run] [--json]
ecc feedback [--json]
```

- `list-installed` reports recorded install-state entries.
- `doctor` reports missing or drifted files and exits nonzero when issues are
  found.
- `repair` previews or applies repairs for managed files.
- `auto-update` rebuilds install arguments from recorded state before applying
  an update. It validates official package names before running an install.
- `uninstall` supports the legacy Codex sync layer through
  `--legacy-codex-sync`; that flag cannot be combined with `--target`.
- `feedback` displays public problem, quick-feedback, and feature routes. It
  does not read project files or upload diagnostics.

### `memory`

```text
ecc memory <init|save|handoff|search|read|doctor> [options]
```

| Subcommand | Function |
|---|---|
| `init` | Create project, team, or user vault directories. |
| `save` | Create an unreviewed memory entry. |
| `handoff` | Create a targeted cross-harness handoff. |
| `search` | Search bounded vault scopes by text and metadata. |
| `read` | Read one memory by stable ID and show derived backlinks. |
| `doctor` | Report malformed files, duplicate IDs, broken links, and skipped symlinks. |

`save` and `handoff` accept bodies only through `--stdin` or `--body-file`.
They do not accept memory bodies as command-line values. `--kind`, `--link`,
`--scope`, `--tag`, and `--target-harness` are repeatable metadata options
where supported. Memory entries are unreviewed context, not executable
instructions or policy.

### `sessions` and `session-inspect`

```text
ecc sessions [<session-id>] [--db <path>] [--json] [--limit <n>]
ecc session-inspect <target> [options]
```

`sessions` lists or inspects state-store sessions. `session-inspect` accepts
canonical targets such as `claude:latest`, direct session files, dmux plans,
and skill-analysis targets. Its options are:

- `--adapter <id>` and `--target-type <type>` select the history adapter.
- `--write <output.json>` writes the snapshot to a file.
- `--list-adapters` lists available adapters without inspecting a target.

Use command-specific help for target grammar and write-mode constraints.

### `work-items`

```text
ecc work-items <list|show|upsert|close|claim|sync-github> [options]
```

The command supports linked Linear, GitHub, handoff, and manual records. Common
options include `--title`, `--source`, `--source-id`, `--status`, `--owner`,
`--as agent|human`, `--repo-root`, `--repo`/`--github-repo`,
`--session`/`--session-id`, `--metadata-json`, `--db`, and `--json`.

### `status` and `loop-status`

```text
ecc status [--json|--markdown] [--write <path>] [--limit <n>] [--exit-code]
ecc loop-status [options]
```

`status` emits a state-store readiness summary. `--json` and `--markdown` are
mutually exclusive; `--write` writes Markdown output to a file. With
`--exit-code`, `status` returns `2` when readiness needs attention.

`loop-status` accepts `--json`, `--home <dir>`, `--transcript <session.jsonl>`,
`--limit <n>`, `--bash-timeout-seconds <n>`, `--wake-grace-multiplier <n>`,
`--now <time>`, `--exit-code`, `--watch`, `--watch-count <n>`,
`--watch-interval-seconds <n>`, and `--write-dir <dir>`. It can inspect a home
directory or a single transcript and can return a computed status code.

### `control-pane`

```text
ecc control-pane [options]
```

This command starts the local ECC2 operator control pane.

| Option | Effect |
|---|---|
| `--host <address>` | Bind the local server (default `127.0.0.1`). |
| `--port <number>` | Bind the local server port (default `8765`). |
| `--db <path>` | Select the ECC2 database. |
| `--state-db <path>` | Read work items from an ECC state-store database. |
| `--config <path>` | Select the ECC2 configuration file. |
| `--query <text>` | Supply the initial query text. |
| `--read-only` | Disable action execution endpoints. |
| `--no-open` | Do not open a browser after the server starts. |

Use `ecc control-pane --help` for the command's current help output.

### `platform-audit`

```text
ecc platform-audit [options]
```

| Option | Effect |
|---|---|
| `--format text\|json\|markdown` | Select the report format. |
| `--json`, `--markdown` | Format aliases. |
| `--write <path>` | Write the report to a file. |
| `--root <path>` | Select the audit root. |
| `--repo <owner/name>` | Add a GitHub repository to the audit. |
| `--skip-github` | Skip GitHub queries. |
| `--allow-untracked <path>` | Allow specified untracked paths. |
| `--max-open-prs <n>` | Fail readiness above this count (default `20`). |
| `--max-open-issues <n>` | Fail readiness above this count (default `20`). |
| `--max-dirty-files <n>` | Fail readiness above this count (default `0`). |
| `--use-env-github-token` | Explicitly retain `GITHUB_TOKEN` for `gh` calls. |
| `--exit-code` | Return `2` when readiness is not met. |

By default, the audit removes the ambient `GITHUB_TOKEN` before invoking
GitHub CLI operations. Use `--use-env-github-token` only when that credential
is intentionally required for the audit.

### `security-ioc-scan`

```text
ecc security-ioc-scan [--root <path>] [--home <path>] [--json]
```

`--home` and `--home-dir` select the home directory used for persistence-surface
checks. `--json` selects machine-readable output. A clean scan exits `0`; scan
findings exit `1`; invalid arguments or runtime failures exit `2`.

### `ito`

```text
ecc ito <login|logout|auth|find|status|evals> [options]
```

| Operation | Function |
|---|---|
| `login [--no-browser]` | Perform device authorization; open the verification page unless suppressed. |
| `logout` | Revoke the current device credential. |
| `auth` | Validate existing authentication. |
| `find` | Submit an authenticated live RFQ for compute capacity. |
| `status` | Query live compute status. |
| `evals` | Run the separately gated qualification evaluation path. |

The bridge requires an explicit absolute `ECC_ITO_CLI_EXECUTABLE` path to the
canonical Itô client. It does not discover a credential-bearing client through
`PATH`. The dispatcher passes an allowlisted environment to the Itô child:
`ITO_API_KEY` is forwarded for `auth`, `find`, and `status`, but not `login`;
qualification variables are limited to the `evals` path. Itô credentials and
tokens must not be placed in command arguments, tracked files, or chat.

`find` submits a live request and does not reserve, purchase, launch, repair,
or recover capacity. `evals` requires the command's explicit live-evaluation
flag, node list, and absolute configuration directory.

## Output and errors

The dispatcher forwards a child command's numeric exit status. It prints
`Error: <message>` and exits `1` for unknown commands, invalid dispatch, or
fatal child-launch errors. Individual commands may use additional statuses:
`doctor` reports findings with `1`; readiness-oriented `status` and
`platform-audit` use `2` when `--exit-code` is requested; the security IOC
scanner uses `1` for findings and `2` for invalid arguments or runtime errors.

## Representative examples

```bash
# Inspect the available surface.
ecc --help
ecc help install

# Preview a selective install, then apply it.
ecc plan --profile core --target cursor
ecc install --profile minimal --target claude

# Use the guided multi-harness installer in preview mode.
ecc install --guided --harness codex --dry-run

# Discover components before installing.
ecc catalog components --family language
ecc catalog show framework:nextjs
ecc consult "security reviews" --target claude

# Inspect and repair managed files.
ecc list-installed --json
ecc doctor --target cursor
ecc repair --dry-run

# Work with local state and handoffs.
ecc status --markdown --write status.md
ecc sessions session-active --json
ecc memory handoff --from codex --target claude --title "Continue migration" --stdin

ecc work-items upsert linear-ecc-20 --source linear --source-id ECC-20 \
  --title "Review control-plane contract" --status blocked

# Audit without automatically using the ambient GitHub token.
ecc platform-audit --json
```

For environment variables, defaults, and secret-handling boundaries, see
[`ENVIRONMENT.md`](./ENVIRONMENT.md) and the source template
[`.env.example`](../.env.example). For slash-command discovery, see the
[`COMMANDS-QUICK-REF.md`](../COMMANDS-QUICK-REF.md).
