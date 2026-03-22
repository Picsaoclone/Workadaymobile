import { Task } from '../types/models';

export type EffectiveTaskStatus = Task['status'];

export function getEffectiveTaskStatus(task: Pick<Task, 'status' | 'progress'>): EffectiveTaskStatus {
  if (task.status === 'done' || task.status === 'cancelled') return task.status;
  if (task.progress > 0 && task.status === 'todo') return 'in-progress';
  if (task.progress <= 0 && task.status === 'in-progress') return 'todo';
  return task.status;
}

export function normalizeTaskPatch(currentTask: Pick<Task, 'status' | 'progress'>, patch: Partial<Task>): Partial<Task> {
  const normalized: Partial<Task> = { ...patch };

  const hasStatus = typeof patch.status !== 'undefined';
  const hasProgress = typeof patch.progress === 'number';

  if (hasStatus) {
    if (patch.status === 'todo') {
      normalized.progress = 0;
    }

    if (patch.status === 'in-progress') {
      const nextProgress = hasProgress ? (patch.progress ?? 0) : currentTask.progress;
      if (nextProgress <= 0) normalized.progress = 1;
    }
  } else if (hasProgress) {
    if ((patch.progress ?? 0) > 0 && currentTask.status === 'todo') {
      normalized.status = 'in-progress';
    }

    if ((patch.progress ?? 0) <= 0 && currentTask.status === 'in-progress') {
      normalized.status = 'todo';
    }
  }

  const nextStatus = normalized.status ?? currentTask.status;
  const nextProgress = typeof normalized.progress === 'number' ? normalized.progress : currentTask.progress;

  if (nextStatus === 'todo' && nextProgress > 0) normalized.progress = 0;
  if (nextStatus === 'in-progress' && nextProgress <= 0) normalized.progress = 1;

  return normalized;
}
