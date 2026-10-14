import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlatformDatabaseService, SourceDatabaseService } from '../database/database.module.js';
import type { SessionClaims } from '../auth/auth.types.js';
import type { CreateReadingDto } from './reading.dto.js';

const MAX_PHOTO_BYTES = 1_000_000;

type CustomerLookupRecord = {
  accountNo: string;
  customerName: string;
  address: string;
  mobileNo: string | null;
  meterNo: string | null;
  wardNo: string | null;
  propertyType: string | null;
  connectionSize: string | null;
  lastMeterReading: string | null;
  lastReadingDate: Date | null;
  previousBill: string | null;
  paidAmount: string | null;
  paymentStatus: string | null;
};

type CreatedReadingRecord = {
  readingId: string;
  createdAt: Date;
};

type AdminReadingRecord = ReadingSubmissionRecord & {
  meterPhoto: Uint8Array | null;
};

export type ReadingSubmissionRecord = {
  id: string;
  readerCode: string;
  accountNo: string;
  wardNo: string | null;
  meterNo: string | null;
  customerName: string;
  currentBill: string;
  latitude: number;
  longitude: number;
  hasPhoto: boolean;
  status: 'Pending' | 'Completed';
  createdAt: Date;
};

@Injectable()
export class ReadingsService {
  constructor(
    private readonly sourceDatabase: SourceDatabaseService,
    private readonly platformDatabase: PlatformDatabaseService,
  ) {}

  async listAssignedCustomers(user: SessionClaims) {
    this.assertInspector(user);
    return this.sourceDatabase.$queryRaw<CustomerLookupRecord[]>`
      SELECT
        CONVERT(nvarchar(255), c.[AccountNo]) AS [accountNo],
        COALESCE(CONVERT(nvarchar(255), c.[CustomerName]), N'') AS [customerName],
        LTRIM(RTRIM(CONCAT(
          COALESCE(c.[AddressLine1], N''),
          CASE WHEN NULLIF(LTRIM(RTRIM(c.[AddressLine2])), N'') IS NULL
            THEN N'' ELSE N', ' + LTRIM(RTRIM(c.[AddressLine2])) END
        ))) AS [address],
        CONVERT(nvarchar(255), c.[MobileNo]) AS [mobileNo],
        CONVERT(nvarchar(255), c.[MeterNo]) AS [meterNo],
        CONVERT(nvarchar(255), c.[WardNo]) AS [wardNo],
        CONVERT(nvarchar(255), c.[PropertyType]) AS [propertyType],
        CONVERT(nvarchar(255), c.[ConnectionSizeCode]) AS [connectionSize],
        CONVERT(nvarchar(50), c.[LastMeterReading]) AS [lastMeterReading],
        c.[LastReadingDate] AS [lastReadingDate],
        CONVERT(nvarchar(50), bills.[BillTotal]) AS [previousBill],
        CONVERT(nvarchar(50), bills.[PaidAmount]) AS [paidAmount],
        CONVERT(nvarchar(50), bills.[PaymentStatus]) AS [paymentStatus]
      FROM [platform].[vw_Customer] AS c
      OUTER APPLY (
        SELECT TOP (1)
          history.[BillTotal],
          history.[PaidAmount],
          history.[PaymentStatus]
        FROM [platform].[vw_BillHistory] AS history
        WHERE CONVERT(nvarchar(255), history.[AccountNo]) =
          CONVERT(nvarchar(255), c.[AccountNo])
        ORDER BY history.[BillDate] DESC
      ) AS bills
      WHERE UPPER(LTRIM(RTRIM(CONVERT(nvarchar(255), c.[MeterReaderCode])))) =
        UPPER(${user.readerCode})
      ORDER BY c.[AccountNo]
    `;
  }

  async lookupCustomer(identifier: string, user: SessionClaims) {
    this.assertInspector(user);
    const customer = await this.findCustomer(identifier);
    if (!customer) {
      throw new NotFoundException('No customer matches that account or meter number.');
    }
    return customer;
  }

  async createReading(input: CreateReadingDto, user: SessionClaims) {
    this.assertInspector(user);
    const customer = await this.findCustomer(input.identifier);
    if (!customer) {
      throw new NotFoundException('No customer matches that account or meter number.');
    }

    if (!input.photoBase64) {
      throw new BadRequestException('A meter photo is required to submit a reading.');
    }
    const photoBytes = Buffer.from(input.photoBase64, 'base64');
    if (photoBytes.length === 0 || photoBytes.length > MAX_PHOTO_BYTES) {
      throw new BadRequestException('The resized meter photo must be no larger than 1 MB.');
    }
    if (photoBytes[0] !== 0xff || photoBytes[1] !== 0xd8) {
      throw new BadRequestException('The meter photo must be a JPEG image.');
    }

    const [created] = await this.platformDatabase.$queryRaw<CreatedReadingRecord[]>`
      INSERT INTO [app].[MeterReadings] (
        [ReaderCode],
        [AccountNo],
        [WardNo],
        [MeterNo],
        [CustomerName],
        [CurrentBill],
        [Latitude],
        [Longitude],
        [MeterPhoto],
        [PhotoContentType]
      )
      OUTPUT
        CONVERT(nvarchar(36), INSERTED.[ReadingId]) AS [readingId],
        INSERTED.[CreatedAt] AS [createdAt]
      VALUES (
        ${user.readerCode},
        ${customer.accountNo},
        ${customer.wardNo},
        ${customer.meterNo},
        ${customer.customerName},
        CONVERT(decimal(12, 2), ${input.currentBill}),
        ${input.latitude},
        ${input.longitude},
        ${photoBytes},
        'image/jpeg'
      )
    `;

    return {
      id: created.readingId,
      accountNo: customer.accountNo,
      meterNo: customer.meterNo,
      customerName: customer.customerName,
      currentBill: input.currentBill,
      createdAt: created.createdAt,
      photoSaved: true,
      status: 'Pending',
    };
  }

  async listInspectorReadings(user: SessionClaims, status: 'Pending' | 'Completed') {
    this.assertInspector(user);
    return this.platformDatabase.$queryRaw<ReadingSubmissionRecord[]>`
      SELECT
        CONVERT(nvarchar(36), [ReadingId]) AS [id],
        [ReaderCode] AS [readerCode],
        [AccountNo] AS [accountNo],
        [WardNo] AS [wardNo],
        [MeterNo] AS [meterNo],
        [CustomerName] AS [customerName],
        CONVERT(nvarchar(50), [CurrentBill]) AS [currentBill],
        CONVERT(float, [Latitude]) AS [latitude],
        CONVERT(float, [Longitude]) AS [longitude],
        CAST(CASE WHEN [MeterPhoto] IS NULL THEN 0 ELSE 1 END AS bit) AS [hasPhoto],
        [Status] AS [status],
        [CreatedAt] AS [createdAt]
      FROM [app].[MeterReadings]
      WHERE [ReaderCode] = ${user.readerCode}
        AND [Status] = ${status}
      ORDER BY [CreatedAt] DESC
    `;
  }

  async listPendingReadingsForAdmin(user: SessionClaims) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('An administrator account is required.');
    }
    const records = await this.platformDatabase.$queryRaw<AdminReadingRecord[]>`
      SELECT
        CONVERT(nvarchar(36), [ReadingId]) AS [id],
        [ReaderCode] AS [readerCode],
        [AccountNo] AS [accountNo],
        [WardNo] AS [wardNo],
        [MeterNo] AS [meterNo],
        [CustomerName] AS [customerName],
        CONVERT(nvarchar(50), [CurrentBill]) AS [currentBill],
        CONVERT(float, [Latitude]) AS [latitude],
        CONVERT(float, [Longitude]) AS [longitude],
        CAST(CASE WHEN [MeterPhoto] IS NULL THEN 0 ELSE 1 END AS bit) AS [hasPhoto],
        [MeterPhoto] AS [meterPhoto],
        [Status] AS [status],
        [CreatedAt] AS [createdAt]
      FROM [app].[MeterReadings]
      WHERE [Status] = N'Pending'
      ORDER BY [CreatedAt] ASC
    `;
    return records.map(({ meterPhoto, ...record }) => ({
      ...record,
      photoBase64: meterPhoto ? Buffer.from(meterPhoto).toString('base64') : null,
    }));
  }

  async approveReading(readingId: string, user: SessionClaims) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('An administrator account is required.');
    }
    const [approved] = await this.platformDatabase.$queryRaw<Array<{ id: string }>>`
      UPDATE [app].[MeterReadings]
      SET [Status] = N'Completed',
          [ReviewedAt] = SYSUTCDATETIME(),
          [ReviewedBy] = ${user.sub}
      OUTPUT CONVERT(nvarchar(36), INSERTED.[ReadingId]) AS [id]
      WHERE [ReadingId] = TRY_CONVERT(uniqueidentifier, ${readingId})
        AND [Status] = N'Pending'
    `;
    if (!approved) {
      throw new NotFoundException('No pending reading was found with that ID.');
    }
    return { id: approved.id, status: 'Completed' as const };
  }

  private async findCustomer(identifier: string): Promise<CustomerLookupRecord | null> {
    const normalizedIdentifier = identifier.trim();
    if (!normalizedIdentifier) {
      throw new BadRequestException('An account or meter number is required.');
    }

    const matches = await this.sourceDatabase.$queryRaw<CustomerLookupRecord[]>`
      SELECT TOP (1)
        CONVERT(nvarchar(255), c.[AccountNo]) AS [accountNo],
        COALESCE(CONVERT(nvarchar(255), c.[CustomerName]), N'') AS [customerName],
        LTRIM(RTRIM(CONCAT(
          COALESCE(c.[AddressLine1], N''),
          CASE WHEN NULLIF(LTRIM(RTRIM(c.[AddressLine2])), N'') IS NULL
            THEN N'' ELSE N', ' + LTRIM(RTRIM(c.[AddressLine2])) END
        ))) AS [address],
        CONVERT(nvarchar(255), c.[MobileNo]) AS [mobileNo],
        CONVERT(nvarchar(255), c.[MeterNo]) AS [meterNo],
        CONVERT(nvarchar(255), c.[WardNo]) AS [wardNo],
        CONVERT(nvarchar(255), c.[PropertyType]) AS [propertyType],
        CONVERT(nvarchar(255), c.[ConnectionSizeCode]) AS [connectionSize],
        CONVERT(nvarchar(50), c.[LastMeterReading]) AS [lastMeterReading],
        c.[LastReadingDate] AS [lastReadingDate],
        CONVERT(nvarchar(50), bills.[BillTotal]) AS [previousBill],
        CONVERT(nvarchar(50), bills.[PaidAmount]) AS [paidAmount],
        CONVERT(nvarchar(50), bills.[PaymentStatus]) AS [paymentStatus]
      FROM [platform].[vw_Customer] AS c
      OUTER APPLY (
        SELECT TOP (1)
          history.[BillTotal],
          history.[PaidAmount],
          history.[PaymentStatus]
        FROM [platform].[vw_BillHistory] AS history
        WHERE CONVERT(nvarchar(255), history.[AccountNo]) =
          CONVERT(nvarchar(255), c.[AccountNo])
        ORDER BY history.[BillDate] DESC
      ) AS bills
      WHERE (
        CONVERT(nvarchar(255), c.[AccountNo]) = ${normalizedIdentifier}
        OR UPPER(LTRIM(RTRIM(CONVERT(nvarchar(255), c.[MeterNo])))) =
          UPPER(${normalizedIdentifier})
      )
      ORDER BY c.[AccountNo]
    `;
    return matches[0] ?? null;
  }

  private assertInspector(user: SessionClaims): void {
    if (user.role !== 'meter_inspector') {
      throw new ForbiddenException('A meter inspector account is required.');
    }
  }
}
