import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  accountNo!: string;

  @IsString()
  @Matches(/^01\d{9}$/, {
    message: 'mobileNo must be a valid 11-digit Bangladesh mobile number.',
  })
  mobileNo!: string;
}

export class VerifyOtpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  accountNo!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must be a 6-digit code.' })
  otp!: string;
}

export class CustomerRefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  refreshToken!: string;
}
