import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { CustomerJwtAccessGuard } from './customer-jwt.guard.js';
import type { CustomerAuthenticatedRequest } from './customer.types.js';
import { CustomerDataService } from './customer-data.service.js';

@Controller('customer')
@UseGuards(CustomerJwtAccessGuard)
export class CustomerDataController {
  constructor(private readonly customerDataService: CustomerDataService) {}

  @Get('profile')
  getProfile(@Req() request: CustomerAuthenticatedRequest) {
    return this.customerDataService.getProfile(request.user);
  }

  @Get('bills')
  getBills(@Req() request: CustomerAuthenticatedRequest) {
    return this.customerDataService.getBillHistory(request.user);
  }

  @Get('meter-readings')
  getMeterReadings(@Req() request: CustomerAuthenticatedRequest) {
    return this.customerDataService.getMeterReadingHistory(request.user);
  }
}
