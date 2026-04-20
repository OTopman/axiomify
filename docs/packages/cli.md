# @axiomify/cli

The project scaffolding and development CLI.

## Install

```bash
npm install -D @axiomify/cli
```

## Commands

- `axiomify init [directory]`
- `axiomify dev [entry]`
- `axiomify build [entry]`
- `axiomify routes [entry]`

## Notes

- `init` refuses to overwrite key files unless you pass `--force`
- `dev` bundles to `.axiomify/dev.js` and restarts on rebuild
- `build` outputs `dist/index.js`
- `routes` expects your entry file to export the app instance

## Recommended Scripts

```json
{
  "scripts": {
    "dev": "axiomify dev src/index.ts",
    "build": "axiomify build src/index.ts",
    "start": "node dist/index.js",
    "routes": "axiomify routes src/index.ts"
  }
}
```
