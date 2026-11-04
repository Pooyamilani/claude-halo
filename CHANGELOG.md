# Changelog

Each plugin is versioned and released on its own. Entries say which plugin changed.

## Unreleased

### halo-desk 0.1.0
- First version: a pane with local git, Jira and GitLab context, task classification, and confirmation-gated cleanup. Halo-branded.
- New `access.jira` / `access.gitlab` settings (`browser` default, or `mcp`): the Remote button can have Claude read Jira and GitLab through MCP servers instead of a signed-in browser, asking for approval before falling back to the browser when an MCP is not connected.
- Fix: a merged branch whose remote copy was deleted is no longer flagged as unpushed.

### halo-usage 1.3.0
- Renamed the plugin from `halo` to `halo-usage` as part of the Halo product. Behavior is unchanged.
- The repository is now a marketplace (`halo`) with plugins under `plugins/`. A deprecated `halo` entry keeps installs made before this release updating.
- Settings key for options is now `pluginConfigs.halo-usage` (see docs/migrating.md).

## halo 1.2.0 and earlier

See the [releases](https://github.com/Pooyamilani/claude-halo/releases) (v1.0.0 to v1.2.0).
