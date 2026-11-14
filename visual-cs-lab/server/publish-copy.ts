/**
 * Per-platform publish copy.
 *
 * Each destination gets the shape its own feed expects — a short Facebook caption,
 * a hook-first Instagram caption with a save prompt, a professional LinkedIn post
 * in Unicode bold, one post under 280 characters for X, and a titled Short with a
 * description and tags for YouTube. Everything is plain Unicode: no markdown
 * symbols, no email, no personal identifiers — only the lesson's own content.
 *
 * The copy is derived from the lesson and its verified trace, so regenerating a
 * video cannot leave its captions describing a different result.
 */

export type PublishPlatform = 'facebook' | 'instagram' | 'linkedin' | 'x' | 'youtube';

export type PublishField = { name: string; value: string };

export type PlatformCopy = {
  platform: PublishPlatform;
  label: string;
  hint: string;
  fields: PublishField[];
  /** Everything in `fields`, separated by blank lines: what the copy button takes. */
  text: string;
  /** Character ceiling the platform enforces, when it has one. */
  limit?: number;
  /** Longest field measured against the limit. */
  used?: number;
};

export type PublishCopyInput = {
  title: string;
  hook: string;
  takeaway: string;
  time: string;
  space: string;
  category: string;
  slug: string;
  /** The video's real length in seconds: the copy never claims a fixed slot. */
  seconds?: number;
};

// The sans-serif bold and italic alphabets, in code-point order. They are built
// from the blocks' base code points rather than typed out, so a letter can never
// be shifted by a copy-paste slip.
const BOLD_UPPER_CHARS = Array.from({ length: 26 }, (_, i) => String.fromCodePoint(0x1d5d4 + i));
const BOLD_LOWER_CHARS = Array.from({ length: 26 }, (_, i) => String.fromCodePoint(0x1d5ee + i));
const ITALIC_UPPER_CHARS = Array.from({ length: 26 }, (_, i) => String.fromCodePoint(0x1d608 + i));
const ITALIC_LOWER_CHARS = Array.from({ length: 26 }, (_, i) => String.fromCodePoint(0x1d622 + i));

/** A-Z / a-z to Unicode bold. Anything else is left exactly as it is. */
export function toBold(text: string): string {
  return String(text).replace(/[A-Za-z]/g, (letter) => {
    const index = letter.charCodeAt(0) - (letter >= 'a' ? 97 : 65);
    return letter >= 'a' ? BOLD_LOWER_CHARS[index] : BOLD_UPPER_CHARS[index];
  });
}

/** A-Z / a-z to Unicode italics. Digits and punctuation stay as they are. */
export function toItalic(text: string): string {
  return String(text).replace(/[A-Za-z]/g, (letter) => {
    const index = letter.charCodeAt(0) - (letter >= 'a' ? 97 : 65);
    return letter >= 'a' ? ITALIC_LOWER_CHARS[index] : ITALIC_UPPER_CHARS[index];
  });
}

function tag(word: string): string {
  const cleaned = String(word)
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
  return cleaned ? `#${cleaned}` : '';
}

/** The lesson's own topic plus the study tags its audience follows. */
function hashtags(input: PublishCopyInput): string[] {
  const topic = tag(input.title || input.slug);
  const core = [
    topic,
    '#DataStructures',
    '#Algorithms',
    '#ComputerScience',
    '#DSA',
    '#CodingInterview',
    '#LearnToCode',
    '#VisualLearning',
    '#Programming',
    '#Shorts'
  ];
  return core.filter(Boolean);
}

/** A one-line premise that reads as a complete sentence. */
function premise(input: PublishCopyInput): string {
  const hook = String(input.hook || '').trim().replace(/\s+/g, ' ');
  if (hook) return hook.endsWith('.') ? hook : `${hook}.`;
  return `${input.title}: the idea in one short.`;
}

/** The lesson's own length, phrased for a caption. */
function lengthPhrase(input: PublishCopyInput): string {
  const seconds = Math.round(Number(input.seconds) || 0);
  if (seconds <= 0) return 'one visual short';
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} minutes` : `${minutes}m ${rest}s`;
}

function youtubeTitle(input: PublishCopyInput): string {
  const length = lengthPhrase(input);
  const candidates = [
    `${input.title} — the core idea in ${length}`,
    `${input.title} explained visually in ${length}`,
    `${input.title} in ${length}`
  ];
  return candidates.find((value) => value.length <= 68) || `${input.title}`.slice(0, 68);
}

function fieldsCopy(
  platform: PublishPlatform,
  label: string,
  hint: string,
  fields: PublishField[],
  limit?: number,
  measured?: string
): PlatformCopy {
  const text = fields.map((field) => field.value).join('\n\n');
  return {
    platform,
    label,
    hint,
    fields,
    text,
    limit,
    used: limit ? (measured ?? text).length : undefined
  };
}

/** The five platform posts for one lesson. */
export function buildPublishCopy(input: PublishCopyInput): PlatformCopy[] {
  const tags = hashtags(input);
  const premiseLine = premise(input);
  const takeaway = String(input.takeaway || '').trim();
  const time = String(input.time || '').trim();
  const space = String(input.space || '').trim();
  const cost = [time && `Time: ${time}`, space && `Space: ${space}`].filter(Boolean).join(' · ');

  const facebookBody = [
    premiseLine,
    takeaway ? `${takeaway}` : `${input.title} — explained visually, no slides to read.`,
    cost,
    tags.slice(0, 4).join(' ')
  ]
    .filter(Boolean)
    .join('\n\n');

  const instagramBody = [
    premiseLine,
    `${input.title} — built to be watched, not skimmed. The animation follows the real algorithm, step by step.`,
    cost,
    'Save this for your next coding session 🔖',
    tags.slice(0, 10).join(' ')
  ]
    .filter(Boolean)
    .join('\n\n');

  const linkedinHeadline = toBold(`${input.title}: the idea in ${lengthPhrase(input)}`);
  const linkedinAngle = `${toItalic('Learning angle')}: the visual shows the trace, not a summary of it — every step is one the algorithm actually took.`;
  const linkedinBody = [
    linkedinHeadline,
    '',
    premiseLine,
    'Most explanations stop at the definition. The animation keeps going: each operation is drawn as it happens, so the cost becomes something you can see rather than memorise.',
    linkedinAngle,
    cost,
    tags.slice(0, 5).join(' ')
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n');

  const xPost = `${input.title}: ${premiseLine.replace(/\.$/, '')} ${cost ? cost + '.' : ''} ${tags.slice(0, 2).join(' ')}`
    .replace(/\s+/g, ' ')
    .trim();

  const youtubeDescription = [
    premiseLine,
    '',
    `${input.title}, animated end to end. ${takeaway || 'The idea, the trace and the cost, in under a minute.'}`,
    cost,
    '',
    tags.slice(0, 8).join(' ')
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n');

  const youtubeTags = tags
    .map((value) => value.replace(/^#/, ''))
    .concat(['visual algorithms', 'computer science shorts'])
    .join(', ');

  return [
    fieldsCopy('facebook', 'Facebook', 'Short caption plus 3–5 hashtags.', [
      { name: 'Caption', value: facebookBody }
    ]),
    fieldsCopy('instagram', 'Instagram', 'Hook, then 8–12 hashtags and a save prompt.', [
      { name: 'Caption', value: instagramBody }
    ]),
    fieldsCopy('linkedin', 'LinkedIn', 'Professional post in Unicode bold and italics.', [
      { name: 'Post', value: linkedinBody }
    ]),
    fieldsCopy('x', 'X', 'One post, 1–2 hashtags, no links.', [
      { name: 'Post', value: xPost }
    ], 280, xPost),
    fieldsCopy('youtube', 'YouTube Shorts', 'Title under 70 characters, description and tags.', [
      { name: 'Title', value: youtubeTitle(input) },
      { name: 'Description', value: youtubeDescription },
      { name: 'Tags', value: youtubeTags }
    ])
  ];
}
