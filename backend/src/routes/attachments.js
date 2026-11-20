import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { query } from '../db.js';
import { HttpError } from '../errors.js';
import { uuidParam } from '../validation.js';

export const attachmentsRouter = Router();
attachmentsRouter.use(requireAuth);

// Chi thanh vien hoi thoai moi xem duoc anh; anh cua tin da thu hoi khong con truy cap duoc.
attachmentsRouter.get('/:id', async (req, res) => {
  const id = uuidParam(req.params.id);
  const { rows } = await query(
    `SELECT a.storage_key FROM attachments a
     JOIN messages m ON m.id = a.message_id
     JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $2
     WHERE a.id = $1 AND m.deleted_at IS NULL`,
    [id, req.user.id],
  );
  if (!rows[0]) throw new HttpError(404, 'Không tìm thấy ảnh');
  res.sendFile(
    rows[0].storage_key,
    { root: config.uploadDir, cacheControl: false, headers: { 'Cache-Control': 'private, max-age=86400' } },
    (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Không tìm thấy ảnh' });
    },
  );
});
