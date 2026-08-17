# ECC Environment Reference

This page documents the variables listed in [`.env.example`](../.env.example).
The template is a starting point, not a declaration that every variable is
required by the core ECC CLI. The Node CLI reads the environment supplied to
its process; copying `.env.example` to `.env` does not load the file by itself.
Use the shell, CI runner, or provider runtime to load the values.

## Status terms

- **Conditional required**: required for the provider or workflow that uses the
  variable, but not for installing or inspecting ECC.
- **Optional**: changes behavior when set; the consumer has a documented
  default or can operate without it.
- **Compatibility / CI only**: used by compatibility lanes or CI rather than
  the Node CLI's normal runtime path.
- **Template-only**: retained in `.env.example` as project or workflow metadata;
  current ECC runtime code does not consume it.

## Provider credentials and endpoints

### Anthropic and GitHub

| Variable | Status | Default | Accepted values | Scope and purpose |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | Conditional required | None | Opaque non-empty API credential | Anthropic provider processes and provider-backed security or model tooling. |
| `GITHUB_TOKEN` | Conditional required | None | Opaque GitHub token | Release and discussion announcement workflows and explicit GitHub API operations. |

`ANTHROPIC_API_KEY` is read by the Claude provider when an API key is not
passed directly. The core `ecc` install, catalog, plan, and local diagnostics
commands do not require it.

`GITHUB_TOKEN` is not automatically retained for every GitHub CLI operation.
The platform-audit and related coordination paths remove the ambient token by
default; `--use-env-github-token` is an explicit opt-in when a token is needed.
Store both values in a secret manager or CI secret store, not in tracked files,
command arguments, or memory entries.

### Astraflow / UModelVerse

The Astraflow adapters use OpenAI-compatible endpoints. The global and China
endpoints are independent provider configurations.

| Variable | Status | Default | Accepted values | Scope and purpose |
|---|---|---|---|---|
| `ASTRAFLOW_API_KEY` | Conditional required | None | Opaque non-empty API credential | Authentication for the global Astraflow provider. |
| `ASTRAFLOW_MODEL` | Optional | `gpt-4o-mini` | Provider-supported model identifier; no enum validation | Default model for the global provider and fallback model for the China provider. |
| `ASTRAFLOW_BASE_URL` | Optional | `https://api.umodelverse.ai/v1` | Endpoint string; no URL-format validation in the adapter | Base URL for the global provider. |
| `ASTRAFLOW_CN_API_KEY` | Conditional required | None | Opaque non-empty API credential | Authentication for the Astraflow China provider. |
| `ASTRAFLOW_CN_MODEL` | Optional | `gpt-4o-mini`, or `ASTRAFLOW_MODEL` when set | Provider-supported model identifier; no enum validation | Default model for the China provider. |
| `ASTRAFLOW_CN_BASE_URL` | Optional | `https://api.modelverse.cn/v1` | Endpoint string; no URL-format validation in the adapter | Base URL for the China provider. |

The adapter considers a provider configured when its selected API key is
truthy. Model and endpoint strings are passed to the OpenAI-compatible client;
provider availability and model validity are enforced by the remote service.
The implementation is in
[`src/llm/providers/astraflow.py`](../src/llm/providers/astraflow.py).

### Atlas Cloud

| Variable | Status | Default | Accepted values | Scope and purpose |
|---|---|---|---|---|
| `ATLAS_API_KEY` | Conditional required | None | Opaque non-empty API credential | Authentication for the Atlas Cloud provider. |
| `ATLAS_BASE_URL` | Optional | `https://api.atlascloud.ai/v1` | Endpoint string; no URL-format validation in the adapter | Base URL for the OpenAI-compatible Atlas Cloud API. |
| `ATLAS_MODEL` | Optional | `deepseek-ai/deepseek-v4-pro` | Provider-supported model identifier; no enum validation | Default Atlas Cloud model. |

The adapter also accepts `ATLASCLOUD_API_KEY` as a compatibility fallback, but
`ATLAS_API_KEY` is the variable documented by the template. See the
[Atlas Cloud provider guide](./ATLAS-CLOUD-GUIDE.md) for provider setup and
model examples. The adapter implementation is in
[`src/llm/providers/atlas.py`](../src/llm/providers/atlas.py).

## Runtime isolation and package selection

### Agent data home

| Variable | Status | Default | Accepted values | Scope and purpose |
|---|---|---|---|---|
| `ECC_AGENT_DATA_HOME` | Optional | `~/.claude`; Cursor hook sessions default to `~/.cursor/ecc` | Absolute path, `~`-prefixed path, or relative path resolved from the current working directory | Root for ECC session summaries, learned skills, aliases, and metrics. |

The value is resolved as a path. Cursor project configuration may provide a
trusted default under the standard Claude or Cursor ECC data roots; an explicit
`ECC_AGENT_DATA_HOME` override takes precedence. Separate roots prevent Claude
Code and Cursor sessions from sharing or overwriting each other's data. See
[`scripts/lib/agent-data-home.js`](../scripts/lib/agent-data-home.js) and the
[agent-data isolation section in the README](../README.md#agent-data-home-multi-harness-isolation).

### Package manager selection

The runtime variable is `CLAUDE_PACKAGE_MANAGER`.

| Variable | Status | Default | Accepted values | Scope and purpose |
|---|---|---|---|---|
| `CLAUDE_PACKAGE_MANAGER` | Optional | `npm` after configured and file-based detection | `npm`, `pnpm`, `yarn`, `bun` | Canonical package-manager override for ECC's Node runtime and setup helpers. |
| `CLAUDE_CODE_PACKAGE_MANAGER` | Compatibility / CI only | None | `npm`, `pnpm`, `yarn`, `bun` | Compatibility value used by CI and ECC2 session lanes; not the canonical Node CLI override. |

`CLAUDE_PACKAGE_MANAGER` has precedence over project configuration,
`package.json`, lock-file detection, and the global preference file. Use this
variable for runtime behavior. `CLAUDE_CODE_PACKAGE_MANAGER` remains in the
template for compatibility consumers that still export the older name. ECC2's
session manager mirrors both names into managed child environments, and the
package's compatibility test lane reads the older name; the canonical Node
resolver does not. The resolver is implemented in
[`scripts/lib/package-manager.js`](../scripts/lib/package-manager.js), while the
ECC2 compatibility path is in
[`ecc2/src/session/manager.rs`](../ecc2/src/session/manager.rs).

## Optional platform and workflow metadata

These entries are retained in `.env.example` for Docker, CI, or local workflow
conventions. They are not consumed by the current ECC Node runtime unless a
separate surrounding workflow reads them.

| Variable | Status | Default in template | Accepted values | Scope and purpose |
|---|---|---|---|---|
| `DOCKER_PLATFORM` | Template-only | Unset | `linux/arm64` or `linux/amd64` | Optional Docker platform hint for external Docker or CI commands. |
| `GITHUB_USER` | Template-only | `your-github-username` | GitHub username string | Placeholder for external CI or release context. |
| `DEFAULT_BASE_BRANCH` | Template-only | `main` | Git branch name | Placeholder for external diff or CI workflows. |
| `SESSION_SCRIPT` | Template-only | `./session-start.sh` | Filesystem path | Placeholder for an external session-start test or wrapper. |
| `CONFIG_FILE` | Template-only | `./mcp-config.json` | Filesystem path | Placeholder for an external generated MCP configuration workflow. |
| `ENABLE_VERBOSE_LOGGING` | Template-only | `false` | `true` or `false` as a string | Placeholder for an external workflow's logging switch. |

`CONFIG_FILE` deserves particular care: scripts that use a local shell variable
with this same name derive it from `CODEX_HOME`; they do not import the
`.env.example` value. Setting the template variable therefore does not change
Codex configuration paths.

## Secret handling

- Copy the template to a local ignored file: `cp .env.example .env`.
- `.env`, `.env.local`, and environment-specific `.env.*.local` files are
  ignored by the repository's [`.gitignore`](../.gitignore).
- Replace empty credential values only in the local or CI secret store; do not
  commit the resulting file.
- Do not place API keys or tokens in command-line arguments, tracked config,
  issue text, chat, or Memory Vault bodies.
- Prefer the narrowest provider or command scope. In particular, an ambient
  `GITHUB_TOKEN` is deliberately removed by platform-audit unless its explicit
  opt-in flag is supplied.
- A missing or invalid provider credential fails when that provider makes an
  authenticated request; it does not make the local install or documentation
  commands unusable.
