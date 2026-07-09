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

async function setupDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      is_completed BOOLEAN DEFAULT false,
      due_date DATE,
      estimated_minutes INTEGER,
      completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT false");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date DATE");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS time_logs (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ended_at TIMESTAMP,
      duration_minutes NUMERIC(10, 2)
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
    res.json(result.rows);
  } catch (error) {
    handleError(res, error, "タスク一覧の取得に失敗しました。");
  }
});

app.post("/api/tasks", async (req, res) => {
  console.log("タスク追加リクエスト:", req.body);

  try {
    const result = await pool.query(
      `INSERT INTO tasks (title, due_date, estimated_minutes)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [
        req.body.title,
        req.body.due_date || null,
        req.body.estimated_minutes || null,
      ],
    );

    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error, "タスクの追加に失敗しました。");
  }
});

app.patch("/api/tasks/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE tasks
       SET is_completed = $1,
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
  try {
    const result = await pool.query(
      `SELECT
         TO_CHAR(DATE(started_at), 'YYYY-MM-DD') AS work_date,
         ROUND(COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - started_at))) / 60, 0)::numeric, 2) AS total_minutes
       FROM time_logs
       WHERE ended_at IS NOT NULL
       GROUP BY DATE(started_at)
       ORDER BY work_date ASC`,
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
