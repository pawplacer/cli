# PawPlacer CLI

Command-line interface for the PawPlacer API. Built on `pawplacer-sdk`.

## Install

Requires Node.js 22 or newer.

```bash
npm install -g pawplacer-cli
```

For local development in this repo:

```bash
npm install
npm run build
npm link
```

## Auth

Use a server-side API key from **Settings > SDK & API**.

```bash
export PAWPLACER_API_KEY="pp_..."
```

You can also pass `--api-key`. If you run the CLI in an interactive terminal
without a key, it prompts for one.

## Quick Start

```bash
pawplacer guide
pawplacer pets list --status available --species dog --limit 20
pawplacer pets get pet-uuid
pawplacer people list --type adopter --status active
pawplacer adoption-fees
pawplacer contracts --type adopter
```

All command output is JSON so it works well with tools like `jq`.

```bash
pawplacer pets list --status available --compact | jq ".total"
```

## Interactive Commands

The CLI uses prompts for common beginner workflows:

```bash
pawplacer guide
pawplacer pets create --prompt
pawplacer people create --prompt
```

The guide is read-only. The create prompts ask for the required fields and a few
common optional fields, then submit the payload through the SDK.

## Create From JSON

For repeatable scripts, prefer files or stdin:

```bash
pawplacer pets create --file pet.json
pawplacer people create --json '{"type":"adopter","name":"Jane Smith"}'
cat pet.json | pawplacer pets create --stdin
```

Create commands send an idempotency key by default. To use a stable key:

```bash
pawplacer pets create --file pet.json --idempotency-key "pet:external-123"
```

Disable automatic idempotency only when you understand the retry tradeoff:

```bash
pawplacer pets create --file pet.json --no-auto-idempotency-key
```

## Commands

### Pets

```bash
pawplacer pets list [--status status] [--species species] [--limit n] [--offset n] [--search query] [--updated-since iso]
pawplacer pets get <id> [--force-refresh]
pawplacer pets search <query>
pawplacer pets status <status>
pawplacer pets create --file pet.json
pawplacer pets create --prompt
pawplacer pets custom-fields
```

### People

```bash
pawplacer people list --type adopter [--status status] [--limit n] [--offset n] [--search query] [--updated-since iso]
pawplacer people get <id> --type adopter [--force-refresh]
pawplacer people create --file person.json
pawplacer people create --prompt
pawplacer people custom-fields --type adopter
```

Valid people types: `adopter`, `foster`, `surrender`, `volunteer`.

### Adoption Fees And Contracts

```bash
pawplacer adoption-fees
pawplacer contracts --type adopter
```

Valid contract types: `adopter`, `foster`, `surrender`, `volunteer`.

## Global Options

```bash
--api-key <key>     API key; defaults to PAWPLACER_API_KEY
--api-url <url>     API URL; defaults to https://pawplacer.com
--timeout <ms>      request timeout
--no-cache          disable SDK GET cache
--compact           print compact JSON
```

## Development

```bash
npm run typecheck
npm test
npm run build
npm run check
```

During development, the CLI uses the published `pawplacer-sdk` package.

## Troubleshooting

If a command says the API key is required, set `PAWPLACER_API_KEY`, pass
`--api-key`, or rerun the command in an interactive terminal so the CLI can
prompt for the key.

If npm reports an engine mismatch, upgrade Node.js to version 22 or newer.
