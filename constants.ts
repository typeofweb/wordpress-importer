export const postSelect = {
  ID: true,
  guid: true,
  post_title: true,
  comment_count: true,
  post_date_gmt: true,
  post_date: true,
  post_modified_gmt: true,
  post_content: true,
  post_content_filtered: true,
  post_excerpt: true,
  post_name: true,
  post_type: true,
  author_: {
    select: {
      ID: true,
      display_name: true,
      user_nicename: true,
      user_email: true,
      usermetas_: true,
    },
  },
  metas_: {
    select: {
      meta_key: true,
      meta_value: true,
    },
  },
  term_relationships_: {
    select: {
      term_order: true,
      term_taxonomy_: {
        select: {
          taxonomy: true,
          term_: {
            select: {
              term_id: true,
              name: true,
              slug: true,
              termmeta_: {
                select: {
                  meta_key: true,
                  meta_value: true,
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
