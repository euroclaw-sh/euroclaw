import type { JsonObject } from "@euroclaw/contracts";
import { redactionContextFrom } from "@euroclaw/contracts";
import type { Governance } from "@euroclaw/core";
import { stateError } from "@euroclaw/errors";
import type { LanguageModelMiddleware } from "ai";
import type { RuntimeModel } from "./runtime";
import type { RunState } from "./tools";

/** AI SDK middleware for the model boundary: redact prompt before provider egress, then run core model boundary. */
export function modelMiddleware(
	core: Governance,
	model: RuntimeModel,
	ctx: Record<string, unknown> | undefined,
	resolvedCtx: Record<string, unknown>,
	state: RunState,
): LanguageModelMiddleware {
	return {
		transformParams: async ({ params }) => ({
			...params,
			prompt: await core.redactor.redactValue(
				params.prompt,
				redactionContextFrom(resolvedCtx),
			),
		}),
		wrapGenerate: async ({ doGenerate, params }) => {
			state.currentModelRunner = doGenerate;
			try {
				const candidate = model as { provider?: unknown; modelId?: unknown };
				const source = params as Record<string, unknown>;
				const parameters: JsonObject = {};
				for (const key of [
					"maxOutputTokens",
					"temperature",
					"topP",
					"topK",
					"seed",
				]) {
					const value = source[key];
					if (typeof value === "number" && Number.isFinite(value)) {
						parameters[key] = value;
					}
				}
				const messages = (
					Array.isArray(params.prompt)
						? params.prompt
						: [{ role: "user", content: params.prompt }]
				).map((message) => {
					const value = message as { role?: unknown; content?: unknown };
					const parts = Array.isArray(value.content)
						? value.content
						: [value.content];
					return {
						role: typeof value.role === "string" ? value.role : "user",
						content: parts
							.map((part) => {
								if (typeof part === "string") return part;
								const p = part as { text?: unknown };
								return typeof p?.text === "string" ? p.text : "";
							})
							.filter(Boolean)
							.join("\n"),
					};
				});
				const result = await core.handleModelCall(
					{
						provider:
							typeof candidate.provider === "string"
								? candidate.provider
								: undefined,
						model:
							typeof candidate.modelId === "string"
								? candidate.modelId
								: undefined,
						parameters,
						messages,
					},
					ctx,
				);
				if (result.status === "ok")
					return result.output as Awaited<ReturnType<typeof doGenerate>>;
				throw stateError("model boundary gate denied model call", {
					status: result.status,
					gateId: result.gateId,
					reason: result.reason,
					reasonCode: result.reasonCode,
				});
			} finally {
				state.currentModelRunner = undefined;
			}
		},
	};
}
