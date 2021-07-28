import { dealWithWordPressCaveats } from './caveats';
import { postSelect } from './constants';
import { prisma } from './db';
import { RawPost } from './types';
import { maybeUnserializeMeta } from './utils';

export function getMeta(
  key: string,
  metas: {
    meta_key: string | null | undefined;
    meta_value: any;
  }[],
) {
  return metas.find((m) => m.meta_key === key && m.meta_value)?.meta_value;
}

export async function getAllPosts() {
  const rawPosts = await prisma.wp_posts.findMany({
    where: {
      post_status: 'publish', // draft, inherit
      post_type: { in: ['post', 'page'] }, // page, attachment, revision…
    },
    select: postSelect,
    orderBy: {
      post_date_gmt: 'desc',
    },
  });

  const posts = (await Promise.all(rawPosts.map(rawPostToPost))).filter((post) => !!post).map((post) => post!);

  const postsWithThumb = await Promise.all(
    posts.map(async (post) => {
      const thumbId = getMeta('_thumbnail_id', post.metas_);
      return {
        ...post,
        thumbnail: thumbId ? await getAttachmentById(thumbId) : undefined,
      };
    }),
  );

  return postsWithThumb;
}

export async function getPostById(id: number) {
  const post = await prisma.wp_posts.findUnique({
    where: {
      ID: id,
    },
    select: postSelect,
  });
  return rawPostToPost(post);
}

export async function getAttachmentById(id: number) {
  const attachment = await prisma.wp_posts.findUnique({
    where: {
      ID: id,
    },
    select: postSelect,
  });
  if (!attachment) {
    return null;
  }
  return {
    ...attachment,
    metas_: attachment.metas_.map(maybeUnserializeMeta),
  };
}

async function rawPostToPost<T extends RawPost | null | undefined>(rawPost: T, index?: number) {
  if (!rawPost) {
    return null;
  }

  return {
    ...(await dealWithWordPressCaveats({
      ...rawPost,
      metas_: rawPost.metas_.map(maybeUnserializeMeta),
    })),
    index,
  };
}
