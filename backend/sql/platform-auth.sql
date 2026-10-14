  IF SCHEMA_ID(N'app') IS NULL
  BEGIN
    EXEC(N'CREATE SCHEMA [app] AUTHORIZATION [dbo]');
  END;
  GO

  IF OBJECT_ID(N'app.AdminAccounts', N'U') IS NULL
  BEGIN
    CREATE TABLE app.AdminAccounts (
      AdminId UNIQUEIDENTIFIER NOT NULL
        CONSTRAINT DF_App_AdminAccounts_AdminId DEFAULT NEWSEQUENTIALID(),
      Username NVARCHAR(100) NOT NULL,
      PasswordHash NVARCHAR(255) NOT NULL,
      IsActive BIT NOT NULL
        CONSTRAINT DF_App_AdminAccounts_IsActive DEFAULT (1),
      CreatedAt DATETIME2 NOT NULL
        CONSTRAINT DF_App_AdminAccounts_CreatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL
        CONSTRAINT DF_App_AdminAccounts_UpdatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_App_AdminAccounts PRIMARY KEY (AdminId),
      CONSTRAINT UQ_App_AdminAccounts_Username UNIQUE (Username)
    );
  END;
  GO

  IF OBJECT_ID(N'app.MeterInspectorCredentials', N'U') IS NULL
  BEGIN
    CREATE TABLE app.MeterInspectorCredentials (
      RICODE NVARCHAR(255) NOT NULL,
      PasswordHash NVARCHAR(255) NOT NULL,
      IsActive BIT NOT NULL
        CONSTRAINT DF_App_MeterInspectorCredentials_IsActive DEFAULT (1),
      CreatedAt DATETIME2 NOT NULL
        CONSTRAINT DF_App_MeterInspectorCredentials_CreatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL
        CONSTRAINT DF_App_MeterInspectorCredentials_UpdatedAt DEFAULT SYSUTCDATETIME(),
      CreatedByAdminId UNIQUEIDENTIFIER NOT NULL,
      UpdatedByAdminId UNIQUEIDENTIFIER NOT NULL,
      CONSTRAINT PK_App_MeterInspectorCredentials PRIMARY KEY (RICODE),
      CONSTRAINT FK_App_MeterInspectorCredentials_CreatedBy
        FOREIGN KEY (CreatedByAdminId) REFERENCES app.AdminAccounts (AdminId),
      CONSTRAINT FK_App_MeterInspectorCredentials_UpdatedBy
        FOREIGN KEY (UpdatedByAdminId) REFERENCES app.AdminAccounts (AdminId)
    );
  END;
  GO
