import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG, AppConfig } from './config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    // Sesión siempre en UTC: el adaptador lee mal las fechas si el servidor de PostgreSQL usa otra zona horaria.
    super({ adapter: new PrismaPg({ connectionString: config.databaseUrl, max: 10, options: '-c TimeZone=UTC' }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

export type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];
