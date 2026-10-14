import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlatformDatabaseService, SourceDatabaseService } from '../database/database.module.js';
import type { SessionClaims } from '../auth/auth.types.js';
import type { CreateServiceRequestDto } from './service-request.dto.js';

const MAX_PHOTO_BYTES = 1_000_000;

type ServiceRequestCustomer = {
  accountNo: string;
  customerName: string;
  address: string;
  meterNo: string | null;
};

type ServiceRequestRecord = ServiceRequestCustomer & {
  id: string;
  problemType: string;
  description: string;
  status: string;
  createdAt: Date;
};

@Injectable()
export class ServiceRequestsService {
  constructor(
    private readonly sourceDatabase: SourceDatabaseService,
    private readonly platformDatabase: PlatformDatabaseService,
  ) {}

  async list(user: SessionClaims) {
    this.assertInspector(user);
    const requests = await this.platformDatabase.$queryRaw<ServiceRequestRecord[]>`
      SELECT
        CONCAT(
          N'SR-', CONVERT(char(8), request.[CreatedAt], 112), N'-',
          RIGHT(REPLACE(CONVERT(nvarchar(36), request.[ServiceRequestId]), N'-', N''), 8)
        ) AS [id],
        request.[AccountNo] AS [accountNo],
        request.[CustomerName] AS [customerName],
        request.[Address] AS [address],
        request.[MeterNo] AS [meterNo],
        request.[ProblemType] AS [problemType],
        request.[Description] AS [description],
        request.[Status] AS [status],
        request.[CreatedAt] AS [createdAt]
      FROM [app].[ServiceRequests] AS request
      WHERE request.[ReaderCode] = ${user.readerCode}
      ORDER BY request.[CreatedAt] DESC
    `;
    return requests;
  }

  async lookupCustomer(identifier: string, user: SessionClaims) {
    this.assertInspector(user);
    const customer = await this.findCustomer(identifier);
    if (!customer) {
      throw new NotFoundException('No customer matches that account or meter number.');
    }
    return customer;
  }

  async create(input: CreateServiceRequestDto, user: SessionClaims) {
    this.assertInspector(user);
    const description = input.description.trim();
    if (!description) {
      throw new BadRequestException('A description is required.');
    }

    const customer = await this.findCustomer(input.identifier);
    if (!customer) {
      throw new NotFoundException('No customer matches that account or meter number.');
    }

    const photoBytes = input.photoBase64 ? Buffer.from(input.photoBase64, 'base64') : null;
    if (photoBytes && (photoBytes.length === 0 || photoBytes.length > MAX_PHOTO_BYTES)) {
      throw new BadRequestException('The compressed service-request photo must be no larger than 1 MB.');
    }
    if (photoBytes && (photoBytes[0] !== 0xff || photoBytes[1] !== 0xd8)) {
      throw new BadRequestException('The service-request photo must be a JPEG image.');
    }

    const [created] = await this.platformDatabase.$queryRaw<Array<{ id: string; createdAt: Date }>>`
      INSERT INTO [app].[ServiceRequests] (
        [ReaderCode],
        [AccountNo],
        [MeterNo],
        [CustomerName],
        [Address],
        [ProblemType],
        [Description],
        [Photo],
        [PhotoContentType]
      )
      OUTPUT
        CONCAT(
          N'SR-', CONVERT(char(8), INSERTED.[CreatedAt], 112), N'-',
          RIGHT(REPLACE(CONVERT(nvarchar(36), INSERTED.[ServiceRequestId]), N'-', N''), 8)
        ) AS [id],
        INSERTED.[CreatedAt] AS [createdAt]
      VALUES (
        ${user.readerCode},
        ${customer.accountNo},
        ${customer.meterNo},
        ${customer.customerName},
        ${customer.address},
        ${input.problemType},
        ${description},
        ${photoBytes},
        ${photoBytes ? 'image/jpeg' : null}
      )
    `;

    return {
      ...created,
      ...customer,
      problemType: input.problemType,
      description,
      status: 'Pending',
    };
  }

  private async findCustomer(identifier: string): Promise<ServiceRequestCustomer | null> {
    const normalizedIdentifier = identifier.trim();
    if (!normalizedIdentifier) {
      throw new BadRequestException('An account or meter number is required.');
    }

    const [customer] = await this.sourceDatabase.$queryRaw<ServiceRequestCustomer[]>`
      SELECT TOP (1)
        CONVERT(nvarchar(255), c.[AccountNo]) AS [accountNo],
        COALESCE(CONVERT(nvarchar(255), c.[CustomerName]), N'') AS [customerName],
        LTRIM(RTRIM(CONCAT(
          COALESCE(c.[AddressLine1], N''),
          CASE WHEN NULLIF(LTRIM(RTRIM(c.[AddressLine2])), N'') IS NULL
            THEN N'' ELSE N', ' + LTRIM(RTRIM(c.[AddressLine2])) END
        ))) AS [address],
        CONVERT(nvarchar(255), c.[MeterNo]) AS [meterNo]
      FROM [platform].[vw_Customer] AS c
      WHERE (
        CONVERT(nvarchar(255), c.[AccountNo]) = ${normalizedIdentifier}
        OR UPPER(LTRIM(RTRIM(CONVERT(nvarchar(255), c.[MeterNo])))) =
          UPPER(${normalizedIdentifier})
      )
    `;
    return customer ?? null;
  }

  private assertInspector(user: SessionClaims): void {
    if (user.role !== 'meter_inspector') {
      throw new ForbiddenException('A meter inspector account is required.');
    }
  }
}
