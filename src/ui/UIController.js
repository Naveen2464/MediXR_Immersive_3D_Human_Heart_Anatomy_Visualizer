// HUD Panel Controller and Event Binder for MediXR
import { HeartData } from '../utils/HeartData.js';

export class UIController {
  constructor(engine, voiceEngine, arManager, vrManager) {
    this.engine = engine;
    this.voiceEngine = voiceEngine;
    this.arManager = arManager;
    this.vrManager = vrManager;

    this.activeMobileTab = 'viewer';
  }

  bindUI() {
    this.bindSimulationToggles();
    this.bindRangeSliders();
    this.bindActionButtons();
    this.bindVoiceOverlay();
    this.bindMobileNavigation();
    this.bindSelectionCallback();
    this.bindXRSessionTriggers();
    this.bindLoaderStartActions();
    this.bindXRInteractionsFix();
  }

  // Bind side control panel switches
  bindSimulationToggles() {
    // 1. Heartbeat Switch
    const beatSwitch = document.getElementById('switch-beat');
    if (beatSwitch) {
      beatSwitch.addEventListener('change', (e) => {
        this.engine.setHeartbeatEnabled(e.target.checked);
      });
    }

    // 2. Blood Flow Switch
    const flowSwitch = document.getElementById('switch-flow');
    if (flowSwitch) {
      flowSwitch.addEventListener('change', (e) => {
        this.engine.setBloodFlowEnabled(e.target.checked);
      });
    }

    // 3. Cross-Section (Clipping) Switch
    const sectionSwitch = document.getElementById('switch-section');
    const sliceSlider = document.getElementById('slider-slice-pos');
    if (sectionSwitch) {
      sectionSwitch.addEventListener('change', (e) => {
        const checked = e.target.checked;
        this.engine.setCrossSectionEnabled(checked);
        if (sliceSlider) {
          sliceSlider.disabled = !checked;
        }
      });
    }

    // 4. Labels Switch
    const labelsSwitch = document.getElementById('switch-labels');
    if (labelsSwitch) {
      labelsSwitch.addEventListener('change', (e) => {
        this.engine.setLabelsEnabled(e.target.checked);
      });
    }

    // 5. View Mode Switch (Skeleton vs Focused Heart Only)
    const viewModeSwitch = document.getElementById('switch-view-mode');
    if (viewModeSwitch) {
      viewModeSwitch.addEventListener('change', (e) => {
        const mode = e.target.checked ? 'focused' : 'skeleton';
        this.engine.setVisualizerMode(mode);
      });
    }

    // 6. Transparency Switch
    const transSwitch = document.getElementById('switch-transparency');
    if (transSwitch) {
      transSwitch.addEventListener('change', (e) => {
        this.engine.setTransparencyMode(e.target.checked);
      });
    }


  }

  // Bind side control panel range inputs
  bindRangeSliders() {
    // 1. Auto-rotation speed
    const rotSlider = document.getElementById('slider-rotation-speed');
    const rotVal = document.getElementById('rotation-speed-val');
    if (rotSlider) {
      rotSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        this.engine.setRotationSpeed(val);
        if (rotVal) rotVal.textContent = `${Math.round(val * 100)}%`;
      });
    }

    // 2. Pulse rate (BPM)
    const bpmSlider = document.getElementById('slider-pulse-rate');
    const bpmVal = document.getElementById('pulse-rate-val');
    if (bpmSlider) {
      bpmSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        this.engine.setPulseRate(val);
        if (bpmVal) bpmVal.textContent = `${val} BPM`;
      });
    }

    // 3. Slicing position
    const sliceSlider = document.getElementById('slider-slice-pos');
    const sliceVal = document.getElementById('slice-pos-val');
    if (sliceSlider) {
      sliceSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        this.engine.setSliceDepth(val);
        if (sliceVal) sliceVal.textContent = parseFloat(val).toFixed(2);
      });
    }

    // 4. Disease select dropdown
    const diseaseSelect = document.getElementById('select-disease');
    if (diseaseSelect) {
      diseaseSelect.addEventListener('change', (e) => {
        this.engine.setDiseaseMode(e.target.value);
        this.updateSubFlowTriggers(e.target.value);
      });
      // Set initial dynamic sub-triggers state
      this.updateSubFlowTriggers(diseaseSelect.value);
    }
  }

  // Bind reset, text-to-speech, and modal triggers
  bindActionButtons() {
    // Reset Space
    const resetBtn = document.getElementById('btn-reset-scene');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.engine.resetScene();

        // Restore sliders visual values
        const rotSlider = document.getElementById('slider-rotation-speed');
        const rotVal = document.getElementById('rotation-speed-val');
        if (rotSlider) {
          rotSlider.value = 0.0;
          this.engine.setRotationSpeed(0.0);
          if (rotVal) rotVal.textContent = "0%";
        }

        const bpmSlider = document.getElementById('slider-pulse-rate');
        const bpmVal = document.getElementById('pulse-rate-val');
        if (bpmSlider) {
          bpmSlider.value = 72;
          this.engine.setPulseRate(72);
          if (bpmVal) bpmVal.textContent = "72 BPM";
        }

        const sectionSwitch = document.getElementById('switch-section');
        const sliceSlider = document.getElementById('slider-slice-pos');
        if (sectionSwitch && sliceSlider) {
          sectionSwitch.checked = false;
          sliceSlider.disabled = true;
          this.engine.setCrossSectionEnabled(false);
        }

        // Reset transparency and exploded switches
        const transSwitch = document.getElementById('switch-transparency');
        if (transSwitch) {
          transSwitch.checked = false;
          this.engine.setTransparencyMode(false);
        }



        const diseaseSelect = document.getElementById('select-disease');
        if (diseaseSelect) {
          diseaseSelect.value = 'healthy';
          this.engine.setDiseaseMode('healthy');
        }
      });
    }

    // Read Description out loud (TTS)
    const readBtn = document.getElementById('btn-read-info');
    if (readBtn) {
      readBtn.addEventListener('click', () => {
        if (this.voiceEngine.speechActive) {
          this.voiceEngine.stopSpeaking();
          readBtn.classList.remove('active');
        } else {
          const title = document.getElementById('info-title').textContent;
          const func = document.getElementById('info-function').textContent;
          const clinical = document.getElementById('info-clinical').textContent;
          const textToSpeak = `${title}. Function: ${func}. Clinical Importance: ${clinical}`;

          readBtn.classList.add('active');
          this.voiceEngine.speak(textToSpeak, () => {
            readBtn.classList.remove('active');
          });
        }
      });
    }

    // Download Reference Diagram Button
    const downloadDiagramBtn = document.getElementById('btn-download-diagram');
    if (downloadDiagramBtn) {
      downloadDiagramBtn.addEventListener('click', () => {
        const imgEl = document.getElementById('info-image');
        if (imgEl && imgEl.src) {
          const link = document.createElement('a');
          const title = document.getElementById('info-title').textContent.toLowerCase().replace(/\s+/g, '_');
          link.download = `${title}_diagram.png`;
          link.href = imgEl.src;
          link.click();
        }
      });
    }

    // Download 3D Render Snapshot Button
    const downloadSnapshotBtn = document.getElementById('btn-download-snapshot');
    if (downloadSnapshotBtn) {
      downloadSnapshotBtn.addEventListener('click', () => {
        // Force rendering the scene immediately so WebGL's backbuffer contains active pixels
        this.engine.renderer.render(this.engine.scene, this.engine.camera);
        const dataUrl = this.engine.renderer.domElement.toDataURL('image/png');
        const link = document.createElement('a');
        const title = document.getElementById('info-title').textContent.toLowerCase().replace(/\s+/g, '_');
        link.download = `${title}_3d_snapshot.png`;
        link.href = dataUrl;
        link.click();
      });
    }
  }

  // Wires Voice Overlay microphone triggering
  bindVoiceOverlay() {
    const micBtn = document.getElementById('btn-voice-toggle');
    const overlay = document.getElementById('voice-overlay');
    const status = document.getElementById('voice-status');
    const transcript = document.getElementById('voice-transcript');

    if (!micBtn || !overlay) return;

    micBtn.addEventListener('click', () => {
      if (this.voiceEngine.isListening) {
        this.voiceEngine.stopListening();
      } else {
        this.voiceEngine.startListening();
      }
    });

    // Wire Speech start animations
    this.voiceEngine.onSpeechStart = () => {
      micBtn.classList.add('listening');
      overlay.classList.remove('hidden');
      if (status) status.textContent = "Listening for medical commands...";
      if (transcript) transcript.textContent = 'Say a command, e.g. "Highlight Left Ventricle"';
    };

    // Wire speech result callback
    this.voiceEngine.onResult = (text) => {
      if (transcript) transcript.textContent = `"${text}"`;
    };

    // Close overlays when speech ends
    this.voiceEngine.onSpeechEnd = () => {
      micBtn.classList.remove('listening');
      // Hide card after short delay so user can read final transcript
      setTimeout(() => {
        if (!this.voiceEngine.isListening) {
          overlay.classList.add('hidden');
        }
      }, 1500);
    };

    // Connect voice commands back to the 3D scene inputs
    this.voiceEngine.onCommand = (cmd) => {
      console.log("UIController: Executing voice command: ", cmd);

      let actionMsg = "";

      switch (cmd.type) {
        case 'RESET':
          actionMsg = "Reset Scene";
          this.engine.resetScene();
          break;
        case 'SCALE':
          actionMsg = cmd.value === 'UP' ? "Zoomed In" : "Zoomed Out";
          if (this.engine.heartGroup) {
            const current = this.engine.heartGroup.scale.x;
            const factor = cmd.value === 'UP' ? 1.25 : 0.8;
            this.engine.heartGroup.scale.setScalar(Math.min(Math.max(current * factor, 0.2), 3.0));
          }
          break;
        case 'ROTATE':
          actionMsg = cmd.value === 'ON' ? "Auto-Rotation Enabled" : "Auto-Rotation Stopped";
          const rotSlider = document.getElementById('slider-rotation-speed');
          const rotVal = document.getElementById('rotation-speed-val');
          const val = cmd.value === 'ON' ? 0.05 : 0.0;
          this.engine.setRotationSpeed(val);
          if (rotSlider) rotSlider.value = val;
          if (rotVal) rotVal.textContent = cmd.value === 'ON' ? '5%' : '0%';
          break;
        case 'BLOOD_FLOW':
          actionMsg = cmd.value ? "Blood Flow Enabled" : "Blood Flow Disabled";
          const flowSwitch = document.getElementById('switch-flow');
          if (flowSwitch) flowSwitch.checked = cmd.value;
          this.engine.setBloodFlowEnabled(cmd.value);
          break;
        case 'CROSS_SECTION':
          actionMsg = cmd.value ? "Cross Section Enabled" : "Cross Section Disabled";
          const sectSwitch = document.getElementById('switch-section');
          const slSlider = document.getElementById('slider-slice-pos');
          if (sectSwitch) sectSwitch.checked = cmd.value;
          if (slSlider) slSlider.disabled = !cmd.value;
          this.engine.setCrossSectionEnabled(cmd.value);
          break;
        case 'HIGHLIGHT':
          const anatomyName = HeartData[cmd.value] ? HeartData[cmd.value].name : cmd.value;
          actionMsg = `Highlighting: ${anatomyName}`;
          this.engine.selectAnatomy(cmd.value);
          break;
        case 'SPEAK_INFO':
          actionMsg = "Reading Medical Information";
          const speakBtn = document.getElementById('btn-read-info');
          if (speakBtn) speakBtn.click();
          break;
      }

      if (actionMsg) {
        this.showVoiceToast(`🎙️ ${actionMsg}`);
      }
    };
  }

  // Wires Mobile screen tab bar selections
  bindMobileNavigation() {
    const navViewer = document.getElementById('nav-viewer');
    const navInfo = document.getElementById('nav-info');
    const navControls = document.getElementById('nav-controls');

    const body = document.body;

    const clearMobileClasses = () => {
      body.classList.remove('mobile-show-left', 'mobile-show-right');
      [navViewer, navInfo, navControls].forEach(el => {
        if (el) el.classList.remove('active');
      });
    };

    if (navViewer) {
      navViewer.addEventListener('click', () => {
        clearMobileClasses();
        navViewer.classList.add('active');
        this.activeMobileTab = 'viewer';
      });
    }

    if (navInfo) {
      navInfo.addEventListener('click', () => {
        clearMobileClasses();
        navInfo.classList.add('active');
        body.classList.add('mobile-show-right');
        this.activeMobileTab = 'info';

        // ensure sidebar is visible
        document.getElementById('panel-right').classList.remove('collapsed');
      });
    }

    if (navControls) {
      navControls.addEventListener('click', () => {
        clearMobileClasses();
        navControls.classList.add('active');
        body.classList.add('mobile-show-left');
        this.activeMobileTab = 'controls';

        // ensure sidebar is visible
        document.getElementById('panel-left').classList.remove('collapsed');
      });
    }
  }

  // Wires 3D selection events to fill details in panel cards
  bindSelectionCallback() {
    const placeholder = document.getElementById('selection-placeholder');
    const details = document.getElementById('info-details');
    const title = document.getElementById('info-title');
    const funcText = document.getElementById('info-function');
    const clinicalText = document.getElementById('info-clinical');
    const explanationText = document.getElementById('info-explanation');

    const rightPanel = document.getElementById('panel-right');

    this.engine.onSelectionChanged = (nameId) => {
      // If voice speaking is active, cancel it immediately when changing selection
      this.voiceEngine.stopSpeaking();

      const readBtn = document.getElementById('btn-read-info');
      if (readBtn) readBtn.classList.remove('active');

      // Remove 'selected' class from all anatomy labels
      document.querySelectorAll('.heart-label-tag').forEach(el => el.classList.remove('selected'));

      if (!nameId) {
        // Clear card content
        if (placeholder) placeholder.classList.remove('hidden');
        if (details) details.classList.add('hidden');
        return;
      }

      const data = HeartData[nameId];
      if (!data) return;

      // If we are in skeleton mode, switch to focused mode to make the heart clearly visible
      if (this.engine.visualizerMode === 'skeleton') {
        this.engine.setVisualizerMode('focused');
      }

      // Highlight the corresponding anatomy label tag
      const labelEl = document.getElementById(`label-tag-${nameId}`);
      if (labelEl) labelEl.classList.add('selected');

      // Populate Texts
      if (title) title.textContent = data.name;
      if (funcText) funcText.textContent = data.function;
      if (clinicalText) clinicalText.textContent = data.clinical;
      if (explanationText) explanationText.textContent = data.explanation;

      // Set anatomical reference image src
      const imgEl = document.getElementById('info-image');
      if (imgEl) {
        let imageSrc = '';
        if (nameId === 'aorta') {
          imageSrc = 'assets/images/aorta.png';
        } else if (nameId === 'pulmonary_artery') {
          imageSrc = 'assets/images/pulmonary_artery.png';
        } else if (nameId === 'vena_cava') {
          imageSrc = 'assets/images/vena_cava.png';
        } else if (nameId === 'left_ventricle' || nameId === 'right_ventricle') {
          imageSrc = 'assets/images/ventricle.png';
        } else if (nameId === 'left_atrium' || nameId === 'right_atrium') {
          imageSrc = 'assets/images/atrium.png';
        } else {
          imageSrc = 'assets/images/ventricle.png'; // default fallback
        }
        imgEl.src = imageSrc;
      }

      // Swap Visibility
      if (placeholder) placeholder.classList.add('hidden');
      if (details) details.classList.remove('hidden');

      // Expand sidebar panel on desktop/tablets when selection triggers
      if (rightPanel && rightPanel.classList.contains('collapsed') && window.innerWidth >= 768) {
        rightPanel.classList.remove('collapsed');
      }

      // In Mobile, automatically switch to the "Heart Info" tab if screen tap selects a part
      if (window.innerWidth < 768 && this.activeMobileTab !== 'info') {
        const navInfo = document.getElementById('nav-info');
        if (navInfo) navInfo.click();
      }

      // Automatically speak the medical details when selected in any mode (desktop, AR, VR)
      const textToSpeak = `${data.name}. Function: ${data.function}. Clinical Importance: ${data.clinical}`;
      if (readBtn) readBtn.classList.add('active');
      this.voiceEngine.speak(textToSpeak, () => {
        if (readBtn) readBtn.classList.remove('active');
      });

      // Accessibility notification
      const srHud = document.getElementById('screen-reader-hud');
      if (srHud) {
        srHud.textContent = `Selected: ${data.name}. Function: ${data.function}.`;
      }
    };
  }

  // Helper to coordinate: Exit Current Mode -> Dispose Session -> Clear Prev Environment -> Reset UI -> Load Selected -> Create New Environment
  async transitionToMode(targetMode, startSessionFn) {
    console.log(`UIController: Transitioning to mode: ${targetMode}`);

    // 1. Exit current session if presenting (Exit Current Mode & Dispose Previous XR Session)
    if (this.engine.renderer.xr.isPresenting) {
      const session = this.engine.renderer.xr.getSession();
      if (session) {
        // Wait for session to end completely before proceeding
        await new Promise((resolve) => {
          const onSessionEnd = () => {
            this.engine.renderer.xr.removeEventListener('sessionend', onSessionEnd);
            // Wait slightly for browser/Three.js state cleanup
            setTimeout(resolve, 150);
          };
          this.engine.renderer.xr.addEventListener('sessionend', onSessionEnd);
          session.end();
        });
      }
    }

    // 2. Load the target mode (which triggers setAppMode to Clear Previous and Load Selected)
    this.engine.setAppMode(targetMode);

    // 3. Request the new session or run simulated environment (Create New Environment)
    if (startSessionFn && navigator.xr) {
      try {
        await startSessionFn();
      } catch (err) {
        console.warn(`WebXR session request failed for ${targetMode}, falling back to simulation:`, err);
        this.engine.setAppMode(targetMode);
      }
    }
  }

  // Wires WebXR start buttons
  bindXRSessionTriggers() {
    const btnAr = document.getElementById('btn-ar');
    const btnVr = document.getElementById('btn-vr');

    const updateActiveButton = (activeBtn) => {
      [btnAr, btnVr].forEach(btn => {
        if (btn) btn.classList.remove('active');
      });
      if (activeBtn) activeBtn.classList.add('active');
    };

    if (btnAr) {
      btnAr.addEventListener('click', () => {
        if (this.engine.appMode === 'ar') {
          updateActiveButton(null);
          this.transitionToMode('desktop', null);
        } else {
          updateActiveButton(btnAr);
          this.transitionToMode('ar', () => this.arManager.startSession());
        }
      });
    }

    if (btnVr) {
      btnVr.addEventListener('click', () => {
        if (this.engine.appMode === 'vr') {
          updateActiveButton(null);
          this.transitionToMode('desktop', null);
        } else {
          updateActiveButton(btnVr);
          this.transitionToMode('vr', () => this.vrManager.startSession());
        }
      });
    }
  }

  // Populate dynamic sub-trigger visual flows under selected anatomy function/condition
  updateSubFlowTriggers(mode) {
    const container = document.getElementById('sub-triggers-container');
    const list = document.getElementById('sub-triggers-list');
    if (!container || !list) return;

    list.innerHTML = '';

    const subTriggersMap = {
      healthy: [
        { id: 'sub-conduction', label: 'Conduction Path (SA/AV Nodes)', callback: (enabled) => this.engine.toggleElectricalConduction(enabled) },
        { id: 'sub-efficiency', label: 'Optimal Output (BPM Boost)', callback: (enabled) => this.engine.toggleCardiacOutput(enabled) }
      ],
      infarction: [
        { id: 'sub-blockage', label: 'Show LAD Blockage Ring', callback: (enabled) => this.engine.toggleArteryBlockage(enabled) },
        { id: 'sub-arrhythmia', label: 'Trigger VFib (Arrhythmia)', callback: (enabled) => this.engine.toggleArrhythmia(enabled) }
      ],
      valve: [
        { id: 'sub-calcification', label: 'Aortic Valve Calcification', callback: (enabled) => this.engine.toggleValveCalcification(enabled) },
        { id: 'sub-regurgitation', label: 'Regurgitant Jet Backflow', callback: (enabled) => this.engine.toggleRegurgitantBackflow(enabled) }
      ],
      hypertrophy: [
        { id: 'sub-septum', label: 'Septum Myocardium Expansion', callback: (enabled) => this.engine.toggleSeptumThickened(enabled) },
        { id: 'sub-compliance', label: 'Stiff Diastolic Compliance', callback: (enabled) => this.engine.toggleDiastolicFilling(enabled) }
      ]
    };

    const triggers = subTriggersMap[mode];
    if (triggers && triggers.length > 0) {
      container.style.display = 'block';
      triggers.forEach(t => {
        const row = document.createElement('div');
        row.className = 'toggle-row';
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.marginTop = '10px';
        
        const label = document.createElement('label');
        label.htmlFor = t.id;
        label.textContent = t.label;
        label.style.fontSize = '0.85rem';
        label.style.fontWeight = '500';
        label.style.color = 'var(--color-text-muted)';
        
        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'switch';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = t.id;
        checkbox.addEventListener('change', (e) => {
          t.callback(e.target.checked);
        });
        
        const slider = document.createElement('span');
        slider.className = 'slider round';
        
        toggleLabel.appendChild(checkbox);
        toggleLabel.appendChild(slider);
        row.appendChild(label);
        row.appendChild(toggleLabel);
        list.appendChild(row);
      });
    } else {
      container.style.display = 'none';
    }
  }

  bindLoaderStartActions() {
    const btnStartZapbox = document.getElementById('btn-start-zapbox');
    const btnStartDesktop = document.getElementById('btn-start-desktop');
    const loaderOverlay = document.getElementById('loader');

    if (btnStartZapbox) {
      btnStartZapbox.addEventListener('click', async () => {
        // Hide loader overlay
        if (loaderOverlay) {
          loaderOverlay.classList.add('fade-out');
        }
        // Start VR session directly (which functions as VR Lab/Zapbox)
        try {
          const btnVr = document.getElementById('btn-vr');
          if (btnVr) btnVr.classList.add('active');
          await this.transitionToMode('vr', () => this.vrManager.startSession());
        } catch (err) {
          console.error("UIController: Failed to auto-start VR session:", err);
        }
      });

      // Hover effects for the button
      btnStartZapbox.addEventListener('mouseenter', () => {
        btnStartZapbox.style.transform = 'scale(1.05)';
        btnStartZapbox.style.boxShadow = '0 0 35px rgba(0, 240, 255, 0.8)';
      });
      btnStartZapbox.addEventListener('mouseleave', () => {
        btnStartZapbox.style.transform = 'scale(1.0)';
        btnStartZapbox.style.boxShadow = '0 0 25px rgba(0, 240, 255, 0.5)';
      });
    }

    if (btnStartDesktop) {
      btnStartDesktop.addEventListener('click', () => {
        if (loaderOverlay) {
          loaderOverlay.classList.add('fade-out');
        }
      });

      btnStartDesktop.addEventListener('mouseenter', () => {
        btnStartDesktop.style.background = 'rgba(255, 255, 255, 0.1)';
        btnStartDesktop.style.borderColor = 'rgba(255, 255, 255, 0.4)';
        btnStartDesktop.style.color = '#ffffff';
      });
      btnStartDesktop.addEventListener('mouseleave', () => {
        btnStartDesktop.style.background = 'rgba(255, 255, 255, 0.05)';
        btnStartDesktop.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        btnStartDesktop.style.color = 'rgba(255, 255, 255, 0.7)';
      });
    }
  }

  showVoiceToast(message) {
    // Remove any existing voice toast
    const existing = document.querySelector('.voice-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'voice-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Force reflow
    toast.offsetHeight;

    // Show toast
    toast.classList.add('show');

    // Fade out and remove after 2.5 seconds
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 2500);
  }

  // Fix touch/click interaction issues inside WebXR dom-overlay on mobile devices
  bindXRInteractionsFix() {
    const hudLayer = document.querySelector('.hud-layer');
    if (!hudLayer) return;

    const stopXRPropagation = (e) => {
      // If the interaction is inside the HUD layer, stop it from propagating to the WebXR canvas / polyfill
      if (hudLayer.contains(e.target)) {
        e.stopPropagation();
      }
    };

    // Intercept standard touch and pointer events in the capturing phase
    window.addEventListener('touchstart', stopXRPropagation, { capture: true, passive: true });
    window.addEventListener('touchend', stopXRPropagation, { capture: true, passive: true });
    window.addEventListener('pointerdown', stopXRPropagation, { capture: true });
    window.addEventListener('pointerup', stopXRPropagation, { capture: true });
    window.addEventListener('mousedown', stopXRPropagation, { capture: true });
    window.addEventListener('mouseup', stopXRPropagation, { capture: true });
  }
}
