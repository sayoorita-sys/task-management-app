const express = require("express");
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

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.delete("/api/reset-data", async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE TABLE subtasks, time_logs, tasks, tags, folders RESTART IDENTITY CASCADE");
    await client.query("INSERT INTO folders (name) VALUES ('tasks')");
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
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      is_completed BOOLEAN DEFAULT false,
      due_date DATE,
      estimated_minutes INTEGER,
      tag_name TEXT,
      tag_color TEXT DEFAULT '#38bdf8',
      folder_name TEXT DEFAULT 'tasks',
      is_hidden BOOLEAN DEFAULT false,
      completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT false");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date DATE");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tag_name TEXT");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tag_color TEXT DEFAULT '#38bdf8'");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS folder_name TEXT DEFAULT 'tasks'");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tags (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      color TEXT NOT NULL DEFAULT '#38bdf8',
      is_hidden BOOLEAN DEFAULT false
    );
  `);

  await pool.query("ALTER TABLE tags ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS folders (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );
  `);

  await pool.query(`
    INSERT INTO folders (name)
    VALUES ('tasks')
    ON CONFLICT (name) DO NOTHING;
  `);

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
      ORDER BY is_completed ASC, id ASC
    `);

    const subtasksResult = await pool.query(`
      SELECT *
      FROM subtasks
      ORDER BY id ASC
    `);

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
    const result = await pool.query("SELECT * FROM folders ORDER BY name ASC");
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
      `INSERT INTO folders (name)
       VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [name],
    );

    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error, "フォルダの追加に失敗しました。");
  }
});

app.get("/api/tags", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tags ORDER BY is_hidden ASC, name ASC");
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
       WHERE id = $2
       RETURNING *`,
      [req.body.is_hidden, req.params.id],
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
      `INSERT INTO folders (name)
       VALUES ($1)
       ON CONFLICT (name) DO NOTHING`,
      [folderName],
    );

    if (tagName) {
      const tagResult = await pool.query(
        `INSERT INTO tags (name, color)
         VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING *`,
        [tagName, tagColor],
      );

      tagColor = tagResult.rows[0].color;
    }

    const result = await pool.query(
      `INSERT INTO tasks (title, due_date, estimated_minutes, tag_name, tag_color, folder_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        req.body.title,
        req.body.due_date || null,
        req.body.estimated_minutes || null,
        tagName || null,
        tagColor,
        folderName,
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
       VALUES ($1, $2)
       RETURNING *`,
      [req.params.id, title],
    );

    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error, "サブタスクの追加に失敗しました。");
  }
});

app.patch("/api/subtasks/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE subtasks
       SET is_completed = $1
       WHERE id = $2
       RETURNING *`,
      [req.body.is_completed, req.params.id],
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
       WHERE task_id = $1`,
      [subtask.task_id],
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
         WHERE task_id = $1 AND ended_at IS NULL`,
        [req.params.id],
      );
    }

    if (typeof req.body.is_hidden === "boolean") {
      const result = await pool.query(
        "UPDATE tasks SET is_hidden = $1 WHERE id = $2 RETURNING *",
        [req.body.is_hidden, req.params.id],
      );

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
        "SELECT 1 FROM folders WHERE name = $1",
        [folderName],
      );

      if (folderResult.rows.length === 0) {
        res.status(400).json({ error: "存在するフォルダを選択してください。" });
        return;
      }

      const result = await pool.query(
        "UPDATE tasks SET folder_name = $1 WHERE id = $2 RETURNING *",
        [folderName, req.params.id],
      );

      res.json(result.rows[0]);
      return;
    }

    const result = await pool.query(
      `UPDATE tasks
       SET is_completed = $1,
           is_hidden = false,
           completed_at = CASE WHEN $1 = true THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = $2
       RETURNING *`,
      [req.body.is_completed, req.params.id],
    );

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
       WHERE task_id = $1 AND ended_at IS NULL`,
      [req.params.id],
    );

    const result = await pool.query(
      "INSERT INTO time_logs (task_id) VALUES ($1) RETURNING *",
      [req.params.id],
    );

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
         WHERE task_id = $1 AND ended_at IS NULL
         ORDER BY started_at DESC
         LIMIT 1
       )
       RETURNING *`,
      [req.params.id],
    );

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
       GROUP BY days.work_date
       ORDER BY days.work_date ASC`,
      [anchorDate],
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
