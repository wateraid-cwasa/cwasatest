USE [CWASABILL_TEST];
GO

IF SCHEMA_ID(N'platform') IS NULL
BEGIN
  EXEC(N'CREATE SCHEMA [platform] AUTHORIZATION [dbo]');
END;
GO

CREATE OR ALTER VIEW [platform].[vw_Inspector]
AS
SELECT
  RICODE AS ReaderCode,
  RINAME AS InspectorName
FROM dbo.MICode;
GO

GRANT SELECT ON OBJECT::[platform].[vw_Inspector]
TO [cwasa_platform_app];
GO

IF OBJECT_ID(N'platform.vw_Customer', N'V') IS NOT NULL
BEGIN
  GRANT SELECT ON OBJECT::[platform].[vw_Customer]
  TO [cwasa_platform_app];
END;
GO

IF OBJECT_ID(N'platform.vw_BillHistory', N'V') IS NOT NULL
BEGIN
  GRANT SELECT ON OBJECT::[platform].[vw_BillHistory]
  TO [cwasa_platform_app];
END;
GO
