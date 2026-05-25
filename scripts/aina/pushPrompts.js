import { config } from 'dotenv';
import { readFileSync } from 'fs';
import pkg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pkg;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationFilePath = path.join(currentDir, 'migration.sql');

export function createDbClient() {
  config();
  const password = encodeURIComponent(process.env.PG_PASSWORD || '');
  const connString = `postgresql://${process.env.PG_USER}:${password}@${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_DATABASE}`;
  return new Client({ connectionString: connString });
}

export async function createTables() {
  const client = createDbClient();
  try {
    await client.connect();
    await client.query(readFileSync(migrationFilePath, 'utf-8'));
  } finally {
    await client.end();
  }
}

export function padTopicIndex(value) {
  return String(value).padStart(4, '0');
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Prompt file field ${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeArray(value, fieldName) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Prompt file field ${fieldName} must be an array.`);
  }

  return value;
}

export function validatePromptSet(promptSet) {
  if (!promptSet || typeof promptSet !== 'object' || Array.isArray(promptSet)) {
    throw new Error('Prompt file must be a JSON object.');
  }

  const datasetId = normalizeRequiredString(promptSet.dataset_id, 'dataset_id');
  const version = normalizeRequiredString(promptSet.version, 'version');
  const language = normalizeRequiredString(promptSet.language, 'language');
  const prompts = normalizeArray(promptSet.prompts, 'prompts');

  if (prompts.length === 0) {
    throw new Error('Prompt file must contain a non-empty prompts array.');
  }

  const seenPromptIds = new Set();
  const seenPhraseIds = new Set();
  for (const [index, prompt] of prompts.entries()) {
    if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
      throw new Error(`Prompt at index ${index} must be an object.`);
    }

    const promptId = normalizeRequiredString(prompt.id, `prompts[${index}].id`);
    const phraseId = normalizeRequiredString(
      prompt.phrase_id || prompt.id,
      `prompts[${index}].phrase_id`
    );
    normalizeRequiredString(prompt.label, `prompts[${index}].label`);
    normalizeRequiredString(prompt.text, `prompts[${index}].text`);
    normalizeRequiredString(prompt.category, `prompts[${index}].category`);

    if (seenPromptIds.has(promptId)) {
      throw new Error(`Duplicate prompt id in prompt file: ${promptId}`);
    }
    seenPromptIds.add(promptId);

    if (seenPhraseIds.has(phraseId)) {
      throw new Error(`Duplicate phrase_id in prompt file: ${phraseId}`);
    }
    seenPhraseIds.add(phraseId);
  }

  const categoryOrder = normalizeArray(promptSet.category_order, 'category_order').map((value, index) =>
    normalizeRequiredString(value, `category_order[${index}]`)
  );
  const categories = normalizeArray(promptSet.categories, 'categories').map((category, index) => {
    if (!category || typeof category !== 'object' || Array.isArray(category)) {
      throw new Error(`Category at index ${index} must be an object.`);
    }

    return {
      id: normalizeRequiredString(category.id, `categories[${index}].id`),
      title: normalizeRequiredString(category.title, `categories[${index}].title`),
      required_count:
        Number.isFinite(Number(category.required_count)) && Number(category.required_count) > 0
          ? Number(category.required_count)
          : 3,
    };
  });

  return {
    ...promptSet,
    dataset_id: datasetId,
    version,
    language,
    category_order: categoryOrder,
    categories,
    prompts,
    control_labels: normalizeArray(promptSet.control_labels, 'control_labels').map((value, index) =>
      normalizeRequiredString(value, `control_labels[${index}]`)
    ),
  };
}

export function buildTopicId(promptSet, copyIndex) {
  return `${promptSet.dataset_id}_${promptSet.version}_${padTopicIndex(copyIndex)}`;
}

export function buildTopicMetadata(promptSet) {
  return {
    dataset_id: promptSet.dataset_id,
    dataset_version: promptSet.version,
    language: promptSet.language,
    prompt_count: promptSet.prompts.length,
    category_order: promptSet.category_order,
    categories: promptSet.categories,
    control_labels: promptSet.control_labels,
  };
}

export function buildTaskMetadata(promptSet, prompt) {
  return {
    prompt_id: prompt.id,
    phrase_id: prompt.phrase_id || prompt.id,
    label: prompt.label,
    semantic_label: normalizeOptionalString(prompt.semantic_label),
    language: promptSet.language,
    category: prompt.category,
    dataset_id: promptSet.dataset_id,
    dataset_version: promptSet.version,
  };
}

async function removeObsoleteTasks(client, topicId, desiredTaskIds) {
  const obsoleteResult = await client.query(
    `
      SELECT
        tk.id,
        COUNT(r.id)::integer AS recording_count
      FROM tasks tk
      LEFT JOIN recordings r
        ON r.task_id = tk.id
      WHERE tk.topic_id = $1
        AND NOT (tk.id = ANY($2::text[]))
      GROUP BY tk.id
      ORDER BY tk.id ASC
    `,
    [topicId, desiredTaskIds]
  );

  if (obsoleteResult.rowCount === 0) {
    return 0;
  }

  const tasksWithRecordings = obsoleteResult.rows.filter((row) => row.recording_count > 0);
  if (tasksWithRecordings.length > 0) {
    throw new Error(
      `Refusing to delete obsolete task(s) with recordings in ${topicId}: ` +
        tasksWithRecordings.map((row) => row.id).join(', ') +
        '. Reset or archive collection data before reseeding this prompt version.'
    );
  }

  const deleteResult = await client.query(
    `
      DELETE FROM tasks
      WHERE topic_id = $1
        AND NOT (id = ANY($2::text[]))
    `,
    [topicId, desiredTaskIds]
  );

  return deleteResult.rowCount;
}

async function moveExistingTasksOutOfTaskIdxRange(client, topicId, desiredTaskIds) {
  await client.query(
    `
      UPDATE tasks
      SET task_idx = task_idx - 1000000
      WHERE topic_id = $1
        AND id = ANY($2::text[])
    `,
    [topicId, desiredTaskIds]
  );
}

export async function pushPrompts(filePath) {
  const client = createDbClient();
  const promptSet = validatePromptSet(JSON.parse(readFileSync(filePath, 'utf-8')));
  const topicCopies = Number.parseInt(process.env.AINA_TOPIC_COPIES || '100', 10);

  await client.connect();
  let deletedObsoleteTaskCount = 0;
  try {
    await client.query('BEGIN');

    for (let copyIndex = 1; copyIndex <= topicCopies; copyIndex += 1) {
      const topicSuffix = padTopicIndex(copyIndex);
      const topicId = buildTopicId(promptSet, copyIndex);
      const topicName = `AINA ${promptSet.language.toUpperCase()} short responses ${promptSet.version} ${topicSuffix}`;
      const desiredTaskIds = promptSet.prompts.map((prompt) => `${topicId}_${prompt.id}`);

      await client.query(
        `
          INSERT INTO topics (id, name, task_count, metadata)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              task_count = EXCLUDED.task_count,
              metadata = EXCLUDED.metadata
        `,
        [
          topicId,
          topicName,
          promptSet.prompts.length,
          buildTopicMetadata(promptSet),
        ]
      );

      deletedObsoleteTaskCount += await removeObsoleteTasks(client, topicId, desiredTaskIds);
      await moveExistingTasksOutOfTaskIdxRange(client, topicId, desiredTaskIds);

      for (const [taskIdx, prompt] of promptSet.prompts.entries()) {
        const taskId = `${topicId}_${prompt.id}`;
        await client.query(
          `
            INSERT INTO tasks (id, topic_id, task_idx, text, metadata)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO UPDATE
            SET text = EXCLUDED.text,
                task_idx = EXCLUDED.task_idx,
                metadata = EXCLUDED.metadata
          `,
          [
            taskId,
            topicId,
            taskIdx,
            prompt.text,
            buildTaskMetadata(promptSet, prompt),
          ]
        );
      }
    }

    await client.query('COMMIT');

    console.log(
      `Seeded/upserted ${topicCopies} AINA topics with ${promptSet.prompts.length} prompts each. ` +
        `${deletedObsoleteTaskCount} obsolete task(s) without recordings were removed. ` +
        'Increase AINA_TOPIC_COPIES and rerun this command to create more topic copies.'
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

const currentPath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (entryPath === currentPath) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/aina/pushPrompts.js scripts/aina/short_finnish_prompts.json');
    process.exit(1);
  }

  await createTables();
  await pushPrompts(filePath);
}
