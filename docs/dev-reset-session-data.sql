-- Reset local/dev session usage without deleting seeded topics or tasks.
-- This makes the existing topic copies available again for fresh testing.

BEGIN;

DELETE FROM recordings;
DELETE FROM participant_sessions;

COMMIT;
