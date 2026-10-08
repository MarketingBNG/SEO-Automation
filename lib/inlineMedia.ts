// Moves a draft's body images to the WordPress Media Library at publish time. The media id and URL
// are remembered on the image record, so a publish that fails halfway and runs again reuses the
// images already uploaded.
import prisma from './prisma';
import { uploadMedia } from './wordpress';
import { publishInlineImages, type Media } from './blogImages';

export async function publishDraftImages(draftId: number, html: string) {
  const rows = await prisma.draft_images.findMany({ where: { draft_id: draftId }, include: { image: { select: { path: true, wp_media_id: true, wp_url: true } } } });
  const known: Record<string, Media> = {};
  for (const r of rows) if (r.image.wp_media_id && r.image.wp_url) known[r.image.path] = { id: r.image.wp_media_id, url: r.image.wp_url };
  return publishInlineImages(
    html,
    async (key, alt) => {
      const m = await uploadMedia(key, { altText: alt });
      await prisma.image_library.updateMany({ where: { path: key }, data: { wp_media_id: m.id, wp_url: m.url } });
      return { id: m.id, url: m.url };
    },
    known,
  );
}
