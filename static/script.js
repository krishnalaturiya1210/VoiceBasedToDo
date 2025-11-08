// script.js
const statusText = document.getElementById("status");
const taskList = document.getElementById("taskList");
const muteBtn = document.getElementById("muteBtn");
const clearBtn = document.getElementById("clearBtn");
const manualForm = document.getElementById("manualForm");
const manualInput = document.getElementById("manualInput");
const controls = document.getElementById("controls");

const synth = window.speechSynthesis;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let listening = true;
let wakeRecognition, commandRecognition;
let wakeRunning = false;
let inCommandMode = false;
let sortMode = "created";

/* --- Speech Helpers --- */
function speak(text) {
  if (!synth) return;
  console.log("🗣️ Speaking:", text);
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  synth.speak(utter);
}

function showStatus(msg, color = "#333") {
  console.log(`💬 Status: ${msg}`);
  statusText.textContent = msg;
  statusText.style.color = color;
}

/* --- Task List --- */
async function refreshTasks() {
  console.log("🎨 Refreshing tasks...");
  try {
    const res = await fetch("/tasks");
    const tasks = await res.json();
    taskList.innerHTML = "";

    const PRIORITY_LABELS = { 3: "High", 2: "Medium", 1: "Low" };
    const PRIORITY_COLORS = { 3: "#e74c3c", 2: "#f1c40f", 1: "#2ecc71" };

    console.log(`🎨 Sorting by: ${sortMode}`);
    tasks.sort((a, b) => {
      if (sortMode === "priority") return (b.priority || 0) - (a.priority || 0);
      if (sortMode === "category") return (a.category || "").localeCompare(b.category || "");
      if (sortMode === "due") return new Date(a.due || 0) - new Date(b.due || 0);
      return new Date(a.created_at || 0) - new Date(b.created_at || 0);
    });

    console.log(`🎨 Rendering ${tasks.length} tasks.`);
    tasks.forEach(t => {
      const div = document.createElement("div");
      div.className = "task";
      div.dataset.id = t.id;

      const left = document.createElement("div");
      left.className = "left";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !!t.done;
      checkbox.addEventListener("change", () => toggleTask(t.id));

      const label = document.createElement("span");
      label.textContent = t.name;

      const badge = document.createElement("span");
      badge.textContent = PRIORITY_LABELS[t.priority] || "Low";
      badge.style.backgroundColor = PRIORITY_COLORS[t.priority] || "#2ecc71";
      badge.style.color = "white";
      badge.style.fontSize = "0.75rem";
      badge.style.padding = "2px 6px";
      badge.style.borderRadius = "6px";
      badge.style.marginLeft = "10px";
      label.appendChild(badge);

      if (t.category && t.category !== "general") {
        const catBadge = document.createElement("span");
        catBadge.textContent = t.category;
        catBadge.className = "category-badge";
        label.appendChild(catBadge);
      }

      left.appendChild(checkbox);
      left.appendChild(label);

      const right = document.createElement("div");
      const delBtn = document.createElement("button");
      delBtn.textContent = "Delete";
      delBtn.className = "danger";
      delBtn.addEventListener("click", () => deleteTask(t.id));
      right.appendChild(delBtn);

      div.appendChild(left);
      div.appendChild(right);
      taskList.appendChild(div);
    });
  } catch (err) {
    showStatus("Failed to load tasks.", "red");
    console.error("🎨 Error refreshing tasks:", err);
  }
}

/* --- API Helper --- */
async function sendCommandJson(path, payload = {}) {
  console.log(`➡️ Sending API command to ${path}`, payload);
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log("⬅️ Received API response:", data);
    if (!res.ok) {
      const err = data.error || "Unknown error";
      console.error("API Error:", err);
      speak(err);
      showStatus(err, "red");
      return null;
    }
    // if (data.message && !data.message.includes("Task added")) speak(data.message);
    if (data.message) speak(data.message);
    await refreshTasks();
    return data;
  } catch (err) {
    console.error("API Network Error:", err);
    showStatus("Network error.", "red");
    speak("Network error.");
    return null;
  }
}

/* --- Voice Command Processing --- */
async function processCommand(cmd) {
  console.log(`🧠 Processing command: "${cmd}"`);
  if (!cmd) return;
  cmd = cmd.trim();
  if (!cmd) return;
  const lower = cmd.toLowerCase();

  if (lower.startsWith("add ")) {
    console.log("-> Matched ADD");
    const name = cmd.replace(/^\s*add\s*/i, "").trim();
    if (!name) return speak("What should I add?");
    sendCommandJson("/add", { task: name });
    return;
  }

  const markMatch = lower.match(/^mark\s+(.+?)\s+(?:as\s+)?done$/i);
  if (markMatch) {
    console.log("-> Matched MARK");
    markTaskByName(markMatch[1].trim());
    return;
  }

  const deleteMatch = lower.match(/^(?:delete|remove)\s+(.+)$/i);
  if (deleteMatch) {
    console.log("-> Matched DELETE");
    deleteTaskByName(deleteMatch[1].trim());
    return;
  }

  if (lower.includes("clear all") || lower.includes("remove all")) {
    console.log("-> Matched CLEAR ALL");
    sendCommandJson("/clear");
    return;
  }

  if (lower.includes("list all tasks") || lower.includes("what are my tasks")) {
    console.log("-> Matched LIST ALL");
    await listAllTasks();
    return;
  }
  if (lower.includes("list pending") || lower.includes("pending tasks")) {
    console.log("-> Matched LIST PENDING");
    await listPendingTasks();
    return;
  }
  if (lower.includes("list completed") || lower.includes("completed tasks")) {
    console.log("-> Matched LIST COMPLETED");
    await listCompletedTasks();
    return;
  }

  console.log("-> Command not understood.");
  speak("Sorry, I didn't understand that.");
}

/* --- Task Helpers --- */
async function markTaskByName(name) {
  console.log(`🧠 Looking for task to MARK: "${name}"`);
  const res = await fetch("/tasks");
  const tasks = await res.json();
  const t = tasks.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!t) return speak("Task not found");
  sendCommandJson("/mark", { id: t.id });
}

async function deleteTaskByName(name) {
  console.log(`🧠 Looking for task to DELETE: "${name}"`);
  const res = await fetch("/tasks");
  const tasks = await res.json();
  const t = tasks.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!t) return speak("Task not found");
  sendCommandJson("/delete", { id: t.id });
}

async function toggleTask(id) {
  console.log(`🖱️ UI: Toggle task ${id}`);
  await sendCommandJson("/toggle", { id });
}
async function deleteTask(id) {
  console.log(`🖱️ UI: Delete task ${id}`);
  await sendCommandJson("/delete", { id });
}

/* --- Sorting Dropdown --- */
function addSortDropdown() {
  console.log("⚙️ Initializing Sort Dropdown");
  const old = document.getElementById("sortWrapper");
  if (old) old.remove();

  const wrapper = document.createElement("div");
  wrapper.id = "sortWrapper";
  wrapper.style.position = "relative";
  wrapper.style.display = "inline-block";

  const btn = document.createElement("button");
  btn.textContent = "Sort By ▾";
  btn.style.padding = "8px 14px";
  btn.style.border = "1px solid #ccc";
  btn.style.borderRadius = "10px";
  btn.style.background = "#156017ff";
  btn.style.cursor = "pointer";
  btn.style.fontWeight = "600";
  btn.style.transition = "0.2s ease";
  btn.addEventListener("mouseenter", () => (btn.style.background = "#4066b8ff"));
  btn.addEventListener("mouseleave", () => (btn.style.background = "#5b843fff"));

  const dropdown = document.createElement("div");
  dropdown.id = "sortMenu";
  dropdown.style.display = "none";
  dropdown.style.position = "absolute";
  dropdown.style.top = "110%";
  dropdown.style.left = "0";
  dropdown.style.background = "#fff";
  dropdown.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
  dropdown.style.borderRadius = "8px";
  dropdown.style.minWidth = "160px";
  dropdown.style.zIndex = "1000";

  const options = [
    { value: "created", label: "Created At" },
    { value: "priority", label: "Priority" },
    { value: "category", label: "Category" },
    { value: "due", label: "Due Date" }
  ];

  options.forEach(opt => {
    const item = document.createElement("div");
    item.textContent = opt.label;
    item.style.padding = "10px 14px";
    item.style.cursor = "pointer";
    item.style.transition = "0.2s";
    item.addEventListener("mouseenter", () => (item.style.background = "#f0f0f0"));
    item.addEventListener("mouseleave", () => (item.style.background = "transparent"));
    item.addEventListener("click", () => {
      console.log(`🎨 Sort mode changed to: ${opt.value}`);
      sortMode = opt.value;
      dropdown.style.display = "none";
      btn.textContent = `Sort By: ${opt.label} ▾`;
      refreshTasks();
    });
    dropdown.appendChild(item);
  });

  btn.addEventListener("click", () => {
    dropdown.style.display = dropdown.style.display === "none" ? "block" : "none";
  });

  document.addEventListener("click", e => {
    if (!wrapper.contains(e.target)) dropdown.style.display = "none";
  });

  wrapper.appendChild(btn);
  wrapper.appendChild(dropdown);
  controls.appendChild(wrapper);
}

/* --- Speech Recognition Setup --- */
function initRecognizers() {
  console.log("⚙️ Initializing speech recognizers...");
  if (!SpeechRecognition) {
    console.error("Web Speech API not supported.");
    showStatus("Web Speech API not supported.", "red");
    return;
  }

  wakeRecognition = new SpeechRecognition();
  wakeRecognition.lang = "en-US";
  wakeRecognition.continuous = true;

  commandRecognition = new SpeechRecognition();
  commandRecognition.lang = "en-US";
  commandRecognition.continuous = false;

  wakeRecognition.onresult = (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
    console.log(`🎙️ Wake heard: "${transcript}"`);
    if ((transcript.includes("hey to do") || transcript.includes("hello to do")) && !inCommandMode) {
      console.log("✅ Wake word DETECTED. Activating command mode.");
      inCommandMode = true;
      stopWakeRecognition();

      const utter = new SpeechSynthesisUtterance("Yes? Listening for your command.");
      utter.lang = "en-US";

      // Show "Listening..." while speaking
      showStatus("Listening for command...", "blue");

      // After speaking, start recognition
      utter.onend = () => {
        console.log("🎙️ App finished speaking. Starting command recognition.");
        showStatus("Speak now!", "green");
        commandRecognition.start();
      };

      synth.speak(utter);
    }
  };

  wakeRecognition.onend = () => {
    console.log("🎙️ Wake recognizer stopped.");
    wakeRunning = false;
    if (!inCommandMode && listening) setTimeout(startWakeRecognition, 500);
  };

  wakeRecognition.onerror = (e) => {
    if (e.error !== "no-speech") console.warn("🎙️ Wake recognizer error:", e.error);
  };

  commandRecognition.onresult = (e) => {
    const transcript = e.results[e.results.length - 1][0].transcript;
    console.log(`🎙️ Command heard: "${transcript}"`);
    showStatus(`You said: "${transcript}"`, "purple");
    processCommand(transcript);
  };

  commandRecognition.onend = () => {
    console.log("🎙️ Command recognizer stopped. Returning to wake mode.");
    inCommandMode = false;
    showStatus("Say 'Hey To Do' to start again.", "green");
    if (listening) setTimeout(startWakeRecognition, 500);
  };

  commandRecognition.onerror = (e) => {
    console.warn("🎙️ Command recognizer error:", e.error);
    inCommandMode = false;
    startWakeRecognition();
  };
}

function startWakeRecognition() {
  if (!wakeRunning && listening) {
    console.log("🎙️ Starting wake recognizer...");
    wakeRecognition.start();
    wakeRunning = true;
  }
}
function stopWakeRecognition() {
  if (wakeRunning) {
    console.log("🎙️ Stopping wake recognizer.");
    try { wakeRecognition.stop(); } catch {}
    wakeRunning = false;
  }
}

/* --- Manual Input --- */
manualForm.addEventListener("submit", ev => {
  ev.preventDefault();
  const v = manualInput.value.trim();
  console.log(`🖱️ Manual form submitted: "${v}"`);
  if (!v) return;
  // sendCommandJson("/add", { task: v }).then(() => speak(`Task ${v} added`));
sendCommandJson("/add", { task: v });  manualInput.value = "";
});

/* --- Mute Toggle --- */
muteBtn.addEventListener("click", () => {
  listening = !listening;
  console.log(`🖱️ Mute button clicked. Listening set to: ${listening}`);
  muteBtn.textContent = listening ? "Stop Listening" : "Start Listening";
  if (listening) {
    initRecognizers();
    startWakeRecognition();
    showStatus("Say 'Hey To Do' to start.", "green");
  } else {
    stopWakeRecognition();
    commandRecognition?.stop();
    showStatus("Voice paused. Use manual input.", "gray");
  }
});

/* --- Clear All --- */
clearBtn.addEventListener("click", async () => {
  console.log("🖱️ Clear All button clicked.");
  if (!confirm("Clear all tasks?")) {
    console.log("-> Clear all cancelled.");
    return;
  }
  await sendCommandJson("/clear");
});

/* --- Initialize App --- */
console.log("🚀 App starting...");
addSortDropdown();
initRecognizers();
startWakeRecognition();
refreshTasks();
window.addEventListener("load", () => {
  console.log("🎉 Page loaded.");
  speak("Voice-based To-Do app ready. Say 'Hey To Do' to start.");
});
showStatus("Say 'Hey To Do' to start.", "green");
