<p align="center">
  <img src="docs/logo.svg" alt="Halo" width="96">
</p>

<h1 align="center">Halo</h1>
<p align="center"><b>A modular workspace for Claude Code.</b><br>Know your session. Manage your work.</p>

<p align="center">
  <a href="LICENSE"><img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-8f9bff?labelColor=1c2230&style=flat-square"></a>
  <img alt="a mod for Claude Code" src="https://img.shields.io/badge/Claude%20Code-mods-e07a52?labelColor=1c2230&style=flat-square">
</p>

Halo brings session visibility and task management into one cohesive Claude Code experience. It is a family of small plugins under one brand. Install only the ones you want; each works on its own.

| Plugin | What it does | Status |
| --- | --- | --- |
| [**Halo Usage**](plugins/halo-usage) · `halo-usage` | A glass bar above your prompt: 5-hour and weekly usage rings, running models with effort, the Jalali or Gregorian date. | Released |
| [**Halo Desk**](plugins/halo-desk) · `halo-desk` | A pane of what is actually open across your git repos, cross-checked against Jira and GitLab, with confirmation-gated cleanup. | In development |

![Halo Usage above the prompt while Claude works with three subagents](plugins/halo-usage/docs/halo-wide.png)

## Install

```
/plugin marketplace add Pooyamilani/claude-halo
/plugin install halo-usage@halo          # usage bar only
/plugin install halo-desk@halo      # task desk only
```

Installing one plugin never loads the other. Update or uninstall either at any time (`/plugin`).

In the desktop app: **+** next to the prompt box → **Plugins** → **Add marketplace** with `Pooyamilani/claude-halo`.

## Compatibility

- Claude Code with plugin mods enabled (developed and tested on 2.1.x, desktop app and terminal).
- Halo Usage draws above the prompt on the desktop app and in terminals. Halo Desk opens as a pane with `/halo-desk`.
- Halo Desk needs `git`. Jira and GitLab data is optional and read-only.

## Permissions and safety

- Halo Usage reads the usage and model data Claude Code already gives plugins. It makes no network calls.
- Halo Desk runs read-only `git` commands, and reads Jira and GitLab only through a snapshot file you control: a token you name by environment variable, a browser you are already signed in to, or your own script. Credentials are never stored.
- The only destructive operations are deleting local branches and dropping stashes in Halo Desk's cleanup review. Each needs evidence and a second confirming press. Untracked files are never deleted.

## Existing Halo users

Installed `halo` before this became a product? It keeps working and updating. See [Migrating](docs/migrating.md).

## Roadmap

- Halo Desk's first public release, with screenshots.
- More modules under the Halo brand when they earn their place. An all-in-one bundle only if people ask for one.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and ideas are welcome on the [issue tracker](https://github.com/Pooyamilani/claude-halo/issues).

## License

MIT. See [LICENSE](LICENSE).
