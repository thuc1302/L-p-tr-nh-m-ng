import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { query, tx } from './db.js';
import { directKey } from './services/conversations.js';

const DEMO_PASSWORD = 'Demo@12345';
const DEMO_USERS = [
  ['an.nguyen', 'an@chatly.local', 'Nguyễn Văn An', 'Thích cà phê và code dạo'],
  ['binh.tran', 'binh@chatly.local', 'Trần Thị Bình', 'Sinh viên năm ba'],
  ['cuong.le', 'cuong@chatly.local', 'Lê Quốc Cường', ''],
];
const DEMO_CHAT = [
  [0, 'Chào Bình, tối nay nhóm mình họp lúc mấy giờ?'],
  [1, 'Chào An, 8 giờ tối nhé.'],
  [0, 'Ok, mình sẽ chuẩn bị phần thiết kế cơ sở dữ liệu.'],
  [1, 'Tuyệt, mình làm phần giao diện.'],
];

export async function seed() {
  if (config.adminEmail && config.adminPassword) {
    const hash = await bcrypt.hash(config.adminPassword, 12);
    await query(
      `INSERT INTO users(email, username, display_name, password_hash, role)
       VALUES ($1, 'admin', 'Quản trị viên', $2, 'admin') ON CONFLICT DO NOTHING`,
      [config.adminEmail, hash],
    );
  }
  if (!config.seedDemo) return;

  const { rowCount } = await query(`SELECT 1 FROM users WHERE username = 'an.nguyen'`);
  if (rowCount) return;

  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
  await tx(async (c) => {
    const ids = [];
    for (const [username, email, name, bio] of DEMO_USERS) {
      const { rows } = await c.query(
        `INSERT INTO users(email, username, display_name, password_hash, bio)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [email, username, name, hash, bio],
      );
      ids.push(rows[0].id);
    }
    const pair = [ids[0], ids[1]];
    const { rows } = await c.query(
      `INSERT INTO conversations(direct_key, created_by, last_message_at)
       VALUES ($1, $2, now()) RETURNING id`,
      [directKey(...pair), pair[0]],
    );
    const conversationId = rows[0].id;
    let lastId = 0;
    for (const [i, [who, content]] of DEMO_CHAT.entries()) {
      const res = await c.query(
        `INSERT INTO messages(conversation_id, sender_id, client_message_id, content, created_at)
         VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5)) RETURNING id`,
        [conversationId, pair[who], randomUUID(), content, (DEMO_CHAT.length - i) * 5],
      );
      lastId = res.rows[0].id;
    }
    for (const userId of pair) {
      await c.query(
        `INSERT INTO conversation_members(conversation_id, user_id, last_delivered_message_id, last_read_message_id)
         VALUES ($1, $2, $3, $3)`,
        [conversationId, userId, lastId],
      );
    }
  });
  console.log('Da tao du lieu demo');
}
