import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

// A Mongo ObjectId is a 24-character hex string. Matched with a plain regex
// (rather than `mongoose.Types.ObjectId.isValid`) so this pipe stays in the
// presentation layer without importing `mongoose` — only the infrastructure
// layer is allowed to do that.
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/**
 * Validates a route param is a well-formed Mongo ObjectId, 400ing
 * otherwise — mirrors `ParseUUIDPipe` for uuid path params, but Mongo's
 * `_id` isn't a uuid. Existence is still checked by the use-case (404);
 * this pipe only rejects malformed input before it reaches the repository.
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (!OBJECT_ID_PATTERN.test(value)) {
      throw new BadRequestException(
        `${metadata.data ?? 'id'} must be a valid ObjectId`,
      );
    }
    return value;
  }
}
