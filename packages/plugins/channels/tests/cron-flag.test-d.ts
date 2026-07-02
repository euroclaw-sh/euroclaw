// Type tests (vitest typecheck mode). Prove that channels() derives its cron requirement from the
// channels' poll flags at compile time: a webhook-only registry needs no cronHandler, a poll registry
// makes createClaw's RequireCronHandler demand one. A passing run means each @ts-expect-error errored.
import { createClaw, type RuntimeConfig } from "euroclaw";
import { describe, test } from "vitest";
import { channels, telegram } from "../src/index";

declare const model: RuntimeConfig["model"];

describe("channels cron-handler requirement", () => {
	test("a webhook-only channel registry needs no cronHandler", () => {
		createClaw({ model, plugins: [channels([telegram({ tenantId: "t" })])] });
		createClaw({
			model,
			plugins: [channels([telegram({ tenantId: "t", mode: "webhook" })])],
		});
	});

	test("a poll channel requires cronHandler, statically", () => {
		// @ts-expect-error — a poll channel contributes cron, so cronHandler is required
		createClaw({
			model,
			plugins: [channels([telegram({ tenantId: "t", mode: "poll" })])],
		});
		// with a cronHandler it type-checks
		createClaw({
			cronHandler: { secret: "s" },
			model,
			plugins: [channels([telegram({ tenantId: "t", mode: "poll" })])],
		});
	});

	test("a mixed registry with any poller requires cronHandler", () => {
		// @ts-expect-error — one poll channel in the list is enough to require cronHandler
		createClaw({
			model,
			plugins: [
				channels([
					telegram({ tenantId: "a", mode: "webhook" }),
					telegram({ tenantId: "b", mode: "poll" }),
				]),
			],
		});
	});
});
