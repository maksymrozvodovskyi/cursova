import type { Context } from "telegraf";
import type { Scenes } from "telegraf";
import type { BuildRecommendation } from "../ai/client";
import type { BuildResult } from "./index";

export interface PendingOptimizeFromDraft {
  lastBuild: BuildRecommendation;
  useCase: string;
  budget: number;
}

export interface ResumeBuildPostMenu {
  draftBuild: BuildResult;
  budget: number;
  useCase: string;
}

export interface BuildWizardState {
  budget?: number;
  optimizeLocked?: boolean;
}

export interface OptimizeWizardState {
  lastBuild?: BuildRecommendation;
  useCase?: string;
  sourceBudget?: number;
}

export interface BotSceneSessionData extends Scenes.WizardSessionData {
  state: BuildWizardState & OptimizeWizardState;
}

export interface BotSessionData extends Scenes.WizardSession<BotSceneSessionData> {
  pendingOptimizeFromDraft?: PendingOptimizeFromDraft;
  resumeBuildPostMenu?: ResumeBuildPostMenu;
}

export interface BotContext extends Context {
  session: BotSessionData;
  scene: Scenes.SceneContextScene<BotContext, BotSceneSessionData>;
  wizard: Scenes.WizardContextWizard<BotContext>;
}
