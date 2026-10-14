import { Injectable, NotFoundException } from '@nestjs/common';
import { PlatformDatabaseService, SourceDatabaseService } from '../database/database.module.js';
import type { CustomerSessionClaims } from './customer.types.js';

type CustomerProfile = {
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
};

type BillHistoryRecord = {
  billDate: Date;
  billTotal: string | null;
  paidAmount: string | null;
  paymentStatus: string | null;
};

type MeterReadingHistoryRecord = {
  readingId: string;
  currentBill: string;
  createdAt: Date;
  hasPhoto: boolean;
};

@Injectable()
export class CustomerDataService {
  constructor(
    private readonly sourceDatabase: SourceDatabaseService,
    private readonly platformDatabase: PlatformDatabaseService,
  ) {}

  async getProfile(user: CustomerSessionClaims): Promise<CustomerProfile> {
    const rows = await this.sourceDatabase.$queryRaw<CustomerProfile[]>`
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
        c.[LastReadingDate] AS [lastReadingDate]
      FROM [platform].[vw_Customer] AS c
      WHERE CONVERT(nvarchar(255), c.[AccountNo]) = ${user.accountNo}
    `;
    const profile = rows[0];
    if (!profile) {
      throw new NotFoundException('No customer record matches the current session.');
    }
    return profile;
  }

  async getBillHistory(user: CustomerSessionClaims): Promise<BillHistoryRecord[]> {
    return this.sourceDatabase.$queryRaw<BillHistoryRecord[]>`
      SELECT
        history.[BillDate] AS [billDate],
        CONVERT(nvarchar(50), history.[BillTotal]) AS [billTotal],
        CONVERT(nvarchar(50), history.[PaidAmount]) AS [paidAmount],
        CONVERT(nvarchar(50), history.[PaymentStatus]) AS [paymentStatus]
      FROM [platform].[vw_BillHistory] AS history
      WHERE CONVERT(nvarchar(255), history.[AccountNo]) = ${user.accountNo}
      ORDER BY history.[BillDate] DESC
    `;
  }

  async getMeterReadingHistory(user: CustomerSessionClaims): Promise<MeterReadingHistoryRecord[]> {
    return this.platformDatabase.$queryRaw<MeterReadingHistoryRecord[]>`
      SELECT
        CONVERT(nvarchar(36), [ReadingId]) AS [readingId],
        CONVERT(nvarchar(50), [CurrentBill]) AS [currentBill],
        [CreatedAt] AS [createdAt],
        CAST(CASE WHEN [MeterPhoto] IS NULL THEN 0 ELSE 1 END AS BIT) AS [hasPhoto]
      FROM [app].[MeterReadings]
      WHERE CONVERT(nvarchar(255), [AccountNo]) = ${user.accountNo}
      ORDER BY [CreatedAt] DESC
    `;
  }
}
