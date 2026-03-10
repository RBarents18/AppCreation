/**
 * HeartBeat Monitor – Application Logic
 *
 * Supports three data sources:
 *   1. Simulation – generates realistic heart rate data locally (no hardware needed).
 *   2. Web Bluetooth – connects to any BLE device that exposes the standard
 *      "Heart Rate" GATT service (UUID 0x180D), e.g. chest straps and wristbands.
 *   3. Arduino Serial – connects to an Arduino Uno (or compatible board) via USB
 *      using the Web Serial API.  The Arduino should send one BPM integer per line
 *      over its hardware serial port (9600 baud), e.g. Serial.println(bpm).
 *
 * Data is charted in real time with Chart.js and can be exported as CSV.
 */

/* ── GATT UUIDs for the standard Heart Rate service ── */
const HEART_RATE_SERVICE      = 0x180D;
const HEART_RATE_MEASUREMENT  = 0x2A37;

/* ── How many data points to show on the rolling chart ── */
const MAX_CHART_POINTS = 60;

/* ── Heart-rate zones (based on typical adult ranges) ── */
const ZONES = [
  { label: 'Resting',   min: 0,   max: 59,  cls: 'zone-rest'   },
  { label: 'Warm-up',   min: 60,  max: 99,  cls: 'zone-warm'   },
  { label: 'Fat-burn',  min: 100, max: 139, cls: 'zone-fat'    },
  { label: 'Cardio',    min: 140, max: 169, cls: 'zone-cardio'  },
  { label: 'Peak',      min: 170, max: 999, cls: 'zone-peak'   },
];

/* ════════════════════════════════════════════════════
   State
   ════════════════════════════════════════════════════ */
const state = {
  running:        false,
  source:         null,   // 'simulation' | 'bluetooth' | 'arduino'
  readings:       [],     // { timestamp: Date, bpm: number }
  sessionStart:   null,
  simulatorTimer: null,
  durationTimer:  null,
  btDevice:       null,
  btCharacteristic: null,
  arduinoPort:    null,   // SerialPort object (Web Serial API)
  arduinoReader:  null,   // ReadableStreamDefaultReader
};

/* ════════════════════════════════════════════════════
   DOM references
   ════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

const dom = {
  btnBluetooth:  $('btn-bluetooth'),
  btnArduino:    $('btn-arduino'),
  btnSimulate:   $('btn-simulate'),
  btnClear:      $('btn-clear'),
  btnExport:     $('btn-export'),
  statusBadge:   $('connection-status'),
  bpmValue:      $('bpm-value'),
  bpmZone:       $('bpm-zone'),
  heartIcon:     $('heart-icon'),
  statAvg:       $('stat-avg'),
  statMin:       $('stat-min'),
  statMax:       $('stat-max'),
  statDuration:  $('stat-duration'),
  dataLog:       $('data-log'),
};

/* ════════════════════════════════════════════════════
   Chart initialisation
   ════════════════════════════════════════════════════ */
const chartCtx = document.getElementById('hr-chart').getContext('2d');

const hrChart = new Chart(chartCtx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [{
      label: 'BPM',
      data: [],
      borderColor: '#e84a5f',
      backgroundColor: 'rgba(232, 74, 95, 0.08)',
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 5,
      fill: true,
      tension: 0.35,
    }],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    scales: {
      x: {
        ticks: { color: '#7a7f9a', maxTicksLimit: 8, maxRotation: 0 },
        grid:  { color: '#2e3250' },
      },
      y: {
        min: 40,
        max: 200,
        ticks: { color: '#7a7f9a', stepSize: 20 },
        grid:  { color: '#2e3250' },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: ctx => ` ${ctx.parsed.y} BPM`,
        },
      },
    },
  },
});

/* ════════════════════════════════════════════════════
   Utility helpers
   ════════════════════════════════════════════════════ */

/** Format a Date as HH:MM:SS */
function formatTime(date) {
  return date.toTimeString().slice(0, 8);
}

/** Classify a BPM reading into a heart-rate zone */
function getZone(bpm) {
  return ZONES.find(z => bpm >= z.min && bpm <= z.max) || ZONES[ZONES.length - 1];
}

/** Compute session duration string from sessionStart to now */
function sessionDuration() {
  if (!state.sessionStart) return '0s';
  const secs = Math.floor((Date.now() - state.sessionStart) / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/* ════════════════════════════════════════════════════
   UI update helpers
   ════════════════════════════════════════════════════ */

function setStatus(text, cls) {
  dom.statusBadge.textContent = `● ${text}`;
  dom.statusBadge.className = `status-badge ${cls}`;
}

/** Push a new BPM reading into state + all UI elements */
function recordReading(bpm) {
  const now = new Date();
  state.readings.push({ timestamp: now, bpm });

  updateBpmDisplay(bpm);
  updateChart(bpm, now);
  updateStats();
  appendLogRow(now, bpm);
}

function updateBpmDisplay(bpm) {
  dom.bpmValue.textContent = bpm;

  // Heartbeat animation
  dom.heartIcon.classList.remove('beat');
  void dom.heartIcon.offsetWidth; // reflow to restart animation
  dom.heartIcon.classList.add('beat');

  // Zone badge
  const zone = getZone(bpm);
  dom.bpmZone.textContent = zone.label;
  dom.bpmZone.className = `bpm-zone ${zone.cls}`;
  dom.bpmValue.style.color = ''; // reset to CSS var
}

function updateChart(bpm, date) {
  const ds    = hrChart.data.datasets[0];
  const labels = hrChart.data.labels;

  labels.push(formatTime(date));
  ds.data.push(bpm);

  if (labels.length > MAX_CHART_POINTS) {
    labels.shift();
    ds.data.shift();
  }

  hrChart.update('none'); // skip animation for performance
}

function updateStats() {
  const bpms = state.readings.map(r => r.bpm);
  const avg = Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length);
  dom.statAvg.textContent = avg;
  dom.statMin.textContent = Math.min(...bpms);
  dom.statMax.textContent = Math.max(...bpms);
}

function appendLogRow(date, bpm) {
  // Remove placeholder on first row
  const placeholder = dom.dataLog.querySelector('.log-placeholder');
  if (placeholder) placeholder.remove();

  const zone = getZone(bpm);
  const row  = document.createElement('div');
  row.className = 'log-row';
  row.innerHTML =
    `<span class="log-time">${formatTime(date)}</span>` +
    `<span class="log-bpm">${bpm} BPM</span>` +
    `<span class="log-zone">${zone.label}</span>`;
  dom.dataLog.prepend(row); // newest at top
}

function resetDisplay() {
  dom.bpmValue.textContent = '--';
  dom.bpmZone.textContent  = '—';
  dom.bpmZone.className    = 'bpm-zone';
  ['statAvg', 'statMin', 'statMax'].forEach(k => { dom[k].textContent = '--'; });
  dom.statDuration.textContent = '0s';

  hrChart.data.labels = [];
  hrChart.data.datasets[0].data = [];
  hrChart.update();

  dom.dataLog.innerHTML = '<p class="log-placeholder">Readings will appear here once monitoring starts.</p>';
}

/* ════════════════════════════════════════════════════
   Simulation
   ════════════════════════════════════════════════════ */

/**
 * Generate the next simulated BPM.
 * Walks the last value by a small random step for realism.
 */
function nextSimulatedBpm() {
  const readings = state.readings;
  if (readings.length === 0) return 72; // starting value

  const last  = readings[readings.length - 1].bpm;
  const delta = Math.round((Math.random() - 0.47) * 5); // slight upward bias
  return Math.min(190, Math.max(45, last + delta));
}

function startSimulation() {
  state.source  = 'simulation';
  state.running = true;
  state.sessionStart = Date.now();

  setStatus('Simulating', 'status-simulating');
  dom.btnSimulate.textContent = '⏹ Stop Simulation';
  dom.btnSimulate.classList.add('active');
  dom.btnBluetooth.disabled = true;
  dom.btnArduino.disabled   = true;

  // Fire immediately, then every second
  recordReading(nextSimulatedBpm());
  state.simulatorTimer = setInterval(() => recordReading(nextSimulatedBpm()), 1000);
  state.durationTimer  = setInterval(() => { dom.statDuration.textContent = sessionDuration(); }, 1000);
}

function stopSimulation() {
  clearInterval(state.simulatorTimer);
  clearInterval(state.durationTimer);

  state.running = false;
  state.source  = null;

  setStatus('Disconnected', 'status-disconnected');
  dom.btnSimulate.textContent = '▶ Start Simulation';
  dom.btnSimulate.classList.remove('active');
  dom.btnBluetooth.disabled = false;
  dom.btnArduino.disabled   = false;
}

/* ════════════════════════════════════════════════════
   Web Bluetooth
   ════════════════════════════════════════════════════ */

/**
 * Parse a Heart Rate Measurement characteristic value.
 * Spec: https://www.bluetooth.com/specifications/assigned-numbers/
 *
 * Byte 0 flags:
 *   bit 0 = 0 → BPM is uint8 at byte 1
 *   bit 0 = 1 → BPM is uint16 at bytes 1-2 (little-endian)
 */
function parseHeartRateMeasurement(value) {
  const flags = value.getUint8(0);
  const is16bit = (flags & 0x01) !== 0;
  return is16bit ? value.getUint16(1, /* littleEndian */ true) : value.getUint8(1);
}

async function connectBluetooth() {
  if (!navigator.bluetooth) {
    alert('Web Bluetooth is not supported in this browser.\n\nTry Chrome or Edge on desktop/Android.\nFor other browsers, use Simulation mode instead.');
    return;
  }

  try {
    setStatus('Scanning…', 'status-simulating');
    dom.btnBluetooth.disabled = true;
    dom.btnArduino.disabled   = true;
    dom.btnSimulate.disabled  = true;

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HEART_RATE_SERVICE] }],
    });

    state.btDevice = device;
    device.addEventListener('gattserverdisconnected', onBluetoothDisconnected);

    const server  = await device.gatt.connect();
    const service = await server.getPrimaryService(HEART_RATE_SERVICE);
    const char    = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
    state.btCharacteristic = char;

    await char.startNotifications();
    char.addEventListener('characteristicvaluechanged', onHeartRateChanged);

    state.source  = 'bluetooth';
    state.running = true;
    state.sessionStart = Date.now();

    setStatus(`Connected – ${device.name || 'BLE Device'}`, 'status-connected');
    dom.btnBluetooth.textContent = '🔵 Disconnect';
    dom.btnArduino.disabled  = true;
    dom.btnSimulate.disabled = true;

    state.durationTimer = setInterval(() => { dom.statDuration.textContent = sessionDuration(); }, 1000);

  } catch (err) {
    if (err.name !== 'NotFoundError') { // user cancelled chooser
      console.error('Bluetooth error:', err);
      alert(`Bluetooth connection failed:\n${err.message}`);
    }
    setStatus('Disconnected', 'status-disconnected');
    dom.btnBluetooth.disabled = false;
    dom.btnArduino.disabled   = false;
    dom.btnSimulate.disabled  = false;
  }
}

function onHeartRateChanged(event) {
  const bpm = parseHeartRateMeasurement(event.target.value);
  recordReading(bpm);
}

async function disconnectBluetooth() {
  if (state.btCharacteristic) {
    try {
      await state.btCharacteristic.stopNotifications();
    } catch (_) { /* ignore */ }
    state.btCharacteristic = null;
  }

  if (state.btDevice && state.btDevice.gatt.connected) {
    state.btDevice.gatt.disconnect();
  }
  state.btDevice = null;
  onBluetoothDisconnected();
}

function onBluetoothDisconnected() {
  clearInterval(state.durationTimer);
  state.running = false;
  state.source  = null;

  setStatus('Disconnected', 'status-disconnected');
  dom.btnBluetooth.textContent = '🔵 Connect Bluetooth Sensor';
  dom.btnBluetooth.disabled    = false;
  dom.btnArduino.disabled      = false;
  dom.btnSimulate.disabled     = false;
}

/* ════════════════════════════════════════════════════
   Arduino Serial (Web Serial API)
   ════════════════════════════════════════════════════ */

/**
 * Connect to an Arduino Uno (or compatible board) via USB serial.
 *
 * The Arduino sketch should send one BPM reading per line at 9600 baud.
 * Supported line formats:
 *   "72"             – plain integer   (Serial.println(bpm))
 *   "BPM: 72"        – labelled
 *   "HR: 72"         – abbreviated label
 *   "Heart Rate: 72" – verbose label
 */
async function connectArduino() {
  if (!navigator.serial) {
    alert(
      'Web Serial API is not supported in this browser.\n\n' +
      'Try Chrome 89+ or Edge 89+ on desktop.\n' +
      'For other browsers, use Simulation mode instead.'
    );
    return;
  }

  try {
    setStatus('Opening port…', 'status-simulating');
    dom.btnArduino.disabled   = true;
    dom.btnBluetooth.disabled = true;
    dom.btnSimulate.disabled  = true;

    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    state.arduinoPort = port;

    state.source       = 'arduino';
    state.running      = true;
    state.sessionStart = Date.now();

    setStatus('Connected – Arduino', 'status-connected');
    dom.btnArduino.textContent = '🔌 Disconnect Arduino';
    dom.btnArduino.classList.add('active');

    state.durationTimer = setInterval(() => { dom.statDuration.textContent = sessionDuration(); }, 1000);

    // Start non-blocking read loop
    readArduinoSerial(port);

  } catch (err) {
    if (err.name !== 'NotFoundError') { // user cancelled port chooser
      console.error('Arduino serial error:', err);
      alert(`Arduino connection failed:\n${err.message}`);
    }
    setStatus('Disconnected', 'status-disconnected');
    dom.btnArduino.disabled   = false;
    dom.btnBluetooth.disabled = false;
    dom.btnSimulate.disabled  = false;
  }
}

/**
 * Continuously read lines from the serial port and forward BPM values.
 * Runs asynchronously; cleans up and calls onArduinoDisconnected() when done.
 */
async function readArduinoSerial(port) {
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = port.readable.getReader();
  state.arduinoReader = reader;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process every complete line; keep any trailing partial line in buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const bpm = parseArduinoBpm(line.trim());
        if (bpm !== null) recordReading(bpm);
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Arduino serial read error:', err);
    }
  } finally {
    reader.releaseLock();
    state.arduinoReader = null;
  }

  // Close the port once the read loop exits (disconnect or error)
  if (state.arduinoPort) {
    try { await state.arduinoPort.close(); } catch (_) { /* ignore */ }
    state.arduinoPort = null;
  }
  onArduinoDisconnected();
}

/**
 * Parse a BPM integer from a single Arduino serial line.
 * Returns null if the line doesn't look like a heart rate reading.
 *
 * Accepted formats (case-insensitive):
 *   "72"             – bare integer
 *   "BPM: 72"        – BPM keyword + colon
 *   "HR: 72"         – HR abbreviation
 *   "Heart Rate: 72" – full label
 */
function parseArduinoBpm(line) {
  if (!line) return null;

  let numStr = null;

  // Bare integer line: "72"
  if (/^\d+$/.test(line)) {
    numStr = line;
  } else {
    // Labelled line: "BPM: 72", "HR:72", "Heart Rate: 72", etc.
    const match = /\b(?:bpm|hr|heart[\s_-]?rate)\s*[:=]\s*(\d+)/i.exec(line);
    if (match) numStr = match[1];
  }

  if (numStr === null) return null;

  const bpm = parseInt(numStr, 10);
  // Sanity check: valid resting-to-peak heart-rate range
  if (bpm < 20 || bpm > 250) return null;
  return bpm;
}

async function disconnectArduino() {
  if (state.arduinoReader) {
    try {
      // Cancelling the reader resolves the pending read() with done=true,
      // which lets readArduinoSerial exit cleanly and call onArduinoDisconnected.
      await state.arduinoReader.cancel();
    } catch (_) { /* ignore */ }
  } else {
    onArduinoDisconnected();
  }
}

function onArduinoDisconnected() {
  if (state.source !== 'arduino') return; // guard against double-call

  clearInterval(state.durationTimer);
  state.running = false;
  state.source  = null;

  setStatus('Disconnected', 'status-disconnected');
  dom.btnArduino.textContent = '🔌 Connect Arduino';
  dom.btnArduino.classList.remove('active');
  dom.btnArduino.disabled    = false;
  dom.btnBluetooth.disabled  = false;
  dom.btnSimulate.disabled   = false;
}

/* ════════════════════════════════════════════════════
   CSV Export
   ════════════════════════════════════════════════════ */
function exportCSV() {
  if (state.readings.length === 0) {
    alert('No data to export yet. Start monitoring first.');
    return;
  }

  const rows = ['Timestamp,BPM,Zone'];
  state.readings.forEach(({ timestamp, bpm }) => {
    const zone = getZone(bpm).label;
    rows.push(`${timestamp.toISOString()},${bpm},${zone}`);
  });

  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `heartbeat_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ════════════════════════════════════════════════════
   Event listeners
   ════════════════════════════════════════════════════ */
dom.btnSimulate.addEventListener('click', () => {
  if (state.running && state.source === 'simulation') {
    stopSimulation();
  } else if (!state.running) {
    startSimulation();
  }
});

dom.btnBluetooth.addEventListener('click', () => {
  if (state.source === 'bluetooth') {
    disconnectBluetooth();
  } else if (!state.running) {
    connectBluetooth();
  }
});

dom.btnArduino.addEventListener('click', () => {
  if (state.source === 'arduino') {
    disconnectArduino();
  } else if (!state.running) {
    connectArduino();
  }
});

dom.btnClear.addEventListener('click', () => {
  state.readings = [];
  resetDisplay();
});

dom.btnExport.addEventListener('click', exportCSV);
