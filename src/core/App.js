// Application Coordinator / Lifecycle Manager for MediXR
import { Engine3D } from './Engine3D.js';
import { VoiceEngine } from '../voice/VoiceEngine.js';
import { ARManager } from '../ar/ARManager.js';
import { VRManager } from '../vr/VRManager.js';
import { UIController } from '../ui/UIController.js';
import { Accessibility } from '../ui/Accessibility.js';

let engine = null;
let voiceEngine = null;
let arManager = null;
let vrManager = null;
let uiController = null;
let accessibility = null;

export function initApp() {
  console.log("MediXR: Starting initialization sequence...");

  // 1. Initialize core 3D engine on viewport container
  engine = new Engine3D('canvas-container');
  engine.init();

  // 2. Initialize Voice Engine (Speech recognition / TTS)
  voiceEngine = new VoiceEngine();
  engine.voiceEngine = voiceEngine;

  // 3. Initialize WebXR managers
  arManager = new ARManager(engine);
  vrManager = new VRManager(engine);
  engine.arManager = arManager;
  engine.vrManager = vrManager;

  // 4. Initialize accessibility helper
  accessibility = new Accessibility(engine, voiceEngine);
  accessibility.init();

  // 5. Initialize UI controller and bind event listeners
  uiController = new UIController(engine, voiceEngine, arManager, vrManager);
  uiController.bindUI();

  // 6. Check WebXR capabilities and update buttons states
  arManager.checkAvailability();
  vrManager.checkAvailability();

  // 7. Connect WebXR session lifecycle to update global HUD/UI viewports
  setupXRSessionListeners();

  console.log("MediXR: Initialization sequence complete.");
}

function setupXRSessionListeners() {
  // Three.js renderer.xr emits events when entering/exiting WebXR presentation sessions
  const xr = engine.renderer.xr;

  const btnAr = document.getElementById('btn-ar');
  const btnVr = document.getElementById('btn-vr');

  xr.addEventListener('sessionstart', () => {
    console.log("MediXR App: WebXR presentation session started.");
    
    // Disable local clipping during XR sessions to prevent shader compilation bugs on mobile GPUs
    engine.renderer.localClippingEnabled = false;

    // Focus the heart and hide skeleton in WebXR
    engine.setVisualizerMode('focused');
    
    const session = xr.getSession();
    const mode = session.mode; // 'immersive-vr' or 'immersive-ar'
    
    if (mode === 'immersive-ar') {
      if (btnAr) btnAr.classList.add('active');
      engine.appMode = 'ar';
      // AR: notify screen reader, collapse side panels
      accessibility.announceToScreenReader("Entered AR Mode. Scan your surroundings to place the heart.");
      document.getElementById('panel-left').classList.remove('collapsed');
      document.getElementById('panel-right').classList.add('collapsed');
    } else if (mode === 'immersive-vr') {
      if (btnVr) btnVr.classList.add('active');
      engine.appMode = 'vr';
      accessibility.announceToScreenReader("Entered VR Laboratory Mode. Use controller lasers to select structures.");
      document.getElementById('panel-left').classList.add('collapsed');
      document.getElementById('panel-right').classList.add('collapsed');
    }

    // Connect animation frames to AR hit testing if AR is running
    engine.renderer.setAnimationLoop((timestamp, frame) => {
      // If AR hit test is active, feed frame details
      if (mode === 'immersive-ar' && arManager.session && frame) {
        arManager.updateARFrame(frame);
      }
      
      // Perform normal render loop
      engine.animate();
    });
  });

  xr.addEventListener('sessionend', () => {
    console.log("MediXR App: WebXR presentation session ended.");
    
    // Restore button active state
    if (btnAr) btnAr.classList.remove('active');
    if (btnVr) btnVr.classList.remove('active');
    
    // Stop active speech or voice overlays
    voiceEngine.stopSpeaking();
    voiceEngine.stopListening();
    
    engine.appMode = 'desktop';
    
    // Re-enable local clipping for desktop mode
    engine.renderer.localClippingEnabled = true;

    // Restore skeleton landing page view
    engine.setVisualizerMode('skeleton');

    // Call VR and AR managers teardowns to clean up floor grids, reticles, and platforms
    if (vrManager) vrManager.endSession();
    if (arManager) arManager.endSession();
    
    // Expand panels back for desktop
    if (window.innerWidth >= 1024) {
      document.getElementById('panel-left').classList.remove('collapsed');
    }
    
    accessibility.announceToScreenReader("Exited immersive mode. Returned to standard 3D Viewer.");
    
    // Restore normal animation loop (without WebXR frame parameters)
    engine.renderer.setAnimationLoop(() => engine.animate());
  });
}
export default initApp;
