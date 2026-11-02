/**
 * Platform captions for one finished video.
 *
 * YouTube, Facebook, Instagram and TikTok each get a title and a description that
 * belong to the render, not to the lesson: one lesson can be rendered several
 * times, and each upload carries its own wording. Until the user saves their own
 * text, the draft is derived from the lesson's publish copy, so the form never
 * opens empty — but nothing is written until Save.
 */

import { buildPublishCopy, type PublishCopyInput } from './publish-copy.ts';

export type CaptionPlatform = 'youtube' | 'facebook' | 'instagram' | 'tiktok';

export type Caption = {
  platform: CaptionPlatform;
  label: string;
  titleLimit: number;
  descriptionLimit: number;
  title: string;
  description: string;
  /** True once this video has its own saved words for the platform. */
  saved: boolean;
  updatedAt: string | null;
};

type PlatformMeta = Omit<Caption, 'title' | 'description' | 'saved' | 'updatedAt'>;

const PLATFORM_META: PlatformMeta[] = [
  { platform: 'youtube', label: 'YouTube Shorts', titleLimit: 100, descriptionLimit: 5000 },
  { platform: 'facebook', label: 'Facebook', titleLimit: 100, descriptionLimit: 2200 },
  { platform: 'instagram', label: 'Instagram', titleLimit: 100, descriptionLimit: 2200 },
  { platform: 'tiktok', label: 'TikTok', titleLimit: 100, descriptionLimit: 2200 }
];

export const CAPTION_PLATFORMS = PLATFORM_META.map((item) => item.platform);

export type SavedCaption = { platform: string; title: string; description: string; updated_at: string };

/** One field of the lesson's generated copy, by platform and field name. */
function copyField(input: PublishCopyInput, platform: string, name: string): string {
  return (
    buildPublishCopy(input)
      .find((item) => item.platform === platform)
      ?.fields.find((field) => field.name === name)?.value || ''
  );
}

/** The drafted title and description for one platform, before the user edits it. */
function draft(platform: CaptionPlatform, input: PublishCopyInput): { title: string; description: string } {
  const title = input.title;
  switch (platform) {
    case 'youtube':
      return {
        title: copyField(input, 'youtube', 'Title') || title,
        description: copyField(input, 'youtube', 'Description')
      };
    case 'tiktok':
      // TikTok has no long description field; the hashtag-led caption fits it best.
      return { title, description: copyField(input, 'instagram', 'Caption') };
    case 'instagram':
      return { title, description: copyField(input, 'instagram', 'Caption') };
    case 'facebook':
      return { title, description: copyField(input, 'facebook', 'Caption') };
  }
}

/** Every platform's caption for one video: saved words where they exist, drafts elsewhere. */
export function captionsFor(input: PublishCopyInput, saved: SavedCaption[]): Caption[] {
  return PLATFORM_META.map((meta) => {
    const fallback = draft(meta.platform, input);
    const row = saved.find((item) => item.platform === meta.platform);
    return {
      ...meta,
      title: row ? row.title : fallback.title,
      description: row ? row.description : fallback.description,
      saved: Boolean(row),
      updatedAt: row ? row.updated_at : null
    };
  });
}
