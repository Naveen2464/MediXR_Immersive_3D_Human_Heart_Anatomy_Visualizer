// Three.js 3D Rendering Engine for MediXR
import { ModelLoader } from './ModelLoader.js';
import { createHeartMaterials, highlightMaterial, createBloodFlowParticles, updateBloodFlowParticles } from '../utils/ShaderMaterials.js';
import { HeartData } from '../utils/HeartData.js';

export class Engine3D {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    // Simulation state variables
    this.rotationSpeed = 0.0;
    this.bpm = 72;
    this.isBeating = true;
    this.isFlowing = true;
    this.isCrossSection = false;
    this.showLabels = true;
    this.sliceDepth = 0.0;
    this.isTransparency = false;
    this.isExploded = false;
    this.diseaseMode = 'healthy';
    this.isGrabbed = false;

    // Animation timers
    this.clock = new THREE.Clock();
    this.beatTimer = 0;

    // Selection and interaction
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.hoveredMesh = null;
    this.selectedMesh = null;
    this.onSelectionChanged = null; // callback to UI

    // VR/AR Selection-Repositioning State
    this.preSelectionHeartPosition = null;
    this.preSelectionInfoPanelPosition = null;
    this.preSelectionInfoPanelRotation = null;
    this.targetHeartPosition = null;
    this.targetInfoPanelPosition = null;
    this.targetInfoPanelRotationY = undefined;
    this.wasGrabbed = false;
    this.xrReferenceSpaceType = 'local';
    this.lastTriggeredBeatIndex = -1;

    this.skeletonGroup = null;
    this.heartGroup = null;
    this.particles = null;
    this.visualizerMode = 'skeleton'; // 'skeleton' or 'focused'
    this.appMode = 'desktop'; // 'desktop', 'ar', 'vr', 'xr'
    this.arSimGroup = null;
    this.vrSimGroup = null;
    this.arScanPlane = null;
    this.podiumMat = null;
    this.rimRing = null;

    // Clipping plane for cross sections
    this.clippingPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 100.0);
    this.materials = null;

    // Label anchors for projection
    this.labelAnchors = {
      left_ventricle: new THREE.Vector3(-0.7, -0.6, 0.4),
      right_ventricle: new THREE.Vector3(0.7, -0.4, 0.4),
      left_atrium: new THREE.Vector3(-0.6, 0.7, -0.1),
      right_atrium: new THREE.Vector3(0.65, 0.6, 0.15),
      aorta: new THREE.Vector3(-0.4, 2.1, -0.1),
      pulmonary_artery: new THREE.Vector3(0.15, 1.25, 0.45),
      vena_cava: new THREE.Vector3(0.8, 1.5, -0.2)
    };

    // Direction offsets for exploded view mode
    this.explodedOffsets = {
      left_ventricle: new THREE.Vector3(-0.7, -0.7, 0.2),
      right_ventricle: new THREE.Vector3(0.7, -0.5, 0.4),
      left_atrium: new THREE.Vector3(-0.8, 0.8, -0.3),
      right_atrium: new THREE.Vector3(0.8, 0.7, 0.1),
      aorta: new THREE.Vector3(-0.2, 1.0, -0.2),
      pulmonary_artery: new THREE.Vector3(0.1, 0.7, 0.5),
      vena_cava: new THREE.Vector3(0.9, 0.8, -0.4)
    };
    this.labelElements = {};
  }

  init() {
    this.setupScene();
    this.setupLights();
    this.setupControls();
    this.setupMaterials();
    this.setupBloodFlow();
    this.setupSimulatedEnvironments();
    this.loadModels();
    this.setupLabels();
    this.setupEvents();

    // Start animation loop
    this.renderer.setAnimationLoop(() => this.animate());
  }

  setupScene() {
    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050a12);
    this.scene.fog = new THREE.FogExp2(0x050a12, 0.12);

    // 2. Camera
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(
      45,
      width / height,
      0.1,
      100
    );
    this.camera.position.set(0, 1.2, 5.5);
    this.raycaster.camera = this.camera; // Ensure sprite raycasting does not throw null pointer errors

    // 3. Renderer with WebXR and Clipping support
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Cinematic tone mapping for photorealistic GLB models
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    // Use sRGB output for accurate PBR texture colors
    if (THREE.SRGBColorSpace !== undefined) {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else {
      this.renderer.outputEncoding = THREE.sRGBEncoding; // Three.js r148 and earlier
    }

    // Enable WebXR support
    this.renderer.xr.enabled = true;

    // Enable local clipping plane
    this.renderer.localClippingEnabled = true;

    // Append canvas
    this.container.appendChild(this.renderer.domElement);
  }

  setupLights() {
    // Ambient Light — raised so GLB textures are not too dark
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    // Hemisphere Light (sky/ground color contrast)
    const hemiLight = new THREE.HemisphereLight(0xfff5ee, 0x1a0a00, 0.4);
    hemiLight.position.set(0, 10, 0);
    this.scene.add(hemiLight);

    // Directional Key Light (casting soft shadows) — bright white for PBR detail
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight.position.set(5, 8, 4);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 25;
    dirLight.shadow.bias = -0.001;
    this.scene.add(dirLight);

    // Warm anatomical fill light (mimics clinical operating-room lighting)
    const fillLight = new THREE.PointLight(0xff9966, 1.2, 14);
    fillLight.position.set(-4, 2, -2);
    this.scene.add(fillLight);

    // Cool back / rim light for depth
    const backLight = new THREE.PointLight(0x99ccff, 0.8, 10);
    backLight.position.set(2, -2, -3);
    this.scene.add(backLight);
  }

  setupControls() {
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 15.0;
    this.controls.maxPolarAngle = Math.PI / 1.8; // prevent going too far below floor

    // Initial target at chest level of skeleton
    this.controls.target.set(0, 1.0, 0);
  }

  setupMaterials() {
    // Create central physical materials sharing our clipping plane
    this.materials = createHeartMaterials(this.clippingPlane);
  }

  setupBloodFlow() {
    // Create the particle system
    this.particles = createBloodFlowParticles();
    this.scene.add(this.particles);
    this.particles.visible = this.isFlowing;
  }

  setupSimulatedEnvironments() {
    // 1. AR Simulated Environment (Green grid and scan line)
    this.arSimGroup = new THREE.Group();
    this.arSimGroup.name = "ar_simulation";
    this.arSimGroup.visible = false;
    this.scene.add(this.arSimGroup);

    // Green AR Grid Helper (positioned below the scaled down heart)
    const arGrid = new THREE.GridHelper(10, 20, 0x00ff88, 0x004422);
    arGrid.position.y = -0.4;
    this.arSimGroup.add(arGrid);

    // Green scanning light plane
    const scanGeo = new THREE.PlaneGeometry(3, 3);
    const scanMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide
    });
    this.arScanPlane = new THREE.Mesh(scanGeo, scanMat);
    this.arScanPlane.rotation.x = Math.PI / 2;
    this.arScanPlane.position.y = 0.6;
    this.arSimGroup.add(this.arScanPlane);

    // 2. VR Simulated Environment (Purple glowing podium, lab floor grid)
    this.vrSimGroup = new THREE.Group();
    this.vrSimGroup.name = "vr_simulation";
    this.vrSimGroup.visible = false;
    this.scene.add(this.vrSimGroup);

    // Dark purple lab grid
    const vrGrid = new THREE.GridHelper(15, 30, 0xa855f7, 0x3b0764);
    vrGrid.position.y = -1.2;
    this.vrSimGroup.add(vrGrid);

  }

  setReferenceSpaceType(type) {
    if (this.renderer && this.renderer.xr) {
      this.renderer.xr.setReferenceSpaceType(type);
    }
    this.xrReferenceSpaceType = type;
  }

  setAppMode(mode) {
    this.appMode = mode; // 'desktop', 'ar', 'vr', 'xr'

    // Reset all body classes
    document.body.classList.remove('body-mode-ar', 'body-mode-vr', 'body-mode-xr');

    // Hide all simulated environment groups by default
    if (this.arSimGroup) this.arSimGroup.visible = false;
    if (this.vrSimGroup) this.vrSimGroup.visible = false;

    // Handle status banner text & icon updates
    const banner = document.getElementById('mode-banner');
    const bannerText = document.getElementById('mode-banner-text');
    const bannerIcon = document.getElementById('mode-banner-icon');

    const panelLeft = document.getElementById('panel-left');
    const panelRight = document.getElementById('panel-right');

    if (mode === 'desktop') {
      if (this.scene) this.scene.background = new THREE.Color(0x050a12);
      if (banner) banner.classList.add('hidden');
      this.setVisualizerMode('skeleton');
      if (panelLeft) panelLeft.classList.remove('collapsed');
      if (panelRight) panelRight.classList.add('collapsed');
    } else {
      if (banner) banner.classList.remove('hidden');
      this.setVisualizerMode('focused');

      // Scale down the heart in simulated AR/VR/XR modes so it fits the viewport & podium perfectly (0.6x)
      if (this.heartGroup) {
        this.heartGroup.scale.set(0.15, 0.15, 0.15);
        this.heartGroup.position.set(0, 0.6, 0);
      }
      if (this.controls) {
        this.controls.target.set(0, 0.6, 0);
        this.camera.position.set(0, 0.6, 3.8); // Adjust camera target and distance accordingly
      }

      // Keep left panel open so all simulation control buttons remain clickable
      if (panelLeft) panelLeft.classList.remove('collapsed');
      if (this.selectedMesh && panelRight) {
        panelRight.classList.remove('collapsed');
      } else {
        if (panelRight) panelRight.classList.add('collapsed');
      }

      if (mode === 'ar') {
        document.body.classList.add('body-mode-ar');
        if (this.scene) this.scene.background = null;
        if (bannerText) bannerText.textContent = 'Simulated AR Mode';
        if (bannerIcon) bannerIcon.textContent = '🟢';
        if (this.arSimGroup) this.arSimGroup.visible = true;
      } else if (mode === 'vr') {
        document.body.classList.add('body-mode-vr');
        if (this.scene) this.scene.background = new THREE.Color(0x050a12);
        if (bannerText) bannerText.textContent = 'Simulated VR Lab';
        if (bannerIcon) bannerIcon.textContent = '🟣';
        if (this.vrSimGroup) this.vrSimGroup.visible = true;

        // Use purple color scheme
        if (this.rimRing) this.rimRing.material.color.setHex(0xa855f7);
        if (this.podiumMat) {
          this.podiumMat.emissive.setHex(0x581c87);
          this.podiumMat.emissiveIntensity = 0.5;
        }
      } else if (mode === 'xr') {
        document.body.classList.add('body-mode-xr');
        if (this.scene) this.scene.background = new THREE.Color(0x050a12);
        if (bannerText) bannerText.textContent = 'Simulated Auto XR';
        if (bannerIcon) bannerIcon.textContent = '💖';
        if (this.vrSimGroup) this.vrSimGroup.visible = true;

        // Use hot pink/magenta color scheme for Auto XR
        if (this.rimRing) this.rimRing.material.color.setHex(0xff0080);
        if (this.podiumMat) {
          this.podiumMat.emissive.setHex(0x9d174d);
          this.podiumMat.emissiveIntensity = 0.6;
        }
      }
    }
  }

  loadModels() {
    const loader = new ModelLoader();
    const progressEl = document.getElementById('progress-bar');
    const loaderStatusEl = document.getElementById('loader-status');

    if (loaderStatusEl) loaderStatusEl.textContent = 'Loading skeletal system...';

    loader.loadSkeletonModel((percent) => {
      if (progressEl) progressEl.style.width = `${percent * 0.4}%`;
    }).then((skeletonGroup) => {
      this.skeletonGroup = skeletonGroup;
      this.scene.add(this.skeletonGroup);

      if (loaderStatusEl) loaderStatusEl.textContent = 'Loading cardiovascular system...';

      return loader.loadHeartModel(this.materials, (percent) => {
        if (progressEl) progressEl.style.width = `${40 + percent * 0.6}%`;
      });
    }).then((heartGroup) => {
      this.heartGroup = heartGroup;

      // Update label anchors when a realistic model is loaded
      if (this.heartGroup.userData && this.heartGroup.userData.isRealisticModel) {
        const computed = this.heartGroup.userData.computedAnchors;

        if (computed && Object.keys(computed).length >= 4) {
          // Use anchors extracted directly from each mesh's bounding box centre
          console.log('Engine3D: Using auto-computed mesh-based label anchors.');
          this.labelAnchors = {};
          Object.entries(computed).forEach(([id, v]) => {
            this.labelAnchors[id] = new THREE.Vector3(v.x, v.y, v.z);
          });
          // Fill any missing anatomy IDs with calibrated fallbacks
          const fallback = {
            // X-axis note: GLB heart has +X = viewer's RIGHT = patient's anatomical LEFT.
            // Right structures (RA, RV, SVC) appear on the viewer's LEFT → negative X.
            // Left structures (LA, LV, Aorta) appear on the viewer's RIGHT → positive X.
            left_ventricle:   new THREE.Vector3( 0.20, -1.35, 1.10), // apex/lower body, viewer's right
            right_ventricle:  new THREE.Vector3(-0.50, -0.65, 1.20), // front-left wall, viewer's left
            left_atrium:      new THREE.Vector3( 0.70,  0.75, 0.10), // upper-right, slightly behind
            right_atrium:     new THREE.Vector3(-0.65,  0.55, 0.65), // upper-left, front
            aorta:            new THREE.Vector3( 0.25,  1.85, 0.25), // ascending arch top
            pulmonary_artery: new THREE.Vector3(-0.15,  1.65, 0.75), // pulmonary trunk top
            vena_cava:        new THREE.Vector3(-0.80,  1.50,-0.25)  // SVC, upper-left
          };
          Object.entries(fallback).forEach(([id, v]) => {
            if (!this.labelAnchors[id]) this.labelAnchors[id] = v;
          });
        } else {
          // X-axis: GLB heart +X = viewer's right = patient anatomical LEFT.
          // Right structures appear on viewer's LEFT (negative X in local space).
          // Left structures appear on viewer's RIGHT (positive X in local space).
          console.log('Engine3D: GLB has no named nodes — using calibrated fallback anchors.');
          this.labelAnchors = {
            left_ventricle:   new THREE.Vector3( 0.20, -1.35, 1.10), // lower body, viewer-right
            right_ventricle:  new THREE.Vector3(-0.50, -0.65, 1.20), // front wall, viewer-left
            left_atrium:      new THREE.Vector3( 0.70,  0.75, 0.10), // upper, viewer-right
            right_atrium:     new THREE.Vector3(-0.65,  0.55, 0.65), // upper, viewer-left
            aorta:            new THREE.Vector3( 0.25,  1.85, 0.25), // ascending arch
            pulmonary_artery: new THREE.Vector3(-0.15,  1.65, 0.75), // pulmonary trunk
            vena_cava:        new THREE.Vector3(-0.80,  1.50,-0.25)  // SVC upper-left
          };
        }
      }

      // Add particles as child of heartGroup so they scale/move together
      if (this.particles) {
        this.heartGroup.add(this.particles);
      }

      this.scene.add(this.heartGroup);

      // Default to landing page skeleton view unless user selected another mode during load
      if (this.visualizerMode !== 'skeleton') {
        this.setVisualizerMode(this.visualizerMode);
      } else {
        this.setVisualizerMode('skeleton');
      }

      // Create 3D sprite labels inside WebGL context for VR/AR modes
      this.create3DLabels();

      // Complete Loading
      setTimeout(() => {
        const loaderStatusEl = document.getElementById('loader-status');
        if (loaderStatusEl) loaderStatusEl.textContent = 'Anatomy Engine Ready';

        const progressContainer = document.querySelector('.progress-bar-container');
        if (progressContainer) progressContainer.style.display = 'none';

        const actionsEl = document.getElementById('loader-start-actions');
        if (actionsEl) {
          actionsEl.style.display = 'flex';
        } else {
          // Fallback if elements do not exist
          const loaderOverlay = document.getElementById('loader');
          if (loaderOverlay) {
            loaderOverlay.classList.add('fade-out');
          }
        }
      }, 500);
    });
  }

  setVisualizerMode(mode) {
    if (this.appMode !== 'desktop') {
      mode = 'focused';
    }
    this.visualizerMode = mode; // 'skeleton' or 'focused'

    // Sync the UI checkbox state
    const viewModeSwitch = document.getElementById('switch-view-mode');
    if (viewModeSwitch) {
      viewModeSwitch.checked = (mode === 'focused');
    }

    if (mode === 'skeleton') {
      this.showLabels = false;
      this.hideAllLabels();
      this.clearSelection();

      if (this.skeletonGroup) {
        this.skeletonGroup.visible = true;
        const isProcedural = this.skeletonGroup.userData && this.skeletonGroup.userData.isProcedural;
        // Reset skeleton positions, rotations, and scales to standard landing defaults
        this.skeletonGroup.position.set(0, isProcedural ? 0.3 : 0, 0);
        this.skeletonGroup.rotation.set(0, 0, 0);
        this.skeletonGroup.scale.set(1, 1, 1);
      }
      if (this.heartGroup) {
        this.heartGroup.visible = true; // Enforce heart visibility
        // Reset rotation to align perfectly with the skeleton's ribcage
        this.heartGroup.rotation.set(0, 0, 0);

        // Scale and position based on whether the skeleton is procedural or realistic
        const isProcedural = this.skeletonGroup && this.skeletonGroup.userData && this.skeletonGroup.userData.isProcedural;
        if (isProcedural) {
          // Centered inside procedural ribcage
          this.heartGroup.scale.set(0.06, 0.05, 0.06);
          this.heartGroup.position.set(0.0, 0.5, 0.1);
        } else {
          // Scale heart small to fit inside realistic GLB ribcage
          this.heartGroup.scale.set(0.04, 0.03, 0.04);
          // Set coordinates to center it inside the ribcage (X = 0.0, Y = 1.37, Z = -0.08)
          this.heartGroup.position.set(0.0, 1.45, -0.08);
        }

        if (this.skeletonGroup) {
          this.skeletonGroup.add(this.heartGroup);
        }
      }

      // Camera target: chest area of skeleton (y=1.2)
      if (this.controls) {
        this.camera.up.set(0, 1, 0); // Reset camera tilt/roll tracking from VR
        this.controls.target.set(0, 1.2, 0);
        this.camera.position.set(0, 1.2, 5.0);
      }
    } else { // 'focused'
      this.showLabels = true;
      if (this.skeletonGroup) {
        this.skeletonGroup.visible = false;
      }

      const isXR = this.renderer.xr.isPresenting;
      if (this.heartGroup) {
        this.heartGroup.visible = true;
        this.scene.add(this.heartGroup); // detach from skeleton group → back to scene root
        if (!isXR) {
          if (this.appMode === 'ar' || this.appMode === 'vr' || this.appMode === 'xr') {
            // XR modes: smaller heart floating at standing eye level
            this.heartGroup.scale.set(0.15, 0.15, 0.15);
            this.heartGroup.position.set(0, 0.6, 0);
          } else {
            // Desktop: scale to fill viewport
            this.heartGroup.scale.set(1.1, 1.1, 1.1);

            // Calculate the geometric center dynamically using Three.js bounding box
            const box = new THREE.Box3().setFromObject(this.heartGroup);
            const center = new THREE.Vector3();
            box.getCenter(center);

            // Shift the heart group so its exact visual center is aligned at (0, 0, 0)
            this.heartGroup.position.copy(center).negate();
          }
        }
      }

      // Camera: look straight at origin so heart is dead-center
      if (this.controls && !isXR) {
        this.camera.up.set(0, 1, 0); // Reset camera tilt/roll tracking
        if (this.appMode === 'ar' || this.appMode === 'vr' || this.appMode === 'xr') {
          this.controls.target.set(0, 0.6, 0);
          this.camera.position.set(0, 0.6, 3.8);
        } else {
          this.controls.target.set(0, 0, 0);
          this.camera.position.set(0, 0, 4.5);
        }
      }
    }

    if (this.controls) this.controls.update();
  }

  hideAllLabels() {
    Object.keys(this.labelElements).forEach(key => {
      const element = this.labelElements[key];
      if (element) {
        element.style.opacity = '0';
        element.style.pointerEvents = 'none';
      }
    });
  }

  setupLabels() {
    // Generate overlay label containers in HUD layer
    const hudContainer = document.querySelector('.hud-layer');
    if (!hudContainer) return;

    Object.keys(this.labelAnchors).forEach(key => {
      const label = document.createElement('div');
      label.className = 'heart-label-tag';
      label.id = `label-tag-${key}`;

      // Get formatted label name
      const name = HeartData[key] ? HeartData[key].name : key;

      // Display small dot icon depending on blood oxygenation
      let dotColor = 'var(--color-primary)';
      if (key === 'aorta' || key === 'left_ventricle' || key === 'left_atrium') dotColor = 'var(--color-ox)';
      if (key === 'pulmonary_artery' || key === 'right_ventricle' || key === 'right_atrium' || key === 'vena_cava') dotColor = 'var(--color-deox)';

      label.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background-color:${dotColor};box-shadow:0 0 6px ${dotColor};margin-right:5px;flex-shrink:0"></span>${name}`;

      // Make label CLICKABLE — selecting that anatomy part directly
      label.style.cursor = 'pointer';
      label.title = `Click to view ${name} details`;
      label.addEventListener('click', (e) => {
        e.stopPropagation();
        // Toggle: if already selected, clear; otherwise select
        if (this.selectedMesh && this.selectedMesh.userData && this.selectedMesh.userData.nameId === key) {
          this.clearSelection();
        } else {
          this.setVisualizerMode('focused');
          this.selectAnatomy(key);
        }
      });

      // Save reference and add to HUD
      this.labelElements[key] = label;
      hudContainer.appendChild(label);
    });
  }

  setupEvents() {
    // Window Resize
    window.addEventListener('resize', () => this.onWindowResize());

    // Mouse Move (Hover checking)
    this.renderer.domElement.addEventListener('mousemove', (e) => this.onMouseMove(e));

    // Click / Touch select
    this.renderer.domElement.addEventListener('click', (e) => this.onMouseClick(e));

    // Mobile Touch interaction helpers (raycasting support)
    this.renderer.domElement.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.touches[0].clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.touches[0].clientY - rect.top) / rect.height) * 2 + 1;
      }
    }, { passive: true });

    // Mobile tap triggers selection (touchend = completed tap without drag)
    this.renderer.domElement.addEventListener('touchend', (e) => {
      if (e.changedTouches.length === 1) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.changedTouches[0].clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.changedTouches[0].clientY - rect.top) / rect.height) * 2 + 1;
        this.onMouseClick(e);
      }
    }, { passive: true });
  }

  onWindowResize() {
    if (this.renderer.xr.isPresenting) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  highlightAnatomy(node, isHighlighted) {
    if (!node) return;
    // Apply highlight recursively to all meshes inside the node (handles group nodes)
    if (node.isMesh) {
      const mat = node.material;
      highlightMaterial(mat, isHighlighted);
    }
    if (node.children && node.children.length > 0) {
      node.traverse(child => {
        if (child.isMesh) {
          highlightMaterial(child.material, isHighlighted);
        }
      });
    }
  }

  onMouseMove(event) {
    // Get mouse coordinates normalized
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Raycast check
    if (this.heartGroup) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.heartGroup.children, true);

      if (intersects.length > 0) {
        // Find topmost named mesh node with a nameId (handling nested groups of GLB models)
        let mesh = intersects[0].object;
        let nameId = null;
        let target = null;
        let current = mesh;
        while (current) {
          if (current.userData && current.userData.nameId) {
            nameId = current.userData.nameId;
            target = current;
            break;
          }
          if (current === this.heartGroup) break;
          current = current.parent;
        }

        if (nameId && target) {
          if (this.hoveredMesh !== target) {
            // Remove previous hover color
            if (this.hoveredMesh && this.hoveredMesh !== this.selectedMesh) {
              this.highlightAnatomy(this.hoveredMesh, false);
            }

            this.hoveredMesh = target;

            // Apply hover highlight
            if (this.hoveredMesh !== this.selectedMesh) {
              this.highlightAnatomy(this.hoveredMesh, true);
              document.body.style.cursor = 'pointer';
            }
          }
        }
      } else {
        if (this.hoveredMesh) {
          if (this.hoveredMesh !== this.selectedMesh) {
            this.highlightAnatomy(this.hoveredMesh, false);
          }
          this.hoveredMesh = null;
          document.body.style.cursor = 'default';
        }
      }
    }
  }

  onMouseClick(event) {
    if (this.heartGroup) {
      // Always recalculate normalised mouse from the actual click/tap position
      // so raycasting works even without a prior mousemove event
      if (event && event.clientX !== undefined) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      }

      this.raycaster.setFromCamera(this.mouse, this.camera);
      
      // Check raycast hits. If in skeleton mode, intersect against skeletonGroup as well to act as a chest collider.
      let intersects = [];
      if (this.visualizerMode === 'skeleton' && this.skeletonGroup) {
        intersects = this.raycaster.intersectObjects([this.heartGroup, this.skeletonGroup], true);
      } else {
        intersects = this.raycaster.intersectObjects(this.heartGroup.children, true);
      }

      if (intersects.length > 0) {
        let mesh = intersects[0].object;
        let nameId = null;

        // Check if we hit the skeleton (in skeleton mode) to act as a chest collider
        if (this.visualizerMode === 'skeleton' && this.skeletonGroup) {
          let current = mesh;
          let hitSkeleton = false;
          while (current) {
            if (current === this.skeletonGroup) {
              hitSkeleton = true;
              break;
            }
            current = current.parent;
          }
          if (hitSkeleton) {
            this.setVisualizerMode('focused');
            return;
          }
        }

        // Check if we hit a 3D Sprite label
        if (mesh.isSprite && mesh.userData && mesh.userData.nameId) {
          nameId = mesh.userData.nameId;
        } else {
          // Walk up hierarchy to find a mesh with a valid anatomy nameId
          let current = mesh;
          while (current) {
            if (current.userData && current.userData.nameId && HeartData[current.userData.nameId]) {
              nameId = current.userData.nameId;
              break;
            }
            if (current === this.heartGroup) break;
            current = current.parent;
          }

          // If mesh has an anatomy nameId directly (region-mapped realistic model)
          if (!nameId && mesh.userData && mesh.userData.nameId && HeartData[mesh.userData.nameId]) {
            nameId = mesh.userData.nameId;
          }

          // Fallback: use closest anchor point for any unresolved click on the heart
          if (!nameId) {
            nameId = this.getClosestAnatomy(intersects[0].point);
          }
        }

        // Auto-focus on heart when clicked inside skeleton
        if (this.visualizerMode === 'skeleton') {
          this.setVisualizerMode('focused');
          return;
        }

        if (nameId && HeartData[nameId]) {
          // Toggle selection: if already selected, clear it
          if (this.selectedMesh && this.selectedMesh.userData.nameId === nameId) {
            this.clearSelection();
          } else {
            this.selectAnatomy(nameId);
          }
        }
      } else {
        // Clicked empty space: clear selection
        this.clearSelection();
      }
    }
  }

  // Returns the nameId of the closest anatomical structure based on 3D distance
  getClosestAnatomy(intersectionPoint) {
    const localPoint = this.heartGroup.worldToLocal(intersectionPoint.clone());
    let closestKey = null;
    let minDist = Infinity;

    Object.keys(this.labelAnchors).forEach(key => {
      const anchor = this.labelAnchors[key];
      const dist = localPoint.distanceTo(anchor);
      if (dist < minDist) {
        minDist = dist;
        closestKey = key;
      }
    });

    // Threshold to prevent picking a structure if clicking extremely far away
    if (closestKey && minDist < 1.5) {
      return closestKey;
    }
    return 'heart';
  }

  // Set selected anatomy structure
  selectAnatomy(nameId) {
    // 1. Clear previous selection (restore all opacities)
    if (this.selectedMesh) {
      this.highlightAnatomy(this.selectedMesh, false);
      this._restoreAllMeshOpacities();
    }

    // 2. Find the first target mesh with matching nameId in the group
    let targetMesh = null;
    this.heartGroup.traverse(node => {
      if (!targetMesh && node.userData && node.userData.nameId === nameId) {
        targetMesh = node;
      }
    });

    // If no mesh has this nameId directly but data exists, use the whole heartGroup as target
    if (!targetMesh && HeartData[nameId]) {
      targetMesh = this.heartGroup;
      targetMesh.userData = targetMesh.userData || {};
      targetMesh.userData.nameId = nameId;
    }

    if (targetMesh) {
      this.selectedMesh = targetMesh;
      this.selectedMesh.userData._selectedNameId = nameId;
      this.updateVRInfoPanel(nameId);

      // Reposition heart group and VR Info panel to be side-by-side in VR mode only
      if (this.appMode === 'vr') {
        if (this.heartGroup) {
          if (!this.preSelectionHeartPosition) {
            this.preSelectionHeartPosition = this.heartGroup.position.clone();
          }
          if (this.vrInfoPanel && !this.preSelectionInfoPanelPosition) {
            this.preSelectionInfoPanelPosition = this.vrInfoPanel.position.clone();
            this.preSelectionInfoPanelRotation = this.vrInfoPanel.rotation.clone();
          }

          const isFloorSpace = (this.xrReferenceSpaceType === 'local-floor');
          const heartY = isFloorSpace ? 1.3 : 0.0;
          // Pull heart back and shift to the left (further away and wider)
          this.targetHeartPosition = new THREE.Vector3(-0.8, heartY, -3.0);
          // Position Info Panel further and to the right, facing user
          this.targetInfoPanelPosition = new THREE.Vector3(0.8, heartY, -2.4);
          this.targetInfoPanelRotationY = -Math.atan2(0.8, 2.4);
        }
      }

      if (this.appMode === 'vr') {
        // VR Mode: Show the entire heart, keeping active transparency if enabled
        const isRealistic = this.heartGroup.userData && this.heartGroup.userData.isRealisticModel;
        this.heartGroup.traverse(node => {
          if (node.isMesh) {
            node.visible = true;
            const mats = Array.isArray(node.material) ? node.material : [node.material];
            mats.forEach(mat => {
              if (mat && mat.userData) {
                const od = mat.userData;
                if (this.isTransparency) {
                  const partName = node.userData ? node.userData.nameId : null;
                  const isOuterWall = isRealistic ||
                    (partName === 'left_ventricle' || partName === 'right_ventricle' ||
                      partName === 'left_atrium' || partName === 'right_atrium');
                  if (isOuterWall) {
                    mat.opacity = 0.22;
                  } else {
                    if (od.originalOpacity !== undefined) mat.opacity = od.originalOpacity;
                  }
                } else {
                  if (od.originalOpacity !== undefined) mat.opacity = od.originalOpacity;
                }
                if (od.originalEmissive !== undefined && mat.emissive) mat.emissive.setHex(od.originalEmissive);
                if (od.originalEmissiveIntensity !== undefined && mat.emissiveIntensity !== undefined) {
                  mat.emissiveIntensity = od.originalEmissiveIntensity;
                }
                mat.needsUpdate = true;
              }
            });
          }
        });
        if (this.particles) {
          this.particles.visible = this.isFlowing;
        }
      } else {
        // Desktop/AR: Completely hide non-selected parts to isolate the selected part (or make them translucent if transparency mode is enabled)
        const isRealistic = this.heartGroup.userData && this.heartGroup.userData.isRealisticModel;
        this.heartGroup.traverse(node => {
          if (node.isMesh) {
            const meshNameId = node.userData ? node.userData.nameId : null;

            // Check parent hierarchy too (for sub-meshes of groups like aorta branches)
            let parentNameId = null;
            let parentNode = node.parent;
            while (parentNode && parentNode !== this.heartGroup) {
              if (parentNode.userData && parentNode.userData.nameId) {
                parentNameId = parentNode.userData.nameId;
                break;
              }
              parentNode = parentNode.parent;
            }

            const isMatch = (meshNameId === nameId) || (parentNameId === nameId);

            const mats = Array.isArray(node.material) ? node.material : [node.material];
            mats.forEach(mat => {
              if (mat) {
                if (isMatch) {
                  // Keep the selected region at original opacity/color, but fully visible
                  mat.transparent = true;
                  mat.opacity = 1.0;
                  if (mat.userData && mat.userData.originalEmissive !== undefined && mat.emissive) {
                    mat.emissive.setHex(mat.userData.originalEmissive);
                  }
                  if (mat.emissiveIntensity !== undefined && mat.userData) {
                    const origIntensity = mat.userData.originalEmissiveIntensity !== undefined ? mat.userData.originalEmissiveIntensity : 0.35;
                    mat.emissiveIntensity = Math.min(origIntensity * 2.0, 1.0);
                  }
                } else {
                  if (this.isTransparency) {
                    // Transparency mode is active: instead of hiding non-selected parts, make outer walls transparent
                    const partName = node.userData ? node.userData.nameId : null;
                    const isOuterWall = isRealistic ||
                      (partName === 'left_ventricle' || partName === 'right_ventricle' ||
                        partName === 'left_atrium' || partName === 'right_atrium');
                    mat.transparent = true;
                    mat.opacity = isOuterWall ? 0.22 : 0.0;
                  } else {
                    // Completely hide non-selected parts to isolate the selected part
                    mat.transparent = true;
                    mat.opacity = 0.0;
                  }
                  if (mat.emissive) mat.emissive.setHex(0x000000);
                  if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = 0.0;
                }
                mat.needsUpdate = true;
              }
            });
            if (this.isTransparency) {
              // In transparency mode, all parts (including translucent walls) remain visible
              const partName = node.userData ? node.userData.nameId : null;
              const isOuterWall = isRealistic ||
                (partName === 'left_ventricle' || partName === 'right_ventricle' ||
                  partName === 'left_atrium' || partName === 'right_atrium');
              node.visible = isMatch || isOuterWall;
            } else {
              node.visible = isMatch; // Only show matching meshes
            }
          }
        });

        // Hide particles on desktop/AR when transparency is OFF and showing only one selected part
        if (this.particles) {
          this.particles.visible = this.isTransparency ? this.isFlowing : false;
        }
      }

      // Highlight the target mesh itself
      if (targetMesh !== this.heartGroup) {
        this.highlightAnatomy(targetMesh, true);
      }

      // Update UI callback
      if (this.onSelectionChanged) {
        this.onSelectionChanged(nameId);
      }
    }
  }

  // Helper: restore all mesh materials to their original opacity/emissive values
  _restoreAllMeshOpacities() {
    if (!this.heartGroup) return;
    const isRealistic = this.heartGroup.userData && this.heartGroup.userData.isRealisticModel;
    this.heartGroup.traverse(node => {
      if (node.isMesh) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach(mat => {
          if (mat && mat.userData) {
            const od = mat.userData;
            if (this.isTransparency) {
              const partName = node.userData ? node.userData.nameId : null;
              const isOuterWall = isRealistic ||
                (partName === 'left_ventricle' || partName === 'right_ventricle' ||
                  partName === 'left_atrium' || partName === 'right_atrium');
              if (isOuterWall) {
                mat.opacity = 0.22;
              } else {
                if (od.originalOpacity !== undefined) mat.opacity = od.originalOpacity;
              }
            } else {
              if (od.originalOpacity !== undefined) mat.opacity = od.originalOpacity;
            }
            if (od.originalEmissive !== undefined && mat.emissive) mat.emissive.setHex(od.originalEmissive);
            if (od.originalEmissiveIntensity !== undefined && mat.emissiveIntensity !== undefined) {
              mat.emissiveIntensity = od.originalEmissiveIntensity;
            }
            mat.needsUpdate = true;
          }
        });
        node.visible = true;
      }
    });
  }

  // Reset selected mesh
  clearSelection() {
    if (this.selectedMesh) {
      this.highlightAnatomy(this.selectedMesh, false);
      this.selectedMesh = null;
    }

    // Restore all mesh opacities and visibility
    this._restoreAllMeshOpacities();

    // Restore selection-based side-by-side positions in VR mode only
    if (this.appMode === 'vr') {
      if (this.preSelectionHeartPosition) {
        this.targetHeartPosition = this.preSelectionHeartPosition.clone();
      }
      if (this.preSelectionInfoPanelPosition) {
        this.targetInfoPanelPosition = this.preSelectionInfoPanelPosition.clone();
        this.targetInfoPanelRotationY = this.preSelectionInfoPanelRotation.y;
      }
    }

    if (this.vrInfoPanel) {
      this.vrInfoPanel.visible = false;
    }

    // Restore active particles visibility
    if (this.particles) {
      this.particles.visible = this.isFlowing;
    }

    if (this.onSelectionChanged) {
      this.onSelectionChanged(null);
    }
  }

  resetScene() {
    this.controls.reset();
    this.clearSelection();

    // Reset rotations/scales
    if (this.heartGroup) {
      this.heartGroup.rotation.set(0, 0, 0);
      this.heartGroup.traverse(node => {
        if (node.userData && node.userData.originalScale) {
          node.scale.copy(node.userData.originalScale);
          node.position.copy(node.userData.originalPosition);
        }
      });
    }

    // Restore skeleton landing view if on desktop, otherwise keep focused view
    if (this.appMode === 'desktop') {
      this.setVisualizerMode('skeleton');
    } else {
      this.setVisualizerMode('focused');
    }
    this.setExplodedMode(false);
  }

  // Config modifier setters
  setRotationSpeed(speed) {
    this.rotationSpeed = parseFloat(speed);
  }

  setPulseRate(rate) {
    this.bpm = parseInt(rate);
  }

  setHeartbeatEnabled(enabled) {
    this.isBeating = enabled;
    // reset scale if disabled
    if (!enabled && this.heartGroup) {
      this.heartGroup.traverse(node => {
        if (node.userData && node.userData.originalScale) {
          node.scale.copy(node.userData.originalScale);
        }
      });
    }
  }

  setBloodFlowEnabled(enabled) {
    this.isFlowing = enabled;
    if (this.particles) {
      this.particles.visible = enabled;
    }
  }

  setCrossSectionEnabled(enabled) {
    this.isCrossSection = enabled;
    if (enabled) {
      this.setVisualizerMode('focused');
      this.clippingPlane.constant = this.sliceDepth;
    } else {
      this.clippingPlane.constant = 100.0;
    }
  }

  setSliceDepth(depth) {
    this.sliceDepth = parseFloat(depth);
    if (this.isCrossSection) {
      this.clippingPlane.constant = this.sliceDepth;
    }
  }

  setLabelsEnabled(enabled) {
    this.showLabels = enabled;
    Object.values(this.labelElements).forEach(el => {
      el.style.display = enabled ? 'flex' : 'none';
    });
    if (this.spriteLabelsGroup) {
      this.spriteLabelsGroup.visible = enabled;
    }
  }

  // Creates 3D labels inside the WebGL scene context so they render inside VR/AR headsets
  create3DLabels() {
    if (this.spriteLabelsGroup && this.heartGroup) {
      this.heartGroup.remove(this.spriteLabelsGroup);
    }

    this.spriteLabelsGroup = new THREE.Group();
    this.spriteLabelsGroup.name = "3d_sprite_labels";
    this.spriteLabelsGroup.visible = false;

    if (this.heartGroup) {
      this.heartGroup.add(this.spriteLabelsGroup);
    }

    // Force updates to ensure matrix operations have correct world coordinates
    this.heartGroup.updateMatrixWorld(true);

    const isRealistic = this.heartGroup && this.heartGroup.userData && this.heartGroup.userData.isRealisticModel;

    // Custom outward offsets to prevent overlapping and keep them outside the heart model
    const customOffsets = {
      left_ventricle:   new THREE.Vector3( 1.4, -0.6,  0.5), // Lower right
      right_ventricle:  new THREE.Vector3(-1.4, -0.6,  0.5), // Lower left
      left_atrium:      new THREE.Vector3( 1.6,  0.2, -0.2), // Upper right
      right_atrium:     new THREE.Vector3(-1.6,  0.0,  0.2), // Upper left
      aorta:            new THREE.Vector3( 0.9,  1.4,  0.2), // Symmetrical top right
      pulmonary_artery: new THREE.Vector3(-0.9,  1.4,  0.4), // Symmetrical top left
      vena_cava:        new THREE.Vector3(-1.8,  0.6, -0.6)  // Far upper left, cleared from PA
    };

    Object.keys(this.labelAnchors).forEach(key => {
      const name = HeartData[key] ? HeartData[key].name : key;

      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');

      // Draw background rounded rectangle with appropriate border color
      ctx.fillStyle = 'rgba(5, 10, 18, 0.9)';
      let borderColor = '#00f0ff';
      if (key === 'aorta' || key === 'left_ventricle' || key === 'left_atrium') borderColor = '#dc2626';
      if (key === 'pulmonary_artery' || key === 'right_ventricle' || key === 'right_atrium' || key === 'vena_cava') borderColor = '#2563eb';
      ctx.strokeStyle = borderColor;

      ctx.lineWidth = 8;
      const x = 8, y = 8, w = canvas.width - 16, h = canvas.height - 16, r = 24;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Draw label text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 44px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, canvas.width / 2, canvas.height / 2);

      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({
        map: texture,
        depthTest: true,
        depthWrite: false
      });
      const sprite = new THREE.Sprite(material);

      const anchor = this.labelAnchors[key];
      let labelPos;
      if (isRealistic) {
        const offset = customOffsets[key];
        labelPos = anchor.clone().add(offset || new THREE.Vector3());
      } else {
        const labelOffset = anchor.clone().normalize().multiplyScalar(0.35);
        labelPos = anchor.clone().add(labelOffset);
      }
      sprite.position.copy(labelPos);

      // Scale sprite to fit the scene size beautifully
      sprite.scale.set(0.9, 0.225, 1.0);
      sprite.renderOrder = 1000;

      sprite.userData = { nameId: key };
      this.spriteLabelsGroup.add(sprite);

      // Add a connecting line from label to anchor point on the heart
      const lineColor = new THREE.Color(borderColor);
      const lineMat = new THREE.LineBasicMaterial({
        color: lineColor,
        transparent: true,
        opacity: 0.6,
        depthTest: true
      });
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        anchor.clone(),
        labelPos.clone()
      ]);
      const line = new THREE.Line(lineGeo, lineMat);
      line.renderOrder = 999;
      this.spriteLabelsGroup.add(line);
    });
  }

  // Projects 3D label anchors to HTML screen coords, or handles 3D sprite labels in VR/AR
  updateLabelsProjection() {
    const isXR = this.renderer.xr.isPresenting || this.appMode !== 'desktop';

    if (isXR) {
      // Hide HTML labels
      this.hideAllLabels();
      // Show 3D scene labels (both sprites and lines)
      if (this.spriteLabelsGroup) {
        this.spriteLabelsGroup.visible = this.showLabels;
        this.spriteLabelsGroup.traverse(child => {
          if (child.isSprite) child.visible = true;
          if (child.isLine) child.visible = true;
        });
      }
      return;
    }

    // Desktop mode: Hide 3D sprites (text) but KEEP 3D lines visible as leader lines!
    if (this.spriteLabelsGroup) {
      this.spriteLabelsGroup.visible = this.showLabels;
      this.spriteLabelsGroup.traverse(child => {
        if (child.isSprite) child.visible = false; // Hide WebGL sprite text on desktop
        if (child.isLine) child.visible = true;  // Keep 3D connecting lines visible!
      });
    }

    if (!this.showLabels || !this.heartGroup) return;

    // Enforce matrix updates on both camera and heart model group to avoid 1-frame lags
    this.camera.updateMatrixWorld(true);
    this.heartGroup.updateMatrixWorld(true);

    const tempV = new THREE.Vector3();
    const widthHalf = (this.container.clientWidth || window.innerWidth) / 2;
    const heightHalf = (this.container.clientHeight || window.innerHeight) / 2;

    const isRealistic = this.heartGroup.userData && this.heartGroup.userData.isRealisticModel;

    // Custom outward offsets to match create3DLabels offsets
    const customOffsets = {
      left_ventricle:   new THREE.Vector3( 1.4, -0.6,  0.5), // Lower right
      right_ventricle:  new THREE.Vector3(-1.4, -0.6,  0.5), // Lower left
      left_atrium:      new THREE.Vector3( 1.6,  0.2, -0.2), // Upper right
      right_atrium:     new THREE.Vector3(-1.6,  0.0,  0.2), // Upper left
      aorta:            new THREE.Vector3( 0.9,  1.4,  0.2), // Symmetrical top right
      pulmonary_artery: new THREE.Vector3(-0.9,  1.4,  0.4), // Symmetrical top left
      vena_cava:        new THREE.Vector3(-1.8,  0.6, -0.6)  // Far upper left, cleared from PA
    };

    Object.keys(this.labelAnchors).forEach(key => {
      const anchor = this.labelAnchors[key];
      const element = this.labelElements[key];
      if (!element) return;

      tempV.copy(anchor);

      // Offset the projected coordinate to match the line's outer end point
      if (isRealistic) {
        const offset = customOffsets[key];
        if (offset) {
          tempV.add(offset);
        }
      } else {
        const labelOffset = anchor.clone().normalize().multiplyScalar(0.35);
        tempV.add(labelOffset);
      }

      // If exploded view is enabled, apply outward scaling shift to anchors
      if (this.isExploded) {
        if (isRealistic) {
          tempV.multiplyScalar(1.45); // shift anchors outwards for realistic model
        } else {
          // For procedural model, dynamically shift using exploded offsets if meshes exist
          const mesh = this.heartGroup.getObjectByName(key);
          if (mesh && this.explodedOffsets[key]) {
            tempV.add(this.explodedOffsets[key]);
          }
        }
      }

      this.heartGroup.localToWorld(tempV);

      // Project to 2D normalized screen space [-1, 1]
      tempV.project(this.camera);

      // Check if coordinate is behind camera lens
      if (tempV.z > 1) {
        element.style.opacity = '0';
        element.style.pointerEvents = 'none';
        return;
      }

      // Convert to CSS positions
      const x = (tempV.x * widthHalf) + widthHalf;
      const y = -(tempV.y * heightHalf) + heightHalf;

      // Clamp X so labels stay inside the visible viewport area.
      // Left sidebar (System Controls) is ~340px wide; right edge leaves 20px margin.
      const panelLeftEl = document.getElementById('panel-left');
      const panelLeftWidth = (panelLeftEl && !panelLeftEl.classList.contains('collapsed'))
        ? (panelLeftEl.offsetWidth + 20) : 20;
      const clampedX = Math.max(panelLeftWidth + 10, Math.min(x, window.innerWidth - 100));
      const clampedY = Math.max(30, Math.min(y, window.innerHeight - 30));

      // Apply positions to HTML elements
      element.style.opacity = '1';
      element.style.pointerEvents = 'auto';
      element.style.left = `${clampedX}px`;
      element.style.top = `${clampedY}px`;
    });
  }

  // Heartbeat ECG simulation formula
  getHeartbeatScale(time, bpm) {
    const period = 60 / bpm; // duration of 1 beat cycle in seconds
    const phase = (time % period) / period; // progress in current beat [0, 1]

    let scale = 0;
    // ECG Waveform Approximation (P-Q-R-S-T wave contraction peaks)
    // Ventricular systole (R wave) peaks around phase = 0.2
    if (phase > 0.15 && phase < 0.28) {
      const t = (phase - 0.15) / 0.13;
      scale = Math.sin(t * Math.PI) * 0.14; // rapid ventricular squeeze
    }
    // Atrial systole (P wave) contract around phase = 0.0
    else if (phase > 0.85 || phase < 0.08) {
      const t = (phase > 0.85 ? phase - 0.85 : phase + 0.15) / 0.23;
      scale = Math.sin(t * Math.PI) * 0.05; // smaller atrial pulse
    }
    // Diastolic relaxation (T wave) swells around phase = 0.45
    else if (phase > 0.38 && phase < 0.65) {
      const t = (phase - 0.38) / 0.27;
      scale = -Math.sin(t * Math.PI) * 0.04; // slight expand/dilation
    }

    return scale;
  }

  animate() {
    const delta = this.clock.getDelta();
    const elapsedTime = this.clock.getElapsedTime();

    // Update simulated AR scanning plane height cycle
    if (this.arSimGroup && this.arSimGroup.visible && this.arScanPlane) {
      this.arScanPlane.position.y = 0.6 + Math.sin(elapsedTime * 2) * 0.4;
    }


    // 1. Controls (only update on desktop/non-WebXR mode)
    if (this.controls && !this.renderer.xr.isPresenting) {
      this.controls.update();
    }

    // Update WebXR VR Grabbing, Manipulation & Joystick Controls
    if (this.vrManager) {
      this.vrManager.updateVRGrabs(delta);
    }

    // Update WebXR AR Joystick Controls
    if (this.arManager && this.appMode === 'ar') {
      this.arManager.updateARJoystick(delta);
    }

    // Update selection-repositioning animation for side-by-side layout in VR mode only
    if (this.appMode === 'vr' && this.heartGroup) {
      // If a grab just ended, adjust the cached pre-selection position relative to new grabbed place
      const grabEnded = !this.isGrabbed && this.wasGrabbed;
      this.wasGrabbed = this.isGrabbed;
      
      if (grabEnded && this.selectedMesh && this.preSelectionHeartPosition && this.targetHeartPosition) {
        const offset = new THREE.Vector3().subVectors(this.targetHeartPosition, this.preSelectionHeartPosition);
        this.preSelectionHeartPosition.copy(this.heartGroup.position).sub(offset);
        this.targetHeartPosition.copy(this.heartGroup.position);
      }

      if (!this.isGrabbed) {
        if (this.targetHeartPosition) {
          this.heartGroup.position.lerp(this.targetHeartPosition, 0.1);
          
          // Clear cached/target positions once returned back to normal resting place
          if (!this.selectedMesh && this.preSelectionHeartPosition) {
            if (this.heartGroup.position.distanceTo(this.preSelectionHeartPosition) < 0.01) {
              this.heartGroup.position.copy(this.preSelectionHeartPosition);
              this.preSelectionHeartPosition = null;
              this.targetHeartPosition = null;
              
              if (this.vrInfoPanel && this.preSelectionInfoPanelPosition) {
                this.vrInfoPanel.position.copy(this.preSelectionInfoPanelPosition);
                this.vrInfoPanel.rotation.copy(this.preSelectionInfoPanelRotation);
                this.preSelectionInfoPanelPosition = null;
                this.targetInfoPanelPosition = null;
              }
            }
          }
        }

        if (this.vrInfoPanel && this.targetInfoPanelPosition) {
          this.vrInfoPanel.position.lerp(this.targetInfoPanelPosition, 0.1);
          if (this.targetInfoPanelRotationY !== undefined) {
            this.vrInfoPanel.rotation.y = THREE.MathUtils.lerp(this.vrInfoPanel.rotation.y, this.targetInfoPanelRotationY, 0.1);
          }
        }
      }
    } else {
      this.wasGrabbed = this.isGrabbed;
    }

    // 2. Auto-rotation (pauses when grabbed by controllers)
    if (this.rotationSpeed > 0 && !this.isGrabbed) {
      const angle = this.rotationSpeed * delta * 60;
      if (this.visualizerMode === 'skeleton') {
        if (this.skeletonGroup) this.skeletonGroup.rotation.y += angle;
      } else {
        if (this.heartGroup) this.heartGroup.rotation.y += angle;
      }
    }

    // Ensure base scale of heartGroup is correct for the active visualizer mode
    if (this.heartGroup) {
      if (this.isArrhythmia) {
        // Chaotic fibrillation rhythm
        const erraticScale = 1.0 + Math.sin(elapsedTime * 28.0) * 0.08 + Math.cos(elapsedTime * 14.0) * 0.04;
        this.heartGroup.scale.setScalar(erraticScale);
        this.bpm = 150;
        const bpmVal = document.getElementById('pulse-rate-val');
        const bpmSlider = document.getElementById('slider-pulse-rate');
        if (bpmVal) bpmVal.textContent = "150 BPM (VFib)";
        if (bpmSlider) bpmSlider.value = 150;
      } else {
        if (this.visualizerMode === 'skeleton') {
          this.heartGroup.scale.set(0.04, 0.03, 0.04);
        } else {
          const isXR = this.renderer.xr.isPresenting || this.appMode === 'ar' || this.appMode === 'vr' || this.appMode === 'xr';
          const s = isXR ? 0.6 : 1.1;
          this.heartGroup.scale.setScalar(s);
        }
      }
    }

    // 3. Heartbeat Animation Squeeze
    if (this.heartGroup && this.isBeating) {

      let beatScaleVal = this.getHeartbeatScale(elapsedTime, this.bpm);
      if (this.isReducedCompliance) {
        beatScaleVal *= 0.25; // stiff ventricles restrict dilation
      }
      const isRealistic = this.heartGroup.userData && this.heartGroup.userData.isRealisticModel;

      this.heartGroup.traverse(node => {
        // Scale meshes with registered original scales (supporting deep node structures of GLTF)
        if (node.isMesh && node.userData && node.userData.originalScale) {
          const original = node.userData.originalScale;
          let factor = 1.0;
          const partName = node.userData.nameId || node.name;

          if (isRealistic) {
            // Realistic model: unified organ pulsing
            factor = 1.0 - beatScaleVal * 0.55;
          } else if (partName === 'left_ventricle' || partName === 'right_ventricle') {
            factor = 1.0 - beatScaleVal; // squeeze during ventricular contraction
          } else if (partName === 'left_atrium' || partName === 'right_atrium') {
            // Atrial beating has opposite phase
            const atrialScaleVal = this.getHeartbeatScale(elapsedTime + (60 / this.bpm) * 0.2, this.bpm);
            factor = 1.0 - atrialScaleVal * 0.8;
          } else {
            // Vessels expand slightly due to blood surge during vent contraction
            factor = 1.0 + beatScaleVal * 0.15;
          }

          // Apply cardiac hypertrophy modifier (only Left Ventricle thickened)
          let hypertrophyFactorX = 1.0;
          let hypertrophyFactorY = 1.0;
          let hypertrophyFactorZ = 1.0;
          if ((this.diseaseMode === 'hypertrophy' || this.isSeptumThickened) && (partName === 'left_ventricle' || isRealistic)) {
            hypertrophyFactorX = 1.45;
            hypertrophyFactorY = 1.2;
            hypertrophyFactorZ = 1.45;
          }

          node.scale.set(
            original.x * factor * hypertrophyFactorX,
            original.y * factor * hypertrophyFactorY,
            original.z * factor * hypertrophyFactorZ
          );
        }
      });
    }

    // 3b. Selection Breathing Highlight Animation (Pulsing isolated part)
    if (this.selectedMesh && this.selectedMesh !== this.heartGroup) {
      const selectedPulse = 1.0 + Math.sin(elapsedTime * 6.0) * 0.05;
      this.selectedMesh.traverse(node => {
        if (node.isMesh && node.userData && node.userData.originalScale) {
          const original = node.userData.originalScale;
          node.scale.set(
            original.x * selectedPulse,
            original.y * selectedPulse,
            original.z * selectedPulse
          );
        }
      });
    }

    // 4. Update Blood Flow Particles
    if (this.isFlowing && this.particles) {
      // Speed scales proportionally with Heart BPM, and is modified by disease mode
      let speedCoeff = this.bpm / 72;
      if (this.diseaseMode === 'valve') {
        // Erratically flow backwards/reflux (oscillates forward and backward)
        speedCoeff *= 0.5 * Math.sin(elapsedTime * 4.5);
      }
      if (this.isRegurgitant) {
        speedCoeff = -1.2 * Math.sin(elapsedTime * 6.0); // reverse flow
      }
      updateBloodFlowParticles(this.particles, speedCoeff);
    }

    // 7. Exploded View component translation lerp
    if (this.heartGroup) {
      const isRealistic = this.heartGroup.userData && this.heartGroup.userData.isRealisticModel;
      // Exploded view works with procedural model (named meshes) but not realistic GLB
      if (!isRealistic) {
        Object.keys(this.explodedOffsets).forEach(key => {
          const mesh = this.heartGroup.getObjectByName(key);
          if (mesh) {
            const originalPos = mesh.userData.originalPosition;
            const targetPos = originalPos.clone();
            if (this.isExploded) {
              targetPos.add(this.explodedOffsets[key]);
            }
            mesh.position.lerp(targetPos, 0.1);
          }
        });
      }
    }

    // Pulse custom visuals
    const conduction = this.scene.getObjectByName("conduction_visuals");
    if (conduction) {
      conduction.traverse(node => {
        if (node.isMesh) {
          node.scale.setScalar(1.0 + Math.sin(elapsedTime * 10) * 0.1);
        }
      });
    }

    const blockage = this.scene.getObjectByName("blockage_visuals");
    if (blockage) {
      blockage.traverse(node => {
        if (node.isMesh) {
          node.scale.setScalar(1.0 + Math.sin(elapsedTime * 12) * 0.15);
        }
      });
    }

    // Trigger VR controller haptic pulses in sync with heartbeat animation (lub-dub pulse)
    if (this.appMode === 'vr' && this.isBeating && this.vrManager) {
      const period = 60 / this.bpm;
      const phase = (elapsedTime % period) / period;
      const beatIndex = Math.floor(elapsedTime / period);

      // Ventricular systole pulse (Lub)
      if (beatIndex !== this.lastTriggeredBeatIndex && phase > 0.18 && phase < 0.24) {
        this.lastTriggeredBeatIndex = beatIndex;
        // Trigger vibration on VR controllers
        this.vrManager.triggerVRHaptic(this.vrManager.controller1, 0.65, 90);
        this.vrManager.triggerVRHaptic(this.vrManager.controller2, 0.65, 90);

        // Diastolic/Atrial rebound pulse (Dub) after a short latency delay
        setTimeout(() => {
          if (this.appMode === 'vr' && this.isBeating && this.vrManager) {
            this.vrManager.triggerVRHaptic(this.vrManager.controller1, 0.35, 70);
            this.vrManager.triggerVRHaptic(this.vrManager.controller2, 0.35, 70);
          }
        }, 220);
      }
    }

    // 5. Update HTML Label coordinates projecting on screen
    this.updateLabelsProjection();

    // 6. Render call
    this.renderer.render(this.scene, this.camera);
  }

  // Toggles Transparency Mode to reveal internal blood flow chambers
  setTransparencyMode(enabled) {
    this.isTransparency = enabled;
    if (!this.heartGroup) return;

    if (enabled) {
      this.setVisualizerMode('focused');
    }

    if (this.selectedMesh && this.selectedMesh.userData && this.selectedMesh.userData._selectedNameId) {
      // Re-run selectAnatomy to recalculate the visibility/opacities based on new transparency state
      this.selectAnatomy(this.selectedMesh.userData._selectedNameId);
    } else {
      // No active selection: just set the normal transparency opacities
      const isRealistic = this.heartGroup.userData && this.heartGroup.userData.isRealisticModel;
      this.heartGroup.traverse(node => {
        if (node.isMesh) {
          const partName = node.userData ? node.userData.nameId : null;
          const isOuterWall = isRealistic ||
            (partName === 'left_ventricle' || partName === 'right_ventricle' ||
              partName === 'left_atrium' || partName === 'right_atrium');

          const mats = Array.isArray(node.material) ? node.material : [node.material];
          mats.forEach(mat => {
            if (mat) {
              if (isOuterWall) {
                mat.transparent = true;
                mat.opacity = enabled ? 0.22 : (mat.userData && mat.userData.originalOpacity !== undefined ? mat.userData.originalOpacity : 1.0);
              } else {
                mat.transparent = true;
                mat.opacity = mat.userData && mat.userData.originalOpacity !== undefined ? mat.userData.originalOpacity : 1.0;
              }
              mat.needsUpdate = true;
            }
          });
          node.visible = true;
        }
      });
      if (this.particles) {
        this.particles.visible = this.isFlowing;
      }
    }
  }

  // Toggles Exploded View to separate components or widen labels projection layout
  setExplodedMode(enabled) {
    this.isExploded = enabled;
    if (enabled) {
      this.setVisualizerMode('focused');
    }
  }

  // Sets Disease Comparison mode modifying BPM, textures, or shapes
  setDiseaseMode(mode) {
    this.diseaseMode = mode;
    if (!this.heartGroup || !this.materials) return;

    if (mode !== 'healthy') {
      this.setVisualizerMode('focused');
    }

    // Reset speeds, colors, and textures to healthy state first
    this.bpm = 72;
    const bpmSlider = document.getElementById('slider-pulse-rate');
    const bpmVal = document.getElementById('pulse-rate-val');

    // Restore original materials colors
    this.heartGroup.traverse(node => {
      if (node.isMesh && node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach(mat => {
          const od = mat.userData;
          if (od && od.originalColor !== undefined) {
            if (mat.color) mat.color.setHex(od.originalColor);
          }
        });
      }
    });

    if (mode === 'healthy') {
      this.bpm = 72;
      this.speakNarration("Displaying a healthy human cardiovascular system. Normal sinus rhythm is active at 72 beats per minute.");
    }
    else if (mode === 'infarction') {
      // irregular/slow BPM simulating heart muscle attack
      this.bpm = 48;
      // Change Left Ventricle meshes to grayish blue (ischemic/dead tissue)
      let foundLV = false;
      this.heartGroup.traverse(node => {
        if (node.isMesh && node.userData && node.userData.nameId === 'left_ventricle') {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          mats.forEach(mat => {
            if (mat && mat.color) mat.color.setHex(0x334155);
          });
          foundLV = true;
        }
      });
      // If no LV found, apply ischemic discoloration to all meshes
      if (!foundLV) {
        this.heartGroup.traverse(node => {
          if (node.isMesh && node.material && node.material.color) {
            node.material.color.setHex(0x5a5566);
          }
        });
      }
      this.speakNarration("Myocardial Infarction mode loaded. The heart rate is depressed to 48 beats per minute due to localized ischemia. Notice the discoloration representing muscle tissue death.");
    }
    else if (mode === 'valve') {
      // Tachycardia compensation
      this.bpm = 105;
      this.speakNarration("Mitral valve disease simulation active. Compensating with a elevated heart rate of 105 beats per minute. Colored blood cells exhibit regurgitation and backflow inside the chambers.");
    }
    else if (mode === 'hypertrophy') {
      // Thickened Left Ventricle wall
      this.bpm = 88;
      this.speakNarration("Cardiac Hypertrophy loaded. Left ventricular walls are pathologically enlarged and thickened to combat systemic resistance, leading to decreased chamber volume.");
    }

    if (bpmSlider && bpmVal) {
      bpmSlider.value = this.bpm;
      bpmVal.textContent = `${this.bpm} BPM`;
    }
  }

  speakNarration(text) {
    if (this.voiceEngine) {
      this.voiceEngine.speak(text);
    }
  }

  // Create a 3D Canvas-textured UI panel inside VR space
  createVRInfoPanel() {
    if (this.vrInfoPanel) {
      this.scene.remove(this.vrInfoPanel);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 1536;
    canvas.height = 1152;
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: true
    });

    const geometry = new THREE.PlaneGeometry(1.2, 0.9);
    this.vrInfoPanel = new THREE.Mesh(geometry, material);
    this.vrInfoPanel.name = "vr_info_panel";

    // Set position dynamically based on appMode and height alignment references
    if (this.appMode === 'vr') {
      const isFloorSpace = (this.xrReferenceSpaceType === 'local-floor');
      const panelY = isFloorSpace ? 1.3 : 0.0;
      this.vrInfoPanel.position.set(1.8, panelY, -2.0);
      this.vrInfoPanel.rotation.set(0, -Math.atan2(1.8, 2.0), 0);
    } else if (this.appMode === 'ar') {
      const isFloorSpace = (this.xrReferenceSpaceType === 'local-floor');
      const panelY = isFloorSpace ? 1.2 : 0.0;
      // Restore original AR default position:
      this.vrInfoPanel.position.set(0.9, panelY, -1.2);
      this.vrInfoPanel.rotation.set(0, -Math.PI / 6, 0);
    } else {
      this.vrInfoPanel.position.set(0.9, 0.65, -0.6);
      this.vrInfoPanel.rotation.set(0, -Math.PI / 6, 0);
    }

    this.vrInfoPanel.visible = false;
    this.scene.add(this.vrInfoPanel);
  }

  // Redraws the 3D VR Panel with medical data or Quiz details
  updateVRInfoPanel(nameId) {
    if (!this.vrInfoPanel) this.createVRInfoPanel();
    if (!nameId || !HeartData[nameId]) {
      this.vrInfoPanel.visible = false;
      return;
    }

    const data = HeartData[nameId];
    const canvas = this.vrInfoPanel.material.map.image;
    const ctx = canvas.getContext('2d');

    // Background Panel Paint (Clear previous draw first to prevent semi-transparent blend accumulation)
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(10, 18, 30, 0.95)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 18; // 6 * 3
    ctx.strokeRect(9, 9, canvas.width - 18, canvas.height - 18);

    // Title
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 78px Outfit, Arial, sans-serif'; // 26 * 3
    ctx.fillText(data.name, 90, 135); // 30*3, 45*3

    // Close Button Box (top right)
    ctx.fillStyle = 'rgba(255, 77, 77, 0.15)';
    ctx.strokeStyle = '#ff4d4d';
    ctx.lineWidth = 6; // 2 * 3
    ctx.fillRect(1230, 54, 216, 84); // 410*3, 18*3, 72*3, 28*3
    ctx.strokeRect(1230, 54, 216, 84);

    ctx.fillStyle = '#ff4d4d';
    ctx.font = 'bold 39px Outfit, sans-serif'; // 13 * 3
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('CLOSE [X]', 1251, 108); // 417*3, 36*3

    // Divider Line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 6; // 2 * 3
    ctx.beginPath();
    ctx.moveTo(90, 195); // 30*3, 65*3
    ctx.lineTo(canvas.width - 90, 195);
    ctx.stroke();

    // Helper text-wrap function
    const wrapText = (text, x, y, maxWidth, lineHeight) => {
      ctx.font = 'bold 51px Outfit, sans-serif';
      ctx.fillStyle = '#f0f4ff';
      ctx.textAlign = 'left';
      const words = text.split(' ');
      let line = '';
      for (let n = 0; n < words.length; n++) {
        let testLine = line + words[n] + ' ';
        let metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && n > 0) {
          ctx.fillText(line, x, y);
          line = words[n] + ' ';
          y += lineHeight;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, x, y);
      return y + lineHeight;
    };

    let startY = 285; // 95 * 3
    ctx.fillStyle = '#a855f7'; // purple header
    ctx.font = 'bold 51px Outfit, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ANATOMICAL FUNCTION', 90, startY);
    startY = wrapText(data.function, 90, startY + 69, canvas.width - 180, 63) + 24;

    ctx.fillStyle = '#a855f7';
    ctx.font = 'bold 51px Outfit, sans-serif';
    ctx.fillText('CLINICAL SIGNIFICANCE', 90, startY);
    startY = wrapText(data.clinical, 90, startY + 69, canvas.width - 180, 63) + 24;

    ctx.fillStyle = '#a855f7';
    ctx.font = 'bold 51px Outfit, sans-serif';
    ctx.fillText('BLOOD FLOW DESCRIPTION', 90, startY);
    wrapText(data.explanation, 90, startY + 69, canvas.width - 180, 63);

    // Update texture map and make visible in VR modes
    this.vrInfoPanel.material.map.needsUpdate = true;
    this.vrInfoPanel.visible = (this.appMode !== 'desktop');
  }

  // Create a 3D Canvas-textured Simulation Control Panel inside VR space
  createVRControlPanel() {
    if (this.vrControlPanel) {
      this.scene.remove(this.vrControlPanel);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 1536;
    canvas.height = 1152;
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: true
    });

    const geometry = new THREE.PlaneGeometry(1.2, 0.9);
    this.vrControlPanel = new THREE.Mesh(geometry, material);
    this.vrControlPanel.name = "vr_control_panel";

    // Set position dynamically based on appMode and height alignment references
    if (this.appMode === 'vr') {
      const isFloorSpace = (this.xrReferenceSpaceType === 'local-floor');
      const panelY = isFloorSpace ? 1.3 : 0.0;
      this.vrControlPanel.position.set(-1.8, panelY, -2.0);
      this.vrControlPanel.rotation.set(0, Math.atan2(1.8, 2.0), 0);
    } else if (this.appMode === 'ar') {
      const isFloorSpace = (this.xrReferenceSpaceType === 'local-floor');
      const panelY = isFloorSpace ? 1.2 : 0.0;
      // Restore original AR default position:
      this.vrControlPanel.position.set(-0.9, panelY, -1.2);
      this.vrControlPanel.rotation.set(0, Math.PI / 6, 0);
    } else {
      this.vrControlPanel.position.set(-0.9, 0.65, -0.6);
      this.vrControlPanel.rotation.set(0, Math.PI / 6, 0);
    }

    this.vrControlPanel.visible = false;
    this.scene.add(this.vrControlPanel);
  }

  // Redraws the 3D VR Control Panel with current toggled statuses
  // Redraws the 3D VR Control Panel with current toggled statuses
  updateVRControlPanel() {
    if (!this.vrControlPanel) this.createVRControlPanel();

    const canvas = this.vrControlPanel.material.map.image;
    const ctx = canvas.getContext('2d');

    // Background Panel Paint (Clear previous draw first to prevent semi-transparent blend accumulation)
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(10, 18, 30, 0.95)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#a855f7'; // Purple border
    ctx.lineWidth = 18; // 6 * 3
    ctx.strokeRect(9, 9, canvas.width - 18, canvas.height - 18);

    // Title
    ctx.fillStyle = '#a855f7';
    ctx.font = 'bold 72px Outfit, Arial, sans-serif'; // 24 * 3
    ctx.fillText('Simulation Controls', 90, 135); // 30*3, 45*3

    // Divider Line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 6; // 2 * 3
    ctx.beginPath();
    ctx.moveTo(90, 180); // 30*3, 60*3
    ctx.lineTo(canvas.width - 90, 180);
    ctx.stroke();

    // Helper to draw a button
    const drawButton = (text, x, y, w, h, isActive) => {
      ctx.fillStyle = isActive ? 'rgba(0, 240, 255, 0.18)' : 'rgba(255, 255, 255, 0.05)';
      ctx.strokeStyle = isActive ? '#00f0ff' : 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 9; // 3 * 3
      
      // Draw rounded rect
      const r = 30; // 10 * 3
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Draw text
      ctx.fillStyle = isActive ? '#00f0ff' : '#cbd5e1';
      ctx.font = 'bold 45px Outfit, sans-serif'; // 15 * 3
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + w / 2, y + h / 2);
    };

    // Row 1 (values scaled by 3)
    drawButton(this.isBeating ? 'Heartbeat: ON' : 'Heartbeat: OFF', 120, 240, 600, 132, this.isBeating);
    drawButton(this.isFlowing ? 'Blood Flow: ON' : 'Blood Flow: OFF', 816, 240, 600, 132, this.isFlowing);

    // Row 2
    drawButton(this.isTransparency ? 'Transparency: ON' : 'Transparency: OFF', 120, 420, 600, 132, this.isTransparency);

    // Row 3
    drawButton(this.showLabels ? 'Anatomy Labels: ON' : 'Anatomy Labels: OFF', 120, 600, 600, 132, this.showLabels);
    drawButton('Controls Guide', 816, 600, 600, 132, false);

    // Row 4
    drawButton('Reset Scene Space', 468, 780, 600, 132, false);

    this.vrControlPanel.material.map.needsUpdate = true;
    this.vrControlPanel.visible = (this.appMode === 'vr');
  }

  // Handle raycast click on specific control panel coordinate options
  handleVRControlClick(x, y) {
    let toggled = false;
    let descriptionText = "";
    let titleText = "";

    // Row 1
    if (x >= 40 && x <= 240 && y >= 80 && y <= 124) {
      const newState = !this.isBeating;
      this.isBeating = newState;
      // Sync DOM
      const beatSwitch = document.getElementById('switch-beat');
      if (beatSwitch) beatSwitch.checked = newState;
      
      toggled = true;
      titleText = "Heartbeat Animation";
      descriptionText = newState 
        ? "Heartbeat animation is now ACTIVE. The chambers contract and expand realistically simulating a cardiac cycle at the specified BPM rate."
        : "Heartbeat animation has been PAUSED. The heart is in a static diastolic state, allowing close physical study of stationary relationships.";
    }
    else if (x >= 272 && x <= 472 && y >= 80 && y <= 124) {
      const newState = !this.isFlowing;
      this.setBloodFlowEnabled(newState);
      const flowSwitch = document.getElementById('switch-flow');
      if (flowSwitch) flowSwitch.checked = newState;

      toggled = true;
      titleText = "Blood Flow Particle System";
      descriptionText = newState
        ? "Blood Flow particle visualization is now ACTIVE. Crimson oxygenated cells and deep blue deoxygenated cells track directional flows inside the ventricles and vessels."
        : "Blood Flow particle system is now DISABLED. All active micro-particles are hidden to allow an unobstructed view of internal muscular and tissue walls.";
    }
    // Row 2
    else if (x >= 40 && x <= 240 && y >= 140 && y <= 184) {
      const newState = !this.isTransparency;
      this.setTransparencyMode(newState);
      const transSwitch = document.getElementById('switch-transparency');
      if (transSwitch) transSwitch.checked = newState;

      toggled = true;
      titleText = "Transparency Mode";
      descriptionText = newState
        ? "Transparency mode is now ACTIVE. Outer muscular tissue becomes translucent, revealing the internal chambers, valves, and blood flow paths in real-time."
        : "Transparency mode is now DISABLED. Fully opaque muscular walls are restored, showing the external vascular structures and fat layers of the heart.";
    }

    // Row 3
    else if (x >= 40 && x <= 240 && y >= 200 && y <= 244) {
      const newState = !this.showLabels;
      this.setLabelsEnabled(newState);
      const labelsSwitch = document.getElementById('switch-labels');
      if (labelsSwitch) labelsSwitch.checked = newState;

      toggled = true;
      titleText = "Anatomy Label Tags";
      descriptionText = newState
        ? "3D Anatomy labels are now VISIBLE. Floating labels highlight key structures (atria, ventricles, aorta, vena cava, etc.) with physical connecting lines."
        : "3D Anatomy labels are now HIDDEN. Text tags and connecting lines have been cleared for a clean view of the cardiac structures.";
    }
    else if (x >= 272 && x <= 472 && y >= 200 && y <= 244) {
      this.showVRControlsGuide();
      return;
    }
    // Row 4
    else if (x >= 156 && x <= 356 && y >= 260 && y <= 304) {
      this.resetScene();
      const rotSlider = document.getElementById('slider-rotation-speed');
      if (rotSlider) rotSlider.value = 0.0;
      const transSwitch = document.getElementById('switch-transparency');
      if (transSwitch) transSwitch.checked = false;

      const labelsSwitch = document.getElementById('switch-labels');
      if (labelsSwitch) labelsSwitch.checked = true;

      toggled = true;
      titleText = "System Reset Space";
      descriptionText = "All simulation parameters (heartbeat, blood flow, cross sections, scales, rotations, positions, and offsets) have been reset to factory defaults.";
    }

    if (toggled) {
      // Pulse animation: expand the heart scale slightly and shrink it back to give mechanical feedback
      if (this.heartGroup) {
        const baseScale = this.heartGroup.scale.x; // dynamically query current scale factor
        this.heartGroup.scale.setScalar(baseScale * 1.22);
        let elapsed = 0;
        const interval = setInterval(() => {
          elapsed += 16;
          const factor = elapsed / 250;
          if (factor >= 1.0) {
            this.heartGroup.scale.setScalar(baseScale);
            clearInterval(interval);
          } else {
            // Lerp scale back to baseScale
            const current = (baseScale * 1.22) * (1.0 - factor) + baseScale * factor;
            this.heartGroup.scale.setScalar(current);
          }
        }, 16);
      }

      this.updateVRControlPanel();
      this.showVRSimulationInfo(titleText, descriptionText);
    }
  }

  // Draw simulation function description onto the VR Info Panel
  showVRSimulationInfo(titleText, descriptionText) {
    if (!this.vrInfoPanel) this.createVRInfoPanel();

    const canvas = this.vrInfoPanel.material.map.image;
    const ctx = canvas.getContext('2d');

    // Background Paint
    ctx.fillStyle = 'rgba(10, 18, 30, 0.95)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);

    // Title
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 26px Outfit, Arial, sans-serif';
    ctx.fillText(titleText, 30, 45);

    // Close Button Box
    ctx.fillStyle = 'rgba(255, 77, 77, 0.15)';
    ctx.strokeStyle = '#ff4d4d';
    ctx.lineWidth = 2;
    ctx.fillRect(410, 18, 72, 28);
    ctx.strokeRect(410, 18, 72, 28);

    ctx.fillStyle = '#ff4d4d';
    ctx.font = 'bold 13px Outfit, sans-serif';
    ctx.fillText('CLOSE [X]', 417, 36);

    // Divider Line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(30, 65);
    ctx.lineTo(canvas.width - 30, 65);
    ctx.stroke();

    const wrapText = (text, x, y, maxWidth, lineHeight) => {
      ctx.font = '16px sans-serif';
      ctx.fillStyle = '#e2e8f0';
      const words = text.split(' ');
      let line = '';
      for (let n = 0; n < words.length; n++) {
        let testLine = line + words[n] + ' ';
        let metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && n > 0) {
          ctx.fillText(line, x, y);
          line = words[n] + ' ';
          y += lineHeight;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, x, y);
    };

    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 16px Outfit, sans-serif';
    ctx.fillText('SIMULATION STATUS', 30, 95);
    wrapText(descriptionText, 30, 120, canvas.width - 60, 22);

    if (this.voiceEngine) {
      this.voiceEngine.speak(`${titleText}. ${descriptionText}`);
    }

    this.vrInfoPanel.material.map.needsUpdate = true;
    this.vrInfoPanel.visible = true;
  }

  // Draw detailed controls guide onto the VR Info Panel
  showVRControlsGuide() {
    if (!this.vrInfoPanel) this.createVRInfoPanel();

    const canvas = this.vrInfoPanel.material.map.image;
    const ctx = canvas.getContext('2d');

    // Background Paint (Clear previous draw first to prevent semi-transparent blend accumulation)
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(10, 18, 30, 0.95)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 18; // 6 * 3
    ctx.strokeRect(9, 9, canvas.width - 18, canvas.height - 18);

    // Title
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 72px Outfit, Arial, sans-serif'; // 24 * 3
    ctx.fillText('VR Controls Guide', 90, 135); // 30*3, 45*3

    // Close Button Box
    ctx.fillStyle = 'rgba(255, 77, 77, 0.15)';
    ctx.strokeStyle = '#ff4d4d';
    ctx.lineWidth = 6; // 2 * 3
    ctx.fillRect(1230, 54, 216, 84); // 410*3, 18*3, 72*3, 28*3
    ctx.strokeRect(1230, 54, 216, 84);

    ctx.fillStyle = '#ff4d4d';
    ctx.font = 'bold 39px Outfit, sans-serif'; // 13 * 3
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('CLOSE [X]', 1251, 108); // 417*3, 36*3

    // Divider Line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 6; // 2 * 3
    ctx.beginPath();
    ctx.moveTo(90, 195); // 30*3, 65*3
    ctx.lineTo(canvas.width - 90, 195);
    ctx.stroke();

    const controlsList = [
      { key: 'Triggers:', desc: 'Point and select anatomy or press panel buttons.' },
      { key: 'Grips:', desc: 'Grab heart (one/two hands) to move & scale.' },
      { key: 'R Thumbstick:', desc: 'Rotate heart (or scale it when grabbed).' },
      { key: 'L Thumbstick:', desc: 'Locomotion movement on floor grid.' },
      { key: 'Button A:', desc: 'Toggle Heartbeat contraction animation.' },
      { key: 'Button B:', desc: 'Toggle Controls Guide (this screen).' },
      { key: 'Buttons X / Y:', desc: 'Toggle Blood Flow / Transparency.' }
    ];

    let startY = 264; // 88 * 3
    controlsList.forEach(item => {
      ctx.fillStyle = '#a855f7'; // Purple header/label
      ctx.font = 'bold 45px Outfit, sans-serif'; // 15 * 3
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.key, 105, startY); // 35 * 3

      ctx.fillStyle = '#e2e8f0'; // White descriptions
      ctx.font = '42px sans-serif'; // 14 * 3
      ctx.fillText(item.desc, 465, startY); // 155 * 3

      startY += 114; // 38 * 3
    });

    if (this.voiceEngine) {
      this.voiceEngine.speak("Loading virtual reality controls guide on screen.");
    }

    this.vrInfoPanel.material.map.needsUpdate = true;
    this.vrInfoPanel.visible = true;
  }

  // Interactive Sub-flow controllers
  toggleElectricalConduction(enabled) {
    this.showElectricalConduction = enabled;
    if (!this.heartGroup) return;

    if (this.conductionGroup) {
      this.heartGroup.remove(this.conductionGroup);
      this.conductionGroup = null;
    }

    if (enabled) {
      this.conductionGroup = new THREE.Group();
      this.conductionGroup.name = "conduction_visuals";

      const saGeo = new THREE.SphereGeometry(0.04, 16, 16);
      const nodeMat = new THREE.MeshBasicMaterial({ color: 0xffd700 }); // gold
      const saNode = new THREE.Mesh(saGeo, nodeMat);
      saNode.position.set(0.18, 0.25, 0.1);
      this.conductionGroup.add(saNode);

      const avNode = new THREE.Mesh(saGeo, nodeMat);
      avNode.position.set(0.05, 0.1, 0.05);
      this.conductionGroup.add(avNode);

      const fiberGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0.18, 0.25, 0.1),
        new THREE.Vector3(0.05, 0.1, 0.05)
      ]);
      const fiberMat = new THREE.LineBasicMaterial({ color: 0xffd700, linewidth: 2 });
      const fiber = new THREE.Line(fiberGeo, fiberMat);
      this.conductionGroup.add(fiber);

      this.heartGroup.add(this.conductionGroup);
    }
  }

  toggleCardiacOutput(enabled) {
    this.isOptimalOutput = enabled;
    if (enabled) {
      this.bpm = 75;
      const bpmVal = document.getElementById('pulse-rate-val');
      const bpmSlider = document.getElementById('slider-pulse-rate');
      if (bpmVal) bpmVal.textContent = "75 BPM (Optimal)";
      if (bpmSlider) bpmSlider.value = 75;
    }
  }

  toggleArteryBlockage(enabled) {
    this.showArteryBlockage = enabled;
    if (!this.heartGroup) return;

    if (this.blockageGroup) {
      this.heartGroup.remove(this.blockageGroup);
      this.blockageGroup = null;
    }

    if (enabled) {
      this.blockageGroup = new THREE.Group();
      this.blockageGroup.name = "blockage_visuals";

      const ringGeo = new THREE.RingGeometry(0.03, 0.04, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(0.15, 0.05, 0.25);
      this.blockageGroup.add(ring);

      const sphereGeo = new THREE.SphereGeometry(0.02, 16, 16);
      const sphere = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xff3333 }));
      sphere.position.set(0.15, 0.05, 0.25);
      this.blockageGroup.add(sphere);

      this.heartGroup.add(this.blockageGroup);
    }
  }

  toggleArrhythmia(enabled) {
    this.isArrhythmia = enabled;
    if (!enabled) {
      this.bpm = 72;
      const bpmVal = document.getElementById('pulse-rate-val');
      const bpmSlider = document.getElementById('slider-pulse-rate');
      if (bpmVal) bpmVal.textContent = "72 BPM";
      if (bpmSlider) bpmSlider.value = 72;
    }
  }

  toggleValveCalcification(enabled) {
    this.isValveCalcified = enabled;
    if (!this.heartGroup) return;
    this.heartGroup.traverse(node => {
      if (node.isMesh && node.userData && (node.userData.nameId === 'aorta' || node.userData.nameId === 'left_ventricle')) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach(mat => {
          if (mat && mat.color) {
            if (enabled) {
              mat.color.setHex(0xf1f5f9); // chalky calcified white
            } else {
              const od = mat.userData;
              if (od && od.originalColor !== undefined) {
                mat.color.setHex(od.originalColor);
              }
            }
          }
        });
      }
    });
  }

  toggleRegurgitantBackflow(enabled) {
    this.isRegurgitant = enabled;
  }

  toggleSeptumThickened(enabled) {
    this.isSeptumThickened = enabled;
  }

  toggleDiastolicFilling(enabled) {
    this.isReducedCompliance = enabled;
  }
}
