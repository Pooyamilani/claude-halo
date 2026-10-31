# Migrating to Halo

Halo Usage used to be a single plugin called `halo`. It is now `halo-usage`, one plugin of the Halo marketplace.

## If you installed `halo` (nothing breaks)

The marketplace keeps a deprecated `halo` entry that points at Halo Usage, so `halo@claude-halo` updates to 1.3.0 and keeps loading. You can switch when convenient:

```
/plugin uninstall halo
/plugin marketplace add Pooyamilani/claude-halo
/plugin install halo-usage@halo
```

## Your options

Options are stored under the plugin's name. If you set any in `~/.claude/settings.json`, rename the key:

```json
"pluginConfigs": { "halo-usage": { "options": { "sessionModel": "hide" } } }
```

(It was `"halo"`.) If an option does not take effect after switching, set it again in the `/plugin` config menu.

## Developing from a clone

Point `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS` at `plugins/halo-usage` instead of the repository root.

## New installs

Use `halo-usage@halo` and `halo-desk@halo`. Do not install both `halo` and `halo-usage`: they are the same plugin and would draw twice.
