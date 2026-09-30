import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

// Marks a route that SecurityGuard lets through without a Bearer JWT.
export const Public = () => SetMetadata(IS_PUBLIC, true);
