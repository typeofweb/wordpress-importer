import { Prisma } from '@prisma/client';

export type RawPost = Prisma.wp_postsGetPayload<{ select: typeof import('./constants').postSelect }>;
