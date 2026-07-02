import type { SkillManifest, SkillsPluginConfig } from "../common/contracts";
import { buildSkillsPlugin } from "../common/plugin";
import { createSimpleSkillsApi } from "./api";
import type { SimpleSkillsPlugin } from "./contracts";

/**
 * The additive skills plugin: the shared plugin shell wired to the additive api surface
 * ({@link createSimpleSkillsApi}). Use the governed plugin instead for the install/share lifecycle.
 */
export function skillsPlugin<const Skills extends readonly SkillManifest[]>(
	config: SkillsPluginConfig<Skills>,
): SimpleSkillsPlugin<Skills> {
	return buildSkillsPlugin(config, createSimpleSkillsApi);
}
