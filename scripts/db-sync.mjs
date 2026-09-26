// Runs during `npm run build`. Demo builds need no database; shared/live builds sync the schema and seed idempotently.
import { execSync } from 'node:child_process';
const mode = process.env.NEXT_PUBLIC_APP_MODE || 'demo';
if (mode === 'demo' || !process.env.DATABASE_URL) {
  console.log(`[db-sync] skipped (mode=${mode}, DATABASE_URL ${process.env.DATABASE_URL ? 'set' : 'missing'})`);
} else {
  execSync('npx prisma db push --skip-generate', { stdio: 'inherit' });
  execSync('node --import tsx prisma/seed.ts', { stdio: 'inherit' });
}
