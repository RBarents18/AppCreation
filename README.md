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
| **Arduino Serial** | Connect an Arduino Uno with a heart rate sensor via USB (Web Serial API) |

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

### Physical sensor – Arduino mode

Requirements:
- An **Arduino Uno** (or any Arduino-compatible board) with a heart rate sensor, e.g.  
  MAX30100 / MAX30102 pulse oximeter module, or a simple Pulse Sensor Amped.
- Chrome 89+ or Edge 89+ on desktop (Web Serial API is not supported in Firefox or Safari).
- The Arduino sketch must send one BPM integer per line at **9600 baud**.

#### Sample Arduino sketch

```cpp
// Minimal example – replace with your actual sensor library
// Tested with the MAX30102 sensor and the SparkFun MAX3010x library.

#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"

MAX30105 particleSensor;

const byte RATE_SIZE = 4; // average over 4 samples
byte rates[RATE_SIZE];
byte rateSpot = 0;
long lastBeat = 0;
float beatsPerMinute;
int beatAvg;

void setup() {
  Serial.begin(9600);
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX30102 not found");
    while (1);
  }
  particleSensor.setup();
  particleSensor.setPulseAmplitudeRed(0x0A);
}

void loop() {
  long irValue = particleSensor.getIR();
  if (checkForBeat(irValue)) {
    long delta = millis() - lastBeat;
    lastBeat = millis();
    beatsPerMinute = 60.0 / (delta / 1000.0);
    if (beatsPerMinute > 20 && beatsPerMinute < 250) {
      rates[rateSpot] = (byte)beatsPerMinute;
      rateSpot = (rateSpot + 1) % RATE_SIZE;
      beatAvg = 0;
      for (byte x = 0; x < RATE_SIZE; x++) beatAvg += rates[x];
      beatAvg /= RATE_SIZE;
    }
  }
  // Send one integer BPM per line – this is what the browser reads
  Serial.println(beatAvg);
  delay(1000);
}
```

The browser accepts these line formats from the Arduino:

| Format | Example |
|---|---|
| Plain integer | `72` |
| BPM label | `BPM: 72` |
| HR label | `HR: 72` |
| Full label | `Heart Rate: 72` |

Steps to connect:
1. Upload the sketch to your Arduino and connect it via USB.
2. Open `index.html` in Chrome or Edge.
3. Click **🔌 Connect Arduino**.
4. Choose the Arduino's serial port from the browser picker (e.g. `COM3` on Windows or `/dev/ttyUSB0` on Linux/macOS).
5. Live readings stream automatically until you click **🔌 Disconnect Arduino**.

## File Structure

```
AppCreation/
├── index.html       # Main page (single-page application)
├── css/
│   └── style.css    # Dark-theme responsive styles
└── js/
    └── app.js       # Simulation engine, Web Bluetooth client, Arduino Serial client,
                     # chart & export logic
```

## Browser Compatibility

| Browser | Simulation | Bluetooth | Arduino (Serial) |
|---|---|---|---|
| Chrome 89+ | ✅ | ✅ | ✅ |
| Edge 89+ | ✅ | ✅ | ✅ |
| Firefox | ✅ | ❌ (Web BT not supported) | ❌ (Web Serial not supported) |
| Safari | ✅ | ❌ (Web BT not supported) | ❌ (Web Serial not supported) |

## Data Format (CSV export)

```
Timestamp,BPM,Zone
2026-03-10T10:00:01.000Z,72,Resting
2026-03-10T10:00:02.000Z,74,Warm-up
...
```

