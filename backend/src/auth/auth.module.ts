import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../database/database.module.js';
import { AdminGuard } from './admin.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAccessGuard } from './jwt-access.guard.js';
import { ReadingsController } from '../readings/readings.controller.js';
import { ReadingsService } from '../readings/readings.service.js';
import { ServiceRequestsController } from '../service-requests/service-requests.controller.js';
import { ServiceRequestsService } from '../service-requests/service-requests.service.js';

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
  controllers: [AuthController, ReadingsController, ServiceRequestsController],
  providers: [AuthService, ReadingsService, ServiceRequestsService, JwtAccessGuard, AdminGuard],
})
export class AuthModule {}
