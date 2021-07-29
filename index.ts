import { getAllPosts, getAttachmentById, getMeta } from './wp';

import Yaml from 'js-yaml';
import Fs from 'fs/promises';
import Path from 'path';
import { fixEntitiesInCodeBlock } from './caveats';
import { maybeUnserialize, uniq } from './utils';
import Crypto from 'crypto';
import { RawPost } from './types';

async function getGravatar({
  user_email,
  user_nicename,
  display_name,
}: {
  user_email: string;
  user_nicename: string;
  display_name: string;
}) {
  const hash = Crypto.createHash('md5').update(user_email.trim().toLowerCase()).digest('hex');
  const _initials = display_name
    .trim()
    .split(' ')
    .map((w) => w[0])
    .join('');
  const _initials2 = user_nicename
    .trim()
    .split('-')
    .map((w) => w[0])
    .join('');
  // const alternative = encodeURIComponent(`https://avatars.dicebear.com/api/initials/${initials || initials2}.svg`);
  return `https://secure.gravatar.com/avatar/${hash}`;
}

type PromiseValue<T> = T extends PromiseLike<infer R> ? R : T;

async function run() {
  const postsWithThumb = await getAllPosts();
  const basePath = Path.resolve(__dirname, '..', 'design-tailwind', 'wordpress_posts');

  // taxonomies
  // category
  // nav_menu
  // post_format
  // post_tag
  // series
  // yst_prominent_words

  const authorsMap = new Map<string, RawPost['author_']>();

  const postsToSave = await Promise.all(
    postsWithThumb.map(async (post) => {
      const isMarkdown =
        !!getMeta('_wpcom_is_markdown', post.metas_) &&
        post.post_content_filtered.includes('## ') &&
        !post.post_content_filtered.includes('<pre class="') &&
        !post.post_content_filtered.includes('<code class="');

      const focusKeywords: Array<string> | undefined = getMeta('_yoast_wpseo_focuskeywords', post.metas_);
      const focusKeywordSynonyms: Array<string> | undefined = getMeta('_yoast_wpseo_keywordsynonyms', post.metas_);
      const legacyKeyword: string | undefined = getMeta('_yoast_wpseo_focuskw', post.metas_);

      const allKeywords = [focusKeywords, legacyKeyword].flat().filter((word) => !!word);

      authorsMap.set(post.author_.user_nicename, post.author_);

      const thumbnailMeta = post.thumbnail
        ? (maybeUnserialize(getMeta('_wp_attachment_metadata', post.thumbnail.metas_)) as {
            width?: number;
            height?: number;
          })
        : undefined;

      const frontmatter = {
        id: Number(post.ID),
        index: postsWithThumb.length - post.index!,
        title: post.post_title,
        date: post.post_date_gmt,
        isMarkdown,
        status: 'publish',
        permalink: post.post_name,
        authors: [post.author_.user_nicename],
        guid: post.guid,
        type: post.post_type,
        thumbnail: post.thumbnail
          ? { url: post.thumbnail.guid, width: Number(thumbnailMeta!.width), height: Number(thumbnailMeta!.height) }
          : undefined,
        categories: post.term_relationships_
          .filter((t) => t.term_taxonomy_.taxonomy === 'category')
          .map((t) => ({ slug: t.term_taxonomy_.term_.slug, name: t.term_taxonomy_.term_.name })),
        series: post.term_relationships_
          .filter((t) => t.term_taxonomy_.taxonomy === 'series')
          .map((t) => ({ slug: t.term_taxonomy_.term_.slug, name: t.term_taxonomy_.term_.name }))?.[0],
        seo: {
          focusKeywords: allKeywords?.length ? uniq(allKeywords) : undefined,
          focusKeywordSynonyms: focusKeywordSynonyms?.length ? uniq(focusKeywordSynonyms) : undefined,
        },
      };

      // @todo ?
      const body = isMarkdown ? fixEntitiesInCodeBlock(post.post_content_filtered) : post.post_content;

      return { body, frontmatter };
    }),
  );

  await Promise.all(
    postsToSave.map(async ({ body, frontmatter }) => {
      const fileContent =
        `
---
${Yaml.dump(frontmatter)}
---
${body}
        `.trim() + '\n';

      if (frontmatter.type === 'post') {
        const year = frontmatter.date.getFullYear().toString();
        const month = (frontmatter.date.getMonth() + 1).toString().padStart(2, '0');

        await Fs.mkdir(Path.join(basePath, year, month), { recursive: true });
        await Fs.writeFile(Path.join(basePath, year, month, frontmatter.permalink + '.md'), fileContent, 'utf-8');
      } else if (frontmatter.type === 'page') {
        await Fs.writeFile(Path.join(basePath, frontmatter.permalink + '.md'), fileContent, 'utf-8');
      }
    }),
  );

  const USER_META_FIELDS = [
    'first_name',
    'last_name',
    'description',
    'facebook',
    'instagram',
    'linkedin',
    'twitter',
    'youtube',
  ] as const;
  type UserMeta = Partial<Record<typeof USER_META_FIELDS[number], string>>;

  const authors = await Promise.all(
    Array.from(authorsMap).map(async ([slug, user]) => {
      const avatarAttachmentId = getMeta('wp_user_avatar', user.usermetas_) as string | number | null | undefined;
      const avatarUrl = avatarAttachmentId
        ? (await getAttachmentById(Number(avatarAttachmentId)))?.guid || (await getGravatar(user))
        : await getGravatar(user);

      return {
        slug,
        displayName: user.display_name,
        avatarUrl,
        meta: Object.fromEntries(
          user.usermetas_
            .filter((meta) => meta.meta_key && USER_META_FIELDS.includes(meta.meta_key as any))
            .map((meta) => [meta.meta_key, meta.meta_value]),
        ) as UserMeta,
      };
    }),
  );

  await Fs.writeFile(Path.join(basePath, 'authors.json'), JSON.stringify(authors, null, 2), 'utf-8');
}

run()
  .then(() => process.exit())
  .catch((err) => console.error(err));
