  USE [CWASABILL_PLATFORM_TEST];
  GO

  IF SCHEMA_ID(N'app') IS NULL
  BEGIN
    EXEC(N'CREATE SCHEMA [app] AUTHORIZATION [dbo]');
  END;
  GO

  IF OBJECT_ID(N'app.CustomerOtps', N'U') IS NULL
  BEGIN
    CREATE TABLE [app].[CustomerOtps] (
      [AccountNo] NVARCHAR(255) NOT NULL,
      [MobileNo] NVARCHAR(255) NOT NULL,
      [OtpHash] NVARCHAR(255) NOT NULL,
      [ExpiresAt] DATETIME2 NOT NULL,
      [Attempts] INT NOT NULL
        CONSTRAINT [DF_App_CustomerOtps_Attempts] DEFAULT (0),
      [CreatedAt] DATETIME2 NOT NULL
        CONSTRAINT [DF_App_CustomerOtps_CreatedAt] DEFAULT SYSUTCDATETIME(),
      CONSTRAINT [PK_App_CustomerOtps] PRIMARY KEY ([AccountNo])
    );
  END;
  GO

  IF DATABASE_PRINCIPAL_ID(N'cwasa_platform_rw') IS NOT NULL
  BEGIN
    GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[app].[CustomerOtps] TO [cwasa_platform_rw];
  END;
  GO
