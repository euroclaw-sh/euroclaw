import type { EuroclawPlugin } from "@euroclaw/contracts";
import type { ActivateSkillInput, ReadSkillInput } from "../common/contracts";
import type { SkillActivationRecord, SkillManifest } from "../core";
import type {
	createPersonalSkillInput,
	createPersonalSkillResult,
	readSkillResult,
	skillCatalogEntry,
	skillCatalogInput,
} from "./schema";

export type ReadSkillResult = typeof readSkillResult.infer;
export type CreatePersonalSkillInput = typeof createPersonalSkillInput.infer;
export type CreatePersonalSkillResult = typeof createPersonalSkillResult.infer;
export type SkillCatalogInput = typeof skillCatalogInput.infer;
export type SkillCatalogEntry = typeof skillCatalogEntry.infer;

/**
 * The additive skills surface: browse the catalog, read a skill's manifest, create a private
 * personal skill, and activate an installed skill for a run. The governed plugin extends this with
 * the install/trust/enable/share lifecycle.
 */
export type SimpleSkillsApi = {
	catalog: (input?: SkillCatalogInput) => Promise<SkillCatalogEntry[]>;
	read: (input: ReadSkillInput) => Promise<ReadSkillResult>;
	createPersonal: (
		input: CreatePersonalSkillInput,
	) => Promise<CreatePersonalSkillResult>;
	activate: (input: ActivateSkillInput) => Promise<SkillActivationRecord>;
};

export type SimpleSkillsPlugin<
	Skills extends readonly SkillManifest[] = readonly SkillManifest[],
> = EuroclawPlugin<
	"no-cron",
	readonly string[],
	{ readonly skills: SimpleSkillsApi }
> & {
	readonly $Infer?: {
		readonly skills: Skills[number];
	};
};
