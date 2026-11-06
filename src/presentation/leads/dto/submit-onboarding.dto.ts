import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  AcademicLevel,
  AcquisitionChannel,
  Blocker,
  DeliverableType,
  Persona,
  WorkTool,
} from '../../../domain/leads/lead-enums';

/**
 * Reads the raw body value. `main.ts` enables implicit conversion, which would
 * turn the string "false" into `true` before `@IsBoolean` ran.
 */
export const RawValue = () =>
  Transform(({ obj, key }) => (obj as Record<string, unknown>)[key]);

export class SubmitOnboardingDto {
  @ApiProperty({ enum: Persona })
  @IsEnum(Persona)
  persona: Persona;

  @ApiProperty({ enum: DeliverableType })
  @IsEnum(DeliverableType)
  deliverable_type: DeliverableType;

  @ApiProperty({ example: '2027-01-15', description: 'YYYY-MM-DD' })
  @RawValue()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  due_date: string;

  @ApiProperty({ enum: AcademicLevel })
  @IsEnum(AcademicLevel)
  academic_level: AcademicLevel;

  @ApiProperty({
    required: false,
    nullable: true,
    maxLength: 120,
    description: 'Trimmed; omitted, null or blank all store null.',
  })
  @Transform(({ obj, key }) => {
    const raw = (obj as Record<string, unknown>)[key];
    if (typeof raw !== 'string') return raw;
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  school_name?: string | null;

  @ApiProperty({ enum: WorkTool, isArray: true, description: '[] is valid.' })
  @RawValue()
  @IsArray()
  @ArrayUnique()
  @IsEnum(WorkTool, { each: true })
  work_tools: WorkTool[];

  @ApiProperty({ enum: Blocker, isArray: true, minItems: 1 })
  @RawValue()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(Blocker, { each: true })
  blockers: Blocker[];

  @ApiProperty({ enum: AcquisitionChannel })
  @IsEnum(AcquisitionChannel)
  acquisition_channel: AcquisitionChannel;

  @ApiProperty({ description: 'Explicit boolean; strings are rejected.' })
  @RawValue()
  @IsBoolean()
  marketing_opt_in: boolean;
}
