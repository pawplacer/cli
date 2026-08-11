# Changelog

All notable changes to `pawplacer-cli` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
