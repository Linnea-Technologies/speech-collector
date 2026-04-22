import { config } from 'dotenv';
import { readFileSync } from 'fs';
import pkg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pkg;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationFilePath = path.join(currentDir, 'migration.sql');

function createDbClient() {
  config();
  const password = encodeURIComponent(process.env.PG_PASSWORD || '');
  const connString = `postgresql://${process.env.PG_USER}:${password}@${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_DATABASE}`;
  return new Client({ connectionString: connString });
}

async function createTables() {
  const client = createDbClient();
  try {
    await client.connect();
    await client.query(readFileSync(migrationFilePath, 'utf-8'));
  } finally {
    await client.end();
  }
}

function padTopicIndex(value) {
  return String(value).padStart(4, '0');
}

async function pushPrompts(filePath) {
  const client = createDbClient();
  const promptSet = JSON.parse(readFileSync(filePath, 'utf-8'));
  const topicCopies = Number.parseInt(process.env.AINA_TOPIC_COPIES || '100', 10);

  if (!Array.isArray(promptSet.prompts) || promptSet.prompts.length === 0) {
    throw new Error('Prompt file must contain a non-empty prompts array.');
  }

  await client.connect();
  try {
    for (let copyIndex = 1; copyIndex <= topicCopies; copyIndex += 1) {
      const topicSuffix = padTopicIndex(copyIndex);
      const topicId = `${promptSet.dataset_id}_${promptSet.version}_${topicSuffix}`;
      const topicName = `AINA ${promptSet.language.toUpperCase()} short responses ${topicSuffix}`;

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
          {
            dataset_id: promptSet.dataset_id,
            dataset_version: promptSet.version,
            language: promptSet.language,
            prompt_count: promptSet.prompts.length,
          },
        ]
      );

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
            {
              prompt_id: prompt.id,
              label: prompt.label,
              language: promptSet.language,
              category: prompt.category,
              dataset_id: promptSet.dataset_id,
              dataset_version: promptSet.version,
            },
          ]
        );
      }
    }

    console.log(
      `Seeded/upserted ${topicCopies} AINA topics with ${promptSet.prompts.length} prompts each. ` +
      'Increase AINA_TOPIC_COPIES and rerun this command to create more topic copies.'
    );
  } finally {
    await client.end();
  }
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node scripts/aina/pushPrompts.js scripts/aina/short_finnish_prompts.json');
  process.exit(1);
}

await createTables();
await pushPrompts(filePath);
