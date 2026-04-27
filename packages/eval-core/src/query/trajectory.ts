import { and, avg, count, desc, eq, gte, max, or, sql } from 'drizzle-orm';
import type { EvalDb } from '../db/client.js';
import { agentInvocations, evalBaselines } from '../db/schema.js';
import type {
  TrajectoryAnalysis,
  TrajectoryBaseline,
  TrajectoryInvocation,
  TrajectoryQueryOptions,
} from './types.js';

function mapAgentName(row: { agentName: string | null; agentType: string }): string {
  return row.agentName ?? row.agentType;
}

export function getTrajectoryBaselines(
  db: EvalDb,
  options: Pick<TrajectoryQueryOptions, 'baselineId' | 'capability' | 'limit'> = {}
): TrajectoryBaseline[] {
  const conditions = [
    options.baselineId !== undefined ? eq(evalBaselines.id, options.baselineId) : undefined,
    options.capability ? eq(evalBaselines.capability, options.capability) : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

  let query = db
    .select()
    .from(evalBaselines)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(evalBaselines.createdAt))
    .$dynamic();

  if (options.limit !== undefined) {
    query = query.limit(options.limit);
  }

  return query.all();
}

export function getTrajectoryInvocations(
  db: EvalDb,
  options: TrajectoryQueryOptions = {}
): TrajectoryInvocation[] {
  const conditions = [
    options.baselineId !== undefined ? eq(agentInvocations.baselineId, options.baselineId) : undefined,
    options.capability ? eq(evalBaselines.capability, options.capability) : undefined,
    options.agentName
      ? or(eq(agentInvocations.agentName, options.agentName), eq(agentInvocations.agentType, options.agentName))
      : undefined,
    options.model ? eq(agentInvocations.model, options.model) : undefined,
    options.since ? gte(agentInvocations.timestamp, options.since) : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

  let query = db
    .select({
      id: agentInvocations.id,
      baselineId: agentInvocations.baselineId,
      taskId: evalBaselines.taskId,
      capability: evalBaselines.capability,
      agentType: agentInvocations.agentType,
      agentName: agentInvocations.agentName,
      model: agentInvocations.model,
      observedSteps: agentInvocations.observedSteps,
      observedToolCalls: agentInvocations.observedToolCalls,
      observedLatencyMs: agentInvocations.observedLatencyMs,
      correctness: agentInvocations.correctness,
      stepRatio: agentInvocations.stepRatio,
      toolCallRatio: agentInvocations.toolCallRatio,
      latencyRatio: agentInvocations.latencyRatio,
      sessionId: agentInvocations.sessionId,
      startedAt: agentInvocations.startedAt,
      completedAt: agentInvocations.completedAt,
      timestamp: agentInvocations.timestamp,
    })
    .from(agentInvocations)
    .leftJoin(evalBaselines, eq(agentInvocations.baselineId, evalBaselines.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(agentInvocations.timestamp))
    .$dynamic();

  if (options.limit !== undefined) {
    query = query.limit(options.limit);
  }

  return query.all().map((row) => ({
    id: row.id,
    baselineId: row.baselineId ?? null,
    taskId: row.taskId ?? null,
    capability: row.capability ?? null,
    agentName: mapAgentName(row),
    model: row.model,
    observedSteps: row.observedSteps ?? null,
    observedToolCalls: row.observedToolCalls ?? null,
    observedLatencyMs: row.observedLatencyMs ?? null,
    correctness: row.correctness ?? null,
    stepRatio: row.stepRatio ?? null,
    toolCallRatio: row.toolCallRatio ?? null,
    latencyRatio: row.latencyRatio ?? null,
    sessionId: row.sessionId ?? null,
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    timestamp: row.timestamp,
  }));
}

export function getTrajectoryAnalysis(
  db: EvalDb,
  options: Pick<TrajectoryQueryOptions, 'baselineId' | 'capability' | 'model' | 'since' | 'limit'> = {}
): TrajectoryAnalysis[] {
  const conditions = [
    options.baselineId !== undefined ? eq(evalBaselines.id, options.baselineId) : undefined,
    options.capability ? eq(evalBaselines.capability, options.capability) : undefined,
    options.model ? eq(agentInvocations.model, options.model) : undefined,
    options.since ? gte(agentInvocations.timestamp, options.since) : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

  let query = db
    .select({
      baselineId: evalBaselines.id,
      taskId: evalBaselines.taskId,
      capability: evalBaselines.capability,
      invocationCount: count(agentInvocations.id),
      avgCorrectness: avg(agentInvocations.correctness),
      avgStepRatio: avg(agentInvocations.stepRatio),
      avgToolCallRatio: avg(agentInvocations.toolCallRatio),
      avgLatencyRatio: avg(agentInvocations.latencyRatio),
      avgObservedSteps: avg(agentInvocations.observedSteps),
      avgObservedToolCalls: avg(agentInvocations.observedToolCalls),
      avgObservedLatencyMs: avg(agentInvocations.observedLatencyMs),
      bestCorrectness: max(agentInvocations.correctness),
      lastInvocationAt: max(agentInvocations.timestamp),
    })
    .from(evalBaselines)
    .leftJoin(agentInvocations, eq(agentInvocations.baselineId, evalBaselines.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(evalBaselines.id)
    .orderBy(desc(sql`coalesce(max(${agentInvocations.timestamp}), ${evalBaselines.createdAt})`))
    .$dynamic();

  if (options.limit !== undefined) {
    query = query.limit(options.limit);
  }

  return query.all().map((row) => ({
    baselineId: row.baselineId,
    taskId: row.taskId,
    capability: row.capability,
    invocationCount: row.invocationCount,
    avgCorrectness: row.avgCorrectness === null ? null : Number(row.avgCorrectness),
    avgStepRatio: row.avgStepRatio === null ? null : Number(row.avgStepRatio),
    avgToolCallRatio: row.avgToolCallRatio === null ? null : Number(row.avgToolCallRatio),
    avgLatencyRatio: row.avgLatencyRatio === null ? null : Number(row.avgLatencyRatio),
    avgObservedSteps: row.avgObservedSteps === null ? null : Number(row.avgObservedSteps),
    avgObservedToolCalls:
      row.avgObservedToolCalls === null ? null : Number(row.avgObservedToolCalls),
    avgObservedLatencyMs:
      row.avgObservedLatencyMs === null ? null : Number(row.avgObservedLatencyMs),
    bestCorrectness: row.bestCorrectness ?? null,
    lastInvocationAt: row.lastInvocationAt ?? null,
  }));
}
