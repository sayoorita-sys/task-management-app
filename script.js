const taskInput = document.getElementById("taskInput");
const authPage = document.getElementById("authPage");
const appLayout = document.getElementById("appLayout");
const loginForm = document.getElementById("loginForm");
const loginEmailInput = document.getElementById("loginEmailInput");
const loginPasswordInput = document.getElementById("loginPasswordInput");
const registerForm = document.getElementById("registerForm");
const registerNameInput = document.getElementById("registerNameInput");
const registerEmailInput = document.getElementById("registerEmailInput");
const registerPasswordInput = document.getElementById("registerPasswordInput");
const currentUserLabel = document.getElementById("currentUserLabel");
const logoutButton = document.getElementById("logoutButton");
const dueDateInput = document.getElementById("dueDateInput");
const estimatedMinutesInput = document.getElementById("estimatedMinutesInput");
const tagNameInput = document.getElementById("tagNameInput");
const tagColorInput = document.getElementById("tagColorInput");
const taskFolderInput = document.getElementById("taskFolderInput");
const addButton = document.getElementById("addButton");
const taskForm = document.getElementById("taskForm");
const taskSortButton = document.getElementById("taskSortButton");
const taskSortOptions = document.getElementById("taskSortOptions");
const taskList = document.getElementById("taskList");
const completedTaskList = document.getElementById("completedTaskList");
const folderViewButton = document.getElementById("folderViewButton");
const tagViewButton = document.getElementById("tagViewButton");
const folderControls = document.getElementById("folderControls");
const folderList = document.getElementById("folderList");
const folderModal = document.getElementById("folderModal");
const folderForm = document.getElementById("folderForm");
const newFolderInput = document.getElementById("newFolderInput");
const addFolderButton = document.getElementById("addFolderButton");
const closeFolderModalButton = document.getElementById("closeFolderModalButton");
const saveFolderButton = document.getElementById("saveFolderButton");
const tagList = document.getElementById("tagList");
const operationToast = document.getElementById("operationToast");
const stopwatchPanel = document.getElementById("stopwatchPanel");
const stopwatchTaskName = document.getElementById("stopwatchTaskName");
const stopwatchTime = document.getElementById("stopwatchTime");
const stopwatchTotalTime = document.getElementById("stopwatchTotalTime");
const stopwatchHint = document.getElementById("stopwatchHint");
const analogClock = document.getElementById("analogClock");
const hourHand = document.getElementById("hourHand");
const minuteHand = document.getElementById("minuteHand");
const secondHand = document.getElementById("secondHand");
const previousRangeButton = document.getElementById("previousRangeButton");
const nextRangeButton = document.getElementById("nextRangeButton");
const reportRangeLabel = document.getElementById("reportRangeLabel");
const previousCalendarMonthButton = document.getElementById("previousCalendarMonthButton");
const nextCalendarMonthButton = document.getElementById("nextCalendarMonthButton");
const calendarMonthLabel = document.getElementById("calendarMonthLabel");
const dueDateCalendar = document.getElementById("dueDateCalendar");
const openGoogleCalendarModalButton = document.getElementById("openGoogleCalendarModalButton");
const googleCalendarModal = document.getElementById("googleCalendarModal");
const closeGoogleCalendarModalButton = document.getElementById("closeGoogleCalendarModalButton");
const googleCalendarTaskList = document.getElementById("googleCalendarTaskList");
const themeOptions = document.getElementById("themeOptions");
const openResetModalButton = document.getElementById("openResetModalButton");
const resetModal = document.getElementById("resetModal");
const confirmResetButton = document.getElementById("confirmResetButton");
const cancelResetButton = document.getElementById("cancelResetButton");

const themeColors = [
  { name: "水色", value: "#38bdf8" },
  { name: "ピンク", value: "#f472b6" },
  { name: "黒", value: "#111827" },
  { name: "白", value: "#ffffff" },
  { name: "赤", value: "#ef4444" },
  { name: "青", value: "#2563eb" },
  { name: "黄緑", value: "#84cc16" },
  { name: "グレー", value: "#64748b" },
  { name: "黄色", value: "#eab308" },
  { name: "紫", value: "#8b5cf6" },
  { name: "オレンジ", value: "#f97316" },
];

const taskSortLabels = {
  "due-asc": "締切日が早い順",
  "due-desc": "締切日が遅い順",
  "title-asc": "50音順",
  custom: "カスタム",
};

let allTasks = [];
let allTags = [];
let allFolders = [];
let currentUser = null;
let workTimeChart;
let stopwatchInterval;
let currentReportRange = "day";
let currentReportDate = new Date();
let currentCalendarDate = new Date();
let currentFolder = "schedule";
let currentViewMode = "folder";
let currentTaskSort = "due-asc";
let selectedTag = null;
let showingHiddenTags = false;
let expandedTaskId = null;
let timerMode = localStorage.getItem("timerMode") || "digital";

function showError(message) {
  operationToast.textContent = message;
  operationToast.classList.add("show", "error");
}

function showStatus(message) {
  operationToast.textContent = message;
  operationToast.classList.add("show");
  operationToast.classList.remove("error");
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
    return data.detail ? `${data.error} ${data.detail}` : data.error || `サーバーエラー: ${statusText}`;
  } catch {
    const text = await response.text();
    return `サーバーエラー: ${statusText} ${text.replace(/\s+/g, " ").slice(0, 160)}`;
  }
}

function showAuthPage() {
  currentUser = null;
  authPage.classList.remove("hidden");
  appLayout.classList.add("hidden");
}

function showAppPage(user) {
  currentUser = user;
  currentUserLabel.textContent = `${user.name}でログイン中`;
  authPage.classList.add("hidden");
  appLayout.classList.remove("hidden");
}

function resetLocalData() {
  allTasks = [];
  allTags = [];
  allFolders = [];
  selectedTag = null;
  showingHiddenTags = false;
  expandedTaskId = null;
  currentFolder = "schedule";
  currentViewMode = "folder";

  if (workTimeChart) {
    workTimeChart.destroy();
    workTimeChart = null;
  }
}

async function loadAppData() {
  await loadFolders();
  await loadTags();
  await loadTasks();
  await loadWorkTimeChart();
}

async function checkLogin() {
  const response = await fetchWithTimeout("/api/auth/me");

  if (!response.ok) {
    showAuthPage();
    return;
  }

  const user = await response.json();
  showAppPage(user);
  await loadAppData();
}

function formatElapsedTime(elapsedSeconds) {
  elapsedSeconds = Math.max(0, Math.floor(elapsedSeconds));
  const hours = String(Math.floor(elapsedSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(elapsedSeconds % 60).padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
}

function formatMinuteSecond(elapsedSeconds) {
  elapsedSeconds = Math.max(0, Math.floor(elapsedSeconds));
  const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
  const seconds = String(elapsedSeconds % 60).padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isPastDueDate(dateText) {
  if (!dateText) {
    return false;
  }

  return dateText.slice(0, 10) < toDateInputValue(new Date());
}

function formatDueDate(dateText) {
  if (!dateText) {
    return "締切なし";
  }

  const [, month, day] = dateText.slice(0, 10).split("-");
  return `${Number(month)}/${Number(day)}`;
}

function toDateTimeLocalValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function getDefaultScheduleTime(task) {
  const defaultDate = task.due_date ? new Date(`${task.due_date.slice(0, 10)}T09:00`) : new Date();

  if (!task.due_date) {
    defaultDate.setMinutes(0, 0, 0);
    defaultDate.setHours(defaultDate.getHours() + 1);
  }

  return toDateTimeLocalValue(defaultDate);
}

function formatGoogleCalendarDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function createGoogleCalendarUrl(task, startValue) {
  const startDate = new Date(startValue);
  const durationMinutes = Number(task.estimated_minutes || 60);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
  const details = [
    task.due_date ? `締切: ${task.due_date.slice(0, 10)}` : "",
    task.tag_name ? `タグ: ${task.tag_name}` : "",
    task.folder_name ? `フォルダ: ${task.folder_name}` : "",
  ].filter(Boolean).join("\n");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: task.title,
    dates: `${formatGoogleCalendarDate(startDate)}/${formatGoogleCalendarDate(endDate)}`,
    details,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function addMonths(date, months) {
  const nextDate = new Date(date);
  nextDate.setMonth(nextDate.getMonth() + months);
  return nextDate;
}

function getMonthLabel(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function applyTheme(color) {
  const isWhiteTheme = color === "#ffffff";

  document.documentElement.style.setProperty("--theme-color", color);
  document.documentElement.style.setProperty("--theme-dark", isWhiteTheme ? "#111827" : color);
  document.documentElement.style.setProperty("--theme-soft", `${color}22`);
  document.documentElement.style.setProperty("--theme-bg", `${color}12`);
  document.documentElement.style.setProperty("--theme-border", isWhiteTheme ? "#d8dee8" : `${color}88`);
  document.documentElement.style.setProperty("--theme-card", isWhiteTheme ? "#ffffff" : `${color}08`);
  document.documentElement.style.setProperty("--theme-button-bg", isWhiteTheme ? "#ffffff" : color);
  document.documentElement.style.setProperty("--theme-button-text", isWhiteTheme ? "#111827" : "#ffffff");
  document.documentElement.style.setProperty("--theme-button-border", isWhiteTheme ? "#64748b" : "transparent");
  localStorage.setItem("themeColor", color);
}

function setupThemeButtons() {
  const savedColor = localStorage.getItem("themeColor") || "#38bdf8";
  applyTheme(savedColor);
  themeOptions.innerHTML = "";

  themeColors.forEach((theme) => {
    const button = document.createElement("button");
    button.className = "theme-button";
    button.type = "button";
    button.textContent = theme.name;
    button.style.backgroundColor = theme.value;
    button.style.color = theme.value === "#ffffff" ? "#111827" : "white";

    if (theme.value === savedColor) {
      button.classList.add("active");
    }

    button.addEventListener("click", () => {
      document.querySelectorAll(".theme-button").forEach((themeButton) => {
        themeButton.classList.remove("active");
      });
      button.classList.add("active");
      applyTheme(theme.value);
      showStatus(`テーマカラーを${theme.name}に変更しました。`);
    });

    themeOptions.appendChild(button);
  });
}

function setTimerMode(mode) {
  timerMode = mode;
  localStorage.setItem("timerMode", mode);
  stopwatchPanel.dataset.mode = mode;
  analogClock.classList.toggle("hidden", mode !== "analog");
  stopwatchTime.parentElement.classList.toggle("hidden", mode !== "digital");

  document.querySelectorAll(".timer-mode-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
}

function updateAnalogClock(elapsedSeconds) {
  const seconds = elapsedSeconds % 60;
  const minutes = Math.floor(elapsedSeconds / 60) % 60;
  const hours = Math.floor(elapsedSeconds / 3600) % 12;

  secondHand.style.transform = `translateX(-50%) rotate(${seconds * 6}deg)`;
  minuteHand.style.transform = `translateX(-50%) rotate(${minutes * 6 + seconds * 0.1}deg)`;
  hourHand.style.transform = `translateX(-50%) rotate(${hours * 30 + minutes * 0.5}deg)`;
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
    updateAnalogClock(0);
    return;
  }

  const initialElapsedSeconds = Number(runningTask.active_elapsed_seconds || 0);
  const initialTotalSeconds = Number(runningTask.total_elapsed_seconds || 0);
  const receivedAt = Date.now();

  function updateStopwatch() {
    const elapsedSinceReceived = Math.floor((Date.now() - receivedAt) / 1000);
    const currentElapsed = initialElapsedSeconds + elapsedSinceReceived;
    stopwatchTime.textContent = formatElapsedTime(currentElapsed);
    stopwatchTotalTime.textContent = formatElapsedTime(initialTotalSeconds + elapsedSinceReceived);
    updateAnalogClock(currentElapsed);
  }

  stopwatchPanel.classList.add("is-running");
  stopwatchTaskName.textContent = runningTask.title;
  stopwatchHint.textContent = "計測中";
  updateStopwatch();
  stopwatchInterval = setInterval(updateStopwatch, 1000);
}

function createEmptyMessage(message) {
  const emptyMessage = document.createElement("p");
  emptyMessage.className = "empty-message";
  emptyMessage.textContent = message;
  return emptyMessage;
}

function isInteractiveElement(target) {
  return ["BUTTON", "INPUT", "FORM"].includes(target.tagName);
}

function renderViewMode() {
  const isFolderMode = currentViewMode === "folder";

  folderViewButton.classList.toggle("active", isFolderMode);
  tagViewButton.classList.toggle("active", !isFolderMode);
  folderControls.classList.toggle("hidden", !isFolderMode);
  tagList.classList.toggle("hidden", isFolderMode);
}

function openFolderModal() {
  newFolderInput.value = "";
  folderModal.classList.remove("hidden");
  newFolderInput.focus();
}

function closeFolderModal() {
  newFolderInput.value = "";
  folderModal.classList.add("hidden");
}

function openResetModal() {
  resetModal.classList.remove("hidden");
}

function closeResetModal() {
  resetModal.classList.add("hidden");
}

function openGoogleCalendarModal() {
  renderCalendarTasks();
  googleCalendarModal.classList.remove("hidden");
}

function closeGoogleCalendarModal() {
  googleCalendarModal.classList.add("hidden");
}

async function resetAllData() {
  confirmResetButton.disabled = true;

  try {
    const response = await fetchWithTimeout("/api/reset-data", {
      method: "DELETE",
    });

    if (!response.ok) {
      showError(await readError(response));
      return;
    }

    allTasks = [];
    allTags = [];
    allFolders = [];
    currentFolder = "schedule";
    currentViewMode = "folder";
    selectedTag = null;
    showingHiddenTags = false;
    expandedTaskId = null;

    closeResetModal();
    await loadFolders();
    await loadTags();
    await loadTasks();
    await loadWorkTimeChart();
    renderViewMode();
    showStatus("全てのデータをリセットしました。");
  } catch {
    showError("サーバーに接続できません。データリセットに失敗しました。");
  } finally {
    confirmResetButton.disabled = false;
  }
}

function setViewMode(mode) {
  currentViewMode = mode;

  if (mode === "folder") {
    selectedTag = null;
    showingHiddenTags = false;
    closeTagContextMenu();
    closeTaskContextMenu();
    showStatus(`${currentFolder} フォルダを表示しています。`);
  } else {
    closeTagContextMenu();
    closeTaskContextMenu();
    showStatus("タグごとに表示しています。");
  }

  renderViewMode();
  renderTags();
  renderTaskLists();
}

function closeTagContextMenu() {
  const contextMenu = document.querySelector(".tag-context-menu");

  if (contextMenu) {
    contextMenu.remove();
  }
}

function closeTaskContextMenu() {
  const contextMenu = document.querySelector(".task-context-menu");

  if (contextMenu) {
    contextMenu.remove();
  }
}

function closeTaskSortOptions() {
  taskSortOptions.classList.add("hidden");
}

function renderTaskSortButton() {
  taskSortButton.textContent = `並び替え: ${taskSortLabels[currentTaskSort]}`;

  document.querySelectorAll("#taskSortOptions button").forEach((button) => {
    button.classList.toggle("active", button.dataset.sort === currentTaskSort);
  });
}

function positionContextMenu(contextMenu, event) {
  const menuWidth = contextMenu.offsetWidth;
  const menuHeight = contextMenu.offsetHeight;
  const left = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
  const top = Math.min(event.clientY, window.innerHeight - menuHeight - 8);

  contextMenu.style.left = `${Math.max(8, left)}px`;
  contextMenu.style.top = `${Math.max(8, top)}px`;
}

function openTagContextMenu(event, tag) {
  closeTagContextMenu();
  closeTaskContextMenu();

  const contextMenu = document.createElement("div");
  contextMenu.className = "tag-context-menu";

  const hideButton = document.createElement("button");
  hideButton.type = "button";
  hideButton.textContent = "非表示";
  hideButton.addEventListener("click", async () => {
    const response = await fetchWithTimeout(`/api/tags/${tag.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_hidden: true }),
    });

    if (!response.ok) {
      showError(await readError(response));
      return;
    }

    if (selectedTag === tag.name) {
      selectedTag = null;
    }

    showingHiddenTags = true;
    closeTagContextMenu();
    showStatus(`${tag.name} タグを非表示にしました。`);
    await loadTags();
    renderTaskLists();
  });

  contextMenu.appendChild(hideButton);
  document.body.appendChild(contextMenu);
  positionContextMenu(contextMenu, event);
}

function renderTaskEditForm(contextMenu, task, event) {
  contextMenu.innerHTML = "";

  const heading = document.createElement("strong");
  heading.textContent = "タスクを編集";
  contextMenu.appendChild(heading);

  const form = document.createElement("form");
  form.className = "task-context-form";

  const titleLabel = document.createElement("label");
  titleLabel.textContent = "タスク名";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.value = task.title;
  titleInput.required = true;
  titleLabel.appendChild(titleInput);

  const dueDateLabel = document.createElement("label");
  dueDateLabel.textContent = "締切日";
  const dueDateEditInput = document.createElement("input");
  dueDateEditInput.type = "date";
  dueDateEditInput.value = task.due_date ? task.due_date.slice(0, 10) : "";
  dueDateLabel.appendChild(dueDateEditInput);

  const estimateLabel = document.createElement("label");
  estimateLabel.textContent = "予想所要時間（分）";
  const estimateInput = document.createElement("input");
  estimateInput.type = "number";
  estimateInput.min = "1";
  estimateInput.value = task.estimated_minutes || "";
  estimateLabel.appendChild(estimateInput);

  const tagLabel = document.createElement("label");
  tagLabel.textContent = "タグ";
  const tagInput = document.createElement("input");
  tagInput.type = "text";
  tagInput.value = task.tag_name || "";
  tagInput.placeholder = "タグなし";
  tagLabel.appendChild(tagInput);

  const tagColorLabel = document.createElement("label");
  tagColorLabel.textContent = "タグ色";
  const tagColorEditInput = document.createElement("input");
  tagColorEditInput.type = "color";
  tagColorEditInput.value = task.tag_color || "#38bdf8";
  tagColorLabel.appendChild(tagColorEditInput);

  const folderLabel = document.createElement("label");
  folderLabel.textContent = "フォルダの編入";
  const folderSelect = document.createElement("select");
  const folderNames = allFolders.map((folder) => folder.name);

  if (!folderNames.includes(task.folder_name)) {
    folderNames.push(task.folder_name || "tasks");
  }

  folderNames.forEach((folderName) => {
    const option = document.createElement("option");
    option.value = folderName;
    option.textContent = folderName;
    option.selected = folderName === task.folder_name;
    folderSelect.appendChild(option);
  });

  folderLabel.appendChild(folderSelect);

  const actions = document.createElement("div");
  actions.className = "task-context-actions";

  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.textContent = "保存";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "secondary-button";
  cancelButton.textContent = "キャンセル";
  cancelButton.addEventListener("click", closeTaskContextMenu);

  actions.appendChild(saveButton);
  actions.appendChild(cancelButton);

  form.appendChild(titleLabel);
  form.appendChild(dueDateLabel);
  form.appendChild(estimateLabel);
  form.appendChild(tagLabel);
  form.appendChild(tagColorLabel);
  form.appendChild(folderLabel);
  form.appendChild(actions);

  form.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();

    saveButton.disabled = true;
    showStatus("タスクを更新中...");

    try {
      const response = await fetchWithTimeout(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleInput.value,
          due_date: dueDateEditInput.value,
          estimated_minutes: estimateInput.value,
          tag_name: tagInput.value,
          tag_color: tagColorEditInput.value,
          folder_name: folderSelect.value,
        }),
      });

      if (!response.ok) {
        showError(await readError(response));
        return;
      }

      closeTaskContextMenu();
      showStatus("タスクを更新しました。");
      await loadTags();
      await loadTasks();
    } finally {
      saveButton.disabled = false;
    }
  });

  contextMenu.appendChild(form);
  positionContextMenu(contextMenu, event);
}

function openTaskContextMenu(event, task) {
  closeTagContextMenu();
  closeTaskContextMenu();

  const contextMenu = document.createElement("div");
  contextMenu.className = "task-context-menu";

  document.body.appendChild(contextMenu);
  renderTaskEditForm(contextMenu, task, event);
  positionContextMenu(contextMenu, event);
}

function createSubtaskArea(task) {
  const subtaskArea = document.createElement("div");
  subtaskArea.className = "subtask-area";

  task.subtasks.forEach((subtask) => {
    const label = document.createElement("label");
    label.className = "subtask-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = subtask.is_completed;
    checkbox.addEventListener("change", async () => {
      const response = await fetchWithTimeout(`/api/subtasks/${subtask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_completed: checkbox.checked }),
      });

      if (!response.ok) {
        showError(await readError(response));
        return;
      }

      showStatus("サブタスクを更新しました。");
      await loadTasks();
      await loadWorkTimeChart();
    });

    const text = document.createElement("span");
    text.textContent = subtask.title;

    label.appendChild(checkbox);
    label.appendChild(text);
    subtaskArea.appendChild(label);
  });

  const form = document.createElement("form");
  form.className = "subtask-form";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "サブタスクを追加";

  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "追加";

  form.appendChild(input);
  form.appendChild(button);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!input.value.trim()) {
      return;
    }

    const response = await fetchWithTimeout(`/api/tasks/${task.id}/subtasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: input.value }),
    });

    if (!response.ok) {
      showError(await readError(response));
      return;
    }

    showStatus("サブタスクを追加しました。");
    await loadTasks();
  });

  subtaskArea.appendChild(form);
  return subtaskArea;
}

function createCustomSortControls(task, customSortContext) {
  const controls = document.createElement("div");
  controls.className = "custom-sort-controls";

  const upButton = document.createElement("button");
  upButton.type = "button";
  upButton.textContent = "↑";
  upButton.disabled = customSortContext.index === 0;
  upButton.addEventListener("click", () => {
    moveTaskInCustomOrder(task.id, -1, task.is_completed);
  });

  const downButton = document.createElement("button");
  downButton.type = "button";
  downButton.textContent = "↓";
  downButton.disabled = customSortContext.index === customSortContext.total - 1;
  downButton.addEventListener("click", () => {
    moveTaskInCustomOrder(task.id, 1, task.is_completed);
  });

  controls.appendChild(upButton);
  controls.appendChild(downButton);
  return controls;
}

function createTaskCard(task, customSortContext = null) {
  const article = document.createElement("article");
  article.className = task.is_completed ? "task-card completed" : "task-card";
  article.style.borderLeftColor = task.tag_color || "#38bdf8";

  article.addEventListener("click", (event) => {
    if (isInteractiveElement(event.target)) {
      return;
    }

    expandedTaskId = expandedTaskId === task.id ? null : task.id;
    renderTaskLists();
  });

  article.addEventListener("contextmenu", (event) => {
    if (isInteractiveElement(event.target)) {
      return;
    }

    event.preventDefault();
    openTaskContextMenu(event, task);
  });

  const checkbox = document.createElement("input");
  checkbox.className = "task-checkbox";
  checkbox.type = "checkbox";
  checkbox.checked = task.is_completed;
  checkbox.style.accentColor = task.tag_color || "#38bdf8";

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

    showStatus(
      checkbox.checked
        ? "完了タスク欄に移動しました。"
        : "タスクリストに戻しました。",
    );
    await loadTasks();
    await loadWorkTimeChart();
  });

  const titleArea = document.createElement("div");
  titleArea.className = "task-title-area";

  const title = document.createElement("h3");
  title.textContent = task.title;

  const remainingSubtaskCount = task.subtasks.filter((subtask) => !subtask.is_completed).length;

  const metaRow = document.createElement("div");
  metaRow.className = "task-meta-row";

  titleArea.appendChild(title);

  if (task.tag_name) {
    const tag = document.createElement("span");
    tag.className = "task-tag";
    tag.style.backgroundColor = task.tag_color || "#38bdf8";
    tag.textContent = task.tag_name;
    metaRow.appendChild(tag);
  }

  if (remainingSubtaskCount > 0) {
    const subtaskBadge = document.createElement("span");
    subtaskBadge.className = "subtask-count-badge";
    subtaskBadge.textContent = `未完了サブタスク${remainingSubtaskCount}個`;
    metaRow.appendChild(subtaskBadge);
  }

  if (metaRow.children.length > 0) {
    titleArea.appendChild(metaRow);
  }

  const dueDate = document.createElement("span");
  dueDate.className = "task-cell due-date-cell";
  dueDate.classList.toggle("is-past-due", isPastDueDate(task.due_date));
  dueDate.textContent = formatDueDate(task.due_date);

  const estimate = document.createElement("span");
  estimate.className = "task-cell";
  estimate.textContent = task.estimated_minutes ? `${task.estimated_minutes}分` : "予想なし";

  const totalTime = document.createElement("span");
  totalTime.className = "task-cell";
  totalTime.textContent = formatMinuteSecond(Number(task.total_elapsed_seconds || 0));

  const startButton = document.createElement("button");
  startButton.textContent = "開始";
  startButton.disabled = task.is_timer_running || task.is_completed;
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

  const timerStatus = document.createElement("strong");
  timerStatus.className = task.is_timer_running ? "timer-running" : "timer-stopped";
  timerStatus.textContent = task.is_timer_running ? "計測中" : "";

  article.appendChild(checkbox);
  article.appendChild(titleArea);
  article.appendChild(dueDate);
  article.appendChild(estimate);
  article.appendChild(totalTime);
  article.appendChild(startButton);
  article.appendChild(stopButton);
  article.appendChild(timerStatus);

  if (task.is_completed) {
    const hideButton = document.createElement("button");
    hideButton.className = "hide-button";
    hideButton.textContent = "非表示";
    hideButton.addEventListener("click", async () => {
      const hideResponse = await fetchWithTimeout(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_hidden: true,
        }),
      });

      if (!hideResponse.ok) {
        showError(await readError(hideResponse));
        return;
      }

      showStatus("完了タスクを非表示にしました。作業ログは残っています。");
      await loadTasks();
    });

    article.appendChild(hideButton);
  }

  if (expandedTaskId === task.id) {
    article.appendChild(createSubtaskArea(task));
  }

  if (currentTaskSort === "custom" && customSortContext) {
    titleArea.appendChild(createCustomSortControls(task, customSortContext));
  }

  return article;
}

function compareTaskTitles(a, b) {
  return a.title.localeCompare(b.title, "ja");
}

function compareTaskDueDates(a, b, direction) {
  const aDueDate = a.due_date ? a.due_date.slice(0, 10) : null;
  const bDueDate = b.due_date ? b.due_date.slice(0, 10) : null;

  if (!aDueDate && !bDueDate) {
    return compareTaskTitles(a, b);
  }

  if (!aDueDate) {
    return 1;
  }

  if (!bDueDate) {
    return -1;
  }

  const result = aDueDate.localeCompare(bDueDate);
  return result === 0 ? compareTaskTitles(a, b) : result * direction;
}

function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (currentTaskSort === "custom") {
      const aOrder = Number(a.custom_order || a.id);
      const bOrder = Number(b.custom_order || b.id);
      return aOrder === bOrder ? compareTaskTitles(a, b) : aOrder - bOrder;
    }

    if (currentTaskSort === "due-desc") {
      return compareTaskDueDates(a, b, -1);
    }

    if (currentTaskSort === "title-asc") {
      return compareTaskTitles(a, b);
    }

    return compareTaskDueDates(a, b, 1);
  });
}

function getVisibleTasks() {
  if (currentViewMode === "tag") {
    const hiddenTagNames = allTags
      .filter((tag) => tag.is_hidden)
      .map((tag) => tag.name);

    if (selectedTag) {
      return allTasks.filter((task) => task.tag_name === selectedTag);
    }

    if (showingHiddenTags) {
      return allTasks.filter((task) => hiddenTagNames.includes(task.tag_name));
    }

    return allTasks.filter(
      (task) => !task.is_hidden && !hiddenTagNames.includes(task.tag_name),
    );
  }

  if (currentFolder === "schedule") {
    return allTasks.filter((task) => task.due_date && !task.is_hidden);
  }

  return allTasks.filter((task) => task.folder_name === currentFolder && !task.is_hidden);
}

async function saveCustomTaskOrder(tasks) {
  const response = await fetchWithTimeout("/api/tasks/reorder", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: tasks.map((task) => task.id) }),
  });

  if (!response.ok) {
    showError(await readError(response));
    return false;
  }

  return true;
}

async function moveTaskInCustomOrder(taskId, direction, isCompleted) {
  const visibleTasks = getVisibleTasks();
  const orderedTasks = sortTasks(
    visibleTasks.filter((task) => task.is_completed === isCompleted),
  );
  const currentIndex = orderedTasks.findIndex((task) => task.id === taskId);
  const nextIndex = currentIndex + direction;

  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedTasks.length) {
    return;
  }

  const nextTasks = [...orderedTasks];
  [nextTasks[currentIndex], nextTasks[nextIndex]] = [nextTasks[nextIndex], nextTasks[currentIndex]];

  if (await saveCustomTaskOrder(nextTasks)) {
    showStatus("カスタム順を保存しました。");
    await loadTasks();
  }
}

function renderTaskLists() {
  const visibleTasks = getVisibleTasks();
  const activeTasks = sortTasks(visibleTasks.filter((task) => !task.is_completed));
  const completedTasks = sortTasks(visibleTasks.filter((task) => task.is_completed));

  taskList.innerHTML = "";
  completedTaskList.innerHTML = "";

  activeTasks.forEach((task, index) => {
    taskList.appendChild(createTaskCard(task, {
      index,
      total: activeTasks.length,
    }));
  });

  if (activeTasks.length === 0) {
    taskList.appendChild(createEmptyMessage("未完了タスクはありません。"));
  }

  completedTasks.forEach((task, index) => {
    completedTaskList.appendChild(createTaskCard(task, {
      index,
      total: completedTasks.length,
    }));
  });

  if (completedTasks.length === 0) {
    completedTaskList.appendChild(createEmptyMessage("表示中の完了タスクはありません。"));
  }
}

function createCalendarTaskCard(task) {
  const article = document.createElement("article");
  article.className = "calendar-task-card";

  const title = document.createElement("h3");
  title.textContent = task.title;

  const meta = document.createElement("p");
  meta.textContent = `${formatDueDate(task.due_date)} / ${
    task.estimated_minutes ? `${task.estimated_minutes}分` : "60分"
  }`;

  const scheduleInput = document.createElement("input");
  scheduleInput.type = "datetime-local";
  scheduleInput.value = getDefaultScheduleTime(task);

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "このタスクを登録";
  button.addEventListener("click", () => {
    if (!scheduleInput.value) {
      showError("作業開始日時を選択してください。");
      return;
    }

    window.open(createGoogleCalendarUrl(task, scheduleInput.value), "_blank", "noopener");
    closeGoogleCalendarModal();
    showStatus("Googleカレンダーの予定作成画面を開きました。");
  });

  article.appendChild(title);
  article.appendChild(meta);
  article.appendChild(scheduleInput);
  article.appendChild(button);

  return article;
}

function renderDueDateCalendar() {
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const calendarStart = addDays(firstDay, -firstDay.getDay());
  const today = toDateInputValue(new Date());
  const tasksByDueDate = allTasks
    .filter((task) => task.due_date && !task.is_hidden)
    .reduce((groups, task) => {
      const dueDate = task.due_date.slice(0, 10);

      if (!groups[dueDate]) {
        groups[dueDate] = [];
      }

      groups[dueDate].push(task);
      return groups;
    }, {});

  calendarMonthLabel.textContent = getMonthLabel(currentCalendarDate);
  dueDateCalendar.innerHTML = "";

  ["日", "月", "火", "水", "木", "金", "土"].forEach((weekday) => {
    const weekdayCell = document.createElement("div");
    weekdayCell.className = "calendar-weekday";
    weekdayCell.textContent = weekday;
    dueDateCalendar.appendChild(weekdayCell);
  });

  for (let index = 0; index < 42; index += 1) {
    const cellDate = addDays(calendarStart, index);
    const dateKey = toDateInputValue(cellDate);
    const dayTasks = tasksByDueDate[dateKey] || [];
    const cell = document.createElement("div");
    cell.className = "calendar-day";
    cell.classList.toggle("outside-month", cellDate.getMonth() !== month);
    cell.classList.toggle("today", dateKey === today);

    const dayNumber = document.createElement("strong");
    dayNumber.textContent = cellDate.getDate();
    cell.appendChild(dayNumber);

    dayTasks.forEach((task) => {
      const taskLabel = document.createElement("span");
      taskLabel.className = task.is_completed ? "calendar-due-task completed" : "calendar-due-task";
      taskLabel.textContent = task.title;
      taskLabel.style.borderLeftColor = task.tag_color || "#38bdf8";
      cell.appendChild(taskLabel);
    });

    dueDateCalendar.appendChild(cell);
  }
}

function renderCalendarTasks() {
  const calendarTasks = allTasks
    .filter((task) => !task.is_completed && !task.is_hidden)
    .sort((a, b) => {
      if (!a.due_date) {
        return 1;
      }

      if (!b.due_date) {
        return -1;
      }

      return a.due_date.localeCompare(b.due_date);
  });

  googleCalendarTaskList.innerHTML = "";

  calendarTasks.forEach((task) => {
    googleCalendarTaskList.appendChild(createCalendarTaskCard(task));
  });

  if (calendarTasks.length === 0) {
    googleCalendarTaskList.appendChild(createEmptyMessage("カレンダーに追加できる未完了タスクはありません。"));
  }
}

function renderFolders() {
  const options = [
    { name: "schedule", label: "schedule" },
    ...allFolders.map((folder) => ({ name: folder.name, label: folder.name })),
  ];

  folderList.innerHTML = "";
  taskFolderInput.innerHTML = "";

  options.forEach((folder) => {
    const button = document.createElement("button");
    button.className = "folder-button";
    button.type = "button";
    button.textContent = folder.label;
    button.classList.toggle("active", folder.name === currentFolder);
    button.addEventListener("click", () => {
      currentFolder = folder.name;
      currentViewMode = "folder";
      selectedTag = null;
      showingHiddenTags = false;
      renderViewMode();
      renderFolders();
      showStatus(`${currentFolder} フォルダを表示しています。`);
      renderTaskLists();
    });

    folderList.appendChild(button);

    if (folder.name !== "schedule") {
      const taskOption = document.createElement("option");
      taskOption.value = folder.name;
      taskOption.textContent = folder.label;
      taskFolderInput.appendChild(taskOption);
    }
  });

  const taskTargetFolder = currentFolder !== "schedule" ? currentFolder : "tasks";

  if ([...taskFolderInput.options].some((option) => option.value === taskTargetFolder)) {
    taskFolderInput.value = taskTargetFolder;
  } else if (!taskFolderInput.value) {
    taskFolderInput.value = "tasks";
  }
}

function renderTags() {
  tagList.innerHTML = "";
  const visibleTags = allTags.filter((tag) => !tag.is_hidden);
  const hiddenTags = allTags.filter((tag) => tag.is_hidden);

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.textContent = "タグ選択を解除";
  clearButton.addEventListener("click", () => {
    selectedTag = null;
    showingHiddenTags = false;
    showStatus("すべてのタグのタスクを表示しています。");
    renderTags();
    renderTaskLists();
  });
  tagList.appendChild(clearButton);

  visibleTags.forEach((tag) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tag.name;
    button.style.backgroundColor = tag.color;

    button.addEventListener("click", () => {
      selectedTag = tag.name;
      showingHiddenTags = false;
      showStatus(`${tag.name} タグのタスクを表示しています。`);
      renderTags();
      renderTaskLists();
    });

    if (selectedTag === tag.name) {
      button.classList.add("active");
    }

    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openTagContextMenu(event, tag);
    });

    tagList.appendChild(button);
  });

  const hiddenTagsButton = document.createElement("button");
  hiddenTagsButton.type = "button";
  hiddenTagsButton.textContent = `非表示タグ${hiddenTags.length ? ` (${hiddenTags.length})` : ""}`;
  hiddenTagsButton.className = showingHiddenTags ? "active" : "";
  hiddenTagsButton.addEventListener("click", () => {
    selectedTag = null;
    showingHiddenTags = true;
    showStatus("非表示タグの一覧を表示しています。");
    renderTags();
    renderTaskLists();
  });
  tagList.appendChild(hiddenTagsButton);

  if (showingHiddenTags) {
    const hiddenSection = document.createElement("div");
    hiddenSection.className = "hidden-tag-section";

    if (hiddenTags.length === 0) {
      const emptyText = document.createElement("span");
      emptyText.textContent = "非表示タグはありません。";
      hiddenSection.appendChild(emptyText);
    }

    hiddenTags.forEach((tag) => {
      const row = document.createElement("div");
      row.className = "hidden-tag-row";

      const tagButton = document.createElement("button");
      tagButton.type = "button";
      tagButton.textContent = tag.name;
      tagButton.style.backgroundColor = tag.color;

      if (selectedTag === tag.name) {
        tagButton.classList.add("active");
      }

      tagButton.addEventListener("click", () => {
        selectedTag = tag.name;
        showStatus(`${tag.name} タグのタスクを表示しています。`);
        renderTags();
        renderTaskLists();
      });

      const showButton = document.createElement("button");
      showButton.type = "button";
      showButton.textContent = "表示";
      showButton.addEventListener("click", async () => {
        const response = await fetchWithTimeout(`/api/tags/${tag.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_hidden: false }),
        });

        if (!response.ok) {
          showError(await readError(response));
          return;
        }

        if (selectedTag === tag.name) {
          selectedTag = null;
        }

        showStatus(`${tag.name} タグを表示に戻しました。`);
        await loadTags();
        renderTaskLists();
      });

      row.appendChild(tagButton);
      row.appendChild(showButton);
      hiddenSection.appendChild(row);
    });

    tagList.appendChild(hiddenSection);
  }
}

async function loadFolders() {
  const response = await fetchWithTimeout("/api/folders");

  if (!response.ok) {
    showError(await readError(response));
    return;
  }

  allFolders = await response.json();
  renderFolders();
}

async function loadTags() {
  const response = await fetchWithTimeout("/api/tags");

  if (!response.ok) {
    showError(await readError(response));
    return;
  }

  allTags = await response.json();
  renderTags();
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

  allTasks = await response.json();
  renderStopwatch(allTasks);
  renderTaskLists();
  renderDueDateCalendar();
  renderCalendarTasks();
}

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const taskText = taskInput.value.trim();

  if (taskText === "") {
    return;
  }

  addButton.disabled = true;
  showStatus("追加中...");

  let response;

  try {
    response = await fetchWithTimeout("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: taskText,
        due_date: dueDateInput.value,
        estimated_minutes: estimatedMinutesInput.value,
        tag_name: tagNameInput.value,
        tag_color: tagColorInput.value,
        folder_name: taskFolderInput.value || "tasks",
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
    tagNameInput.value = "";
    tagColorInput.value = "#38bdf8";

    await loadFolders();
    await loadTags();
    await loadTasks();
    showStatus("追加しました。");
  } finally {
    addButton.disabled = false;
  }
});

async function loadWorkTimeChart() {
  let response;

  try {
    response = await fetchWithTimeout(
      `/api/reports/work-time?range=${currentReportRange}&date=${toDateInputValue(currentReportDate)}`,
    );
  } catch {
    return;
  }

  if (!response.ok) {
    return;
  }

  const reports = await response.json();
  const labels = reports.map((report) => report.work_date);
  const data = reports.map((report) => Number(report.total_minutes));
  const maxMinutes = data.length > 0 ? Math.max(...data) : 0;

  reportRangeLabel.textContent = toDateInputValue(currentReportDate);

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
          backgroundColor: getComputedStyle(document.documentElement)
            .getPropertyValue("--theme-color")
            .trim() || "#38bdf8",
        },
      ],
    },
    options: {
      scales: {
        y: {
          beginAtZero: true,
          max: maxMinutes + 60,
        },
      },
    },
  });
}

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-button").forEach((tab) => tab.classList.remove("active"));
    document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));

    button.classList.add("active");
    document.getElementById(button.dataset.page).classList.add("active");

    if (button.dataset.page === "reportPage") {
      loadWorkTimeChart();
    }

    if (button.dataset.page === "calendarPage") {
      renderDueDateCalendar();
      renderCalendarTasks();
    }
  });
});

document.querySelectorAll(".range-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".range-button").forEach((rangeButton) => {
      rangeButton.classList.remove("active");
    });

    button.classList.add("active");
    currentReportRange = button.dataset.range;
    loadWorkTimeChart();
  });
});

previousRangeButton.addEventListener("click", () => {
  currentReportDate = currentReportRange === "month"
    ? addMonths(currentReportDate, -1)
    : addDays(currentReportDate, currentReportRange === "week" ? -7 : -1);
  loadWorkTimeChart();
});

nextRangeButton.addEventListener("click", () => {
  currentReportDate = currentReportRange === "month"
    ? addMonths(currentReportDate, 1)
    : addDays(currentReportDate, currentReportRange === "week" ? 7 : 1);
  loadWorkTimeChart();
});

previousCalendarMonthButton.addEventListener("click", () => {
  currentCalendarDate = addMonths(currentCalendarDate, -1);
  renderDueDateCalendar();
});

nextCalendarMonthButton.addEventListener("click", () => {
  currentCalendarDate = addMonths(currentCalendarDate, 1);
  renderDueDateCalendar();
});

addFolderButton.addEventListener("click", () => {
  openFolderModal();
});

closeFolderModalButton.addEventListener("click", () => {
  closeFolderModal();
});

folderForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const folderName = newFolderInput.value.trim();

  if (!folderName) {
    showError("フォルダ名を入力してください。");
    return;
  }

  saveFolderButton.disabled = true;

  try {
    const response = await fetchWithTimeout("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: folderName }),
    });

    if (!response.ok) {
      showError(await readError(response));
      return;
    }

    closeFolderModal();
    currentFolder = folderName;
    await loadFolders();
    renderTaskLists();
    showStatus("フォルダを追加しました。");
  } catch {
    showError("サーバーに接続できません。フォルダを追加できませんでした。");
  } finally {
    saveFolderButton.disabled = false;
  }
});

folderViewButton.addEventListener("click", () => {
  setViewMode("folder");
});

tagViewButton.addEventListener("click", () => {
  setViewMode("tag");
});

taskSortButton.addEventListener("click", () => {
  taskSortOptions.classList.toggle("hidden");
});

document.querySelectorAll("#taskSortOptions button").forEach((button) => {
  button.addEventListener("click", () => {
    currentTaskSort = button.dataset.sort;
    closeTaskSortOptions();
    renderTaskSortButton();
    renderTaskLists();
    showStatus(`タスクの並び順を${taskSortLabels[currentTaskSort]}に変更しました。`);
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".sort-menu")) {
    closeTaskSortOptions();
  }

  if (!event.target.closest(".tag-context-menu")) {
    closeTagContextMenu();
  }

  if (!event.target.closest(".task-context-menu")) {
    closeTaskContextMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeTagContextMenu();
    closeTaskContextMenu();
  }
});

tagNameInput.addEventListener("input", () => {
  const matchedTag = allTags.find((tag) => tag.name === tagNameInput.value.trim());

  if (matchedTag) {
    tagColorInput.value = matchedTag.color;
  }
});

document.querySelectorAll(".timer-mode-button").forEach((button) => {
  button.addEventListener("click", () => {
    setTimerMode(button.dataset.mode);
    showStatus(`タイマー表示を${button.textContent}に変更しました。`);
  });
});

openResetModalButton.addEventListener("click", () => {
  openResetModal();
});

openGoogleCalendarModalButton.addEventListener("click", () => {
  openGoogleCalendarModal();
});

closeGoogleCalendarModalButton.addEventListener("click", () => {
  closeGoogleCalendarModal();
});

cancelResetButton.addEventListener("click", () => {
  closeResetModal();
});

confirmResetButton.addEventListener("click", () => {
  resetAllData();
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const response = await fetchWithTimeout("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: loginEmailInput.value,
      password: loginPasswordInput.value,
    }),
  });

  if (!response.ok) {
    showError(await readError(response));
    return;
  }

  const user = await response.json();
  resetLocalData();
  showAppPage(user);
  await loadAppData();
  showStatus("ログインしました。");
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const response = await fetchWithTimeout("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: registerNameInput.value,
      email: registerEmailInput.value,
      password: registerPasswordInput.value,
    }),
  });

  if (!response.ok) {
    showError(await readError(response));
    return;
  }

  const user = await response.json();
  resetLocalData();
  showAppPage(user);
  await loadAppData();
  showStatus("登録してログインしました。");
});

logoutButton.addEventListener("click", async () => {
  const response = await fetchWithTimeout("/api/auth/logout", {
    method: "POST",
  });

  if (!response.ok) {
    showError(await readError(response));
    return;
  }

  resetLocalData();
  showAuthPage();
  showStatus("ログアウトしました。");
});

setupThemeButtons();
setTimerMode(timerMode);
renderViewMode();
renderTaskSortButton();
checkLogin();
