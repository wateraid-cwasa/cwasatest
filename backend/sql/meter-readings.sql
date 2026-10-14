  USE [CWASABILL_PLATFORM_TEST];
  GO

  IF SCHEMA_ID(N'app') IS NULL
  BEGIN
    EXEC(N'CREATE SCHEMA [app] AUTHORIZATION [dbo]');
  END;
  GO

  IF OBJECT_ID(N'app.MeterReadings', N'U') IS NULL
  BEGIN
    CREATE TABLE [app].[MeterReadings] (
      [ReadingId] UNIQUEIDENTIFIER NOT NULL
        CONSTRAINT [DF_App_MeterReadings_ReadingId] DEFAULT NEWSEQUENTIALID(),
      [ReaderCode] NVARCHAR(255) NOT NULL,
      [AccountNo] NVARCHAR(255) NOT NULL,
      [WardNo] NVARCHAR(255) NULL,
      [MeterNo] NVARCHAR(255) NULL,
      [CustomerName] NVARCHAR(255) NOT NULL,
      [CurrentBill] DECIMAL(12, 2) NOT NULL,
      [Latitude] DECIMAL(9, 6) NOT NULL,
      [Longitude] DECIMAL(9, 6) NOT NULL,
      [MeterPhoto] VARBINARY(MAX) NULL,
      [PhotoContentType] NVARCHAR(50) NULL,
      [Status] NVARCHAR(30) NOT NULL
        CONSTRAINT [DF_App_MeterReadings_Status] DEFAULT N'Pending',
      [ReviewedAt] DATETIME2 NULL,
      [ReviewedBy] NVARCHAR(255) NULL,
      [CreatedAt] DATETIME2 NOT NULL
        CONSTRAINT [DF_App_MeterReadings_CreatedAt] DEFAULT SYSUTCDATETIME(),
      CONSTRAINT [PK_App_MeterReadings] PRIMARY KEY ([ReadingId]),
      CONSTRAINT [CK_App_MeterReadings_CurrentBill] CHECK ([CurrentBill] >= 0),
      CONSTRAINT [CK_App_MeterReadings_Latitude] CHECK ([Latitude] BETWEEN -90 AND 90),
      CONSTRAINT [CK_App_MeterReadings_Longitude] CHECK ([Longitude] BETWEEN -180 AND 180),
      CONSTRAINT [CK_App_MeterReadings_Status]
        CHECK ([Status] IN (N'Pending', N'Completed', N'Rejected'))
    );

    CREATE INDEX [IX_App_MeterReadings_ReaderCode_CreatedAt]
      ON [app].[MeterReadings] ([ReaderCode], [CreatedAt] DESC);
  END;
  GO

  IF COL_LENGTH(N'app.MeterReadings', N'WardNo') IS NULL
  BEGIN
    ALTER TABLE [app].[MeterReadings] ADD [WardNo] NVARCHAR(255) NULL;
  END;
  GO

  IF COL_LENGTH(N'app.MeterReadings', N'Status') IS NULL
  BEGIN
    ALTER TABLE [app].[MeterReadings]
      ADD [Status] NVARCHAR(30) NOT NULL
        CONSTRAINT [DF_App_MeterReadings_Status] DEFAULT N'Pending' WITH VALUES;
  END;
  GO

  IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE [name] = N'CK_App_MeterReadings_Status'
      AND [parent_object_id] = OBJECT_ID(N'app.MeterReadings')
  )
  BEGIN
    ALTER TABLE [app].[MeterReadings] DROP CONSTRAINT [CK_App_MeterReadings_Status];
  END;
  GO

  ALTER TABLE [app].[MeterReadings]
    ADD CONSTRAINT [CK_App_MeterReadings_Status]
      CHECK ([Status] IN (N'Pending', N'Completed', N'Rejected'));
  GO

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE [name] = N'IX_App_MeterReadings_Status_CreatedAt'
      AND [object_id] = OBJECT_ID(N'app.MeterReadings')
  )
  BEGIN
    CREATE INDEX [IX_App_MeterReadings_Status_CreatedAt]
      ON [app].[MeterReadings] ([Status], [CreatedAt] DESC);
  END;
  GO

  IF COL_LENGTH(N'app.MeterReadings', N'ReviewedAt') IS NULL
  BEGIN
    ALTER TABLE [app].[MeterReadings] ADD [ReviewedAt] DATETIME2 NULL;
  END;
  GO

  IF COL_LENGTH(N'app.MeterReadings', N'ReviewedBy') IS NULL
  BEGIN
    ALTER TABLE [app].[MeterReadings] ADD [ReviewedBy] NVARCHAR(255) NULL;
  END;
  GO

  IF DATABASE_PRINCIPAL_ID(N'cwasa_platform_rw') IS NOT NULL
  BEGIN
    GRANT SELECT, INSERT, UPDATE ON OBJECT::[app].[MeterReadings] TO [cwasa_platform_rw];
  END;
  GO
