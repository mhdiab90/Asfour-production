/**
 * Central, typed Tool Registry. This is the ONLY set of operations the AI
 * provider can ever invoke - there is no "arbitrary database tool" and no
 * path from the AI provider to raw Firestore access or arbitrary JS.
 */
import { ToolDefinition, ToolSummary } from '../types';

const registry = new Map<string, ToolDefinition>();

export function registerTool(tool: ToolDefinition): void {
  if (registry.has(tool.toolName)) {
    throw new Error(`Assistant tool "${tool.toolName}" is already registered.`);
  }
  registry.set(tool.toolName, tool);
}

export function getTool(toolName: string): ToolDefinition | undefined {
  return registry.get(toolName);
}

export function listTools(): ToolDefinition[] {
  return Array.from(registry.values());
}

export function listToolSummaries(): ToolSummary[] {
  return listTools().map((t) => ({
    toolName: t.toolName,
    descriptionAr: t.descriptionAr,
    descriptionEn: t.descriptionEn,
    commandType: t.commandType,
    parameterSchema: t.parameterSchema,
  }));
}

/** Test/dev helper only - never used in application flow. */
export function _clearRegistryForTests(): void {
  registry.clear();
}
