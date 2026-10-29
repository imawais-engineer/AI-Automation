/**
 * The lesson's table of contents.
 *
 * One list, built from the sections the lesson actually has, so every link
 * points at a heading that exists. Optional parts of the lesson (a video, a
 * knowledge check, common mistakes) are simply absent from the list when the
 * lesson does not include them.
 */

export type ContentsItem = { id: string; label: string };

export default function LessonContents({ items }: { items: ContentsItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav className="p-contents" aria-label="Lesson contents">
      <span className="p-eyebrow">Lesson contents</span>
      <ol>
        {items.map((item, index) => (
          <li key={item.id}>
            <a href={`#${item.id}`}>
              <span className="p-contents-index">{String(index + 1).padStart(2, '0')}</span>
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
