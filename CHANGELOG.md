# Changelog

All notable changes to `pawplacer-cli` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-11-25

### Added

- Tables in a terminal: lists print as tables and single records as labeled fields. Output stays JSON when piped or with `--json`.
- `--all` on `pets list` and `people list` fetches every page.
- `pawplacer doctor` checks your key and connection, and shows the API version, rate limit, and sample-data state.
- A stderr reminder when the workspace still has sample data (from the API's `X-PawPlacer-Sample-Data` header). `--quiet` hides it.
- `PAWPLACER_API_URL`, `--quiet`, and `--debug` (request logs and stack traces on stderr).
- Prompts cover all 10 species and the `houseTrained` compatibility, accept any status your account uses, and ask volunteers for skills, interests, preferred roles, and languages.
- In `pets update --prompt`, leaving a text or list answer blank clears that field.
- Using a removed 1.x command or flag prints what to use instead.

### Changed

- **Node.js 22.12 or newer is required**, matching `pawplacer-sdk` 2.0.
- Built on `pawplacer-sdk@^2.0.0`. API errors show the real status, code, message, field details, hint, and request ID. In 1.2.0 they came through as a bare "Request failed with status code ...".
- Exit codes: 2 for usage errors, 1 for API and connection errors, 130 for a cancelled prompt. 1.x exited 1 for everything.
- `--json` now switches output to JSON. Pass inline payloads with `--data`.
- With no payload flag, `create` and `update` prompt in a terminal and read JSON from stdin when piped.
- `--updated-since` is now `--since`, and `--no-auto-idempotency-key` is now `--no-idempotency-key`.
- `--limit` accepts 1-100, `--since` must be a date, and `--species`, `--type`, and people `--status` must be valid values. Each is checked before any request.
- Pet prompts no longer require `health`, and the status list matches PawPlacer's default statuses.
- The update check covers the CLI only, runs in parallel with your command, and skips CI, non-terminal stderr, and `--quiet`.

### Removed

- `pets search` and `pets status`. Use `pets list --search` and `pets list --status`.
- `--stdin`. Pipe the JSON in, or use `--file -`.
- `--retry`. Writes with an idempotency key retry automatically.
- `--no-cache` and `--force-refresh`. The CLI always reads fresh data.
- The SDK version from the update notice.

## [1.2.0] - 2026-08-11

### Added

- Interactive adopter and foster application submission with contract rendering, PawPlacer pet IDs, and explicit terms acceptance from `pawplacer-sdk` 1.6.
- People search, pet status filtering, and pet/people custom-field catalogs in the read-only `guide`.
- Update notices when either the CLI or its installed `pawplacer-sdk` version is behind npm.

### Changed

- Updated the CLI dependency to `pawplacer-sdk@^1.6.0`.
- Custom-field prompts now respect SDK-provided section/field ordering, placeholders, and `sync_to_column` metadata.
- Person creation prompts now offer only API-supported create-time statuses.
- CI and release checks now enforce Biome linting and formatting.
- CI now verifies Node.js 20, 22, and 24 compatibility.

## [1.1.0] - 2026-06-11

### Added

- `pets update <id-or-custom-id>` for partial pet updates by PawPlacer UUID or assigned `custom_id` through JSON, file, stdin, or prompt payloads.

## [1.0.1]

### Added

- Initial CLI package with `pawplacer` binary.
- JSON-first commands for pets, people, adoption fees, and contracts.
- Interactive `pawplacer guide` for common read-only workflows.
- Prompt-based `pets create --prompt` and `people create --prompt`.
- Friendly colored error output with `chalk`.
- Typecheck, test, and build scripts.

### Changed

- Switched from the local sibling SDK to the published `pawplacer-sdk@^1.4.0`.
- Set the CLI Node.js engine to 22 or newer to match the published dependency tree.

### Fixed

- Missing API keys now fail with a direct setup message before SDK construction.
- Create payload source errors now mention `--prompt`.
- Removed an unused prompt dependency from the program adapter.
