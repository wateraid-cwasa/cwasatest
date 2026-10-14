import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../database/database.module.js';
import { CustomerAuthController } from './customer-auth.controller.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { CustomerDataController } from './customer-data.controller.js';
import { CustomerDataService } from './customer-data.service.js';
import { CustomerJwtAccessGuard } from './customer-jwt.guard.js';

function getSecret(name: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET'): string {
  const secret = process.env[name];
  if (!secret || secret.length < 32 || secret.startsWith('replace-with-')) {
    throw new Error(`${name} must be configured with a non-placeholder secret of at least 32 characters.`);
  }
  return secret;
}

@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = getSecret('JWT_ACCESS_SECRET');
        getSecret('JWT_REFRESH_SECRET');
        return { secret };
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
  ],
  controllers: [CustomerAuthController, CustomerDataController],
  providers: [CustomerAuthService, CustomerDataService, CustomerJwtAccessGuard],
})
export class CustomerModule {}
