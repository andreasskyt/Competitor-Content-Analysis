/**
 * In-memory job store for MVP.
 * Persisted on globalThis to survive HMR in dev.
 */

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface JobProgress {
  step: string;
  pct: number;
}

export interface JobInputs {
  channels: string[];
  topN: number;
  lookbackDays: number;
  whisperFallback: boolean;
  whisperTopK: number;
}

export interface Job {
  id: string;
  createdAt: string;
  status: JobStatus;
  progress: JobProgress;
  inputs: JobInputs;
  downloadUrl?: string;
  error?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __jobStore: Map<string, Job> | undefined;
}

function getStore(): Map<string, Job> {
  if (typeof globalThis.__jobStore === "undefined") {
    globalThis.__jobStore = new Map<string, Job>();
  }
  return globalThis.__jobStore;
}

export function createJob(inputs: JobInputs): Job {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const job: Job = {
    id,
    createdAt: new Date().toISOString(),
    status: "queued",
    progress: { step: "queued", pct: 0 },
    inputs,
  };
  getStore().set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return getStore().get(id);
}

export function updateJob(
  id: string,
  updates: Partial<Pick<Job, "status" | "progress" | "downloadUrl" | "error">>
): void {
  const job = getStore().get(id);
  if (job) {
    Object.assign(job, updates);
  }
}
