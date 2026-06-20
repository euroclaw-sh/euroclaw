# @euroclaw/engine-core

Engine-neutral contracts for euroclaw durable execution engines.

Use this package for the stable engine shape that the branded `claw.api` composes over and future framework adapters can rely on indirectly.

This package owns only the engine contract:

```ts
type ClawEngineHandle = {
  kind: string
  startRun: (input: EngineStartRunInput) => Promise<{ id: string }>
  continueRun: (input: EngineContinueRunInput) => Promise<{ id: string }>
  work?: () => Promise<unknown>
}

type ClawRunReadModel = {
  get: (id: string) => Promise<EngineRunRecord | null>
  events: (runId: string) => Promise<EngineRunEvent[]>
}

type ClawEngineInstance = {
  engine: ClawEngineHandle
  runs?: ClawRunReadModel
}
```

`@euroclaw/engine-core` does not import `@euroclaw/runtime` and does not know about SQL, Temporal, Vercel Workflow, HTTP, or framework adapters. Concrete engines adapt their own execution backend to this contract.

Current and future implementations include:

- `@euroclaw/engine-sql`: SQL-backed run/task/event/lease engine.
- future `@euroclaw/engine-temporal`: Temporal workflow engine.
- future Vercel Workflow or other managed durable execution engines.

The branded `euroclaw` package exposes execution through protocol-agnostic `claw.api` methods. SQL-specific names such as `store`, `tick`, table names, or task kinds stay inside `@euroclaw/engine-sql` and host wiring.
