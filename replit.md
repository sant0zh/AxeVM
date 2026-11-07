# AxeVM

A responsive ARM64 virtual-machine manager prototype for configuring AxeOS-ready VMs, with execution clearly marked unavailable until QEMU is integrated.

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
- `docs/architecture.md` — architecture boundaries and the planned native/QEMU integration

## Architecture decisions

- Keep VM configuration persistence behind a repository boundary, separate from UI state.
- Keep VM execution behind an engine boundary; the current prototype reports execution as unavailable and does not simulate boots.
- See `docs/architecture.md` for the prototype storage choice and planned Kotlin/Compose, JNI, and QEMU boundaries.

## Product

The initial milestone is a responsive dashboard and VM configuration manager with console, storage, and settings surfaces. VM configuration is persistent in the browser prototype; guest execution is not available.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
