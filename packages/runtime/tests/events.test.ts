import type {
	EuroclawPlugin,
	EuroclawPluginConfigureContext,
} from "@euroclaw/contracts";
import { describe, expect, it } from "vitest";
import { pluginEventSink, type RuntimeEventSink } from "../src/events";

// A recorder standing in for a real runtime sink (durable, in-memory, etc.).
function recordingSink() {
	const observed: { type: string }[] = [];
	const sink: RuntimeEventSink = {
		emit(event) {
			observed.push(event);
		},
	};
	return { sink, observed };
}

describe("pluginEventSink", () => {
	it("forwards plugin-emitted events to the runtime sinks", async () => {
		const a = recordingSink();
		const b = recordingSink();
		const context: EuroclawPluginConfigureContext = {
			events: pluginEventSink([a.sink, b.sink]),
		};

		const plugin: EuroclawPlugin = {
			id: "emitter",
			configure(ctx) {
				void ctx.events?.emit({ type: "skill.demo", skillId: "s1" });
				return undefined;
			},
		};

		plugin.configure?.(context);
		// emit may be async on the sink side; let microtasks flush.
		await Promise.resolve();

		expect(a.observed).toEqual([{ type: "skill.demo", skillId: "s1" }]);
		expect(b.observed).toEqual([{ type: "skill.demo", skillId: "s1" }]);
	});

	it("awaits async sinks for every event", async () => {
		const order: string[] = [];
		const slow: RuntimeEventSink = {
			async emit(event) {
				await Promise.resolve();
				order.push(event.type);
			},
		};
		const port = pluginEventSink([slow]);

		await port.emit({ type: "a" });
		await port.emit({ type: "b" });

		expect(order).toEqual(["a", "b"]);
	});

	it("leaves a plugin that never touches events untouched", () => {
		const { sink, observed } = recordingSink();
		const context: EuroclawPluginConfigureContext = {
			events: pluginEventSink([sink]),
		};

		const plugin: EuroclawPlugin = {
			id: "quiet",
			configure() {
				return undefined;
			},
		};

		expect(() => plugin.configure?.(context)).not.toThrow();
		expect(observed).toEqual([]);
	});

	it("works when no events port is provided (optional)", () => {
		const context: EuroclawPluginConfigureContext = {};
		const plugin: EuroclawPlugin = {
			id: "optional",
			configure(ctx) {
				void ctx.events?.emit({ type: "skill.demo" });
				return undefined;
			},
		};

		expect(() => plugin.configure?.(context)).not.toThrow();
	});
});
