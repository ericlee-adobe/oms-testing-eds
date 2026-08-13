# Your Project's Title...
Your project's description...

## Environments
- Preview: https://main--{repo}--{owner}.aem.page/
- Live: https://main--{repo}--{owner}.aem.live/

## Documentation

Before using the aem-boilerplate, we recommand you to go through the documentation on https://www.aem.live/docs/ and more specifically:
1. [Developer Tutorial](https://www.aem.live/developer/tutorial)
2. [The Anatomy of a Project](https://www.aem.live/developer/anatomy-of-a-project)
3. [Web Performance](https://www.aem.live/developer/keeping-it-100)
4. [Markup, Sections, Blocks, and Auto Blocking](https://www.aem.live/developer/markup-sections-blocks)

## Installation

```sh
npm i
```

## Linting

```sh
npm run lint
```

## Local development

1. Create a new repository based on the `aem-boilerplate` template
1. Add the [AEM Code Sync GitHub App](https://github.com/apps/aem-code-sync) to the repository
1. Install dependencies: `npm i`
1. Open the `{repo}` directory in your favorite IDE and start coding :)

### Running locally

The quickest way is a single command that starts everything:

```sh
npm start
```

`npm start` launches all three dev processes in one terminal (Ctrl+C stops them
all): the AEM server, the React (JSX) watcher, and the local ACC proxy.

If you prefer separate terminals, or only need some of them, run them
individually — each does a distinct job and is only needed in certain cases:

| Command | Port | What it does | Needed when |
| --- | --- | --- | --- |
| `npm run serve` | 3000 | AEM dev server (`aem up --no-open`); serves the site at `http://localhost:3000` | **always** |
| `npm run watch:react` | — | Rebuilds the React blocks (`src/blocks/**/*.jsx` → `blocks/**/*.js`) on save | when editing React blocks (e.g. the login block) |
| `npm run proxy` | 3001 | CORS proxy for the login block's ACC calls; forwards to the hosted `acc-proxy` App Builder action | when testing the login block's API calls |

Notes:

- **React blocks require a build step.** `.jsx` sources under `src/blocks/`
  compile to the served bundles under `blocks/`. Keep `npm run watch:react`
  running so edits are picked up automatically (~70ms rebuild); then hard-refresh
  the browser. Plain CSS/JS/HTML edits are served live by `aem up` — no rebuild.
- **The login block can't call ACC directly from the browser** (no CORS for our
  origins, internal host). On localhost it routes through `npm run proxy`
  (`localhost:3001`), which forwards to the `acc-proxy` App Builder action; the
  deployed site calls that action directly. Endpoints are configured via
  `VITE_ACC_*` vars in `.env`.
- If you already have `serve`/`proxy` running in their own terminals, stop them
  before running `npm start` (it binds the same ports 3000/3001).
