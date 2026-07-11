# 🫀 MediXR — Immersive 3D Human Heart Anatomy Visualizer

MediXR is an interactive WebXR medical education application designed to visualize and inspect a medically accurate 3D model of the human heart. It supports **Interactive 3D**, **Augmented Reality (AR)**, **Virtual Reality (VR)**, and **Voice Controls**.


https://github.com/user-attachments/assets/04e8d562-664a-4bd5-9f39-86372eba08c5

*(The animation above displays the actual project loading, the human skeleton chest landing page, and focusing onto the beating 3D heart with animated blood flow particles.)*

---

## 🌟 Key Features

*   🖥️ **3D Desktop View:** Rotate, zoom, and click on heart structures to view clinical explanations.
*   📱 **Augmented Reality (AR):** Place the 3D heart on any surface in your physical room.
*   🥽 **Virtual Reality (VR):** Step into an immersive VR laboratory with laser pointer controls.
*   🔄 **Anatomy Simulations:** Toggles for heartbeat pulsing, blood flow streams, cross-section slicing, translucent views, and exploded parts.
*   🫀 **Pathology States:** Simulate healthy heart flow, myocardial infarction (heart attack necrotic area), valve disease (leaky backflow), and hypertrophy (ventricular wall thickening).
*   🎙️ **Voice Commands:** Control the app hands-free with voice recognition and text-to-speech audio feedback.

---

## 📂 Complete Folder Structure

Here is the full layout of files and assets in the project:

```
webxr_PROJECT/
│
├── index.html                     # Main HTML application layout, CDNs, and UI overlays
├── server.js                      # Custom HTTP/HTTPS Node.js dev server with auto-SSL
├── package.json                   # Project scripts and package configuration metadata
├── realistic_human_heart.glb      # Root medically accurate GLB 3D heart model file
├── favicon.ico                    # Browser favicon icon
│
├── certs/                         # SSL Certificate files for local HTTPS testing
│   ├── generate.ps1               # PowerShell SSL generator command script
│   └── server.pfx                 # Generated PKCS#12 SSL/TLS Certificate archive
│
├── assets/                        # Shared project assets (diagrams, 3D GLTF models)
│   ├── images/                    # Anatomical reference diagram overlays
│   │   ├── aorta.png              # Aorta clinical reference image diagram
│   │   ├── atrium.png             # Atria clinical reference image diagram
│   │   ├── pulmonary_artery.png   # Pulmonary artery clinical reference image
│   │   ├── vena_cava.png          # Vena Cava clinical reference image diagram
│   │   ├── ventricle.png          # Ventricles clinical reference image diagram
│   │   └── medixr_walkthrough.webp   # Actual project interaction walkthrough animation
│   │
│   └── models/                    # Subfolder containing 3D GLTF model files
│       ├── README.md              # Model documentation notes
│       ├── realistic_human_heart.glb # Main heart model copy inside assets
│       └── skeleton.glb           # Chest ribcage skeleton context model
│
├── styles/                        # Style assets folder
│   └── main.css                   # Main Glassmorphic Dark UI & layout stylesheet
│
└── src/                           # Modular application source code directory
    ├── ar/                        # Augmented Reality (AR) scripts
    │   └── ARManager.js           # AR session events, hit testing, and floor placement
    │
    ├── vr/                        # Virtual Reality (VR) scripts
    │   └── VRManager.js           # VR room setup, 6DoF controller rays, and grab physics
    │
    ├── core/                      # Application core engine modules
    │   ├── App.js                 # App coordinator, entry, and WebXR session listener
    │   ├── Engine3D.js            # Core Three.js render loop, lights, and simulated modes
    │   └── ModelLoader.js         # Model importer, progress tracker, and PBR materials
    │
    ├── ui/                        # User interface modules
    │   ├── UIController.js        # Event binder for HUD, panels, sliders, and buttons
    │   └── Accessibility.js       # Accessibility features, high contrast, and screen readers
    │
    ├── voice/                     # Voice recognition and synthesis
    │   └── VoiceEngine.js         # Speech commands listener and medical text TTS reader
    │
    └── utils/                     # Utility services and geometry generators
        ├── HeartData.js           # Detailed medical descriptions & pathology conditions database
        ├── HeartGeometry.js       # Procedural heart chambers (fallback geometry generator)
        ├── ShaderMaterials.js     # Custom WebGL shaders (blood flows, heartbeat contraction)
        └── SkeletonGeometry.js    # Procedural skeleton (fallback geometry generator)
```

---

## 🚀 Getting Started

### 1. Run the Project
Ensure you have [Node.js](https://nodejs.org/) installed, then run in your terminal:
```bash
# Clone the repository
git clone https://github.com/Naveen2464/heart.git
cd heart

# Run the local server
npm run dev
```

### 2. Open in Browser
The terminal will display your network IP addresses. Open these URLs:
*   💻 **Desktop Simulator:** `http://localhost:8080`
*   📱 **AR/VR headset (Secure HTTPS):** `https://localhost:8443` or `https://<YOUR-IP>:8443`
    *   *Note: Accept the self-signed certificate warning in your mobile browser ("Advanced" -> "Proceed") to allow camera and gyroscopic sensors.*

---

## 🎙️ Spoken Voice Commands

Click the microphone icon on the top right to start listening, then speak:

| Command | Action |
| :--- | :--- |
| **"reset"** / **"restore"** | Resets camera position and controls. |
| **"zoom in"** / **"zoom out"** | Scales the size of the heart model. |
| **"rotate heart"** / **"stop rotation"** | Starts or stops the slow auto-spin. |
| **"show blood flow"** / **"hide blood flow"** | Toggles red/blue blood flow particle streams. |
| **"slice heart"** / **"unslice heart"** | Opens/closes the cross-section view. |
| **"explain heart"** | Speaks the medical function of the highlighted structure. |
| **"left ventricle"** / **"aorta"** / etc. | Highlights and selects specific anatomical structures. |

---

## ⚙️ Sidebar Control Panels

*   **Heartbeat Animation:** Toggle the contraction pulse and slide to adjust speed (BPM).
*   **Blood Flow:** Enable particles representing oxygenated (red) and deoxygenated (blue) blood.
*   **Cross-Section:** Slice the model open and slide the depth slider to view internal chambers.
*   **Anatomy Labels:** Enable floating tags to identify parts.
*   **Transparency & Exploded View:** Turn outer shells see-through or isolate individual structures.

---

## 📂 Codebase Layout

*   `index.html` — Layout and UI overlay HUD.
*   `server.js` — Custom HTTP & secure HTTPS dev server.
*   `styles/main.css` — Modern glassmorphism UI stylesheet.
*   `src/ar/ARManager.js` — AR session camera feed, hit-tests, and taps.
*   `src/vr/VRManager.js` — VR laboratory, controllers, and grab controls.
*   `src/core/` — Core Three.js render loops (`Engine3D.js`), model loading (`ModelLoader.js`), and session listeners (`App.js`).
*   `src/ui/` — Panel click event binders (`UIController.js`) and theme settings (`Accessibility.js`).
*   `src/voice/VoiceEngine.js` — Speech-to-text recognition and text-to-speech feedback.
*   `src/utils/` — Heart data, custom shaders, and geometry fallbacks.
*   `assets/` — 3D `.glb` files and reference diagrams.
