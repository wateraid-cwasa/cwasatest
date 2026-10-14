import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAccessGuard } from '../auth/jwt-access.guard.js';
import {
  CreateServiceRequestDto,
  ServiceRequestCustomerQueryDto,
} from './service-request.dto.js';
import { ServiceRequestsService } from './service-requests.service.js';

@Controller('service-requests')
@UseGuards(JwtAccessGuard)
export class ServiceRequestsController {
  constructor(private readonly serviceRequestsService: ServiceRequestsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.serviceRequestsService.list(request.user);
  }

  @Get('customer-lookup')
  lookupCustomer(
    @Query() query: ServiceRequestCustomerQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.serviceRequestsService.lookupCustomer(query.identifier, request.user);
  }

  @Post()
  create(
    @Body() body: CreateServiceRequestDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.serviceRequestsService.create(body, request.user);
  }
}
