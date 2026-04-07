# @axiomify/cli

The official Command Line Interface for the Axiomify framework. 

`@axiomify/cli` provides a lightning-fast development experience, production-ready build steps, and powerful inspection tools for your Axiomify applications.

## 📦 Installation

We recommend installing the CLI locally as a development dependency in your project so your CI/CD pipelines can utilize it:

```bash
npm install @axiomify/cli -D
````

You can also install it globally if you want to use the `init` command anywhere on your machine:

```bash
npm install -g @axiomify/cli
```

## 🛠️ Commands

| Command | Description |
| :--- | :--- |
| `axiomify init` | Scaffolds a new, production-ready Axiomify project. |
| `axiomify dev <entry>` | Starts the development server with hot-module reloading (HMR). |
| `axiomify build <entry>` | Compiles your TypeScript application for production. |
| `axiomify routes <entry>`| Inspects your app and prints a visual table of all registered routes. |

## 🚀 Usage Guide

### 1\. Project Scaffolding

Quickly generate a new project with all the necessary TypeScript configurations and adapter boilerplates:

```bash
npx @axiomify/cli init my-new-app
```

### 2\. Development Mode

Run your application locally. The CLI automatically watches your file system and restarts the server when it detects changes.

```bash
npx axiomify dev src/index.ts
```

### 3\. Route Inspector

Having trouble debugging an endpoint? The route inspector parses your Radix tree and prints a clean, color-coded table of every available method, path, and attached schema directly to your terminal.

```bash
npx axiomify routes src/index.ts
```

### 4\. Production Build

Compiles your application into highly optimized JavaScript ready for edge or serverless deployment.

```bash
npx axiomify build src/index.ts
```

## 📖 Standard `package.json` Setup

For the best developer experience, map the CLI commands to your project's npm scripts:

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

## 📚 Documentation

For complete documentation, guides, and ecosystem packages, please visit the [Axiomify Master Repository](https://github.com/OTopman/axiomify).

## 📄 License

MIT
