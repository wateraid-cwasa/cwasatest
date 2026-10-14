import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class InspectorLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  meterReaderId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class AdminLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class SetInspectorPasswordDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  refreshToken!: string;
}
