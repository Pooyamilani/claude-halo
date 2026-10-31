# Contributing to Halo

Halo is a monorepo of independent Claude Code plugins. Keep them independent.

## Layout

```
.claude-plugin/marketplace.json   the `halo` marketplace
plugins/halo-usage/               usage bar
plugins/halo-desk/               open-work pane
docs/                             product docs
```

## Rules

- A plugin must work without the others and must not read files outside its own folder at run time.
- Share code only when it clearly pays for itself. A small duplicated helper beats a shared runtime.
- Each plugin has its own version, README and tests. Bump the version in its `plugin.json` and in `marketplace.json` together, and add a CHANGELOG entry.
- Destructive operations stay confirmation-gated and are documented.
- No project, host or credential specifics in code, tests or docs. Use made-up names (`ACME-12`, `git.example.com`).

## Check your change

```bash
claude plugin validate .                       # the marketplace
cd plugins/<plugin> && claude plugin validate . && claude plugin test .
```

For installs, test in a clean config: `CLAUDE_CONFIG_DIR=$(mktemp -d) claude plugin marketplace add <path-to-this-repo>`.
