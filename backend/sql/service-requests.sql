USE [CWASABILL_PLATFORM_TEST];
GO

IF SCHEMA_ID(N'app') IS NULL
BEGIN
  EXEC(N'CREATE SCHEMA [app] AUTHORIZATION [dbo]');
END;
GO

IF OBJECT_ID(N'app.ServiceRequests', N'U') IS NULL
BEGIN
  CREATE TABLE [app].[ServiceRequests] (
    [ServiceRequestId] UNIQUEIDENTIFIER NOT NULL
      CONSTRAINT [DF_App_ServiceRequests_Id] DEFAULT NEWSEQUENTIALID(),
    [ReaderCode] NVARCHAR(255) NOT NULL,
    [AccountNo] NVARCHAR(255) NOT NULL,
    [MeterNo] NVARCHAR(255) NULL,
    [CustomerName] NVARCHAR(255) NOT NULL,
    [Address] NVARCHAR(1000) NOT NULL,
    [ProblemType] NVARCHAR(100) NOT NULL,
    [Description] NVARCHAR(500) NOT NULL,
    [Status] NVARCHAR(30) NOT NULL
      CONSTRAINT [DF_App_ServiceRequests_Status] DEFAULT N'Pending',
    [Photo] VARBINARY(MAX) NULL,
    [PhotoContentType] NVARCHAR(50) NULL,
    [CreatedAt] DATETIME2 NOT NULL
      CONSTRAINT [DF_App_ServiceRequests_CreatedAt] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PK_App_ServiceRequests] PRIMARY KEY ([ServiceRequestId]),
    CONSTRAINT [CK_App_ServiceRequests_Status]
      CHECK ([Status] IN (N'Pending', N'In progress', N'Completed'))
  );

  CREATE INDEX [IX_App_ServiceRequests_ReaderCode_CreatedAt]
    ON [app].[ServiceRequests] ([ReaderCode], [CreatedAt] DESC);
END;
GO

IF DATABASE_PRINCIPAL_ID(N'cwasa_platform_rw') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT ON OBJECT::[app].[ServiceRequests] TO [cwasa_platform_rw];
END;
GO
