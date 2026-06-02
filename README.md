# PawPlacer CLI

Command-line interface for the PawPlacer API. Built on `pawplacer-sdk`.

## What Is This?

PawPlacer CLI lets shelters and rescues list, create, and manage pets, people,
adoption fees, and contracts from the terminal.

## Install

Requires Node.js 20 or newer.

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

Do not commit API keys. Prefer environment variables or your shell's secret
manager for local use.

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

## Examples

The `custom_field_data` keys below are examples. Use
`pawplacer pets custom-fields` or
`pawplacer people custom-fields --type adopter` to inspect your configured
field keys.

Minimal `pet.json`:

```json
{
  "name": "Maple",
  "species": "dog",
  "age_category": "adult",
  "sex": "female",
  "size": "medium",
  "status": "available",
  "health": "good"
}
```

Create it with:

```bash
pawplacer pets create --file pet.json
```

Minimal adopter JSON:

```json
{
  "type": "adopter",
  "name": "Jane Smith"
}
```

Create it with:

```bash
pawplacer people create --json '{"type":"adopter","name":"Jane Smith"}'
```

Example output from `pawplacer pets list --compact`:

```json
{"data":[{"id":"pet_123","name":"Maple","species":"dog","status":"available"}],"total":1,"limit":20,"offset":0}
```

Larger `pet.json` with common optional fields:

```json
{
  "name": "Max",
  "species": "dog",
  "age_category": "young",
  "sex": "male",
  "size": "medium",
  "status": "available",
  "health": "good",
  "breed": ["Labrador Retriever"],
  "color": ["Black"],
  "age_years": "2",
  "description": "Playful, social dog who does well in an active home.",
  "spayed": true,
  "adoption_fee": 250,
  "microchip_id": "985112009876543",
  "good_with": ["families", "kids", "dogs"],
  "bad_with": ["cats"],
  "temperaments": ["playful", "social", "energetic"],
  "image_urls": ["https://example.com/max.jpg"],
  "custom_id": "DOG-2026-001",
  "intake_date": "2026-05-15",
  "show_public": true,
  "special_needs": ["Daily joint supplement"],
  "weight": "48 lb",
  "custom_field_data": {
    "kennel": "A12",
    "preferred_food": "Chicken kibble"
  }
}
```

```bash
pawplacer pets create --file pet.json --idempotency-key "pet:DOG-2026-001"
```

Larger foster JSON:

```json
{
  "type": "foster",
  "name": "Bob Foster",
  "email": "bob@example.com",
  "phone": "555-0200",
  "address": "456 Oak Ave, Austin, TX",
  "status": "active",
  "status_change_notes": "Approved after home check.",
  "capacity": 2,
  "custom_field_data": {
    "dog_experience": "yes",
    "has_yard": true,
    "preferred_size": "medium"
  }
}
```

```bash
pawplacer people create --file foster.json
```

Larger volunteer JSON:

```json
{
  "type": "volunteer",
  "name": "Val Volunteer",
  "email": "val@example.com",
  "phone": "555-0400",
  "status": "active",
  "custom_field_data": {
    "preferred_shift": "Saturday",
    "interests": ["dog walking", "events"],
    "orientation_complete": true
  }
}
```

```bash
pawplacer people create --file volunteer.json
```

Surrender intake with a new pet to create and link:

```json
{
  "type": "surrender",
  "name": "Sam Surrender",
  "email": "sam@example.com",
  "phone": "555-0300",
  "status": "pending",
  "custom_field_data": {
    "requested_intake_at": "2026-06-15",
    "reason_for_surrender": "Moving"
  },
  "pets": [
    {
      "create": {
        "name": "Buddy",
        "species": "dog",
        "age_category": "adult",
        "sex": "male",
        "size": "large",
        "status": "intake",
        "health": "unknown",
        "breed": ["Lab Mix"],
        "color": ["Black"],
        "reason_for_surrender": "Moving"
      },
      "reason": "Moving",
      "urgency": "high",
      "notes": "Owner can foster until intake date.",
      "custom_data": {
        "has_vet_records": true
      }
    }
  ]
}
```

```bash
pawplacer people create --file surrender.json --idempotency-key "surrender:sam-2026-06-15"
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

If npm reports an engine mismatch, upgrade Node.js to version 20 or newer.
