# Contributing

Thanks for helping improve the PawPlacer CLI. Public participation is limited to GitHub issues and pull requests.

## Before You Start

- Check the open issues and pull requests to avoid duplicate work.
- For larger behavior changes, open an issue first so the approach can be discussed.
- Keep pull requests focused. Small, single-purpose changes are easier to review.

## Development

Requirements:

- Node.js 20 or newer
- npm

Install dependencies:

```bash
npm ci
```

Run the full local check:

```bash
npm run check
```

This runs type checks, tests, and a production build.

To inspect the npm package contents locally:

```bash
npm pack --dry-run
```

## Pull Requests

Please include:

- A clear description of the change
- Any related issue number
- Tests or documentation updates when behavior changes
- Notes about breaking changes, if any

Before opening a PR, run:

```bash
npm run check
```

## Coding Guidelines

- Preserve the public CLI behavior unless the change is intentionally breaking.
- Keep command output clear, script-friendly, and consistent.
- Prefer explicit TypeScript types for public interfaces.
- Add or update tests for new behavior and bug fixes.
- Keep examples short and realistic.

## Project Ownership

Only the project owner can merge pull requests, manage repository settings, create release tags, or publish `pawplacer-cli` to npm.

Contributors can:

- Open issues
- Comment on issues and pull requests
- Submit pull requests for review

Contributors cannot:

- Publish the package to npm
- Create official releases or tags
- Merge pull requests
- Change repository settings
- Represent themselves as project maintainers
