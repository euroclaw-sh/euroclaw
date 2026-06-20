// Type-level tests. Run by `tsc --noEmit`; the `.type-test.ts` name keeps Vitest
// from picking this up. A passing typecheck means each `@ts-expect-error` line
// produced the intended compile-time error.

import type { EuroclawPlugin } from "@euroclaw/core";
import { type SqlEngineStore, sqlEngine } from "@euroclaw/engine-sql";
import { createClaw, type RuntimeConfig } from "./index";

declare const model: RuntimeConfig["model"];
declare const store: SqlEngineStore;

createClaw({
	cronHandler: { secret: "secret" },
	engine: sqlEngine({ store }),
	model,
});

createClaw({
	cronHandler: false,
	engine: sqlEngine({ store }),
	model,
});

createClaw({
	engine: sqlEngine({ cron: false, store }),
	model,
});

// @ts-expect-error - SQL contributes cron work by default, so cronHandler is required.
createClaw({
	engine: sqlEngine({ store }),
	model,
});

const cronPlugin: EuroclawPlugin<"has-cron"> = {
	id: "channel:telegram",
	cron: [
		{
			id: "channel:telegram:poll",
			handler: () => ({ status: "idle" as const }),
		},
	],
};

createClaw({
	cronHandler: { secret: "secret" },
	model,
	plugins: [cronPlugin],
});

// @ts-expect-error - cron-capable plugins require createClaw({ cronHandler }).
createClaw({
	model,
	plugins: [cronPlugin],
});

const webhookOnlyPlugin: EuroclawPlugin<"no-cron"> = {
	id: "channel:telegram",
};

createClaw({
	model,
	plugins: [webhookOnlyPlugin],
});
