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

## `init` prompts

`axiomify init` now supports:
- project name (if no target directory is supplied)
- project description
- optional ESLint + Prettier + EditorConfig files
- package manager choice (`npm`, `pnpm`, `yarn`)
- optional git initialization
- optional dependency installation

## Scaffolding output

Generated project includes:
- baseline scripts (`dev`, `build`, `start`, `routes`, `typecheck`)
- optional lint scripts (`lint`, `lint:fix`, `format`)
- optional `.eslintrc.cjs`, `.prettierrc`, `.prettierignore`, `.editorconfig`
- starter integrations for `helmet`, `cors`, `security`, `rate-limit`, `fingerprint`, and `logger`

## Notes

- `init` refuses to overwrite key files unless you pass `--force`
- install command uses the selected package manager
- final startup hint uses package-manager-specific dev command
