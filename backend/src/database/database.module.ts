import { Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaMssql } from '@prisma/adapter-mssql';
import { PrismaClient as PlatformPrismaClient } from '../generated/platform/client.js';
import { PrismaClient as SourcePrismaClient } from '../generated/source/client.js';

function getDatabaseUrl(name: string): string {
  const value = process.env[name];
  if (!value || value.includes('REPLACE_WITH') || !value.startsWith('sqlserver://')) {
    throw new Error(`${name} must be configured with a real SQL Server connection URL.`);
  }
  return value;
}

@Injectable()
export class SourceDatabaseService extends SourcePrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaMssql(getDatabaseUrl('SOURCE_DATABASE_URL')) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

@Injectable()
export class PlatformDatabaseService extends PlatformPrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaMssql(getDatabaseUrl('PLATFORM_DATABASE_URL')) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

@Module({
  providers: [SourceDatabaseService, PlatformDatabaseService],
  exports: [SourceDatabaseService, PlatformDatabaseService],
})
export class DatabaseModule {}
