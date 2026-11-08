# AxeVM

A responsive ARM64 VM manager prototype for configuring AxeOS-ready profiles and preparing a clean boundary for future native QEMU execution.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/axe-vm run dev` — run the AxeVM interface
- `pnpm --filter @workspace/axe-vm run typecheck` — typecheck the AxeVM interface
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- The AxeVM prototype does not require a backend or database.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/axe-vm/` — React + TypeScript browser prototype
- `artifacts/axe-vm/src/lib/workspace.ts` — VM/asset types, schema migration, browser workspace persistence
- `artifacts/axe-vm/src/lib/asset-storage.ts` — IndexedDB persistence for imported asset bytes
- `artifacts/axe-vm/src/lib/vm-engine.ts` — typed execution, capabilities, session, event, and asset-resolution contracts
- `docs/architecture.md` — Iteration 1 architecture and deferred native/QEMU work

## Architecture decisions

- Keep VM configuration and binary asset storage behind separate persistence boundaries.
- Use the ARM64 QEMU `virt` machine and generic `max` CPU profile; preserve unsupported legacy hardware labels when normalizing old saves.
- Keep VM execution behind a typed engine boundary; the current adapter reports execution unavailable and never simulates a boot.
- See `docs/architecture.md` for schema migration and the planned Kotlin/Compose, JNI, and QEMU boundaries.

## Product

Iteration 1 provides ARM64 VM configuration management, schema-versioned browser persistence, local asset-file storage, and a typed unavailable VM-engine adapter. Native execution and the Iteration 2 UI work remain deferred.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
