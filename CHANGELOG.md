# Changelog

Each plugin is versioned and released on its own. Entries say which plugin changed.

## Unreleased

### halo-desk 0.2.0
- New pane design: the Halo rings are a live summary (the selected tab's ring glows and shivers), two tabs (Needs action, Waiting), and a queue grouped by what to do, with the Jira title, a link to the card, Copy branch and Open MR on every row.
- One **Sync** button (git fetch, then Jira and GitLab) behind a single approval card; *Git only* is offered inside it. A cleanup banner appears only when there is something to clean up; Local details is a disclosure at the bottom.
- Fix: a card whose Jira status is closed and whose MR is merged is never shown as "push the branch", even when the local tip cannot be matched to the merged one.
- Removed from the pane: the usage card (use Halo Usage) and the Show/Hide section cards.

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
