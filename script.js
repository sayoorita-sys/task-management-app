const taskInput = document.getElementById("taskInput");
const dueDateInput = document.getElementById("dueDateInput");
const estimatedMinutesInput = document.getElementById("estimatedMinutesInput");
const addButton = document.getElementById("addButton");
const taskForm = document.getElementById("taskForm");
const taskList = document.getElementById("taskList");
const errorMessage = document.getElementById("errorMessage");
const stopwatchPanel = document.getElementById("stopwatchPanel");
const stopwatchTaskName = document.getElementById("stopwatchTaskName");
const stopwatchTime = document.getElementById("stopwatchTime");
const stopwatchTotalTime = document.getElementById("stopwatchTotalTime");
const stopwatchHint = document.getElementById("stopwatchHint");

let workTimeChart;
let stopwatchInterval;

function showError(message) {
  errorMessage.textContent = message;
}

function showStatus(message) {
  errorMessage.textContent = message;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readError(response) {
  const statusText = `${response.status} ${response.statusText}`;

  try {
    const data = await response.json();
    if (data.detail) {
      return `${data.error} ${data.detail}`;
    }

    return data.error || `サーバーエラー: ${statusText}`;
  } catch {
    const text = await response.text();
    const shortText = text.replace(/\s+/g, " ").slice(0, 160);
    return `サーバーエラー: ${statusText} ${shortText}`;
  }
}

function formatElapsedTime(elapsedSeconds) {
  elapsedSeconds = Math.max(0, Math.floor(elapsedSeconds));
  const hours = String(Math.floor(elapsedSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(elapsedSeconds % 60).padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
}

function renderStopwatch(tasks) {
  const runningTask = tasks.find((task) => task.is_timer_running);

  if (stopwatchInterval) {
    clearInterval(stopwatchInterval);
    stopwatchInterval = null;
  }

  if (!runningTask) {
    stopwatchPanel.classList.remove("is-running");
    stopwatchTaskName.textContent = "停止中";
    stopwatchTime.textContent = "00:00:00";
    stopwatchTotalTime.textContent = "00:00:00";
    stopwatchHint.textContent = "タスクの開始ボタンで計測します。";
    return;
  }

  const initialElapsedSeconds = Number(runningTask.active_elapsed_seconds || 0);
  const initialTotalSeconds = Number(runningTask.total_elapsed_seconds || 0);
  const receivedAt = Date.now();

  function updateStopwatch() {
    const elapsedSinceReceived = Math.floor((Date.now() - receivedAt) / 1000);
    stopwatchTime.textContent = formatElapsedTime(initialElapsedSeconds + elapsedSinceReceived);
    stopwatchTotalTime.textContent = formatElapsedTime(initialTotalSeconds + elapsedSinceReceived);
  }

  stopwatchPanel.classList.add("is-running");
  stopwatchTaskName.textContent = runningTask.title;
  stopwatchHint.textContent = "計測中";
  updateStopwatch();
  stopwatchInterval = setInterval(updateStopwatch, 1000);
}

async function loadTasks() {
  let response;

  try {
    response = await fetchWithTimeout("/api/tasks");
  } catch {
    showError("サーバーに接続できません。http://localhost:3000 で開いているか確認してください。");
    return;
  }

  if (!response.ok) {
    showError(await readError(response));
    return;
  }

  const tasks = await response.json();

  taskList.innerHTML = "";
  renderStopwatch(tasks);

  tasks.forEach((task) => {
    const li = document.createElement("li");
    li.className = task.is_completed ? "task-item completed" : "task-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.is_completed;

    checkbox.addEventListener("change", async () => {
      const updateResponse = await fetchWithTimeout(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_completed: checkbox.checked,
        }),
      });

      if (!updateResponse.ok) {
        showError(await readError(updateResponse));
        return;
      }

      await loadTasks();
      await loadWorkTimeChart();
    });

    const title = document.createElement("span");
    title.textContent = task.title;

    const meta = document.createElement("small");
    const dueDate = task.due_date ? `締切: ${task.due_date.slice(0, 10)}` : "締切なし";
    const estimate = task.estimated_minutes
      ? `予想: ${task.estimated_minutes}分`
      : "予想時間なし";
    const totalTime = `累計: ${formatElapsedTime(Number(task.total_elapsed_seconds || 0))}`;
    meta.textContent = `${dueDate} / ${estimate} / ${totalTime}`;

    const timerStatus = document.createElement("strong");
    timerStatus.className = task.is_timer_running ? "timer-running" : "timer-stopped";
    timerStatus.textContent = task.is_timer_running ? "計測中" : "";

    const startButton = document.createElement("button");
    startButton.textContent = "開始";
    startButton.disabled = task.is_timer_running;
    startButton.addEventListener("click", async () => {
      const startResponse = await fetchWithTimeout(`/api/tasks/${task.id}/timer/start`, {
        method: "POST",
      });

      if (!startResponse.ok) {
        showError(await readError(startResponse));
        return;
      }

      showStatus(`${task.title} のタイマーを開始しました。`);
      await loadTasks();
    });

    const stopButton = document.createElement("button");
    stopButton.textContent = "停止";
    stopButton.disabled = !task.is_timer_running;
    stopButton.addEventListener("click", async () => {
      const stopResponse = await fetchWithTimeout(`/api/tasks/${task.id}/timer/stop`, {
        method: "POST",
      });

      if (!stopResponse.ok) {
        showError(await readError(stopResponse));
        return;
      }

      showStatus(`${task.title} のタイマーを停止しました。`);
      await loadTasks();
      await loadWorkTimeChart();
    });

    li.appendChild(checkbox);
    li.appendChild(title);
    li.appendChild(meta);
    li.appendChild(timerStatus);
    li.appendChild(startButton);
    li.appendChild(stopButton);
    taskList.appendChild(li);
  });

  if (tasks.length === 0) {
    const emptyMessage = document.createElement("li");
    emptyMessage.className = "empty-message";
    emptyMessage.textContent = "まだタスクはありません。";
    taskList.appendChild(emptyMessage);
  }
}

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const taskText = taskInput.value;

  if (taskText === "") {
    return;
  }

  addButton.disabled = true;
  showStatus("追加中...");

  let response;

  try {
    response = await fetchWithTimeout("/api/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: taskText,
        due_date: dueDateInput.value,
        estimated_minutes: estimatedMinutesInput.value,
      }),
    });
  } catch {
    showError("サーバーに接続できません。http://localhost:3000 で開いているか確認してください。");
    addButton.disabled = false;
    return;
  }

  try {
    if (!response.ok) {
      showError(await readError(response));
      return;
    }

    taskInput.value = "";
    dueDateInput.value = "";
    estimatedMinutesInput.value = "";

    await loadTasks();
    showStatus("追加しました。");
  } finally {
    addButton.disabled = false;
  }
});

async function loadWorkTimeChart() {
  let response;

  try {
    response = await fetchWithTimeout("/api/reports/work-time");
  } catch {
    return;
  }

  if (!response.ok) {
    return;
  }

  const reports = await response.json();

  const labels = reports.map((report) => report.work_date);
  const data = reports.map((report) => Number(report.total_minutes));

  if (workTimeChart) {
    workTimeChart.destroy();
  }

  workTimeChart = new Chart(document.getElementById("workTimeChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "作業時間（分）",
          data,
        },
      ],
    },
  });
}

loadTasks();
loadWorkTimeChart();
