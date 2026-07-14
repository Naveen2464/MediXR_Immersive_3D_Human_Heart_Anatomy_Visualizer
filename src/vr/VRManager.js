// WebXR VR Laboratory Session Manager for MediXR
// Fully mapped for Zapbox 6DoF controllers with raycaster support
import { HeartData } from '../utils/HeartData.js';

export class VRManager {
  constructor(engine) {
    this.engine = engine;
    this.session = null;

    // VR specific environment objects
    this.vrEnvironment = null;
    this.controllers = [];
    this.controllerGrips = [];
    this.controllerModels = [];
    this.activeGrabbers = [];
    this.initialGrabDist = 0;
    this.initialHeartScale = new THREE.Vector3();

    // Zapbox 6DoF controller state tracking
    this.controllerStates = [
      { connected: false, handedness: 'none', hasGamepad: false },
      { connected: false, handedness: 'none', hasGamepad: false }
    ];

    // Raycaster hit visualization (laser dot on surface)
    this.hitMarkers = [];
  }

  // Check if immersive VR is supported on the device
  async checkAvailability() {
    if (navigator.xr) {
      const btn = document.getElementById('btn-vr');
      if (btn) {
        btn.classList.remove('disabled');
        btn.removeAttribute('disabled');
        console.log("VRManager: WebXR detected. Enabling VR button.");
      }
    }
  }

  // Start the VR session
  async startSession() {
    if (!navigator.xr) return;
    try {
      this.session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local', 'local-floor', 'hand-tracking']
      });

      console.log("VRManager: WebXR VR session started.");

      // Force renderer to be fully opaque for VR mode (fixes iOS WebXR transparency stereo bugs)
      this.engine.renderer.setClearColor(0x050a12, 1.0);
      this.engine.renderer.setClearAlpha(1.0);

      // Default to 'local' reference space type synchronously to start the session immediately
      this.engine.setReferenceSpaceType('local');
      this.engine.renderer.xr.setSession(this.session);

      // Create a camera rig parent group to enable player locomotion movement
      this.cameraRig = new THREE.Group();
      this.cameraRig.name = "vr_camera_rig";
      this.engine.scene.add(this.cameraRig);
      this.cameraRig.add(this.engine.camera);

      // Create futuristic virtual laboratory podium, floor grid
      this.buildVRLabEnvironment(false); // default to local space layout
      this.setupControllers();
      this.engine.updateVRControlPanel();

      // Reposition heart group in front of the VR camera (further away: z = -2.5)
      if (this.engine.heartGroup) {
        this.engine.scene.add(this.engine.heartGroup); // Ensure attached to main scene
        this.engine.heartGroup.position.set(0, 0.0, -2.5);
        this.engine.heartGroup.scale.set(0.1, 0.1, 0.1);
        this.engine.heartGroup.visible = true; // Ensure visibility
      }

      // Query reference space asynchronously without blocking the main WebXR session startup thread
      this.session.requestReferenceSpace('local-floor').then((refSpace) => {
        console.log("VRManager: 'local-floor' reference space is active. Aligning heights...");
        // Tell Three.js manager to use local-floor
        this.engine.setReferenceSpaceType('local-floor');
        this.adjustEnvironmentHeight(true);
      }).catch((floorErr) => {
        console.warn("VRManager: 'local-floor' not available. Keeping 'local' space layout.");
        this.adjustEnvironmentHeight(false);
      });

      this.session.addEventListener('end', () => this.endSession());
      document.body.classList.add('xr-vr-active');

      // Log input sources for debugging Zapbox controllers
      this.session.addEventListener('inputsourceschange', (event) => {
        this.onInputSourcesChange(event);
      });

    } catch (error) {
      console.error("VRManager: Failed to start VR session: ", error);
      throw error;
    }
  }

  // Track Zapbox controller connections and capabilities
  onInputSourcesChange(event) {
    for (const source of event.added) {
      console.log(`VRManager: Controller connected — handedness: ${source.handedness}, profiles: [${source.profiles.join(', ')}]`);

      // Detect Zapbox-specific input profile
      const isZapbox = source.profiles.some(p =>
        p.includes('zapbox') || p.includes('zappar')
      );
      if (isZapbox) {
        console.log("VRManager: Zapbox 6DoF controller detected! Enabling transparent passthrough.");
        this.engine.renderer.setClearColor(0x000000, 0.0);
        this.engine.renderer.setClearAlpha(0.0);
        this.engine.scene.background = null;
      }
    }
    for (const source of event.removed) {
      console.log(`VRManager: Controller disconnected — handedness: ${source.handedness}`);
    }
  }

  buildVRLabEnvironment(isFloorSpace) {
    this.vrEnvironment = new THREE.Group();
    this.vrEnvironment.name = "vr_lab_environment";

    // Set height based on whether reference space is floor-relative (y=0) or viewer-relative (y=-1.6)
    const floorY = isFloorSpace ? 0 : -1.6;

    // 1. Futuristic Floor Grid
    const gridHelper = new THREE.GridHelper(30, 30, 0x00f0ff, 0x1e293b);
    gridHelper.position.y = floorY + 0.01;
    gridHelper.name = "grid_helper";
    this.vrEnvironment.add(gridHelper);

    // 2. Circular platform base
    const platformGeo = new THREE.CylinderGeometry(4, 4.2, 0.1, 32);
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.8,
      metalness: 0.2
    });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.y = floorY + 0.05;
    platform.name = "platform";
    this.vrEnvironment.add(platform);



    // 4. Background laboratory structural halos (sci-fi wall/cage feel)
    for (let i = 0; i < 3; i++) {
      const haloGeo = new THREE.TorusGeometry(8 + i * 2, 0.08, 16, 64);
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0x0066ff,
        transparent: true,
        opacity: 0.15 - i * 0.03
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.position.set(0, floorY + 4, -5);
      halo.rotation.y = Math.PI / 4 * i;
      halo.name = `halo_${i}`;
      this.vrEnvironment.add(halo);
    }

    // 5. Futuristic wireframe sky dome for laboratory look
    const domeGeo = new THREE.SphereGeometry(18, 16, 12);
    const domeMat = new THREE.MeshBasicMaterial({
      color: 0x0044aa,
      transparent: true,
      opacity: 0.12,
      wireframe: true,
      side: THREE.BackSide
    });
    const skyDome = new THREE.Mesh(domeGeo, domeMat);
    skyDome.position.y = floorY + 4;
    skyDome.name = "sky_dome";
    this.vrEnvironment.add(skyDome);

    // 7. Transparent Cylindrical Boundary Collider around platform (Radius = 4.0, height = 3.0)
    const boundaryGeo = new THREE.CylinderGeometry(4.0, 4.0, 3.0, 32, 1, true);
    const boundaryMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.boundaryCollider = new THREE.Mesh(boundaryGeo, boundaryMat);
    this.boundaryCollider.name = "platform_boundary_collider";
    this.boundaryCollider.position.y = floorY + 1.5;
    this.vrEnvironment.add(this.boundaryCollider);

    // 6. Glowing star particles (microdust environment)
    const starGeo = new THREE.BufferGeometry();
    const starCount = 150;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i += 3) {
      starPositions[i] = (Math.random() - 0.5) * 16;
      starPositions[i + 1] = Math.random() * 6 + floorY;
      starPositions[i + 2] = (Math.random() - 0.5) * 16;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0x00f0ff,
      size: 0.04,
      transparent: true,
      opacity: 0.6
    });
    const starParticles = new THREE.Points(starGeo, starMat);
    starParticles.name = "star_particles";
    this.vrEnvironment.add(starParticles);

    this.engine.scene.add(this.vrEnvironment);
  }

  // Adjusts the VR environment and heart coordinates dynamically after startup space is resolved
  adjustEnvironmentHeight(isFloorSpace) {
    // Keep environment relative to camera origin (eye level) for guaranteed visibility across all devices
    const floorY = isFloorSpace ? 0.0 : -1.6;
    const heartY = isFloorSpace ? 1.3 : 0.0;

    if (this.cameraRig) {
      this.cameraRig.position.y = isFloorSpace ? 1.2 : 0.0;
    }

    // Clear any active selection repositioning caches to align with new space coordinates
    this.engine.preSelectionHeartPosition = null;
    this.engine.preSelectionInfoPanelPosition = null;
    this.engine.preSelectionInfoPanelRotation = null;
    this.engine.targetHeartPosition = null;
    this.engine.targetInfoPanelPosition = null;
    this.engine.targetInfoPanelRotationY = undefined;

    // Adjust heart position to eye-level (y = heartY, z = -2.5)
    if (this.engine.heartGroup) {
      this.engine.heartGroup.position.set(0, heartY, -2.5);
    }

    // Adjust VR panel positions to chest level and rotate to face user exactly (further away)
    if (this.engine.vrControlPanel) {
      const panelY = isFloorSpace ? 1.3 : 0.0;
      this.engine.vrControlPanel.position.set(-1.8, panelY, -2.0);
      this.engine.vrControlPanel.rotation.set(0, Math.atan2(1.8, 2.0), 0);
    }
    if (this.engine.vrInfoPanel) {
      const panelY = isFloorSpace ? 1.3 : 0.0;
      this.engine.vrInfoPanel.position.set(1.8, panelY, -2.0);
      this.engine.vrInfoPanel.rotation.set(0, -Math.atan2(1.8, 2.0), 0);
    }

    // Adjust VR environment child positions if they exist
    if (this.vrEnvironment) {
      this.vrEnvironment.traverse(node => {
        if (node.name === 'grid_helper') {
          node.position.y = floorY + 0.01;
        } else if (node.name === 'platform') {
          node.position.y = floorY + 0.05;
        } else if (node.name === 'podium') {
          node.position.y = floorY + 0.45;
        } else if (node.name === 'glow_ring') {
          node.position.y = floorY + 0.86;
        } else if (node.name && node.name.startsWith('halo_')) {
          node.position.y = floorY + 4;
        } else if (node.name === 'sky_dome') {
          node.position.y = floorY + 4;
        } else if (node.name === 'star_particles') {
          node.position.y = floorY;
        } else if (node.name === 'platform_boundary_collider') {
          node.position.y = floorY + 1.5;
        }
      });
    }
  }

  setupControllers() {
    const renderer = this.engine.renderer;

    // Laser pointer geometry
    const laserGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1)
    ]);
    const laserMaterial = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.8
    });
    const laserLine = new THREE.Line(laserGeometry, laserMaterial);
    laserLine.name = 'laser';
    laserLine.scale.z = 5; // length of laser ray

    // Hit marker (small glowing sphere at raycast intersection)
    const hitMarkerGeo = new THREE.SphereGeometry(0.015, 12, 12);
    const hitMarkerMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.9
    });

    // Controller listeners — bind both controllers for Zapbox 6DoF
    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);

      // Add laser pointer
      const laser = laserLine.clone();
      laser.material = laserLine.material.clone(); // clone material to allow independent warning color shifts
      laser.visible = false; // Hide initially
      controller.add(laser);

      // Create hit marker for this controller
      const hitMarker = new THREE.Mesh(hitMarkerGeo, hitMarkerMat.clone());
      hitMarker.visible = false;
      this.engine.scene.add(hitMarker);
      this.hitMarkers.push(hitMarker);

      // Build visible 3D controller model (universal shape for Zapbox/generic)
      const controllerModel = this.createControllerModel(i);
      controller.add(controllerModel);
      this.controllerModels.push(controllerModel);

      // Zapbox triggers 'select' event on button press — bind both select and selectstart
      controller.addEventListener('select', (event) => this.onVRSelect(controller, i, event));
      controller.addEventListener('selectstart', (event) => this.onVRSelectStart(controller, i, event));
      controller.addEventListener('selectend', (event) => this.onVRSelectEnd(controller, i, event));
      controller.addEventListener('squeezestart', (event) => this.onVRSqueezeStart(controller, event));
      controller.addEventListener('squeezeend', (event) => this.onVRSqueezeEnd(controller, event));

      // Track connected state for debugging
      controller.addEventListener('connected', (event) => {
        const source = event.data;
        this.controllerStates[i] = {
          connected: true,
          handedness: source.handedness || 'none',
          hasGamepad: !!source.gamepad,
          profiles: source.profiles || [],
          inputSource: source
        };
        console.log(`VRManager: Controller ${i} connected — ${source.handedness}, gamepad: ${!!source.gamepad}, profiles: [${(source.profiles || []).join(', ')}]`);

        // Make controller model and laser visible
        controllerModel.visible = true;
        const l = controller.getObjectByName('laser');
        if (l) l.visible = true;
      });

      controller.addEventListener('disconnected', () => {
        this.controllerStates[i].connected = false;
        controllerModel.visible = false;
        const l = controller.getObjectByName('laser');
        if (l) l.visible = false;
        console.log(`VRManager: Controller ${i} disconnected.`);
      });

      if (this.cameraRig) {
        this.cameraRig.add(controller);
      } else {
        this.engine.scene.add(controller);
      }
      this.controllers.push(controller);

      // Controller grip space (for physical hand position)
      const controllerGrip = renderer.xr.getControllerGrip(i);
      if (this.cameraRig) {
        this.cameraRig.add(controllerGrip);
      } else {
        this.engine.scene.add(controllerGrip);
      }
      this.controllerGrips.push(controllerGrip);
    }

    console.log("VRManager: 6DoF controllers initialized with raycaster and haptic support.");
  }

  // Create a visible 3D controller model (works for Zapbox and generic WebXR controllers)
  createControllerModel(index) {
    const group = new THREE.Group();
    group.name = `controller_model_${index}`;

    // Controller body — capsule-like shape
    const bodyGeo = new THREE.CylinderGeometry(0.015, 0.02, 0.12, 12);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: index === 0 ? 0x00aaff : 0xff4488,
      roughness: 0.3,
      metalness: 0.7
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.rotation.x = Math.PI / 2; // align along Z axis (forward)
    group.add(body);

    // Trigger button indicator (small sphere at front)
    const triggerGeo = new THREE.SphereGeometry(0.01, 8, 8);
    const triggerMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff
    });
    const trigger = new THREE.Mesh(triggerGeo, triggerMat);
    trigger.position.set(0, 0.01, -0.06);
    trigger.name = 'trigger_indicator';
    group.add(trigger);

    // Glowing ring at emitter point
    const ringGeo = new THREE.RingGeometry(0.008, 0.012, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(0, 0, -0.065);
    group.add(ring);

    group.visible = false; // hidden until controller connects
    return group;
  }

  // Build ray from controller's 6DoF world matrix
  buildControllerRay(controller) {
    if (!controller) return new THREE.Ray();
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(controller.matrixWorld);

    const ray = new THREE.Ray();
    ray.origin.setFromMatrixPosition(controller.matrixWorld);
    ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    return ray;
  }

  // Perform raycasting from a 6DoF controller against the heart model (restrict to label buttons)
  raycastFromController(controller, controllerIndex) {
    if (!this.engine.heartGroup || !this.engine.spriteLabelsGroup) return null;

    const ray = this.buildControllerRay(controller);

    // 1. Primary: Direct 3D Sprite label button intersection
    this.engine.raycaster.ray.copy(ray);
    const intersects = this.engine.raycaster.intersectObjects(this.engine.spriteLabelsGroup.children, true);

    let hitObject = null;
    for (const hit of intersects) {
      if (hit.object.isSprite && hit.object.userData && hit.object.userData.nameId) {
        hitObject = hit;
        break;
      }
    }

    // Update hit marker visualization
    if (this.hitMarkers[controllerIndex]) {
      if (hitObject) {
        this.hitMarkers[controllerIndex].position.copy(hitObject.point);
        this.hitMarkers[controllerIndex].visible = true;
      } else {
        this.hitMarkers[controllerIndex].visible = false;
      }
    }

    if (hitObject) {
      const nameId = hitObject.object.userData.nameId;
      if (HeartData[nameId]) {
        return { nameId, point: hitObject.point, distance: hitObject.distance };
      }
    }

    // 2. Secondary: Fallback to ray-to-sprite position distance check
    let closestKey = null;
    let minDist = Infinity;
    const worldPos = new THREE.Vector3();

    this.engine.spriteLabelsGroup.children.forEach(child => {
      if (child.isSprite && child.userData && child.userData.nameId) {
        child.getWorldPosition(worldPos);
        const dist = ray.distanceToPoint(worldPos);
        if (dist < minDist) {
          minDist = dist;
          closestKey = child.userData.nameId;
        }
      }
    });

    // Tight threshold of 0.08 meters (8cm) to align with button pointer interaction
    if (closestKey && minDist < 0.08) {
      return { nameId: closestKey, point: null, distance: minDist };
    }

    return null;
  }

  // Zapbox fires 'select' (complete press+release) — use for primary interaction
  onVRSelect(controller, controllerIndex, event) {
    if (this.engine.hasDraggedInXR) {
      this.engine.hasDraggedInXR = false;
      return;
    }

    // 1. Raycast against VR Info Panel first to handle Close [X] button clicks
    if (this.engine.vrInfoPanel && this.engine.vrInfoPanel.visible) {
      const ray = this.buildControllerRay(controller);
      this.engine.raycaster.ray.copy(ray);
      const intersectsInfo = this.engine.raycaster.intersectObject(this.engine.vrInfoPanel);
      if (intersectsInfo.length > 0) {
        const uv = intersectsInfo[0].uv;
        // Check if hit UV coordinates match CLOSE [X] button (x in [0.80, 0.95], y in [0.87, 0.96])
        if (uv && uv.x >= 0.80 && uv.x <= 0.95 && uv.y >= 0.87 && uv.y <= 0.96) {
          console.log("VRManager: Close button clicked on VR Info Panel.");
          this.triggerVRHaptic(controller, 0.4, 60);
          this.engine.clearSelection();
          return;
        }
      }
    }

    // 1b. Raycast against VR Control Panel to handle button clicks
    if (this.engine.vrControlPanel && this.engine.vrControlPanel.visible) {
      const ray = this.buildControllerRay(controller);
      this.engine.raycaster.ray.copy(ray);
      const intersectsControl = this.engine.raycaster.intersectObject(this.engine.vrControlPanel);
      if (intersectsControl.length > 0) {
        const uv = intersectsControl[0].uv;
        if (uv) {
          const x = uv.x * 512;
          const y = (1 - uv.y) * 384;

          this.triggerVRHaptic(controller, 0.45, 70);
          this.engine.handleVRControlClick(x, y);
          return;
        }
      }
    }

    const hit = this.raycastFromController(controller, controllerIndex);

    if (hit) {
      this.triggerVRHaptic(controller, 0.4, 60);

      // Toggle selection: if already selected, clear it
      if (this.engine.selectedMesh &&
        this.engine.selectedMesh.userData &&
        this.engine.selectedMesh.userData.nameId === hit.nameId) {
        this.engine.clearSelection();
      } else {
        this.engine.selectAnatomy(hit.nameId);
      }

      // Flash the trigger indicator on the controller model
      this.flashTriggerIndicator(controllerIndex);
    } else {
      // Clicked empty air: clear selection
      this.engine.clearSelection();
    }
  }

  // selectstart — for grab initiation and continuous tracking
  onVRSelectStart(controller, controllerIndex, event) {
    if (event && event.data && event.data.targetRayMode === 'screen') {
      return;
    }
    // Visual feedback: highlight trigger indicator
    this.setTriggerState(controllerIndex, true);
  }

  // selectend — reset trigger visual
  onVRSelectEnd(controller, controllerIndex, event) {
    if (event && event.data && event.data.targetRayMode === 'screen') {
      return;
    }
    this.setTriggerState(controllerIndex, false);
  }

  // Flash trigger indicator on controller model
  flashTriggerIndicator(controllerIndex) {
    if (this.controllerModels[controllerIndex]) {
      const trigger = this.controllerModels[controllerIndex].getObjectByName('trigger_indicator');
      if (trigger) {
        trigger.material.color.setHex(0xff4444);
        setTimeout(() => {
          trigger.material.color.setHex(0x00f0ff);
        }, 150);
      }
    }
  }

  // Set trigger visual state (pressed/released)
  setTriggerState(controllerIndex, pressed) {
    if (this.controllerModels[controllerIndex]) {
      const trigger = this.controllerModels[controllerIndex].getObjectByName('trigger_indicator');
      if (trigger) {
        trigger.material.color.setHex(pressed ? 0xff8800 : 0x00f0ff);
        trigger.scale.setScalar(pressed ? 1.3 : 1.0);
      }
    }
  }

  // Restore scene to standard view
  endSession() {
    console.log("VRManager: VR Session ended.");
    this.session = null;

    // Restore renderer transparency for desktop/AR mode
    this.engine.renderer.setClearColor(0x050a12, 1.0);
    this.engine.renderer.setClearAlpha(1.0);

    // Remove environment
    if (this.vrEnvironment) {
      this.engine.scene.remove(this.vrEnvironment);
      this.vrEnvironment = null;
    }

    // Remove controllers and camera from rig, restore camera to scene root
    if (this.cameraRig) {
      this.controllers.forEach(c => this.cameraRig.remove(c));
      this.controllerGrips.forEach(g => this.cameraRig.remove(g));
      this.cameraRig.remove(this.engine.camera);
      this.engine.scene.add(this.engine.camera);
      this.engine.scene.remove(this.cameraRig);
      this.cameraRig = null;
    } else {
      this.controllers.forEach(c => this.engine.scene.remove(c));
      this.controllerGrips.forEach(g => this.engine.scene.remove(g));
    }
    this.hitMarkers.forEach(m => this.engine.scene.remove(m));
    this.controllers = [];
    this.controllerGrips = [];
    this.controllerModels = [];
    this.hitMarkers = [];

    // Reset controller states
    this.controllerStates = [
      { connected: false, handedness: 'none', hasGamepad: false },
      { connected: false, handedness: 'none', hasGamepad: false }
    ];

    // Ensure heart group visibility
    if (this.engine.heartGroup) {
      this.engine.heartGroup.visible = true;
    }
    this.activeGrabbers = [];
    this.engine.isGrabbed = false;

    document.body.classList.remove('xr-vr-active');
  }

  // Squeeze/grab: attach heart to controller for 6DoF repositioning
  onVRSqueezeStart(controller, event) {
    if (event && event.data && event.data.targetRayMode === 'screen') {
      return;
    }

    // Squeeze/grip button triggers selection clearing and panel closing
    console.log("VRManager: Squeeze/grip pressed. Clearing active selections.");
    this.triggerVRHaptic(controller, 0.4, 60);
    this.engine.clearSelection();

    if (!this.engine.heartGroup) return;

    const ray = this.buildControllerRay(controller);
    this.engine.raycaster.ray.copy(ray);

    const intersects = this.engine.raycaster.intersectObjects(this.engine.heartGroup.children, true);
    if (intersects.length > 0) {
      this.triggerVRHaptic(controller, 0.5, 80);

      if (!this.activeGrabbers.includes(controller)) {
        this.activeGrabbers.push(controller);
      }

      if (this.activeGrabbers.length === 1) {
        // Single controller grab: attach heart to controller for 6DoF movement
        controller.attach(this.engine.heartGroup);
        this.engine.isGrabbed = true;
      }
      else if (this.activeGrabbers.length === 2) {
        // Two-hand grab: enable pinch-to-scale
        this.engine.scene.attach(this.engine.heartGroup);
        this.initialGrabDist = this.activeGrabbers[0].position.distanceTo(this.activeGrabbers[1].position);
        this.initialHeartScale.copy(this.engine.heartGroup.scale);
      }
    }
  }

  onVRSqueezeEnd(controller, event) {
    if (event && event.data && event.data.targetRayMode === 'screen') {
      return;
    }
    const idx = this.activeGrabbers.indexOf(controller);
    if (idx > -1) {
      this.activeGrabbers.splice(idx, 1);
    }

    if (this.activeGrabbers.length === 1) {
      this.activeGrabbers[0].attach(this.engine.heartGroup);
    }
    else if (this.activeGrabbers.length === 0) {
      if (this.engine.heartGroup) {
        this.engine.scene.attach(this.engine.heartGroup);
      }
      this.engine.isGrabbed = false;
    }
  }

  // Two-controller pinch-to-scale update (called from animation loop)
  updateVRGrabs(delta) {
    this.checkVRBoundaryCollisions(delta);

    if (this.activeGrabbers.length === 2 && this.engine.heartGroup) {
      const p1 = this.activeGrabbers[0].position;
      const p2 = this.activeGrabbers[1].position;

      const midpoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
      this.engine.heartGroup.position.copy(midpoint);

      const currentDist = p1.distanceTo(p2);
      if (this.initialGrabDist > 0.01) {
        const ratio = currentDist / this.initialGrabDist;
        const targetScale = Math.max(0.1, Math.min(ratio, 4.0));

        this.engine.heartGroup.scale.copy(this.initialHeartScale).multiplyScalar(targetScale);
      }
    }

    // Process joystick/thumbstick inputs for movement and rotation
    this.updateJoystickControls(delta);

    // Update laser hit markers each frame for continuous visual feedback
    this.updateLaserHitMarkers();
  }

  // Read controller gamepads and apply translation, rotation, and scaling using thumbsticks/joysticks
  updateJoystickControls(delta) {
    if (!this.session || !this.engine.heartGroup || !delta) return;

    for (let i = 0; i < 2; i++) {
      const state = this.controllerStates[i];
      if (state && state.connected && state.inputSource && state.inputSource.gamepad) {
        const controllerObj = this.controllers[i];
        const gamepad = state.inputSource.gamepad;

        // 1. Process Button clicks (A, B, X, Y)
        if (gamepad.buttons && gamepad.buttons.length > 5) {
          if (!state.buttonClicks) state.buttonClicks = {};
          const buttons = gamepad.buttons;
          const handedness = state.handedness;

          const checkClick = (btnIndex) => {
            const isPressed = !!(buttons[btnIndex] && buttons[btnIndex].pressed);
            const wasPressed = !!state.buttonClicks[btnIndex];
            state.buttonClicks[btnIndex] = isPressed;
            return isPressed && !wasPressed;
          };

          if (handedness === 'right' || handedness === 'none') {
            // Button A (index 4) -> Toggle Heartbeat
            if (checkClick(4)) {
              console.log("VRManager: Button A clicked. Toggling Heartbeat.");
              this.triggerVRHaptic(controllerObj, 0.45, 60);

              const newState = !this.engine.isBeating;
              this.engine.setHeartbeatEnabled(newState);
              const beatSwitch = document.getElementById('switch-beat');
              if (beatSwitch) beatSwitch.checked = newState;

              this.engine.updateVRControlPanel();
              this.engine.showVRSimulationInfo("Heartbeat Animation", newState
                ? "Heartbeat animation is now ACTIVE. The chambers contract and expand realistically simulating a cardiac cycle at the specified BPM rate."
                : "Heartbeat animation has been PAUSED. The heart is in a static diastolic state, allowing close physical study of stationary structural relationships.");
            }

            // Button B (index 5) -> Toggle VR Controls Guide
            if (checkClick(5)) {
              console.log("VRManager: Button B clicked. Toggling VR Controls Guide.");
              this.triggerVRHaptic(controllerObj, 0.45, 60);

              if (this.engine.vrInfoPanel && this.engine.vrInfoPanel.visible) {
                this.engine.clearSelection();
              } else {
                this.engine.showVRControlsGuide();
              }
            }
          }

          if (handedness === 'left') {
            // Button X (index 4) -> Toggle Blood Flow
            if (checkClick(4)) {
              console.log("VRManager: Button X clicked. Toggling Blood Flow.");
              this.triggerVRHaptic(controllerObj, 0.45, 60);

              const newState = !this.engine.isFlowing;
              this.engine.setBloodFlowEnabled(newState);
              const flowSwitch = document.getElementById('switch-flow');
              if (flowSwitch) flowSwitch.checked = newState;

              this.engine.updateVRControlPanel();
              this.engine.showVRSimulationInfo("Blood Flow Particle System", newState
                ? "Blood Flow particle visualization is now ACTIVE. Crimson oxygenated cells and deep blue deoxygenated cells track directional flows inside the ventricles and vessels."
                : "Blood Flow particle system is now DISABLED. All active micro-particles are hidden to allow an unobstructed view of internal muscular and tissue walls.");
            }
            // Button Y (index 5) -> Toggle Transparency
            if (checkClick(5)) {
              console.log("VRManager: Button Y clicked. Toggling Transparency.");
              this.triggerVRHaptic(controllerObj, 0.45, 60);

              const newState = !this.engine.isTransparency;
              this.engine.setTransparencyMode(newState);
              const transSwitch = document.getElementById('switch-transparency');
              if (transSwitch) transSwitch.checked = newState;

              this.engine.updateVRControlPanel();
              this.engine.showVRSimulationInfo("Transparency Mode", newState
                ? "Transparency mode is now ACTIVE. Outer muscular tissue becomes translucent, revealing the internal chambers, valves, and blood flow paths in real-time."
                : "Transparency mode is now DISABLED. Fully opaque muscular walls are restored, showing the external vascular structures and fat layers of the heart.");
            }
          }
        }

        // 2. Process Joystick/Thumbstick Axes
        const axes = gamepad.axes;
        if (axes && axes.length >= 2) {
          let xAxis = 0;
          let yAxis = 0;
          if (axes.length >= 4) {
            xAxis = Math.abs(axes[2]) > 0.1 ? axes[2] : axes[0];
            yAxis = Math.abs(axes[3]) > 0.1 ? axes[3] : axes[1];
          } else {
            xAxis = axes[0];
            yAxis = axes[1];
          }

          const threshold = 0.15;
          if (Math.abs(xAxis) > threshold || Math.abs(yAxis) > threshold) {
            const isSqueezed = this.activeGrabbers.includes(controllerObj);
            const handedness = state.handedness;

            if (handedness === 'left') {
              if (this.cameraRig) {
                if (isSqueezed) {
                  // Fly up/down using left joystick when squeezed
                  this.cameraRig.position.y -= yAxis * delta * 2.5;
                } else {
                  // Locomotion: walk horizontally anywhere in the VR lab relative to gaze
                  const forward = new THREE.Vector3();
                  this.engine.camera.getWorldDirection(forward);
                  forward.y = 0; // Lock movement on floor grid
                  forward.normalize();

                  const right = new THREE.Vector3();
                  right.crossVectors(forward, this.engine.camera.up).normalize();

                  this.cameraRig.position.addScaledVector(right, xAxis * delta * 2.5);
                  this.cameraRig.position.addScaledVector(forward, -yAxis * delta * 2.5);
                }
              } else {
                // Fallback translation on the heart itself
                if (isSqueezed) {
                  this.engine.heartGroup.position.y -= yAxis * delta * 1.5;
                } else {
                  this.engine.heartGroup.position.x += xAxis * delta * 1.5;
                  this.engine.heartGroup.position.z += yAxis * delta * 1.5;
                }
              }
            } else if (handedness === 'right' || handedness === 'none') {
              if (isSqueezed) {
                // Squeezed: scale the heart model up/down
                const scaleFactor = 1.0 - yAxis * delta * 1.2;
                const currentScale = this.engine.heartGroup.scale.x;
                const targetScale = Math.min(Math.max(currentScale * scaleFactor, 0.1), 4.0);
                this.engine.heartGroup.scale.setScalar(targetScale);
              } else {
                // Normal: rotate the heart model
                this.engine.heartGroup.rotation.y += xAxis * delta * 2.0;
                this.engine.heartGroup.rotation.x += yAxis * delta * 2.0;
              }
            }
          }
        }
      }
    }
  }

  // Continuous raycaster visualization — update hit dots each frame
  updateLaserHitMarkers() {
    this.raycastFrameCount = (this.raycastFrameCount || 0) + 1;
    if (this.raycastFrameCount % 3 !== 0) return;

    if (!this.engine.heartGroup) return;



    for (let i = 0; i < this.controllers.length; i++) {
      const controller = this.controllers[i];
      if (!controller || !this.controllerStates[i] || !this.controllerStates[i].connected) {
        if (this.hitMarkers[i]) this.hitMarkers[i].visible = false;
        continue;
      }

      const ray = this.buildControllerRay(controller);

      // 1. Raycast against VR Info Panel first
      let hitInfoPanel = false;
      if (this.engine.vrInfoPanel && this.engine.vrInfoPanel.visible) {
        this.engine.raycaster.ray.copy(ray);
        const intersectsInfo = this.engine.raycaster.intersectObject(this.engine.vrInfoPanel);
        if (intersectsInfo.length > 0) {
          if (this.hitMarkers[i]) {
            this.hitMarkers[i].position.copy(intersectsInfo[0].point);
            this.hitMarkers[i].visible = true;
          }
          hitInfoPanel = true;
        }
      }

      let hitControlPanel = false;
      if (!hitInfoPanel && this.engine.vrControlPanel && this.engine.vrControlPanel.visible) {
        this.engine.raycaster.ray.copy(ray);
        const intersectsControl = this.engine.raycaster.intersectObject(this.engine.vrControlPanel);
        if (intersectsControl.length > 0) {
          if (this.hitMarkers[i]) {
            this.hitMarkers[i].position.copy(intersectsControl[0].point);
            this.hitMarkers[i].visible = true;
          }
          hitControlPanel = true;
        }
      }

      if (!hitInfoPanel && !hitControlPanel && this.engine.spriteLabelsGroup) {
        this.engine.raycaster.ray.copy(ray);
        const intersects = this.engine.raycaster.intersectObjects(this.engine.spriteLabelsGroup.children, true);

        let hitSprite = null;
        for (const hit of intersects) {
          if (hit.object.isSprite && hit.object.userData && hit.object.userData.nameId) {
            hitSprite = hit;
            break;
          }
        }

        if (this.hitMarkers[i]) {
          if (hitSprite) {
            this.hitMarkers[i].position.copy(hitSprite.point);
            this.hitMarkers[i].visible = true;
          } else {
            this.hitMarkers[i].visible = false;
          }
        }
      }
    }
  }

  triggerVRHaptic(controller, intensity, duration) {
    // Attempt haptic feedback pulse on standard VR Gamepads (Zapbox may not support haptics)
    try {
      const session = this.engine.renderer.xr.getSession();
      if (session) {
        // Find matching input source
        for (const source of session.inputSources) {
          if (source.gamepad) {
            // Try standard hapticActuators first
            if (source.gamepad.hapticActuators && source.gamepad.hapticActuators.length > 0) {
              source.gamepad.hapticActuators[0].pulse(intensity, duration);
            }
            // Try vibrationActuator (newer API used by some devices)
            else if (source.gamepad.vibrationActuator) {
              source.gamepad.vibrationActuator.playEffect('dual-rumble', {
                duration: duration,
                strongMagnitude: intensity,
                weakMagnitude: intensity * 0.5
              });
            }
          }
        }
      }
    } catch (e) {
      // Zapbox may not support haptics — silently ignore
      console.debug("VRManager: Haptic feedback not available.", e.message);
    }
  }

  // Real-time cylindrical platform collision detection & clamping for rig and controllers
  checkVRBoundaryCollisions(delta) {
    const maxPlatformRadius = 4.0;
    const maxRigRadius = 3.9;

    // 1. Clamp player locomotion (Camera Rig) position to keep player on circular platform
    if (this.cameraRig) {
      const rigPos = this.cameraRig.position;
      const rigDistXZ = Math.sqrt(rigPos.x * rigPos.x + rigPos.z * rigPos.z);
      if (rigDistXZ > maxRigRadius) {
        rigPos.x *= maxRigRadius / rigDistXZ;
        rigPos.z *= maxRigRadius / rigDistXZ;
      }
    }

    // 2. Prevent controllers / surgical tools from going outside the platform boundary
    for (let i = 0; i < this.controllers.length; i++) {
      const controller = this.controllers[i];
      if (!controller || !this.controllerStates[i] || !this.controllerStates[i].connected) {
        continue;
      }

      const worldPos = new THREE.Vector3();
      controller.getWorldPosition(worldPos);

      const distXZ = Math.sqrt(worldPos.x * worldPos.x + worldPos.z * worldPos.z);
      const laser = controller.getObjectByName('laser');
      const model = this.controllerModels[i];
      const hitMarker = this.hitMarkers[i];

      if (distXZ > maxPlatformRadius) {
        // Collided with boundary! Play haptics and color pointer red
        this.triggerVRHaptic(controller, 0.55, 30);

        if (laser) {
          laser.material.color.setHex(0xff0000);
        }
        if (hitMarker) {
          hitMarker.material.color.setHex(0xff0000);
        }

        // Clamp the visual model local offset to stay exactly on the cylinder edge
        if (model) {
          const clampedWorldPos = worldPos.clone();
          clampedWorldPos.x *= maxPlatformRadius / distXZ;
          clampedWorldPos.z *= maxPlatformRadius / distXZ;

          const localClamped = controller.worldToLocal(clampedWorldPos.clone());
          model.position.copy(localClamped);
        }
      } else {
        // Inside platform - restore default visual pointer colors and model position
        if (laser) {
          laser.material.color.setHex(0x00f0ff);
        }
        if (hitMarker) {
          hitMarker.material.color.setHex(0x00f0ff);
        }
        if (model) {
          model.position.set(0, 0, 0);
        }
      }
    }
  }
}
