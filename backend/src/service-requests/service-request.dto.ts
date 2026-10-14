import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const SERVICE_REQUEST_PROBLEMS = [
  'Meter defective',
  'Meter stopped',
  'Glass broken',
  'Other',
] as const;

export class CreateServiceRequestDto {
  @IsString()
  @MaxLength(255)
  identifier!: string;

  @IsIn(SERVICE_REQUEST_PROBLEMS)
  problemType!: (typeof SERVICE_REQUEST_PROBLEMS)[number];

  @IsString()
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_400_000)
  @Matches(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, {
    message: 'photoBase64 must be valid base64 image data.',
  })
  photoBase64?: string;
}

export class ServiceRequestCustomerQueryDto {
  @IsString()
  @MaxLength(255)
  identifier!: string;
}
