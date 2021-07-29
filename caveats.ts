import { get_html_translation_table } from 'locutus/php/strings';
import { RawPost } from './types';
import { maybeUnserialize, replaceAsync, tryCatch } from './utils';
import { getAttachmentById, getMeta } from './wp';

const characterToEntity: Record<string, string> = get_html_translation_table('HTML_SPECIALCHARS', 'ENT_QUOTES');
const entityToCharacter = Object.fromEntries(
  Object.entries(characterToEntity).map(([entity, character]) => [character, entity]),
);
entityToCharacter['&#039;'] = entityToCharacter['&#39;'];
const entitiesToReplace = Object.keys(entityToCharacter);

const UNSAFE_CHARS = '^$\\.*+?()[]{}|';
const CODEBLOCK_PATTERN = /(```\w*)(.*?)(```)/gms;

function escapeRegex(str: string) {
  return str
    .split('')
    .map((c) => {
      if (UNSAFE_CHARS.includes(c)) {
        return '\\' + c;
      }
      return c;
    })
    .join('');
}

const fieldsWhichAreArraysButShouldNotBe = [
  'dsq_thread_id',
  '_yoast_wpseo_title',
  '_yoast_wpseo_metadesc',
  '_yoast_wpseo_meta-robots-nofollow', // '1'
  '_yoast_wpseo_opengraph-image-id',
  '_yoast_wpseo_opengraph-image',
  '_yoast_wpseo_twitter-image',
  '_yoast_wpseo_focuskeywords', // array in array
  '_yoast_wpseo_focuskw_text_input',
  '_yoast_wpseo_focuskw',
  '_yoast_wpseo_is_cornerstone', // '1'
  '_yoast_wpseo_keywordsynonyms', // array in array
] as const;

const pseudoNumbers = [
  '_series_part',
  '_thumbnail_id',
  '_yoast_wpseo_linkdex',
  '_yoast_wpseo_primary_category',
  '_yoast_wpseo_content_score',
  '_yst_prominent_words_version',
  '_edit_last',
  '_edit_lock',
];

const pseudoBooleans = [
  '_yoast_wpseo_meta-robots-nofollow', // '1'
  '_yoast_wpseo_is_cornerstone', // '1'
  '_wpcom_is_markdown', // '1'
  '_bj_lazy_load_skip_post', // 'false'
  'onesignal_meta_box_present', // '1'
];

const stringifiedArrays = ['_yoast_wpseo_focuskeywords', '_yoast_wpseo_keywordsynonyms'];

// const seoFields = [
//   'seo_focuskeywords',
//   'seo_focuskw_text_input',
//   'seo_focuskw',
//   'seo_is_cornerstone',
//   'seo_keywordsynonyms',
//   'seo_meta-robots-nofollow',
//   'seo_metadesc',
//   'seo_opengraph-image-id',
//   'seo_opengraph-image',
//   'seo_title',
//   'seo_twitter-image',
// ];

export async function dealWithWordPressCaveats(post: RawPost) {
  const newMetas = post.metas_
    .map((m) => {
      if (!m.meta_key || !m.meta_value) {
        return m;
      }

      let meta_value = m.meta_value as any;

      if (stringifiedArrays.includes(m.meta_key as any) && typeof meta_value === 'string') {
        meta_value = tryCatch(() => JSON.parse(meta_value ?? '')) ?? meta_value;
      }
      if (fieldsWhichAreArraysButShouldNotBe.includes(m.meta_key as any) && Array.isArray(meta_value)) {
        meta_value = meta_value.flat();
      }
      if (pseudoBooleans.includes(m.meta_key as any) && typeof meta_value !== 'boolean') {
        const originalVal = meta_value;
        meta_value =
          meta_value === 'true' ? 'true' : meta_value === 'false' ? false : Boolean(parseInt(meta_value?.trim() ?? ''));
        if (Number.isNaN(meta_value)) {
          meta_value = originalVal;
        }
      }
      if (pseudoNumbers.includes(m.meta_key as any) && typeof meta_value !== 'number') {
        meta_value = parseFloat(meta_value?.trim() ?? '');
      }

      if (m.meta_key === '_yoast_wpseo_keywordsynonyms') {
        if (typeof meta_value === 'string') {
          meta_value = meta_value.split(',');
        }

        meta_value = meta_value
          .map((word: unknown) => (typeof word === 'string' ? word.trim() : word))
          .filter((word: unknown) => !!word);
      }

      if (m.meta_key === '_yoast_wpseo_focuskeywords') {
        meta_value = Array.isArray(meta_value)
          ? meta_value.map((v) => (typeof v === 'object' && v ? v.keyword : v))
          : meta_value;
      }

      return { ...m, meta_value };
    })
    .filter((m) => {
      return typeof m.meta_value !== 'string' || m.meta_value.trim();
    });

  return {
    ...post,
    metas_: newMetas,
    post_content: await handleShortcodes(post.post_content),
    post_content_filtered: await handleShortcodes(post.post_content_filtered),
  };
}

function replaceEntities(code: string) {
  const regexpes = entitiesToReplace.map((entity) => new RegExp(escapeRegex(entity), 'gi'));
  return regexpes.reduce(
    (block, entityPattern) => block.replace(entityPattern, (entity) => entityToCharacter[entity]),
    code,
  );
}

export function fixEntitiesInCodeBlock(post: string) {
  return post.replace(CODEBLOCK_PATTERN, (_, opening: string, code: string, closing: string) => {
    return opening + replaceEntities(code) + closing;
  });
}

function codepenReplacer(content: string): string {
  const [, height] = /data-height="(.*?)"/gi.exec(content) ?? [];
  const [, themeId] = /data-theme-id="(.*?)"/gi.exec(content) ?? [];
  const [, slugHash] = /data-slug-hash="(.*?)"/gi.exec(content) ?? [];
  const [, defaultTab] = /data-default-tab="(.*?)"/gi.exec(content) ?? [];
  const [, user] = /data-user="(.*?)"/gi.exec(content) ?? [];
  const [, embedVersion] = /data-embed-version="(.*?)"/gi.exec(content) ?? [];
  let [, penTitle] = /data-pen-title="(.*?)"/gi.exec(content) ?? [];
  if (penTitle === slugHash) {
    penTitle = '';
  }

  const props = Object.entries({ height, themeId, slugHash, defaultTab, user, embedVersion, penTitle })
    .filter(([, value]) => !!value)
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
    .join(' ');

  return `<CodepenWidget ${props}><a href="http://codepen.io/${user}/pen/${slugHash}/">Zobacz Codepen${
    penTitle ? ' ' + penTitle : ''
  }</a>.</CodepenWidget>`;
}

async function handleShortcodes(content: string) {
  const sloganWithCategory = /\[typeofweb-courses-slogan category="(.*?)"\]/gi;
  const slogan = /\[typeofweb-courses-slogan\]/gi;
  const gallery = /\[gallery\s+(.*?)\]/gi;
  const galleryInner = /((\w+)="(.*?)")/gi;
  const banner1 = `<div style="text-align: center; margin-bottom: 40px;">[typeofweb-mailchimp title=""]</div>`;
  const banner2 = `<div style="text-align: center;">[typeofweb-facebook-page]</div>`;
  const wtf = `<div class="grammarly-disable-indicator"></div>`;
  const olStart = /<ol start=(\d+)>/g;
  const styles = /<style>([\s\S]*?)<\/style>/gi;
  const scripts = /<script>([\s\S]*?)<\/script>/gi;
  const important = /(\s+)class=important(\s+|>)/gi;
  const texOpen = /\\\\\[/g;
  const texClose = /\\\\\]/g;
  const inlineTexOpen = /\\\\\(/g;
  const inlineTexClose = /\\\\\)/g;
  const more = /<!--\s*more\s*-->/;
  const caption =
    /\[caption (?<attributes>(?:\w+=".*?"\s*)*?)\](?:(?:(?<figure><(\w+).*?<\/\3>)\s*(?<caption>.*?))|(?:(?<figurevoid><(\w+).*?\/>)\s*(?<captionvoid>.*?)))\[\/caption\]/gi;
  const codepen = /<p .*?data-slug-hash=".*?<\/p>/gims;

  const almostDoneContent = content
    .replace(/language-language-/g, 'language-')
    .replace(more, `{/* more */}`)
    .replace(wtf, '')
    .replace(texOpen, '$$$$')
    .replace(texClose, '$$$$')
    .replace(inlineTexOpen, '$$')
    .replace(inlineTexClose, '$$')
    .replace(styles, '')
    .replace(scripts, '')
    .replace(olStart, '<ol start="$1">')
    .replace(important, '$1class="important"$2')
    .replace(banner1, '<NewsletterForm />')
    .replace(banner2, '<FacebookPageWidget />')
    .replace(
      slogan,
      '<a href="https://szkolenia.typeofweb.com/" target="_blank">zapisz się na szkolenie w Type of Web</a>.',
    )
    .replace(codepen, codepenReplacer)
    .replace(
      sloganWithCategory,
      '<a href="https://szkolenia.typeofweb.com/" target="_blank">zapisz się na szkolenie z $1</a>.',
    )
    .replace(
      caption,
      `
<figure $<attributes>>
  $<figure>$<figurevoid>
  <figcaption>
    $<caption>$<captionvoid>
  </figcaption>
</figure>
`,
    );

  return replaceAsync(almostDoneContent, gallery, async (_, attributes: string) => {
    const galleryAttributes = [...attributes.matchAll(galleryInner)];
    if (galleryAttributes.length < 4) {
      return '';
    }

    const parsedAttrs = (galleryAttributes as [string, string, string, string][]).reduce<Record<string, string>>(
      (acc, [, , key, val]) => {
        acc[key] = val;
        return acc;
      },
      {},
    );

    if (!('ids' in parsedAttrs)) {
      return '';
    }

    const ids = parsedAttrs.ids
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id);
    delete parsedAttrs.ids;

    const attachments = await Promise.all(ids.map((id) => getAttachmentById(Number(id))));

    const images = attachments
      .filter((a) => !!a)
      .map((att) => {
        if (att === null) {
          throw new Error();
        }

        const attMeta = att.metas_
          ? (maybeUnserialize(getMeta('_wp_attachment_metadata', att.metas_)) as {
              width?: number;
              height?: number;
            })
          : undefined;

        const title = att.post_excerpt || att.post_title || '';

        const alt = att.metas_ ? (getMeta('_wp_attachment_image_alt', att.metas_) as string) : title;

        const parsedAttrs = {
          src: att.guid,
          loading: 'lazy',
          alt,
          title,
          ...(attMeta?.width && { width: attMeta.width }),
          ...(attMeta?.height && { height: attMeta.height }),
        };

        const props = Object.entries(parsedAttrs)
          .map(([key, val]) => `${key}="${val}"`)
          .join(' ');

        return `<img ${props} />`;
      })
      .join('\n');

    const props = Object.entries(parsedAttrs)
      .map(([key, val]) => `${key}="${val}"`)
      .join(' ');

    return `
<Gallery ${props}>
  ${images}
</Gallery>
`;
  });
}
