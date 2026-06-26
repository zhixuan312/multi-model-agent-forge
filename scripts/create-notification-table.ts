import 'dotenv/config';
import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await sql`
    CREATE TABLE IF NOT EXISTS forge.ops_notification (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id uuid REFERENCES forge.team_member(id) ON DELETE CASCADE,
      kind text NOT NULL,
      title text NOT NULL,
      subtitle text,
      source_id text,
      read_at timestamp with time zone,
      dismissed_at timestamp with time zone,
      created_at timestamp with time zone NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS notification_member_feed_idx ON forge.ops_notification (member_id, dismissed_at, created_at DESC)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS notification_source_dedup_idx ON forge.ops_notification (source_id) WHERE source_id IS NOT NULL`;
  console.log('ops_notification table created.');
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
