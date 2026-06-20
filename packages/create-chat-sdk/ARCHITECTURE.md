# Architecture

`create-chat-sdk` scaffolds webhook-only [Chat SDK](https://chat-sdk.dev) bot projects. It uses the `chat/adapters` catalog as the source of truth for adapter metadata and keeps CLI-only code-generation policy inside this package.

## Project structure

```txt
packages/create-chat-sdk/
├── src/
│   ├── index.ts
│   ├── cli/
│   │   ├── program.ts
│   │   └── run.ts
│   ├── catalog/
│   │   ├── index.ts
│   │   ├── scaffold-spec.ts
│   │   └── selection.ts
│   ├── generators/
│   │   ├── bot.ts
│   │   ├── env-example.ts
│   │   ├── next-config.ts
│   │   ├── package-json.ts
│   │   ├── readme.ts
│   │   └── routes.ts
│   ├── prompts/
│   │   ├── flow.ts
│   │   └── validate.ts
│   ├── scaffold/
│   │   ├── fs.ts
│   │   ├── run.ts
│   │   └── template.ts
│   ├── errors.ts
│   └── types.ts
├── docs/
│   └── create-chat-sdk.mdx
├── _template/
│   ├── src/app/api/webhooks/[platform]/route.ts
│   ├── .agents/skills/chat-sdk/SKILL.md
│   ├── AGENTS.md
│   ├── README.md
│   ├── .env.example
│   ├── .gitignore
│   ├── next-env.d.ts
│   ├── next.config.ts
│   ├── package.json
│   └── tsconfig.json
├── README.md
├── ARCHITECTURE.md
├── tsup.config.ts
├── vitest.config.ts
└── package.json
```

## Data flow

```txt
CLI invocation
  │
  ▼
index.ts ──► cli/program.ts
                │
                ▼
           cli/run.ts
                │
                ├── prompts/flow.ts
                │      └── catalog/selection.ts
                │             └── chat/adapters
                │
                ▼
           scaffold/run.ts
                │
                ├── copy _template/
                ├── generators/bot.ts
                ├── generators/env-example.ts
                ├── generators/package-json.ts
                ├── generators/next-config.ts
                ├── generators/readme.ts
                └── generators/routes.ts
```

## Catalog boundary

`chat/adapters` owns adapter facts:

- slug
- package name
- display metadata
- env specs
- peer dependencies
- `factoryExport`

`create-chat-sdk` owns scaffold policy in `CLI_SCAFFOLD_SPEC`:

- factory invocation shape
- extra dependencies
- Next.js `serverExternalPackages`
- state adapter prompt hints

The scaffold spec is declared with `satisfies Record<AdapterSlug, CliScaffoldSpec>`, so adding a catalog adapter without scaffold policy is a type error.

## Template model

The generated app is a webhook-only Next.js API app. The template intentionally does not include pages, layouts, or client UI. `src/lib/bot.ts`, `.env.example`, `next.config.ts`, `README.md`, and optional Web adapter route files are generated from the selected adapters.

## Testing

Tests use Vitest with v8 coverage and enforce 100% line, branch, function, and statement coverage for `src`.

- `catalog/selection.test.ts` verifies slug resolution and scaffold-spec coverage.
- `generators/generators.test.ts` verifies code generation for every catalog adapter.
- `cli/e2e.test.ts` scaffolds every catalog adapter through the real CLI path.
- `scaffold/run.test.ts` uses real temp directories and verifies spinner cleanup on failures.
