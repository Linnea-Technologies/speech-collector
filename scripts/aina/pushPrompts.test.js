import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  buildTaskMetadata,
  buildTopicId,
  buildTopicMetadata,
  validatePromptSet,
} from './pushPrompts.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const promptFilePath = path.join(currentDir, 'short_finnish_prompts.json');

test('v2 prompt seed contains category phrase metadata', () => {
  const promptSet = validatePromptSet(JSON.parse(readFileSync(promptFilePath, 'utf-8')));
  const yesPrompt = promptSet.prompts.find((prompt) => prompt.id === 'yes_kylla');
  const numberPrompt = promptSet.prompts.find((prompt) => prompt.id === 'number_kaks');

  assert.equal(promptSet.version, 'v2');
  assert.deepEqual(promptSet.category_order, [
    'yes',
    'no',
    'maybe',
    'dont_know',
    'correct',
    'number',
  ]);
  assert.equal(promptSet.categories.find((category) => category.id === 'correct')?.required_count, 3);
  assert.equal(yesPrompt.text, 'Kyllä');
  assert.equal(yesPrompt.phrase_id, 'yes_kylla');
  assert.equal(yesPrompt.label, 'kylla');
  assert.equal(yesPrompt.semantic_label, 'yes');
  assert.equal(numberPrompt.label, 'kaks');
  assert.equal(numberPrompt.semantic_label, 'number_2');
  assert.deepEqual(promptSet.control_labels, ['unknown', 'silence', 'noise']);
});

test('topic metadata stores category order and categories', () => {
  const promptSet = validatePromptSet(JSON.parse(readFileSync(promptFilePath, 'utf-8')));
  const topicMetadata = buildTopicMetadata(promptSet);

  assert.equal(buildTopicId(promptSet, 1), 'short_finnish_responses_v2_0001');
  assert.equal(topicMetadata.dataset_version, 'v2');
  assert.equal(topicMetadata.prompt_count, promptSet.prompts.length);
  assert.deepEqual(topicMetadata.category_order, promptSet.category_order);
  assert.equal(topicMetadata.categories.find((category) => category.id === 'number')?.title, 'Numbers');
});

test('task metadata stores phrase_id and semantic_label from prompt rows', () => {
  const promptSet = validatePromptSet(JSON.parse(readFileSync(promptFilePath, 'utf-8')));
  const prompt = promptSet.prompts.find((entry) => entry.id === 'dont_know_en_tiia');
  const taskMetadata = buildTaskMetadata(promptSet, prompt);

  assert.deepEqual(taskMetadata, {
    prompt_id: 'dont_know_en_tiia',
    phrase_id: 'dont_know_en_tiia',
    label: 'en_tiia',
    semantic_label: 'dont_know',
    language: 'fi',
    category: 'dont_know',
    dataset_id: 'short_finnish_responses',
    dataset_version: 'v2',
  });
});

test('validatePromptSet rejects duplicate phrase IDs', () => {
  assert.throws(
    () =>
      validatePromptSet({
        dataset_id: 'short_finnish_responses',
        version: 'v2',
        language: 'fi',
        prompts: [
          {
            id: 'first',
            phrase_id: 'duplicate',
            label: 'first',
            text: 'First',
            category: 'yes',
          },
          {
            id: 'second',
            phrase_id: 'duplicate',
            label: 'second',
            text: 'Second',
            category: 'yes',
          },
        ],
      }),
    /Duplicate phrase_id/
  );
});
