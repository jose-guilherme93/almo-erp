export type AttachmentItem = {
  id: string;
  fileName: string;
  mimeType: string;
  createdAt: Date;
};

/** Galeria de imagens anexadas a uma solicitação ou chamado. */
export function AttachmentGallery({ items }: { items: AttachmentItem[] }) {
  if (items.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item.id}>
          <a
            href={`/api/anexos/${item.id}`}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-md border"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/anexos/${item.id}`}
              alt={item.fileName}
              className="h-24 w-24 object-cover"
              width={96}
              height={96}
              loading="lazy"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}
