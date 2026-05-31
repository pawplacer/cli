# Changelog

All notable changes to `pawplacer-cli` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
