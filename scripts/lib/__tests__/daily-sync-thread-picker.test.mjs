import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickDailySyncTaskTitles } from '../daily-sync-thread-picker.mjs';

const TODAY = '2026-05-06';

function taskArtifact(overrides = {}) {
  const id = overrides.id ?? 'task_x';
  const title = overrides.title ?? id;
  return {
    id,
    type: 'task',
    title,
    frontmatter: {
      id,
      type: 'task',
      title,
      owner: overrides.owner ?? 'fisher',
      status: overrides.status ?? 'ready',
      priority: overrides.priority ?? 'plan',
      due_date: overrides.due_date ?? null,
      created_at: overrides.created_at ?? '2026-01-01',
      updated_at: overrides.updated_at ?? '2026-05-06',
    },
  };
}

describe('pickDailySyncTaskTitles', () => {
  it('uses canonical focus-task ranking instead of input order or updated_at ties', () => {
    const artifacts = [
      taskArtifact({
        id: 'task_low',
        title: 'Low priority active',
        status: 'ready',
        priority: 'routine',
        created_at: '2026-02-01',
        updated_at: '2026-05-06',
      }),
      taskArtifact({
        id: 'task_doing',
        title: 'Actual in-flight work',
        status: 'doing',
        priority: 'plan',
        created_at: '2026-03-01',
        updated_at: '2026-05-06',
      }),
      taskArtifact({
        id: 'task_do',
        title: 'High priority ready work',
        status: 'ready',
        priority: 'do',
        created_at: '2026-04-01',
        updated_at: '2026-05-06',
      }),
    ];

    const titles = pickDailySyncTaskTitles({ artifacts, member: 'fisher', today: TODAY });
    assert.deepEqual(titles, [
      'Actual in-flight work',
      'High priority ready work',
      'Low priority active',
    ]);
  });

  it('drops plan tasks and keeps a deterministic id-based tiebreaker', () => {
    const artifacts = [
      taskArtifact({
        id: 'task_b',
        title: 'Second ready task',
        status: 'ready',
        priority: 'plan',
        created_at: '2026-04-01',
      }),
      taskArtifact({
        id: 'task_plan_only',
        title: 'Backlog idea',
        status: 'plan',
        priority: 'do',
        created_at: '2026-01-01',
      }),
      taskArtifact({
        id: 'task_a',
        title: 'First ready task',
        status: 'ready',
        priority: 'plan',
        created_at: '2026-04-01',
      }),
    ];

    const titles = pickDailySyncTaskTitles({ artifacts, member: 'fisher', today: TODAY });
    assert.deepEqual(titles, ['First ready task', 'Second ready task']);
  });
});
