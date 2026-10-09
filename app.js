import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

import {
  collection,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  addDoc,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBkXRY91cIA24l8io4IXpuf8WCs-XzqzkY",
  authDomain: "praktik-nessa-p1-243026010.firebaseapp.com",
  databaseURL:
    "https://praktik-nessa-p1-243026010-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "praktik-nessa-p1-243026010",
  storageBucket:
    "praktik-nessa-p1-243026010.firebasestorage.app",
  messagingSenderId: "899976657760",
  appId: "1:899976657760:web:a02ea4c386c337e0ec7c05",
};

const LOG_COLLECTION = "detection_logs";
const MOCK_STORAGE_KEY = "edge_ai_inventory_mock_logs";
const DEVICE_STORAGE_KEY = "edge_ai_inventory_device_id";

const SAVE_THROTTLE_MS = 3000;
const MAX_VISIBLE_LOGS = 50;

const TARGET_CLASSES = [
  "mouse",
  "keyboard",
  "cell phone",
  "book",
  "scissors",
  "laptop",
  "person",
];

const CLASS_LABELS = {
  mouse: "Mouse",
  keyboard: "Keyboard",
  "cell phone": "HP / Cell Phone",
  book: "Book",
  scissors: "Scissors",
  laptop: "Laptop",
  person: "Person",
};

const CLASS_EMOJIS = {
  mouse: "🖱️",
  keyboard: "⌨️",
  "cell phone": "📱",
  book: "📚",
  scissors: "✂️",
  laptop: "💻",
  person: "👤",
};

const state = {
  dbMode: "mock",

  db: null,
  firebaseEnabled: false,

  unsubscribe: null,
  mockListener: null,

  stream: null,

  model: null,
  modelLoading: false,

  isDetecting: false,
  detectionBusy: false,
  frameHandle: null,

  cameraStarted: false,

  lastSaveAt: 0,

  selectedTargets: new Set(TARGET_CLASSES),

  confidence: 0.35,

  autoSave: true,

  torchOn: false,

  logs: [],
};

const el = {
  video: document.getElementById("video"),
  canvas: document.getElementById("canvas"),
  ctx: document.getElementById("canvas").getContext("2d"),
  cameraContainer: document.getElementById("cameraContainer"),

  overlayMsg: document.getElementById("overlayMsg"),
  overlayText: document.getElementById("overlayText"),

  startCameraBtn: document.getElementById("startCameraBtn"),
  stopCameraBtn: document.getElementById("stopCameraBtn"),
  facingMode: document.getElementById("facingMode"),

  loadModelBtn: document.getElementById("loadModelBtn"),
  toggleAiBtn: document.getElementById("toggleAiBtn"),
  modelStatus: document.getElementById("modelStatus"),
  aiState: document.getElementById("aiState"),

  dbStatus: document.getElementById("dbStatus"),
  logModeBadge: document.getElementById("logModeBadge"),
  syncIndicator: document.getElementById("syncIndicator"),

  confidenceRange: document.getElementById("confidenceRange"),
  confidenceValue: document.getElementById("confidenceValue"),

  targetClasses: document.getElementById("targetClasses"),
  targetSelectedCount:
    document.getElementById("targetSelectedCount"),

  detectionCount:
    document.getElementById("detectionCount"),

  detectedObjectName:
    document.getElementById("detectedObjectName"),

  detectedObjectInfo:
    document.getElementById("detectedObjectInfo"),

  detectedConfidence:
    document.getElementById("detectedConfidence"),

  detectionSummaryText:
    document.getElementById("detectionSummaryText"),

  aiReadyText:
    document.getElementById("aiReadyText"),

  cameraStatus:
    document.getElementById("cameraStatus"),

  logCount:
    document.getElementById("logCount"),

  dataList:
    document.getElementById("dataList"),

  exportBtn:
    document.getElementById("exportBtn"),

  clearLogsBtn:
    document.getElementById("clearLogsBtn"),

  navItems:
    document.querySelectorAll(".nav-item"),

  pageTargets:
    document.querySelectorAll("[data-page-target]"),

  quickCameraBtn:
    document.getElementById("quickCameraBtn"),

  quickSwitchBtn:
    document.getElementById("quickSwitchBtn"),

  quickAiBtn:
    document.getElementById("quickAiBtn"),

  quickFlashBtn:
    document.getElementById("quickFlashBtn"),

  mainScanBtn:
    document.getElementById("mainScanBtn"),

  settingsTopBtn:
    document.getElementById("settingsTopBtn"),

  settingsBackBtn:
    document.getElementById("settingsBackBtn"),

  settingsExportBtn:
    document.getElementById("settingsExportBtn"),

  clearSettingsBtn:
    document.getElementById("clearSettingsBtn"),

  autoSaveToggle:
    document.getElementById("autoSaveToggle"),
};

function hasValidFirebaseConfig() {
  const required = [
    firebaseConfig.apiKey,
    firebaseConfig.authDomain,
    firebaseConfig.projectId,
    firebaseConfig.storageBucket,
    firebaseConfig.messagingSenderId,
    firebaseConfig.appId,
  ];

  return (
    required.every(Boolean) &&
    !firebaseConfig.apiKey.includes("PASTE_") &&
    !firebaseConfig.projectId.includes("PASTE_") &&
    !firebaseConfig.appId.includes("PASTE_")
  );
}

function initFirebase() {
  if (state.firebaseEnabled && state.db) {
    return true;
  }

  if (!hasValidFirebaseConfig()) {
    return false;
  }

  try {
    const app = initializeApp(firebaseConfig);

    state.db = getFirestore(app);
    state.firebaseEnabled = true;

    return true;
  } catch (error) {
    console.error("Firebase init error:", error);

    state.firebaseEnabled = false;
    state.db = null;

    return false;
  }
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_STORAGE_KEY);

  if (!id) {
    id = `BROWSER-${
      crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(16).slice(2, 10)
    }`.toUpperCase();

    localStorage.setItem(DEVICE_STORAGE_KEY, id);
  }

  return id;
}

function readMockLogs() {
  try {
    const data = JSON.parse(
      localStorage.getItem(MOCK_STORAGE_KEY) || "[]"
    );

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(
      "Mock storage parse error:",
      error
    );

    return [];
  }
}

function writeMockLogs(logs) {
  localStorage.setItem(
    MOCK_STORAGE_KEY,
    JSON.stringify(logs)
  );

  window.dispatchEvent(
    new CustomEvent("edge-ai-mock-change")
  );
}

function getMockLogsSorted() {
  return readMockLogs().sort(
    (a, b) =>
      new Date(b.timestamp).getTime() -
      new Date(a.timestamp).getTime()
  );
}

function mockListen(callback) {
  const render = () => {
    callback({
      docs: getMockLogsSorted().slice(
        0,
        MAX_VISIBLE_LOGS
      ),
    });
  };

  const handler = () => render();

  window.addEventListener(
    "edge-ai-mock-change",
    handler
  );

  window.addEventListener(
    "storage",
    handler
  );

  render();

  return () => {
    window.removeEventListener(
      "edge-ai-mock-change",
      handler
    );

    window.removeEventListener(
      "storage",
      handler
    );
  };
}

function normalizeFirestoreTimestamp(value) {
  if (!value) {
    return null;
  }

  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function normalizeLog(
  doc,
  firebaseDoc = true
) {
  const data =
    firebaseDoc &&
    typeof doc.data === "function"
      ? doc.data()
      : doc;

  return {
    id: firebaseDoc
      ? doc.id
      : data.id || crypto.randomUUID(),

    items: Array.isArray(data.items)
      ? data.items
      : [],

    itemsString:
      data.itemsString ||
      (Array.isArray(data.items)
        ? data.items.join(", ")
        : "-"),

    count: Number(data.count || 0),

    deviceId:
      data.deviceId ||
      "BROWSER-UNKNOWN",

    timestamp:
      normalizeFirestoreTimestamp(
        data.timestamp
      ) ||
      data.timestamp ||
      new Date().toISOString(),

    mode:
      data.mode ||
      (state.dbMode === "firebase"
        ? "firebase"
        : "mock"),
  };
}

function closeDbListener() {
  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }

  if (state.mockListener) {
    state.mockListener();
    state.mockListener = null;
  }
}

function listenToDatabase() {
  closeDbListener();

  setSyncIndicator(
    "Menyinkronkan",
    true
  );

  if (
    state.dbMode === "firebase" &&
    state.firebaseEnabled &&
    state.db
  ) {
    const logsRef = collection(
      state.db,
      LOG_COLLECTION
    );

    const logsQuery = query(
      logsRef,
      orderBy("timestamp", "desc"),
      limit(MAX_VISIBLE_LOGS)
    );

    state.unsubscribe = onSnapshot(
      logsQuery,

      (snapshot) => {
        state.logs =
          snapshot.docs.map(
            (doc) =>
              normalizeLog(
                doc,
                true
              )
          );

        renderLogs();

        setSyncIndicator(
          "Firebase real-time",
          true
        );
      },

      (error) => {
        console.error(
          "Firestore listener error:",
          error
        );

        setDbStatus(
          "Firebase error",
          "warn"
        );

        setSyncIndicator(
          "Firebase gagal, cek Rules",
          false
        );
      }
    );

    return;
  }

  state.mockListener = mockListen(
    (snapshot) => {
      state.logs =
        snapshot.docs.map(
          (doc) =>
            normalizeLog(
              doc,
              false
            )
        );

      renderLogs();

      setSyncIndicator(
        "Mock LocalStorage",
        true
      );
    }
  );
}

async function saveToDatabase(
  detections
) {
  if (!state.autoSave) {
    return false;
  }

  const now = Date.now();

  if (
    now - state.lastSaveAt <
    SAVE_THROTTLE_MS
  ) {
    return false;
  }

  if (!detections.length) {
    return false;
  }

  const items =
    detections.map(
      (item) => ({
        class: item.class,

        label:
          CLASS_LABELS[item.class] ||
          item.class,

        confidence: Number(
          (item.score * 100).toFixed(2)
        ),
      })
    );

  const payload = {
    items,

    itemsString: items
      .map(
        (item) =>
          `${item.label} (${item.confidence}%)`
      )
      .join(", "),

    count: items.length,

    deviceId:
      getDeviceId(),

    mode:
      state.dbMode,

    timestamp:
      state.dbMode === "firebase"
        ? serverTimestamp()
        : new Date().toISOString(),
  };

  try {
    if (
      state.dbMode === "firebase" &&
      state.firebaseEnabled &&
      state.db
    ) {
      await addDoc(
        collection(
          state.db,
          LOG_COLLECTION
        ),
        payload
      );
    } else {
      const current =
        readMockLogs();

      current.push({
        ...payload,

        id: crypto.randomUUID(),

        timestamp:
          new Date().toISOString(),
      });

      writeMockLogs(
        current.slice(-200)
      );
    }

    state.lastSaveAt = now;

    return true;
  } catch (error) {
    console.error(
      "Gagal menyimpan ke database:",
      error
    );

    setDbStatus(
      "DB write error",
      "warn"
    );

    return false;
  }
}

async function exportLogsAsCsv() {
  let logs = [];

  try {
    if (
      state.dbMode === "firebase" &&
      state.firebaseEnabled &&
      state.db
    ) {
      const snapshot =
        await getDocs(
          collection(
            state.db,
            LOG_COLLECTION
          )
        );

      logs =
        snapshot.docs
          .map(
            (doc) =>
              normalizeLog(
                doc,
                true
              )
          )
          .sort(
            (a, b) =>
              new Date(
                b.timestamp
              ).getTime() -
              new Date(
                a.timestamp
              ).getTime()
          );
    } else {
      logs =
        getMockLogsSorted();
    }

    if (!logs.length) {
      alert(
        "Belum ada log untuk diekspor."
      );

      return;
    }

    const rows = [
      [
        "Waktu",
        "Items",
        "Jumlah",
        "Device ID",
        "Mode",
      ],

      ...logs.map(
        (log) => [
          formatDate(log.timestamp),
          log.itemsString,
          log.count,
          log.deviceId,
          log.mode,
        ]
      ),
    ];

    const csv =
      rows
        .map(
          (row) =>
            row
              .map(
                (cell) =>
                  `"${String(
                    cell ?? ""
                  ).replaceAll(
                    '"',
                    '""'
                  )}"`
              )
              .join(",")
        )
        .join("\r\n");

    const blob =
      new Blob(
        ["\ufeff" + csv],
        {
          type:
            "text/csv;charset=utf-8;",
        }
      );

    const url =
      URL.createObjectURL(blob);

    const a =
      document.createElement(
        "a"
      );

    a.href = url;

    a.download =
      `inventory-log-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;

    document.body.appendChild(a);

    a.click();

    a.remove();

    URL.revokeObjectURL(url);
  } catch (error) {
    console.error(
      "Export error:",
      error
    );

    alert(
      "Gagal mengekspor log. Cek console browser."
    );
  }
}

function clearMockLogs() {
  if (
    state.dbMode !== "mock"
  ) {
    alert(
      "Tombol ini hanya menghapus log Mock/LocalStorage."
    );

    return;
  }

  if (
    !confirm(
      "Hapus semua log Mock di browser ini?"
    )
  ) {
    return;
  }

  localStorage.removeItem(
    MOCK_STORAGE_KEY
  );

  window.dispatchEvent(
    new CustomEvent(
      "edge-ai-mock-change"
    )
  );
}

function setDbStatus(
  text,
  type = "neutral"
) {
  if (!el.dbStatus) {
    return;
  }

  el.dbStatus.textContent =
    `DB: ${text}`;

  el.dbStatus.className =
    `status-pill status-${type}`;
}

function setModelStatus(
  text,
  type = "neutral"
) {
  if (!el.modelStatus) {
    return;
  }

  el.modelStatus.textContent =
    text;

  el.modelStatus.className =
    `status-pill status-${type}`;
}

function setSyncIndicator(
  text,
  live = false
) {
  if (!el.syncIndicator) {
    return;
  }

  el.syncIndicator.innerHTML =
    `<i></i> ${escapeHtml(text)}`;

  el.syncIndicator.classList.toggle(
    "live",
    live
  );
}

function setOverlay(
  text,
  show = true
) {
  if (
    !el.overlayText ||
    !el.overlayMsg
  ) {
    return;
  }

  el.overlayText.textContent =
    text;

  el.overlayMsg.classList.toggle(
    "hidden",
    !show
  );
}

function updateTargetSelectedCount() {
  const count =
    state.selectedTargets.size;

  const total =
    TARGET_CLASSES.length;

  if (el.targetSelectedCount) {
    el.targetSelectedCount.textContent =
      `${count}/${total} dipilih`;
  }
}

function renderTargetCheckboxes() {
  if (!el.targetClasses) {
    return;
  }

  el.targetClasses.innerHTML =
    TARGET_CLASSES
      .map(
        (target) => {
          const checked =
            state.selectedTargets.has(
              target
            )
              ? "checked"
              : "";

          return `
            <label class="target-option">
              <input
                type="checkbox"
                value="${target}"
                ${checked}
              />

              <span>
                ${
                  CLASS_EMOJIS[target] ||
                  "•"
                }
                ${
                  CLASS_LABELS[target] ||
                  target
                }
              </span>
            </label>
          `;
        }
      )
      .join("");

  el.targetClasses
    .querySelectorAll("input")
    .forEach(
      (input) => {
        input.addEventListener(
          "change",
          () => {
            if (input.checked) {
              state.selectedTargets.add(
                input.value
              );
            } else {
              state.selectedTargets.delete(
                input.value
              );
            }

            updateTargetSelectedCount();

            if (
              state.selectedTargets.size ===
                0 &&
              state.isDetecting
            ) {
              stopDetection();

              setOverlay(
                "Pilih minimal satu target objek.",
                true
              );
            }
          }
        );
      }
    );

  updateTargetSelectedCount();
}

function updateDetectionResult(
  predictions
) {
  const count =
    predictions.length;

  if (el.detectionCount) {
    el.detectionCount.textContent =
      String(count);
  }

  if (!count) {
    if (
      el.detectedObjectName
    ) {
      el.detectedObjectName.textContent =
        "Belum ada objek";
    }

    if (
      el.detectedObjectInfo
    ) {
      el.detectedObjectInfo.textContent =
        state.isDetecting
          ? "Arahkan kamera ke objek target"
          : "Mulai scanning untuk mendeteksi";
    }

    if (
      el.detectedConfidence
    ) {
      el.detectedConfidence.textContent =
        "—";
    }

    if (
      el.detectionSummaryText
    ) {
      el.detectionSummaryText.textContent =
        "Belum ada hasil deteksi";
    }

    return;
  }

  const best =
    [...predictions].sort(
      (a, b) =>
        b.score - a.score
    )[0];

  const bestLabel =
    CLASS_LABELS[best.class] ||
    best.class;

  const bestConfidence =
    `${(
      best.score * 100
    ).toFixed(0)}%`;

  if (
    el.detectedObjectName
  ) {
    el.detectedObjectName.textContent =
      bestLabel;
  }

  if (
    el.detectedObjectInfo
  ) {
    el.detectedObjectInfo.textContent =
      count === 1
        ? "1 target terdeteksi"
        : `${count} target terdeteksi`;
  }

  if (
    el.detectedConfidence
  ) {
    el.detectedConfidence.textContent =
      bestConfidence;
  }

  if (
    el.detectionSummaryText
  ) {
    const labels = [
      ...new Set(
        predictions.map(
          (item) =>
            CLASS_LABELS[item.class] ||
            item.class
        )
      ),
    ];

    el.detectionSummaryText.textContent =
      labels.join(" • ");
  }
}

function renderLogs() {
  if (el.logCount) {
    el.logCount.textContent =
      `${state.logs.length} log`;
  }

  if (!el.dataList) {
    updateClearButtons();
    return;
  }

  if (!state.logs.length) {
    el.dataList.innerHTML = `
      <div class="empty-state">
        <div class="empty-emoji">🌸</div>
        <strong>Belum ada objek terdeteksi</strong>
        <span>Mulai scanning untuk melihat riwayat.</span>
      </div>
    `;

    updateClearButtons();
    return;
  }

  el.dataList.innerHTML =
    state.logs
      .map(
        (log) => {
          const labels =
            (log.items || [])
              .map(
                (item) =>
                  item.label ||
                  item.class ||
                  "Unknown"
              );

          const uniqueLabels =
            [...new Set(labels)];

          const firstClass =
            log.items?.[0]?.class;

          const emoji =
            CLASS_EMOJIS[firstClass] ||
            "🎯";

          return `
            <article class="log-item">

              <div>

                <div class="log-time">
                  ${escapeHtml(
                    formatDate(
                      log.timestamp
                    )
                  )}
                </div>

                <div class="log-items">
                  ${emoji}
                  ${escapeHtml(
                    log.itemsString ||
                    "-"
                  )}
                </div>

                <div class="log-meta">
                  ${uniqueLabels
                    .slice(0, 7)
                    .map(
                      (label) =>
                        `<span class="log-tag">
                          ${escapeHtml(label)}
                        </span>`
                    )
                    .join("")}
                </div>

              </div>

              <div class="log-count-badge">
                ${Number(
                  log.count || 0
                )} obj
              </div>

            </article>
          `;
        }
      )
      .join("");

  updateClearButtons();
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return String(value);
  }

  return new Intl.DateTimeFormat(
    "id-ID",
    {
      dateStyle: "short",
      timeStyle: "medium",
    }
  ).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}

function syncCanvasSize() {
  if (
    !el.video.videoWidth ||
    !el.video.videoHeight
  ) {
    return;
  }

  if (
    el.canvas.width !==
      el.video.videoWidth ||
    el.canvas.height !==
      el.video.videoHeight
  ) {
    el.canvas.width =
      el.video.videoWidth;

    el.canvas.height =
      el.video.videoHeight;
  }
}


function fitCameraContainer() {
  if (
    !el.video.videoWidth ||
    !el.video.videoHeight
  ) {
    return;
  }

  el.cameraContainer.style.width = "100%";
  el.cameraContainer.style.height = "100%";
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert(
      "Browser ini tidak mendukung kamera. Gunakan Chrome/Edge/Firefox terbaru melalui HTTPS atau localhost."
    );

    return false;
  }

  stopCamera();

  setOverlay("Meminta izin kamera...", true);

  try {
    const facingMode = el.facingMode.value;

const isMobile = window.matchMedia(
  "(max-width: 768px)"
).matches;

state.stream =
  await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: {
        ideal: facingMode,
      },

      ...(!isMobile
        ? {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            aspectRatio: { ideal: 16 / 9 },
          }
        : {}),
    },
    audio: false,
  });

    el.video.srcObject = state.stream;

    el.video.style.transform = "scaleX(1)";
    el.canvas.style.transform = "scaleX(1)";

    await el.video.play();

    await new Promise((resolve) => {
      if (el.video.readyState >= 2) {
        resolve();
      } else {
        el.video.addEventListener(
          "loadedmetadata",
          resolve,
          {
            once: true,
          }
        );
      }
    });

    fitCameraContainer();
    syncCanvasSize();

    state.cameraStarted = true;
    state.torchOn = false;

    el.startCameraBtn.disabled = true;
    el.stopCameraBtn.disabled = false;
    el.toggleAiBtn.disabled = !state.model;

    if (el.cameraStatus) {
      el.cameraStatus.textContent = "ON";
    }

    setOverlay("", false);
    updateQuickCameraButton();

    return true;
  } catch (error) {
    console.error("Camera error:", error);

    state.cameraStarted = false;

    setOverlay(
      "Kamera gagal dibuka. Cek izin kamera dan gunakan HTTPS/localhost.",
      true
    );

    alert(
      `Gagal mengakses kamera: ${error.message}`
    );

    return false;
  }
}

function stopCamera() {
  stopDetection();

  if (state.stream) {
    state.stream
      .getTracks()
      .forEach(
        (track) =>
          track.stop()
      );

    state.stream = null;
  }

  el.video.srcObject = null;

  state.cameraStarted = false;
  state.torchOn = false;

  el.startCameraBtn.disabled =
    false;

  el.stopCameraBtn.disabled =
    true;

  el.toggleAiBtn.disabled =
    true;

  if (el.cameraStatus) {
    el.cameraStatus.textContent =
      "OFF";
  }

  el.ctx.clearRect(
    0,
    0,
    el.canvas.width,
    el.canvas.height
  );

  updateQuickCameraButton();

  updateDetectionResult([]);
}

async function loadModel() {
  if (
    state.model ||
    state.modelLoading
  ) {
    return !!state.model;
  }

  state.modelLoading = true;

  if (el.loadModelBtn) {
    el.loadModelBtn.disabled =
      true;
  }

  setModelStatus(
    "Memuat model...",
    "warn"
  );

  setOverlay(
    "Mengunduh model COCO-SSD...",
    true
  );

  try {
    await tf.ready();

    state.model =
      await cocoSsd.load({base: "mobilenet_v2",});

    setModelStatus(
      "Model siap",
      "success"
    );

    if (el.toggleAiBtn) {
      el.toggleAiBtn.disabled =
        !state.cameraStarted;
    }

    if (el.loadModelBtn) {
      el.loadModelBtn.textContent =
        "✅ Model Siap";
    }

    if (
      state.cameraStarted
    ) {
      setOverlay(
        "",
        false
      );
    }

    return true;
  } catch (error) {
    console.error(
      "Model load error:",
      error
    );

    state.model = null;

    if (el.loadModelBtn) {
      el.loadModelBtn.disabled =
        false;
    }

    setModelStatus(
      "Model gagal",
      "warn"
    );

    setOverlay(
      "Gagal memuat model. Pastikan internet aktif.",
      true
    );

    alert(
      "Gagal memuat COCO-SSD. Coba refresh halaman dan pastikan koneksi internet aktif."
    );

    return false;
  } finally {
    state.modelLoading =
      false;
  }
}

function drawDetections(
  predictions
) {
  syncCanvasSize();

  const ctx = el.ctx;

  ctx.clearRect(
    0,
    0,
    el.canvas.width,
    el.canvas.height
  );

  const scaleX =
    el.canvas.width /
    Math.max(
      el.video.videoWidth,
      1
    );

  const scaleY =
    el.canvas.height /
    Math.max(
      el.video.videoHeight,
      1
    );

  predictions.forEach(
    (pred) => {
      const [
        x,
        y,
        width,
        height,
      ] = pred.bbox;

      const canvasX =
        x * scaleX;

      const canvasY =
        y * scaleY;

      const canvasW =
        width * scaleX;

      const canvasH =
        height * scaleY;

      ctx.lineWidth = 3;

      ctx.strokeStyle =
        "#ec4899";

      ctx.strokeRect(
        canvasX,
        canvasY,
        canvasW,
        canvasH
      );

      const label =
        `${
          CLASS_LABELS[
            pred.class
          ] ||
          pred.class
        } ${
          (
            pred.score * 100
          ).toFixed(0)
        }%`;

      ctx.font =
        "700 14px Nunito, sans-serif";

      const labelWidth =
        ctx.measureText(label)
          .width + 14;

      const labelY =
        Math.max(
          canvasY - 25,
          0
        );

      ctx.fillStyle =
        "#ec4899";

      ctx.fillRect(
        canvasX,
        labelY,
        labelWidth,
        25
      );

      ctx.fillStyle =
        "#ffffff";

      ctx.fillText(
        label,
        canvasX + 7,
        labelY + 17
      );
    }
  );
}

async function detectFrame() {
  if (!state.isDetecting) {
    return;
  }

  if (
    !state.cameraStarted ||
    !state.model
  ) {
    stopDetection();
    return;
  }

  if (
    state.selectedTargets.size ===
    0
  ) {
    stopDetection();

    updateDetectionResult([]);

    return;
  }

  if (
    !state.detectionBusy &&
    el.video.readyState >= 2
  ) {
    state.detectionBusy =
      true;

    try {
      const predictions = await state.model.detect(el.video);
      console.table(
  predictions.map((pred) => ({
    class: pred.class,
    confidence: `${(pred.score * 100).toFixed(1)}%`,
  }))
);

      const targetPredictions =
        predictions.filter(
          (pred) =>
            state.selectedTargets.has(
              pred.class
            ) &&
            pred.score >=
              state.confidence
        );

      drawDetections(
        targetPredictions
      );

      updateDetectionResult(
        targetPredictions
      );

      if (
        targetPredictions.length >
        0
      ) {
        await saveToDatabase(
          targetPredictions
        );
      }
    } catch (error) {
      console.error(
        "Detection error:",
        error
      );
    } finally {
      state.detectionBusy =
        false;
    }
  }

  state.frameHandle =
    requestAnimationFrame(
      detectFrame
    );
}

async function startDetection() {
  if (!state.cameraStarted) {
    const cameraReady =
      await startCamera();

    if (!cameraReady) {
      return false;
    }
  }

  if (
    !state.selectedTargets.size
  ) {
    alert(
      "Pilih minimal satu Target Object terlebih dahulu."
    );

    return false;
  }

  if (!state.model) {
    const modelReady =
      await loadModel();

    if (!modelReady) {
      return false;
    }
  }

  if (state.isDetecting) {
    return true;
  }

  state.isDetecting =
    true;

  state.lastSaveAt =
    0;

  if (el.aiState) {
    el.aiState.textContent =
      "ON";

    el.aiState.className =
      "mini-state pink";
  }

  if (el.toggleAiBtn) {
    el.toggleAiBtn.textContent =
      "⏸ Stop AI";

    el.toggleAiBtn.className =
      "settings-full-btn success-btn";
  }

  if (el.aiReadyText) {
    el.aiReadyText.textContent =
      "AI Scanning";
  }

  setOverlay(
    "",
    false
  );

  updateQuickAiButton();

  detectFrame();

  return true;
}

function stopDetection() {
  state.isDetecting =
    false;

  state.detectionBusy =
    false;

  if (state.frameHandle) {
    cancelAnimationFrame(
      state.frameHandle
    );
  }

  state.frameHandle =
    null;

  if (el.aiState) {
    el.aiState.textContent =
      "OFF";

    el.aiState.className =
      "mini-state";
  }

  if (el.toggleAiBtn) {
    el.toggleAiBtn.textContent =
      "▶ Start AI";

    el.toggleAiBtn.className =
      "settings-full-btn success-btn";
  }

  if (el.aiReadyText) {
    el.aiReadyText.textContent =
      "AI Ready";
  }

  updateDetectionResult([]);

  updateQuickAiButton();
}

async function startScanning() {
  const ready =
    await startDetection();

  if (ready) {
    el.mainScanBtn.textContent =
      "⏸ Stop Scanning";

    el.mainScanBtn.dataset.active =
      "true";
  }
}

function stopScanning() {
  stopDetection();

  el.mainScanBtn.innerHTML = `
    <span class="scan-icon">⌾</span>
    <span>Start Scanning</span>
  `;

  el.mainScanBtn.dataset.active =
    "false";
}

async function toggleMainScanning() {
  if (state.isDetecting) {
    stopScanning();
    return;
  }

  await startScanning();
}

function updateQuickCameraButton() {
  if (!el.quickCameraBtn) {
    return;
  }

  if (state.cameraStarted) {
    el.quickCameraBtn.innerHTML =
      `⏹<span>Stop</span>`;
  } else {
    el.quickCameraBtn.innerHTML =
      `📷<span>Camera</span>`;
  }
}

async function toggleQuickCamera() {
  if (state.cameraStarted) {
    stopCamera();
    return;
  }

  await startCamera();
}

async function switchCamera() {
  const wasDetecting =
    state.isDetecting;

  const current =
    el.facingMode.value;

  el.facingMode.value =
    current === "environment"
      ? "user"
      : "environment";

  if (state.cameraStarted) {
    const started =
      await startCamera();

    if (
      started &&
      wasDetecting
    ) {
      await startDetection();
    }
  }
}

async function toggleFlash() {
  if (
    !state.cameraStarted ||
    !state.stream
  ) {
    alert(
      "Nyalakan kamera terlebih dahulu."
    );

    return;
  }

  const videoTrack =
    state.stream.getVideoTracks()[0];

  if (!videoTrack) {
    alert(
      "Track kamera tidak tersedia."
    );

    return;
  }

  const capabilities =
    videoTrack.getCapabilities?.();

  if (
    !capabilities ||
    !capabilities.torch
  ) {
    alert(
      "Flash/torch tidak didukung oleh kamera atau browser perangkat ini."
    );

    return;
  }

  try {
    state.torchOn =
      !state.torchOn;

    await videoTrack.applyConstraints(
      {
        advanced: [
          {
            torch:
              state.torchOn,
          },
        ],
      }
    );

    if (el.quickFlashBtn) {
      el.quickFlashBtn.classList.toggle(
        "active",
        state.torchOn
      );
    }
  } catch (error) {
    console.error(
      "Torch error:",
      error
    );

    state.torchOn =
      false;

    alert(
      "Flash tidak dapat diaktifkan pada perangkat ini."
    );
  }
}

async function toggleQuickAi() {
  if (state.isDetecting) {
    stopDetection();
    return;
  }

  await startDetection();
}

function applyDbMode(mode) {
  state.dbMode =
    mode;

  document
    .querySelectorAll(
      "[data-db-mode]"
    )
    .forEach(
      (button) => {
        button.classList.toggle(
          "active",
          button.dataset.dbMode ===
            mode
        );
      }
    );

  if (el.logModeBadge) {
    el.logModeBadge.textContent =
      mode.toUpperCase();
  }

  if (
    mode === "firebase"
  ) {
    if (!state.firebaseEnabled) {
      const initialized =
        initFirebase();

      if (!initialized) {
        alert(
          "Firebase config belum valid. Cek firebaseConfig di app.js."
        );

        state.dbMode =
          "mock";

        document
          .querySelectorAll(
            "[data-db-mode]"
          )
          .forEach(
            (button) => {
              button.classList.toggle(
                "active",
                button.dataset.dbMode ===
                  "mock"
              );
            }
          );

        if (el.logModeBadge) {
          el.logModeBadge.textContent =
            "MOCK";
        }

        setDbStatus(
          "Mock Mode",
          "pink"
        );

        updateClearButtons();

        listenToDatabase();

        return;
      }
    }

    setDbStatus(
      "Firebase ON",
      "success"
    );
  } else {
    setDbStatus(
      "Mock Mode",
      "pink"
    );
  }

  updateClearButtons();

  listenToDatabase();
}

function updateClearButtons() {
  const noData =
    state.logs.length === 0;

  const disabled =
    state.dbMode !== "mock" ||
    noData;

  if (el.clearLogsBtn) {
    el.clearLogsBtn.disabled =
      disabled;
  }

  if (el.clearSettingsBtn) {
    el.clearSettingsBtn.disabled =
      disabled;
  }
}

function updateAutoSaveUI() {
  if (!el.autoSaveToggle) {
    return;
  }

  el.autoSaveToggle.classList.toggle(
    "active",
    state.autoSave
  );

  el.autoSaveToggle.setAttribute(
    "aria-pressed",
    String(state.autoSave)
  );
}

function toggleAutoSave() {
  state.autoSave =
    !state.autoSave;

  updateAutoSaveUI();
}

function showPage(pageName) {
  const pageId =
    `${pageName}Page`;

  document
    .querySelectorAll(".app-page")
    .forEach(
      (page) => {
        page.classList.toggle(
          "active-page",
          page.id === pageId
        );

        page.scrollTop = 0;
      }
    );

  document
    .querySelectorAll(".nav-item")
    .forEach(
      (item) => {
        item.classList.toggle(
          "active",
          item.dataset.pageTarget ===
            pageName
        );
      }
    );
}

el.startCameraBtn.addEventListener(
  "click",
  startCamera
);

el.stopCameraBtn.addEventListener(
  "click",
  stopCamera
);

el.loadModelBtn.addEventListener(
  "click",
  loadModel
);

el.toggleAiBtn.addEventListener(
  "click",
  () => {
    state.isDetecting
      ? stopDetection()
      : startDetection();
  }
);

el.facingMode.addEventListener(
  "change",
  () => {
    if (state.cameraStarted) {
      startCamera();
    }
  }
);

el.confidenceRange.addEventListener(
  "input",
  (event) => {
    state.confidence =
      Number(
        event.target.value
      ) / 100;

    if (el.confidenceValue) {
      el.confidenceValue.textContent =
        `${event.target.value}%`;
    }

    if (
      state.isDetecting &&
      state.cameraStarted
    ) {
      el.ctx.clearRect(
        0,
        0,
        el.canvas.width,
        el.canvas.height
      );
    }
  }
);

document
  .querySelectorAll(
    "[data-db-mode]"
  )
  .forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => {
          applyDbMode(
            button.dataset.dbMode
          );
        }
      );
    }
  );

el.exportBtn.addEventListener(
  "click",
  exportLogsAsCsv
);

el.settingsExportBtn.addEventListener(
  "click",
  exportLogsAsCsv
);

el.clearLogsBtn.addEventListener(
  "click",
  clearMockLogs
);

el.clearSettingsBtn.addEventListener(
  "click",
  clearMockLogs
);

el.autoSaveToggle.addEventListener(
  "click",
  toggleAutoSave
);

el.quickCameraBtn.addEventListener(
  "click",
  toggleQuickCamera
);

el.quickSwitchBtn.addEventListener(
  "click",
  switchCamera
);

el.quickAiBtn.addEventListener(
  "click",
  toggleQuickAi
);

el.quickFlashBtn.addEventListener(
  "click",
  toggleFlash
);

el.mainScanBtn.addEventListener(
  "click",
  toggleMainScanning
);

el.pageTargets.forEach(
  (button) => {
    button.addEventListener(
      "click",
      () => {
        const target =
          button.dataset
            .pageTarget;

        if (!target) {
          return;
        }

        showPage(target);
      }
    );
  }
);

window.addEventListener("resize", () => {
  fitCameraContainer();
  syncCanvasSize();
});

window.addEventListener(
  "beforeunload",
  () => {
    closeDbListener();
    stopCamera();
  }
);

function initApp() {
  renderTargetCheckboxes();

  updateAutoSaveUI();

  renderLogs();

  applyDbMode("mock");

  const firebaseReady =
    initFirebase();

  if (firebaseReady) {
    setDbStatus(
      "Siap · config tersedia",
      "success"
    );
  } else {
    setDbStatus(
      "Mock Mode",
      "pink"
    );
  }

  updateQuickCameraButton();

  updateQuickAiButton();

  updateDetectionResult([]);

  updateClearButtons();

  showPage("scanner");

  console.log(
    "✅ Edge AI Inventory Scanner siap."
  );

  console.log(
    "📱 Device ID:",
    getDeviceId()
  );

  console.log(
    "☁️ Firebase config tersedia:",
    firebaseReady
  );
}

function updateQuickAiButton() {
  if (!el.quickAiBtn) {
    return;
  }

  if (state.isDetecting) {
    el.quickAiBtn.classList.add(
      "active"
    );

    el.quickAiBtn.innerHTML =
      `⏸<span>Stop AI</span>`;
  } else {
    el.quickAiBtn.classList.remove(
      "active"
    );

    el.quickAiBtn.innerHTML =
      `✳<span>AI Scan</span>`;
  }
}
   
initApp();