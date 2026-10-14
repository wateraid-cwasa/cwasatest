import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { JwtAccessGuard } from '../auth/jwt-access.guard.js';
import { CreateReadingDto, CustomerLookupQueryDto } from './reading.dto.js';
import { ReadingsService } from './readings.service.js';

@Controller('readings')
@UseGuards(JwtAccessGuard)
export class ReadingsController {
  constructor(private readonly readingsService: ReadingsService) {}

  @Get('assigned-customers')
  listAssignedCustomers(@Req() request: AuthenticatedRequest) {
    return this.readingsService.listAssignedCustomers(request.user);
  }

  @Get('customer-lookup')
  lookupCustomer(
    @Query() query: CustomerLookupQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.readingsService.lookupCustomer(query.identifier, request.user);
  }

  @Post()
  createReading(
    @Body() body: CreateReadingDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.readingsService.createReading(body, request.user);
  }

  @Get('pending')
  listPending(@Req() request: AuthenticatedRequest) {
    return this.readingsService.listInspectorReadings(request.user, 'Pending');
  }

  @Get('completed')
  listCompleted(@Req() request: AuthenticatedRequest) {
    return this.readingsService.listInspectorReadings(request.user, 'Completed');
  }

  @Get('admin/pending')
  @UseGuards(AdminGuard)
  listPendingForAdmin(@Req() request: AuthenticatedRequest) {
    return this.readingsService.listPendingReadingsForAdmin(request.user);
  }

  @Post('admin/:readingId/approve')
  @UseGuards(AdminGuard)
  approveReading(
    @Param('readingId') readingId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.readingsService.approveReading(readingId, request.user);
  }
}
