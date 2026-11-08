// Which provider serves a catalog image model, decided from its route and group.
//
// The generate route looks the requested model up in the (database-backed) catalog first. Rows in
// the "OpenAI Images" group used to be sent to OpenAI directly just because of the group name, but
// GPT Image 2.5 / 2.6 live in that group and are served by WaveSpeed (openai/gpt-image-2.x-*/...).
// Sending their site id to OpenAI fails, and skips the GPT Image pricing and tier checks.
// Keep this decision in one tested place.

import { isWaveSpeedGptImageModelId } from "@/lib/image-models";

export type DynamicImageProvider = "google" | "openai" | "wavespeed";

export function pickDynamicImageProvider(targetApiRoute: string, group?: string | null): DynamicImageProvider {
  if (isWaveSpeedGptImageModelId(targetApiRoute)) return "wavespeed";
  if (/^(google|gemini|imagen)/i.test(targetApiRoute) || /google/i.test(group || "")) return "google";
  if (/^(openai|dall-e)/i.test(targetApiRoute) || /openai/i.test(group || "")) return "openai";
  return "wavespeed";
}
