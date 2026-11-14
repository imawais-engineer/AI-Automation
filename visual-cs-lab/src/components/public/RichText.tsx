/**
 * Renders a lesson section body.
 *
 * Section text is stored as plain prose with blank-line paragraphs and `-` or
 * `1.` list lines. Rendering it literally (the old page used one <p> with
 * pre-wrap) showed bullet characters mid-sentence, so the small amount of
 * structure the authors actually write is parsed here instead of ignored.
 */

type Block = { type: 'p'; text: string } | { type: 'ul' | 'ol'; items: string[] };

const BULLET = /^[-•]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;

export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of String(body || '').replace(/\r/g, '').split(/\n{2,}/)) {
    let list: Extract<Block, { items: string[] }> | null = null;
    let paragraph: string[] = [];

    const flush = () => {
      if (paragraph.length === 0) return;
      blocks.push({ type: 'p', text: paragraph.join(' ') });
      paragraph = [];
    };

    for (const raw of chunk.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const bullet = BULLET.exec(line);
      const numbered = NUMBERED.exec(line);
      if (bullet || numbered) {
        flush();
        const type = bullet ? 'ul' : 'ol';
        if (!list || list.type !== type) {
          list = { type, items: [] };
          blocks.push(list);
        }
        list.items.push((bullet || numbered)![1]);
      } else {
        list = null;
        paragraph.push(line);
      }
    }
    flush();
  }
  return blocks;
}

export default function RichText({ body }: { body: string }) {
  return (
    <>
      {parseBody(body).map((block, index) => {
        if (block.type === 'p') return <p key={index}>{block.text}</p>;
        const List = block.type === 'ul' ? 'ul' : 'ol';
        return (
          <List key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{item}</li>
            ))}
          </List>
        );
      })}
    </>
  );
}
