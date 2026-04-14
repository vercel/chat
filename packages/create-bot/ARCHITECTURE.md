# Architecture

`create-bot` is a CLI that scaffolds new [Chat SDK](https://chat-sdk.dev) bot projects. It is published as the `create-bot` npm package and lives in the Chat SDK monorepo at `packages/create-bot`.

## Project structure

```
packages/create-bot/
├── src/
│   ├── index.ts          # Entry point — calls createProgram().parse()
│   ├── cli.ts            # Commander program definition, flags, help text
│   ├── prompts.ts        # Interactive prompts (Clack) and flag resolution
│   ├── scaffold.ts       # File copying, post-processing, dependency install
│   ├── templates.ts      # Dynamic code generation (bot.ts)
│   └── types.ts          # Shared TypeScript interfaces
├── _template/            # Static template files copied into scaffolded projects
│   ├── src/app/api/webhooks/[platform]/route.ts
│   ├── .agents/skills/chat-sdk/SKILL.md
│   ├── AGENTS.md
│   ├── README.md
│   ├── .env.example
│   ├── .gitignore
│   ├── next.config.ts
│   ├── tsconfig.json
│   └── package.json
├── adapters.json         # Adapter registry (platforms, state, env vars, categories)
├── AGENTS.md             # Agent instructions for this package
├── ARCHITECTURE.md       # This document
├── CLAUDE.md             # Points to AGENTS.md
├── tsup.config.ts        # Bundler config (ESM + shebang)
├── vitest.config.ts      # Test config with v8 coverage
└── package.json
```

## Data flow

```
CLI invocation (npx create-bot my-bot --adapter slack redis)
  │
  ▼
index.ts ──► cli.ts (Commander parses args and flags)
                │
                ▼
           prompts.ts (resolves flags or runs interactive Clack prompts)
                │
                ├── resolveAdapterFlags()  ← matches --adapter values to adapters.json
                ├── text / groupMultiselect / select / confirm  ← interactive fallback
                └── detectPackageManager()  ← reads npm_config_user_agent
                │
                ▼
           scaffold.ts (creates the project on disk)
                │
                ├── copyDir()              ← copies _template/ → project directory
                ├── postProcessEnvExample  ← injects adapter env vars into .env.example
                ├── postProcessNextConfig  ← adds serverExternalPackages if needed
                ├── npm pkg set            ← sets name, description, adapter dependencies
                ├── templates.botTs()      ← generates src/lib/bot.ts with imports + handlers
                └── execa(install)         ← runs package manager install
                │
                ▼
           cli.ts (displays next steps and outro)
```

## Key design decisions

- **Static template + post-processing**: Most files live as-is in `_template/` and are copied verbatim. Only `.env.example`, `next.config.ts`, and `package.json` are post-processed. `src/lib/bot.ts` is the sole fully-generated file because its imports and adapter configuration vary per selection.
- **`adapters.json` as registry**: All adapter metadata (packages, factory functions, env vars, categories, server external packages) is centralized in a single JSON file. The CLI reads it at build time via an import assertion. This avoids hardcoding adapter knowledge across multiple source files.
- **`npm pkg set` for `package.json`**: Instead of generating the full `package.json` from a template function, the CLI copies a base `package.json` from `_template/` and patches it with `npm pkg set`. This keeps the base file readable and avoids JSON serialization edge cases.
- **Clack for interactive UX**: `@clack/prompts` provides the interactive prompt flow with spinners, grouped multi-select, and cancellation handling. All prompts are skippable via flags for non-interactive / CI usage.
- **Commander for arg parsing**: Handles positional args, flags, help text generation, and the `--no-color` convention.

## Testing

Tests use Vitest with v8 coverage. Each source module has a co-located `.test.ts` file. The test strategy:

- **`cli.test.ts`** — Mocks `runPrompts` and `scaffold`; tests Commander program creation, help text output, and action handler logic.
- **`prompts.test.ts`** — Mocks `@clack/prompts`; tests interactive flows, flag resolution, cancellation, validation, and package manager detection.
- **`scaffold.test.ts`** — Uses real temp directories; mocks `execa` and `@clack/prompts`; tests file copying, post-processing, dependency installation, and overwrite prompts.
- **`templates.test.ts`** — Pure function tests for `botTs()` output with various adapter combinations.

`types.ts` and `index.ts` are excluded from coverage — `types.ts` is definition-only and `index.ts` is a one-line entry point.
