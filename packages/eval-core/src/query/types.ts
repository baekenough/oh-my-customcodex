export interface ProjectStats {
  id: number;
  name: string;
  cwd: string;
  lastSeenAt: string;
  createdAt: string;
  sessionCount: number;
  totalTurns: number;
  totalInvocations: number;
}

export interface SessionStats {
  id: number;
  sessionId: string;
  projectId: number | null;
  projectName: string | null;
  startedAt: string;
  endedAt: string | null;
  cwd: string | null;
  durationMs: number | null;
  turnCount: number;
  invocationCount: number;
  estimatedCostUsd: number | null;
}

export interface AgentStat {
  agentType: string;
  totalInvocations: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  lastUsed: string;
}

export interface DashboardStats {
  totalSessions: number;
  totalTurns: number;
  totalInvocations: number;
  totalProjects: number;
  recentSessions: SessionStats[];
  topAgents: AgentStat[];
}

export interface TrajectoryBaseline {
  id: number;
  taskId: string;
  capability: string;
  idealSteps: number | null;
  idealToolCalls: number | null;
  idealLatencyMs: number | null;
  description: string | null;
  createdAt: string;
}

export interface TrajectoryInvocation {
  id: number;
  baselineId: number | null;
  taskId: string | null;
  capability: string | null;
  agentName: string;
  model: string;
  observedSteps: number | null;
  observedToolCalls: number | null;
  observedLatencyMs: number | null;
  correctness: number | null;
  stepRatio: number | null;
  toolCallRatio: number | null;
  latencyRatio: number | null;
  sessionId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  timestamp: string;
}

export interface TrajectoryAnalysis {
  baselineId: number;
  taskId: string;
  capability: string;
  invocationCount: number;
  avgCorrectness: number | null;
  avgStepRatio: number | null;
  avgToolCallRatio: number | null;
  avgLatencyRatio: number | null;
  avgObservedSteps: number | null;
  avgObservedToolCalls: number | null;
  avgObservedLatencyMs: number | null;
  bestCorrectness: number | null;
  lastInvocationAt: string | null;
}

export interface TrajectoryQueryOptions {
  baselineId?: number;
  capability?: string;
  agentName?: string;
  model?: string;
  since?: string;
  limit?: number;
}
