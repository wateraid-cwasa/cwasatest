import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CustomerModule } from './customer/customer.module.js';

@Module({
  imports: [AuthModule, CustomerModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
