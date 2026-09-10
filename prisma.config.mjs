import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 keeps the runtime connection out of schema.prisma. The CLI
// (migrate / db / studio) reads the URL from here; the application passes its
// own driver adapter to `new PrismaClient()` (see src/db.js).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
