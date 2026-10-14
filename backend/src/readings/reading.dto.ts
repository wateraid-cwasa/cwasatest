import {
  IsNumber,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CustomerLookupQueryDto {
  @IsString()
  @MaxLength(255)
  identifier!: string;
}

export class CreateReadingDto {
  @IsString()
  @MaxLength(255)
  identifier!: string;

  @IsString()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/, {
    message: 'currentBill must be a non-negative amount with up to two decimal places.',
  })
  currentBill!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsString()
  @MaxLength(1_400_000)
  @Matches(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, {
    message: 'photoBase64 must be valid base64 image data.',
  })
  photoBase64!: string;
}
