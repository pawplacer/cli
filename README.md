# PawPlacer CLI

Work with your PawPlacer pets, people, adoption fees, and contracts from the
terminal. Built on [`pawplacer-sdk`](https://github.com/pawplacer/sdk).

Upgrading from 1.x? See [Upgrading to 2.0](#upgrading-to-20).

## Install

Requires Node.js 22.12 or newer.

```bash
npm install -g pawplacer-cli
```

## Auth

Create an API key in PawPlacer under **Settings > SDK/API**, then:

```bash
export PAWPLACER_API_KEY="ppk_live_..."
pawplacer doctor
```

`doctor` checks the key and connection, and shows the API version, your rate
limit, and whether the workspace still has sample data. You can also pass
`--api-key`, and in a terminal with no key set the CLI asks for one.

Read-only keys can run every read command. Create and update commands need a
**Write + read** key. Don't commit keys; keep them in your shell's secret
manager or your CI's secrets.

## Quick start

```bash
pawplacer guide
pawplacer pets list --status available --species dog
pawplacer pets get <pet-uuid>
pawplacer pets update DOG-2026-001 --data '{"description":"Updated bio"}'
pawplacer people list --type adopter --search "Jane"
pawplacer adoption-fees
pawplacer contracts --type adopter
```

## Output

In a terminal, lists print as tables and single records as labeled fields.
When output is piped, or with `--json`, every command prints JSON, so scripts
and `jq` keep working:

```bash
pawplacer pets list --status available --json | jq '.total'
pawplacer pets list --all --compact > pets.json
```

List JSON matches the SDK: `{ "data": [...], "total", "limit", "offset", "hasMore" }`.
With `--all`, the CLI fetches every page and prints `{ "data": [...], "total" }`.

Notices, such as the sample-data reminder and update notices, go to stderr, so
they never mix into JSON on stdout. `--quiet` hides them.

### Sample data

New workspaces start with sample data. While it's there, API responses include
the sample pets and people (sample pets have `"is_sample": true`), and the CLI
prints a reminder on stderr. Keep or clear the sample data in **Settings >
Danger Zone** before you sync anything to a live website.

## Commands

### Pets

```bash
pawplacer pets list [--status <status>] [--species <species>] [--search <text>]
                    [--since <date>] [--limit <1-100>] [--offset <n>] [--all]
pawplacer pets get <pet-uuid>
pawplacer pets create [--data <json> | --file <path> | --prompt]
pawplacer pets update <pet-uuid-or-custom-id> [--data <json> | --file <path> | --prompt]
pawplacer pets custom-fields
```

Species: `dog`, `cat`, `rabbit`, `horse`, `small_furry`, `bird`, `barnyard`,
`reptile`, `scales_fins_other`, `invertebrate`. `--status` takes any status
name or label your account uses, like `available` or `"Ready for Adoption"`.

### People

```bash
pawplacer people list --type <type> [--status <status>] [--search <text>]
                      [--since <date>] [--limit <1-100>] [--offset <n>] [--all]
pawplacer people get <person-uuid> --type <type>
pawplacer people create [--data <json> | --file <path> | --prompt]
pawplacer people custom-fields --type <type>
```

Types: `adopter`, `foster`, `surrender`, `volunteer`. Statuses: `pending`,
`active`, `training`, `inactive`, `denied`, `suspended`, `blocked`.

### Fees, contracts, and setup

```bash
pawplacer adoption-fees
pawplacer contracts --type <adopter|foster|surrender|volunteer>
pawplacer doctor
pawplacer guide
```

## Creating and updating

Give a payload one of three ways:

```bash
pawplacer pets create --data '{"name":"Maple","species":"dog","age_category":"adult","sex":"female","size":"medium","status":"available"}'
pawplacer pets create --file pet.json
cat pet.json | pawplacer pets create
```

With no payload flag, the CLI prompts in a terminal and reads JSON from stdin
when piped. `--file -` also reads stdin.

`pets update` sends only the fields you give it. Use `""` or `[]` to clear a
field:

```bash
pawplacer pets update DOG-2026-001 --data '{"description":"","special_needs":[]}'
```

### Prompts

`pets create`, `pets update`, and `people create` can build the payload from
prompts. Pet prompts cover every species and field, and accept any status your
account uses. They also include your custom fields, in the order and sections
you set up in PawPlacer. In `pets update`, leaving a text or list answer blank
clears that field.

`people create` asks volunteers for skills, interests, preferred roles, and
languages. For adopter and foster applications, it shows the contract, then
asks for the pet IDs and whether the applicant accepted the terms.

### Idempotency

Every create and update sends an idempotency key, and the SDK retries the write
on timeouts, 429s, and 5xx responses. Pass your own key when a sync job may run
twice, so the second run returns the first result instead of writing again:

```bash
pawplacer pets create --file pet.json --idempotency-key "pet:DOG-2026-001"
```

Use a new key for each different change; reusing a key with a different payload
returns a conflict. Application keys must be UUIDs. `--no-idempotency-key`
sends no key and turns off write retries.

## Examples

Use `pawplacer pets custom-fields` and `pawplacer people custom-fields --type <type>`
to see your own `custom_field_data` keys. The keys below are examples.

Pet with common optional fields (`pet.json`):

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
  "good_with": ["families", "kids", "dogs", "houseTrained"],
  "bad_with": ["cats"],
  "temperaments": ["playful", "social", "energetic"],
  "image_urls": ["https://example.com/max.jpg"],
  "custom_id": "DOG-2026-001",
  "intake_date": "2026-05-15",
  "show_public": true,
  "weight": "48 lb",
  "custom_field_data": { "kennel": "A12" }
}
```

Foster (`foster.json`):

```json
{
  "type": "foster",
  "name": "Bob Foster",
  "email": "bob@example.com",
  "phone": "555-0200",
  "status": "active",
  "capacity": 2
}
```

Volunteer (`volunteer.json`):

```json
{
  "type": "volunteer",
  "name": "Val Volunteer",
  "email": "val@example.com",
  "status": "training",
  "skills": ["Dog walking", "Photography"],
  "preferred_roles": ["Events"],
  "languages": ["Spanish"]
}
```

Adopter application. Show the applicant the contract from
`pawplacer contracts --type adopter` first:

```bash
pawplacer people create --data '{"type":"adopter","name":"Jane Smith","email":"jane@example.com","status":"pending","application":{"pet_ids":["<pet-uuid>"],"terms_accepted":true}}'
```

Surrender with a new pet to create and link (`surrender.json`):

```json
{
  "type": "surrender",
  "name": "Sam Surrender",
  "email": "sam@example.com",
  "status": "pending",
  "pets": [
    {
      "create": {
        "name": "Buddy",
        "species": "dog",
        "age_category": "adult",
        "sex": "male",
        "size": "large",
        "status": "intake"
      },
      "reason": "Moving",
      "urgency": "high"
    }
  ]
}
```

```bash
pawplacer people create --file surrender.json --idempotency-key "surrender:sam-2026-06-15"
```

## Global options

```
--api-key <key>   API key (default: PAWPLACER_API_KEY)
--api-url <url>   API URL (default: PAWPLACER_API_URL or https://pawplacer.com)
--timeout <ms>    per-request timeout
--json            print JSON (the default when output is piped)
--compact         print compact JSON
--quiet           hide notices on stderr
--debug           log each request to stderr and show stack traces
```

## Exit codes

| Code | Meaning |
| ---- | ------- |
| 0 | Success |
| 1 | The API returned an error, or the CLI couldn't reach it |
| 2 | Usage error: a bad flag or value, a missing key, or a missing payload |
| 130 | You cancelled a prompt |

API errors print the status, code, message, any field details, a hint when
there is one, and the request ID to include in support requests.

## Update notices

Once a day, the CLI checks npm for a newer version while your command runs,
and prints a notice on stderr when there is one. It skips the check in CI, when
stderr isn't a terminal, with `--quiet`, or with `PAWPLACER_NO_UPDATE_CHECK=1`.

## Upgrading to 2.0

| 1.x | 2.0 |
| --- | --- |
| `pets search <query>` | `pets list --search <query>` |
| `pets status <status>` | `pets list --status <status>` |
| `--json '<payload>'` | `--data '<payload>'` (`--json` now means JSON output) |
| `--stdin` | pipe the JSON in, or `--file -` |
| `--updated-since <iso>` | `--since <date>` |
| `--no-auto-idempotency-key` | `--no-idempotency-key` |
| `--retry` | removed; keyed writes retry automatically |
| `--no-cache`, `--force-refresh` | removed; the CLI always reads fresh data |
| JSON output in a terminal | tables in a terminal; JSON when piped or with `--json` |
| exit code 1 for every failure | 2 for usage errors, 1 for API errors, 130 for a cancelled prompt |
| Node.js 20 | Node.js 22.12 |

Using a removed command or flag prints what to use instead.

## Development

```bash
npm install
npm run check   # lint, format check, typecheck, tests, build
npm link        # puts your local build on PATH as `pawplacer`
```

Tests run the CLI against a local HTTP server with the real SDK.
