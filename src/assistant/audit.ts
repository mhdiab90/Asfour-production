/**
 * Assistant action audit trail. Reuses the EXISTING auditLogs mechanism
 * (src/services/auditService.ts) rather than introducing a second audit
 * system - the assistant's structured fields are encoded into the existing
 * free-text `details` field. Never stores API keys, passwords, or tokens.
 */
import { logAuditAction } from '../services/auditService';
import { AssistantActionAuditEntry } from './types';

function generateAssistantActionId(): string {
  return `AST-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export async function auditAssistantAction(
  entry: Omit<AssistantActionAuditEntry, 'assistantActionId' | 'timestamp'>
): Promise<string> {
  const assistantActionId = generateAssistantActionId();
  const timestamp = new Date().toISOString();

  const details = JSON.stringify({
    assistantActionId,
    timestamp,
    screen: entry.screen,
    module: entry.module,
    tool: entry.tool,
    safeParametersSummary: entry.safeParametersSummary,
    result: entry.result,
    affectedCount: entry.affectedCount,
    success: entry.success,
    confirmationUsed: entry.confirmationUsed,
    provider: entry.provider,
    // §23 - per-item breakdown (requestedValue/status/decision/result); never secrets.
    itemResults: entry.itemResults,
  });

  try {
    await logAuditAction('UPDATE', 'aiAssistantActions', assistantActionId, details);
  } catch {
    // Audit failures must never block the assistant's response to the user.
  }

  return assistantActionId;
}
