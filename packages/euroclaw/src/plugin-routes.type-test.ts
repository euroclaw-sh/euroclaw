// Type-level tests. Run by `tsc --noEmit`; the `.type-test.ts` name keeps Vitest
// from picking this up. A passing typecheck means each `@ts-expect-error` line
// produced the intended compile-time error.

import type { EuroclawPlugin } from "@euroclaw/core";
import { createClaw, type RuntimeConfig } from "./index";

declare const model: RuntimeConfig["model"];

const recruitingWebhook: EuroclawPlugin<"no-cron", ["/telegram/recruiting"]> = {
	id: "channel:telegram:recruiting",
	routes: [
		{
			method: "POST",
			path: "/telegram/recruiting",
			handler: () => ({ body: { ok: true } }),
		},
	],
};

const supportWebhook: EuroclawPlugin<"no-cron", ["/telegram/support"]> = {
	id: "channel:telegram:support",
	routes: [
		{
			method: "POST",
			path: "/telegram/support",
			handler: () => ({ body: { ok: true } }),
		},
	],
};

const duplicateWebhook: EuroclawPlugin<"no-cron", ["/telegram/recruiting"]> = {
	id: "channel:telegram:duplicate",
	routes: [
		{
			method: "POST",
			path: "/telegram/recruiting",
			handler: () => ({ body: { ok: true } }),
		},
	],
};

createClaw({
	model,
	plugins: [recruitingWebhook, supportWebhook],
});

// @ts-expect-error - duplicate literal plugin route paths are rejected.
createClaw({
	model,
	plugins: [recruitingWebhook, duplicateWebhook],
});
