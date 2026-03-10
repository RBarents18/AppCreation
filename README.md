# HeartBeat Monitor

A lightweight, browser-based interface for tracking heart rate data from a sensor in real time.

## Features

| Feature | Details |
|---|---|
| **Live BPM display** | Large, animated readout with heartbeat pulse effect |
| **Heart-rate zones** | Automatic zone classification (Resting → Peak) |
| **Real-time chart** | Scrolling 60-point line chart powered by Chart.js |
| **Session statistics** | Average, minimum, maximum BPM and session duration |
| **Data log** | Timestamped log of every reading (newest on top) |
| **CSV export** | Download the full session as a spreadsheet |
| **Simulation mode** | Test the UI without any hardware |
| **Web Bluetooth** | Connect to any BLE heart rate monitor (standard GATT `0x180D`) |

## Getting Started

### No hardware – Simulation mode

1. Open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari).
2. Click **▶ Start Simulation** – realistic BPM data begins streaming immediately.
3. Click **⬇ Export CSV** to download the session data.

### Physical sensor – Bluetooth mode

Requirements:
- A BLE heart rate monitor that advertises the standard **Heart Rate service** (`0x180D`).  
  Examples: Polar H10, Garmin HRM-Pro, most chest straps, some wristbands.
- Chrome or Edge on desktop / Android (Web Bluetooth is not supported in Firefox or Safari).

Steps:
1. Make sure your sensor is powered on and in pairing mode.
2. Open `index.html` and click **🔵 Connect Bluetooth Sensor**.
3. Choose your device from the browser's Bluetooth picker.
4. Live readings stream automatically until you click **🔵 Disconnect**.

## File Structure

```
AppCreation/
├── index.html       # Main page (single-page application)
├── css/
│   └── style.css    # Dark-theme responsive styles
└── js/
    └── app.js       # Simulation engine, Web Bluetooth client, chart & export logic
```

## Browser Compatibility

| Browser | Simulation | Bluetooth |
|---|---|---|
| Chrome 56+ | ✅ | ✅ |
| Edge 79+ | ✅ | ✅ |
| Firefox | ✅ | ❌ (Web BT not supported) |
| Safari | ✅ | ❌ (Web BT not supported) |

## Data Format (CSV export)

```
Timestamp,BPM,Zone
2026-03-10T10:00:01.000Z,72,Resting
2026-03-10T10:00:02.000Z,74,Warm-up
...
```
