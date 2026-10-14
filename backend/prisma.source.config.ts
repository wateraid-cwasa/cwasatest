import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/source/schema.prisma',
  datasource: {
    url: env('SOURCE_DATABASE_URL'),
  },
});
