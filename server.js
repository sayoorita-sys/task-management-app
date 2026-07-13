const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("."));

process.on("exit", (code) => {
  console.log(`サーバープロセスが終了しました。終了コード: ${code}`);
});

process.on("SIGINT", () => {
  console.log("Ctrl+C でサーバーを停止しました。");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM を受け取ったためサーバーを停止しました。");
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  console.error("予期しないエラーでサーバーが停止しました。", error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  console.error("非同期処理のエラーでサーバーが停止しました。", error);
  process.exit(1);
});

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL が設定されていません。RenderのDB接続URLを環境変数に入れてください。");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
  query_timeout: 8000,
});

function handleError(res, error, message) {
  console.error(message, error);
  res.status(500).json({ error: message, detail: error.message });
}

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, cookie) => {
    const [rawName, ...rawValue] = cookie.trim().split("=");

    if (!rawName) {
      return cookies;
    }

    cookies[rawName] = decodeURIComponent(rawValue.join("="));
    return cookies;
  }, {});
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
  const [salt, storedHash] = String(storedPassword || "").split(":");

  if (!salt || !storedHash) {
    return false;
  }

  const hash = crypto.scryptSync(password, salt, 64);
  const storedBuffer = Buffer.from(storedHash, "hex");

  return storedBuffer.length === hash.length && crypto.timingSafeEqual(storedBuffer, hash);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sessionCookie(token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}${secure}`;
}

function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

async function ensureUserDefaultFolder(userId) {
  await pool.query(
    `INSERT INTO folders (name, user_id)
     SELECT 'tasks', $1
     WHERE NOT EXISTS (
       SELECT 1 FROM folders WHERE user_id = $1 AND name = 'tasks'
     )`,
    [userId],
  );
}

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO auth_sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '30 days')`,
    [hashToken(token), userId],
  );
  res.setHeader("Set-Cookie", sessionCookie(token));
}

async function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.session;

  if (!token) {
    res.status(401).json({ error: "ログインしてください。" });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT users.id, users.name, users.email
       FROM auth_sessions
       JOIN users ON users.id = auth_sessions.user_id
       WHERE auth_sessions.token_hash = $1
         AND auth_sessions.expires_at > CURRENT_TIMESTAMP`,
      [hashToken(token)],
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: "ログインしてください。" });
      return;
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    handleError(res, error, "ログイン確認に失敗しました。");
  }
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  res.json(req.user);
});

app.post("/api/auth/register", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!name || !email || password.length < 6) {
    res.status(400).json({ error: "名前、メールアドレス、6文字以上のパスワードを入力してください。" });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const userResult = await client.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email`,
      [name, email, hashPassword(password)],
    );
    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO folders (name, user_id)
       SELECT 'tasks', $1
       WHERE NOT EXISTS (
         SELECT 1 FROM folders WHERE user_id = $1 AND name = 'tasks'
       )`,
      [user.id],
    );
    await client.query("COMMIT");
    await createSession(res, user.id);
    res.json(user);
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      res.status(400).json({ error: "このメールアドレスはすでに登録されています。" });
      return;
    }

    handleError(res, error, "ユーザー登録に失敗しました。");
  } finally {
    client.release();
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  try {
    const result = await pool.query(
      "SELECT id, name, email, password_hash FROM users WHERE email = $1",
      [email],
    );

    if (result.rows.length === 0 || !verifyPassword(password, result.rows[0].password_hash)) {
      res.status(400).json({ error: "メールアドレスまたはパスワードが違います。" });
      return;
    }

    const user = result.rows[0];
    await ensureUserDefaultFolder(user.id);
    await createSession(res, user.id);
    res.json({ id: user.id, name: user.name, email: user.email });
  } catch (error) {
    handleError(res, error, "ログインに失敗しました。");
  }
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);

  try {
    if (cookies.session) {
      await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [hashToken(cookies.session)]);
    }

    res.setHeader("Set-Cookie", clearSessionCookie());
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "ログアウトに失敗しました。");
  }
});

app.use("/api", requireAuth);

app.delete("/api/reset-data", async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM tasks WHERE user_id = $1", [req.user.id]);
    await client.query("DELETE FROM tags WHERE user_id = $1", [req.user.id]);
    await client.query("DELETE FROM folders WHERE user_id = $1", [req.user.id]);
    await client.query("INSERT INTO folders (name, user_id) VALUES ('tasks', $1)", [req.user.id]);
    await client.query("COMMIT");

    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    handleError(res, error, "データリセットに失敗しました。");
  } finally {
    client.release();
  }
});

async function setupDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      is_completed BOOLEAN DEFAULT false,
      due_date DATE,
      estimated_minutes INTEGER,
      tag_name TEXT,
      tag_color TEXT DEFAULT '#38bdf8',
      folder_name TEXT DEFAULT 'tasks',
      custom_order INTEGER,
      is_hidden BOOLEAN DEFAULT false,
      completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT false");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date DATE");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tag_name TEXT");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tag_color TEXT DEFAULT '#38bdf8'");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS folder_name TEXT DEFAULT 'tasks'");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS custom_order INTEGER");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
  await pool.query("UPDATE tasks SET custom_order = id WHERE custom_order IS NULL");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tags (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT UNIQUE NOT NULL,
      color TEXT NOT NULL DEFAULT '#38bdf8',
      is_hidden BOOLEAN DEFAULT false
    );
  `);

  await pool.query("ALTER TABLE tags ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
  await pool.query("ALTER TABLE tags ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false");
  await pool.query("ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_key");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS tags_user_name_unique ON tags (user_id, name) WHERE user_id IS NOT NULL");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS folders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT UNIQUE NOT NULL
    );
  `);

  await pool.query("ALTER TABLE folders ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
  await pool.query("ALTER TABLE folders DROP CONSTRAINT IF EXISTS folders_name_key");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS folders_user_name_unique ON folders (user_id, name) WHERE user_id IS NOT NULL");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS time_logs (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ended_at TIMESTAMP,
      duration_minutes NUMERIC(10, 2)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subtasks (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      is_completed BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

app.get("/api/tasks", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        tasks.*,
        EXISTS (
          SELECT 1
          FROM time_logs
          WHERE time_logs.task_id = tasks.id
            AND time_logs.ended_at IS NULL
        ) AS is_timer_running,
        (
          SELECT started_at
          FROM time_logs
          WHERE time_logs.task_id = tasks.id
            AND time_logs.ended_at IS NULL
          ORDER BY started_at DESC
          LIMIT 1
        ) AS active_started_at,
        (
          SELECT FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)))
          FROM time_logs
          WHERE time_logs.task_id = tasks.id
            AND time_logs.ended_at IS NULL
          ORDER BY started_at DESC
          LIMIT 1
        ) AS active_elapsed_seconds,
        COALESCE((
          SELECT FLOOR(SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, CURRENT_TIMESTAMP) - started_at))))
          FROM time_logs
          WHERE time_logs.task_id = tasks.id
        ), 0) AS total_elapsed_seconds
      FROM tasks
      WHERE tasks.user_id = $1
      ORDER BY is_completed ASC, id ASC
    `, [req.user.id]);

    const subtasksResult = await pool.query(`
      SELECT subtasks.*
      FROM subtasks
      JOIN tasks ON tasks.id = subtasks.task_id
      WHERE tasks.user_id = $1
      ORDER BY id ASC
    `, [req.user.id]);

    const subtasksByTaskId = subtasksResult.rows.reduce((groups, subtask) => {
      if (!groups[subtask.task_id]) {
        groups[subtask.task_id] = [];
      }

      groups[subtask.task_id].push(subtask);
      return groups;
    }, {});

    const tasks = result.rows.map((task) => ({
      ...task,
      subtasks: subtasksByTaskId[task.id] || [],
    }));

    res.json(tasks);
  } catch (error) {
    handleError(res, error, "タスク一覧の取得に失敗しました。");
  }
});

app.get("/api/folders", async (req, res) => {
  try {
    await ensureUserDefaultFolder(req.user.id);
    const result = await pool.query(
      "SELECT * FROM folders WHERE user_id = $1 ORDER BY name ASC",
      [req.user.id],
    );
    res.json(result.rows);
  } catch (error) {
    handleError(res, error, "フォルダ一覧の取得に失敗しました。");
  }
});

app.post("/api/folders", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();

    if (!name) {
      res.status(400).json({ error: "フォルダ名を入力してください。" });
      return;
    }

    const result = await pool.query(
      `INSERT INTO folders (name, user_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, name) WHERE user_id IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [name, req.user.id],
    );

    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error, "フォルダの追加に失敗しました。");
  }
});

app.get("/api/tags", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM tags WHERE user_id = $1 ORDER BY is_hidden ASC, name ASC",
      [req.user.id],
    );
    res.json(result.rows);
  } catch (error) {
    handleError(res, error, "タグ一覧の取得に失敗しました。");
  }
});

app.patch("/api/tags/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE tags
       SET is_hidden = $1
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [req.body.is_hidden, req.params.id, req.user.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "タグが見つかりませんでした。" });
      return;
    }

    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error, "タグの表示設定に失敗しました。");
  }
});

app.post("/api/tasks", async (req, res) => {
  console.log("タスク追加リクエスト:", req.body);

  try {
    let tagColor = req.body.tag_color || "#38bdf8";
    const tagName = String(req.body.tag_name || "").trim();
    const folderName = String(req.body.folder_name || "").trim() || "tasks";

    await pool.query(
      `INSERT INTO folders (name, user_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, name) WHERE user_id IS NOT NULL
       DO NOTHING`,
      [folderName, req.user.id],
    );

    if (tagName) {
      const tagResult = await pool.query(
        `INSERT INTO tags (name, color, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, name) WHERE user_id IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name
         RETURNING *`,
        [tagName, tagColor, req.user.id],
      );

      tagColor = tagResult.rows[0].color;
    }

    const result = await pool.query(
      `INSERT INTO tasks (title, due_date, estimated_minutes, tag_name, tag_color, folder_name, custom_order, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE((SELECT MAX(custom_order) + 1 FROM tasks WHERE user_id = $7), 1), $7)
       RETURNING *`,
      [
        req.body.title,
        req.body.due_date || null,
        req.body.estimated_minutes || null,
        tagName || null,
        tagColor,
        folderName,
        req.user.id,
      ],
    );

    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error, "タスクの追加に失敗しました。");
  }
});

app.post("/api/tasks/:id/subtasks", async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();

    if (!title) {
      res.status(400).json({ error: "サブタスク名を入力してください。" });
      return;
    }

    const result = await pool.query(
      `INSERT INTO subtasks (task_id, title)
       SELECT $1, $2
       WHERE EXISTS (
         SELECT 1 FROM tasks WHERE id = $1 AND user_id = $3
       )
       RETURNING *`,
      [req.params.id, title, req.user.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "タスクが見つかりませんでした。" });
      return;
    }

    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error, "サブタスクの追加に失敗しました。");
  }
});

app.patch("/api/tasks/reorder", async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];

  if (ids.length === 0) {
    res.status(400).json({ error: "並び替えるタスクを選択してください。" });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (let index = 0; index < ids.length; index += 1) {
      await client.query(
        "UPDATE tasks SET custom_order = $1 WHERE id = $2 AND user_id = $3",
        [index + 1, ids[index], req.user.id],
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    handleError(res, error, "タスクの並び替え保存に失敗しました。");
  } finally {
    client.release();
  }
});

app.patch("/api/subtasks/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE subtasks
       SET is_completed = $1
       WHERE id = $2
         AND EXISTS (
           SELECT 1 FROM tasks
           WHERE tasks.id = subtasks.task_id
             AND tasks.user_id = $3
         )
       RETURNING *`,
      [req.body.is_completed, req.params.id, req.user.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "サブタスクが見つかりませんでした。" });
      return;
    }

    const subtask = result.rows[0];
    const statusResult = await pool.query(
      `SELECT
         COUNT(*)::int AS total_count,
         COUNT(*) FILTER (WHERE is_completed = true)::int AS completed_count
       FROM subtasks
       JOIN tasks ON tasks.id = subtasks.task_id
       WHERE subtasks.task_id = $1 AND tasks.user_id = $2`,
      [subtask.task_id, req.user.id],
    );

    const status = statusResult.rows[0];

    if (status.total_count > 0 && status.total_count === status.completed_count) {
      await pool.query(
        `UPDATE time_logs
         SET ended_at = CURRENT_TIMESTAMP,
             duration_minutes = ROUND((EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) / 60)::numeric, 2)
         WHERE task_id = $1 AND ended_at IS NULL`,
        [subtask.task_id],
      );

      await pool.query(
        `UPDATE tasks
         SET is_completed = true,
             is_hidden = false,
             completed_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [subtask.task_id],
      );
    }

    res.json(subtask);
  } catch (error) {
    handleError(res, error, "サブタスクの更新に失敗しました。");
  }
});

app.patch("/api/tasks/:id", async (req, res) => {
  try {
    if (req.body.is_completed === true) {
      await pool.query(
        `UPDATE time_logs
         SET ended_at = CURRENT_TIMESTAMP,
             duration_minutes = ROUND((EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) / 60)::numeric, 2)
         WHERE task_id = $1
           AND ended_at IS NULL
           AND EXISTS (
             SELECT 1 FROM tasks
             WHERE tasks.id = time_logs.task_id
               AND tasks.user_id = $2
           )`,
        [req.params.id, req.user.id],
      );
    }

    if (typeof req.body.is_hidden === "boolean") {
      const result = await pool.query(
        "UPDATE tasks SET is_hidden = $1 WHERE id = $2 AND user_id = $3 RETURNING *",
        [req.body.is_hidden, req.params.id, req.user.id],
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "タスクが見つかりませんでした。" });
        return;
      }

      res.json(result.rows[0]);
      return;
    }

    if (typeof req.body.folder_name === "string") {
      const folderName = req.body.folder_name.trim();

      if (!folderName) {
        res.status(400).json({ error: "移動先フォルダを選択してください。" });
        return;
      }

      const folderResult = await pool.query(
        "SELECT 1 FROM folders WHERE name = $1 AND user_id = $2",
        [folderName, req.user.id],
      );

      if (folderResult.rows.length === 0) {
        res.status(400).json({ error: "存在するフォルダを選択してください。" });
        return;
      }

      const result = await pool.query(
        "UPDATE tasks SET folder_name = $1 WHERE id = $2 AND user_id = $3 RETURNING *",
        [folderName, req.params.id, req.user.id],
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "タスクが見つかりませんでした。" });
        return;
      }

      res.json(result.rows[0]);
      return;
    }

    const result = await pool.query(
      `UPDATE tasks
       SET is_completed = $1,
           is_hidden = false,
           completed_at = CASE WHEN $1 = true THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [req.body.is_completed, req.params.id, req.user.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "タスクが見つかりませんでした。" });
      return;
    }

    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error, "タスクの更新に失敗しました。");
  }
});

//開始API
app.post("/api/tasks/:id/timer/start", async (req, res) => {
  try {
    await pool.query(
      `UPDATE time_logs
       SET ended_at = CURRENT_TIMESTAMP,
           duration_minutes = ROUND((EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) / 60)::numeric, 2)
       WHERE task_id = $1
         AND ended_at IS NULL
         AND EXISTS (
           SELECT 1 FROM tasks
           WHERE tasks.id = time_logs.task_id
             AND tasks.user_id = $2
         )`,
      [req.params.id, req.user.id],
    );

    const result = await pool.query(
      `INSERT INTO time_logs (task_id)
       SELECT $1
       WHERE EXISTS (
         SELECT 1 FROM tasks WHERE id = $1 AND user_id = $2
       )
       RETURNING *`,
      [req.params.id, req.user.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "タスクが見つかりませんでした。" });
      return;
    }

    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error, "タイマー開始に失敗しました。");
  }
});

//停止API
app.post("/api/tasks/:id/timer/stop", async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE time_logs
       SET ended_at = CURRENT_TIMESTAMP,
           duration_minutes = ROUND((EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) / 60)::numeric, 2)
       WHERE id = (
         SELECT id
         FROM time_logs
         JOIN tasks ON tasks.id = time_logs.task_id
         WHERE task_id = $1 AND ended_at IS NULL
           AND tasks.user_id = $2
         ORDER BY started_at DESC
         LIMIT 1
       )
       RETURNING *`,
      [req.params.id, req.user.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "開始中のタイマーが見つかりませんでした。" });
      return;
    }

    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error, "タイマー停止に失敗しました。");
  }
});

//日ごとの作業時間の合計を取得するAPI
app.get("/api/reports/work-time", async (req, res) => {
  const range = ["day", "week", "month"].includes(req.query.range)
    ? req.query.range
    : "day";
  const anchorDate = req.query.date || new Date().toISOString().slice(0, 10);
  const dateStart = {
    day: "$1::date",
    week: "DATE_TRUNC('week', $1::date)::date",
    month: "DATE_TRUNC('month', $1::date)::date",
  }[range];
  const dateEnd = {
    day: "$1::date",
    week: "DATE_TRUNC('week', $1::date)::date + INTERVAL '6 days'",
    month: "DATE_TRUNC('month', $1::date)::date + INTERVAL '1 month - 1 day'",
  }[range];

  try {
    const result = await pool.query(
      `WITH days AS (
       SELECT generate_series(
           ${dateStart},
           ${dateEnd},
           '1 day'::interval
         )::date AS work_date
       )
       SELECT
         TO_CHAR(days.work_date, 'YYYY-MM-DD') AS work_date,
         ROUND(COALESCE(SUM(EXTRACT(EPOCH FROM (time_logs.ended_at - time_logs.started_at))) / 60, 0)::numeric, 2) AS total_minutes
       FROM days
       LEFT JOIN time_logs
         ON DATE(time_logs.started_at) = days.work_date
        AND time_logs.ended_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM tasks
          WHERE tasks.id = time_logs.task_id
            AND tasks.user_id = $2
        )
       GROUP BY days.work_date
       ORDER BY days.work_date ASC`,
      [anchorDate, req.user.id],
    );

    res.json(result.rows);
  } catch (error) {
    handleError(res, error, "作業時間レポートの取得に失敗しました。");
  }
});

setupDatabase()
  .then(() => {
    const server = app.listen(port, () => {
      console.log(`http://localhost:${port} で起動しました`);
    });

    server.on("error", (error) => {
      console.error("サーバー起動中にエラーが発生しました。", error);
      process.exit(1);
    });
  })
  .catch((error) => {
    console.error("データベースの準備に失敗しました。", error);
    process.exit(1);
  });
