import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateProgress } from './taskProvider.js';

test('calculateProgress returns total, completed, and remaining counts', () => {
  assert.deepEqual(calculateProgress(9, 3), {
    totalTasks: 9,
    completedTasks: 3,
    remainingTasks: 6,
  });
});

test('calculateProgress never returns a negative remaining count', () => {
  assert.deepEqual(calculateProgress(2, 5), {
    totalTasks: 2,
    completedTasks: 5,
    remainingTasks: 0,
  });
});
