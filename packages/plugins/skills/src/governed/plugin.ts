import type { SkillManifest, SkillsPluginConfig } from "../common/contracts";
import { buildSkillsPlugin } from "../common/plugin";
import { createGovernedSkillsApi } from "./api";
import type { GovernedSkillsPlugin } from "./contracts";

/**
 * The full governed skills plugin: the same plugin shell as {@link skillsPlugin} (active-skill
 * resolution + opt-in allowed-tools gate), but exposing the governed lifecycle API. Being on the
 * governed plugin is the opt-in — there is no mode flag.
 */
export function governedSkillsPlugin<
	const Skills extends readonly SkillManifest[],
>(config: SkillsPluginConfig<Skills>): GovernedSkillsPlugin<Skills> {
	return buildSkillsPlugin(config, createGovernedSkillsApi);
}
