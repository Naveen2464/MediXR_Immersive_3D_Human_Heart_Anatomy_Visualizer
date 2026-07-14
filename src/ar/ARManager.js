// WebXR AR Session Manager for MediXR
import { HeartData } from '../utils/HeartData.js';

export class ARManager {
  constructor(engine) {
    this.engine = engine;
    this.session = null;
    this.hitTestSource = null;
    this.hitTestSpace = null;
    
    // Reticle (placement ring) for showing detected planes
    this.reticle = null;
    this.hasHitPose = false;
    this.isPlaced = false;
    this.controller = null;
    this.onSelectCallback = null;
    this.laserLine = null;
    this.hitMarker = null;
    this.controllerConnected = false;
    this.onControllerConnected = null;
    this.onControllerDisconnected = null;
  }

  // Check if immersive AR is supported on the device
  async checkAvailability() {
    if (navigator.xr) {
      const btn = document.getElementById('btn-ar');
      if (btn) {
        btn.classList.remove('disabled');
        btn.removeAttribute('disabled');
        console.log("ARManager: WebXR detected. Enabling AR button.");
      }
    }
  }

  // Starts the WebXR AR Session
  async startSession() {
    if (!navigator.xr) return;
    
    this.isPlaced = false;
    this.controllerConnected = false;
    
    try {
      // Build session options — domOverlay root is only used if the feature is granted
      const sessionInit = {
        optionalFeatures: ['local', 'local-floor', 'hit-test', 'dom-overlay']
      };

      // Only attach domOverlay config if the HUD layer element exists
      const hudLayer = document.querySelector('.hud-layer');
      if (hudLayer) {
        sessionInit.domOverlay = { root: hudLayer };
      }

      try {
        this.session = await navigator.xr.requestSession('immersive-ar', sessionInit);
      } catch (sessionErr) {
        console.warn("ARManager: Failed to request session with domOverlay, retrying fallback without overlay...", sessionErr);
        const fallbackInit = {
          optionalFeatures: ['local', 'local-floor', 'hit-test']
        };
        this.session = await navigator.xr.requestSession('immersive-ar', fallbackInit);
      }

      console.log("ARManager: WebXR AR session started.");

      if (hudLayer) {
        this.beforeXRSelectHandler = (ev) => {
          // Prevent standard UI elements from triggering WebXR select events
          if (ev.target !== hudLayer) {
            ev.preventDefault();
          }
        };
        hudLayer.addEventListener('beforexrselect', this.beforeXRSelectHandler);
      }
      
      // Ensure transparent clear color/alpha so camera background is visible
      this.engine.renderer.setClearColor(0x000000, 0.0);
      this.engine.renderer.setClearAlpha(0.0);

      // Set correct reference space type on Three.js WebXR Manager before initializing session
      this.engine.setReferenceSpaceType('local');
      this.engine.renderer.xr.setSession(this.session);
      
      // Configure scene adjustments for AR (hide background, shift scale)
      this.engine.scene.background = null;
      this.engine.updateVRControlPanel();

      if (this.engine.heartGroup) {
        this.engine.scene.add(this.engine.heartGroup); // Ensure attached to main scene
        // Default to local space chest height (y=0.0) first
        this.engine.heartGroup.position.set(0, 0.0, -1.2);
        this.engine.heartGroup.scale.set(0.13, 0.13, 0.13);
        this.engine.heartGroup.rotation.set(0, 0, 0);
        this.engine.heartGroup.visible = true; // Show immediately in front of user
      }

      // Query reference space asynchronously without blocking the main WebXR session startup thread
      this.session.requestReferenceSpace('local-floor').then((refSpaceFloor) => {
        console.log("ARManager: 'local-floor' reference space is active. Aligning heights...");
        this.hitTestSpace = refSpaceFloor;
        this.engine.setReferenceSpaceType('local-floor');
        this.adjustARHeight(true);
      }).catch((floorErr) => {
        console.warn("ARManager: 'local-floor' not available. Falling back to 'local'.");
        this.session.requestReferenceSpace('local').then((localRef) => {
          this.hitTestSpace = localRef;
        }).catch((e) => {});
        this.adjustARHeight(false);
      });
      
      // Try to set up hit-test for surface detection (may not be available on Zapbox)
      let hitTestAvailable = false;
      try {
        const refSpace = await this.session.requestReferenceSpace('viewer');
        this.hitTestSource = await this.session.requestHitTestSource({ space: refSpace });
        hitTestAvailable = true;
        console.log("ARManager: Hit-test is available — enabling surface placement.");
      } catch (htErr) {
        console.warn("ARManager: Hit-test not supported on this device — placing heart directly.", htErr);
        this.hitTestSource = null;
      }

      if (hitTestAvailable) {
        this.isPlaced = false;
        // Setup reticle indicator for surface placement
        this.createReticle();

        // Show placement instructions
        const instr = document.getElementById('ar-instructions');
        if (instr) {
          instr.style.display = '';
        }
      } else {
        // No hit-test: skip placement phase, show heart immediately in front of user
        this.isPlaced = true;
        if (this.engine.heartGroup) {
          this.engine.heartGroup.visible = true;
        }
        const instr = document.getElementById('ar-instructions');
        if (instr) {
          instr.style.display = 'none';
        }
      }

      // Handle screen tap/select using Three.js WebXR controller
      this.controller = this.engine.renderer.xr.getController(0);
      this.onSelectCallback = (event) => this.onARSelect(this.controller, event);
      this.controller.addEventListener('select', this.onSelectCallback);

      this.onSqueezeStartCallback = (event) => {
        if (event && event.data && event.data.targetRayMode === 'screen') return;
        console.log("ARManager: Squeeze/grip pressed. Clearing selection.");
        this.engine.clearSelection();
      };
      this.controller.addEventListener('squeezestart', this.onSqueezeStartCallback);

      // Create a visual laser pointer line for controller aiming
      const laserGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1)
      ]);
      const laserMaterial = new THREE.LineBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.8
      });
      this.laserLine = new THREE.Line(laserGeometry, laserMaterial);
      this.laserLine.name = 'laser';
      this.laserLine.scale.z = 5;
      this.laserLine.visible = false; // Hide initially until connected
      this.controller.add(this.laserLine);

      // Listen for connection events to toggle laser pointer visibility
      this.onControllerConnected = (event) => {
        this.controllerConnected = true;
        if (this.laserLine) this.laserLine.visible = false; // Hide laser pointer completely
        console.log("ARManager: Controller connected.");
      };

      this.onControllerDisconnected = () => {
        this.controllerConnected = false;
        if (this.laserLine) this.laserLine.visible = false;
        if (this.hitMarker) this.hitMarker.visible = false;
        console.log("ARManager: Controller disconnected.");
      };

      this.controller.addEventListener('connected', this.onControllerConnected);
      this.controller.addEventListener('disconnected', this.onControllerDisconnected);

      // Create visual hit marker at the point of laser raycast intersection
      const hitMarkerGeo = new THREE.SphereGeometry(0.015, 12, 12);
      const hitMarkerMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.9
      });
      this.hitMarker = new THREE.Mesh(hitMarkerGeo, hitMarkerMat);
      this.hitMarker.visible = false;
      this.engine.scene.add(this.hitMarker);

      this.engine.scene.add(this.controller);
      
      // Listen for session end
      this.session.addEventListener('end', () => this.endSession());

      // Update UI state
      document.body.classList.add('xr-ar-active');
      
    } catch (error) {
      console.error("ARManager: Failed to start AR session: ", error);
      throw error;
    }
  }

  createReticle() {
    // Create an invisible dummy object to satisfy matrix updates without rendering a blue ring
    this.reticle = new THREE.Object3D();
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.engine.scene.add(this.reticle);
  }

  onARSelect(controller, event) {
    if (this.engine.hasDraggedInXR) {
      this.engine.hasDraggedInXR = false;
      return;
    }



    // 1. Raycast against VR Info Panel first to handle Close [X] button clicks
    if (this.engine.vrInfoPanel && this.engine.vrInfoPanel.visible) {
      const tempMatrix = new THREE.Matrix4();
      tempMatrix.identity().extractRotation(controller.matrixWorld);

      const ray = new THREE.Ray();
      ray.origin.setFromMatrixPosition(controller.matrixWorld);
      ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

      this.engine.raycaster.ray.copy(ray);
      const intersectsInfo = this.engine.raycaster.intersectObject(this.engine.vrInfoPanel);
      if (intersectsInfo.length > 0) {
        const uv = intersectsInfo[0].uv;
        // Check if hit UV coordinates match CLOSE [X] button (x in [0.80, 0.95], y in [0.87, 0.96])
        if (uv && uv.x >= 0.80 && uv.x <= 0.95 && uv.y >= 0.87 && uv.y <= 0.96) {
          console.log("ARManager: Close button clicked on VR Info Panel.");
          this.engine.clearSelection();
          return;
        }
      }
    }

    // 1b. Raycast against VR Control Panel first to handle button clicks in AR
    if (this.engine.vrControlPanel && this.engine.vrControlPanel.visible) {
      const tempMatrix = new THREE.Matrix4();
      tempMatrix.identity().extractRotation(controller.matrixWorld);

      const ray = new THREE.Ray();
      ray.origin.setFromMatrixPosition(controller.matrixWorld);
      ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

      this.engine.raycaster.ray.copy(ray);
      const intersectsControl = this.engine.raycaster.intersectObject(this.engine.vrControlPanel);
      if (intersectsControl.length > 0) {
        const uv = intersectsControl[0].uv;
        if (uv) {
          const x = uv.x * 512;
          const y = (1 - uv.y) * 384;
          
          this.engine.handleVRControlClick(x, y);
          return;
        }
      }
    }

    let hitHeart = false;
    
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    
    const ray = new THREE.Ray();
    ray.origin.setFromMatrixPosition(controller.matrixWorld);
    ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    
    if (this.engine.heartGroup && this.engine.heartGroup.visible && this.engine.spriteLabelsGroup) {
      // 1. Ray-to-sprite position distance check (for input pointer precision)
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

      // Tight threshold of 0.08 meters (8cm) for ray-to-button proximity
      if (closestKey && minDist < 0.08) {
        if (this.engine.selectedMesh && this.engine.selectedMesh.userData.nameId === closestKey) {
          this.engine.clearSelection();
        } else {
          this.engine.selectAnatomy(closestKey);
        }
        hitHeart = true;

        if (!this.isPlaced) {
          this.isPlaced = true;
          if (this.reticle) {
            this.engine.scene.remove(this.reticle);
            this.reticle = null;
          }
          const instr = document.getElementById('ar-instructions');
          if (instr) {
            instr.style.display = 'none';
          }
        }
        return;
      }

      // 2. Direct raycast against 3D Sprite labels
      this.engine.raycaster.ray.copy(ray);
      const intersects = this.engine.raycaster.intersectObjects(this.engine.spriteLabelsGroup.children, true);
      
      let hitSprite = null;
      for (const hit of intersects) {
        if (hit.object.isSprite && hit.object.userData && hit.object.userData.nameId) {
          hitSprite = hit;
          break;
        }
      }

      if (hitSprite) {
        const nameId = hitSprite.object.userData.nameId;
        if (HeartData[nameId]) {
          // Toggle selection: if already selected, clear it
          if (this.engine.selectedMesh && this.engine.selectedMesh.userData.nameId === nameId) {
            this.engine.clearSelection();
          } else {
            this.engine.selectAnatomy(nameId);
          }
          hitHeart = true;
          
          // Once they start interacting with the heart, we can stop the placement phase
          if (!this.isPlaced) {
            this.isPlaced = true;
            if (this.reticle) {
              this.engine.scene.remove(this.reticle);
              this.reticle = null;
            }
            const instr = document.getElementById('ar-instructions');
            if (instr) {
              instr.style.display = 'none';
            }
          }
        }
      }
    }

    // If we didn't hit the heart
    if (!hitHeart) {
      if (!this.isPlaced) {
        this.onPlaceHeart();
      } else {
        // Tapped empty space after placement: clear selection
        this.engine.clearSelection();
      }
    }
  }

  // Triggers when plane is clicked to place the heart
  onPlaceHeart() {
    if (this.isPlaced) return;
    this.isPlaced = true;
    
    // Determine position: use hit pose if resolved, otherwise fallback to comfortable viewer distance
    const position = new THREE.Vector3();
    if (this.reticle && this.hasHitPose) {
      position.setFromMatrixPosition(this.reticle.matrix);
      position.y += 0.3; // float slightly above target
    } else {
      // Fallback: place in front of camera
      const refSpace = this.engine.renderer.xr.getReferenceSpace();
      const isFloorSpace = !!(refSpace && refSpace.constructor && refSpace.constructor.name.includes('Floor'));
      const defaultY = isFloorSpace ? 1.2 : 0.0;
      position.set(0, defaultY, -1.2);
    }
    
    if (this.engine.heartGroup) {
      this.engine.heartGroup.position.copy(position);
      this.engine.heartGroup.scale.set(0.13, 0.13, 0.13); // Ensure correct scale is set
      this.engine.heartGroup.visible = true;
      console.log("ARManager: Heart placed in physical environment at ", position);
    }
    
    // Remove reticle
    if (this.reticle) {
      this.engine.scene.remove(this.reticle);
      this.reticle = null;
    }

    // Hide AR placement instructions helper
    const instr = document.getElementById('ar-instructions');
    if (instr) {
      instr.style.display = 'none';
    }
  }

  // Monitors hit test markers inside Engine frame updates
  updateARFrame(frame) {
    // Continuous raycasting/visual feedback for Zapbox controller
    this.updateARLaser();

    if (!this.session || !this.hitTestSource || !this.reticle) return;
    
    // Retrieve reference space from renderer
    const refSpace = this.engine.renderer.xr.getReferenceSpace();
    const hitTestResults = frame.getHitTestResults(this.hitTestSource);
    
    if (hitTestResults.length > 0 && !this.isPlaced) {
      const hit = hitTestResults[0];
      const pose = hit.getPose(refSpace);
      
      this.reticle.visible = false; // Keep reticle invisible to remove blue click indicator
      this.reticle.matrix.fromArray(pose.transform.matrix);
      this.hasHitPose = true;

      // Show heart dynamically at the detected hit position with correct scale
      if (this.engine.heartGroup) {
        const position = new THREE.Vector3();
        position.setFromMatrixPosition(this.reticle.matrix);
        position.y += 0.3; // float slightly above target
        this.engine.heartGroup.position.copy(position);
        this.engine.heartGroup.scale.set(0.13, 0.13, 0.13);
        this.engine.heartGroup.visible = true;
      }
    } else {
      this.reticle.visible = false;
      this.hasHitPose = false;

      // Keep heart visible at its default position when no hit test pose is resolved yet
      if (!this.isPlaced && this.engine.heartGroup) {
        this.engine.heartGroup.visible = true;
      }
    }
  }

  // Read physical tracked controller joysticks and apply horizontal/depth translation, rotation, and scaling
  updateARJoystick(delta) {
    if (!this.session || !this.controllerConnected || !this.controller || !this.engine.heartGroup || !delta) return;

    // Find the input source for controller 0
    let inputSource = null;
    for (const source of this.session.inputSources) {
      if (source.targetRayMode === 'tracked-pointer') {
        inputSource = source;
        break;
      }
    }

    if (inputSource && inputSource.gamepad) {
      const axes = inputSource.gamepad.axes;
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
          // Check if squeeze/grip button (buttons[1]) is pressed to switch from rotation to translate/scale
          let isSqueezed = false;
          if (inputSource.gamepad.buttons && inputSource.gamepad.buttons.length > 1) {
            const squeezeBtn = inputSource.gamepad.buttons[1];
            if (squeezeBtn && squeezeBtn.pressed) {
              isSqueezed = true;
            }
          }

          if (isSqueezed) {
            // Squeezed: translate horizontally (X) and scale up/down with Y axis
            if (Math.abs(xAxis) > threshold) {
              this.engine.heartGroup.position.x += xAxis * delta * 1.5;
            }
            if (Math.abs(yAxis) > threshold) {
              // Scale the heart model
              const scaleFactor = 1.0 - yAxis * delta * 1.2;
              const currentScale = this.engine.heartGroup.scale.x;
              const targetScale = Math.min(Math.max(currentScale * scaleFactor, 0.05), 3.0);
              this.engine.heartGroup.scale.setScalar(targetScale);
            }
          } else {
            // Normal: rotate the heart (xAxis around Y-axis, yAxis around X-axis)
            this.engine.heartGroup.rotation.y += xAxis * delta * 2.0;
            this.engine.heartGroup.rotation.x += yAxis * delta * 2.0;
          }
        }
      }
    }
  }

  // Update laser hit markers each frame for continuous visual feedback in AR
  updateARLaser() {
    this.raycastFrameCount = (this.raycastFrameCount || 0) + 1;
    if (this.raycastFrameCount % 3 !== 0) return;

    if (!this.controller || !this.controllerConnected || !this.engine.heartGroup || !this.hitMarker) {
      if (this.hitMarker) this.hitMarker.visible = false;
      return;
    }



    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(this.controller.matrixWorld);

    const ray = new THREE.Ray();
    ray.origin.setFromMatrixPosition(this.controller.matrixWorld);
    ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    // 1. Raycast against VR Info Panel first
    let hitInfoPanel = false;
    if (this.engine.vrInfoPanel && this.engine.vrInfoPanel.visible) {
      this.engine.raycaster.ray.copy(ray);
      const intersectsInfo = this.engine.raycaster.intersectObject(this.engine.vrInfoPanel);
      if (intersectsInfo.length > 0) {
        this.hitMarker.position.copy(intersectsInfo[0].point);
        this.hitMarker.visible = false; // Hide hit marker completely
        hitInfoPanel = true;
      }
    }

    let hitControlPanel = false;
    if (!hitInfoPanel && this.engine.vrControlPanel && this.engine.vrControlPanel.visible) {
      this.engine.raycaster.ray.copy(ray);
      const intersectsControl = this.engine.raycaster.intersectObject(this.engine.vrControlPanel);
      if (intersectsControl.length > 0) {
        this.hitMarker.position.copy(intersectsControl[0].point);
        this.hitMarker.visible = false; // Hide hit marker completely
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

      if (hitSprite && this.engine.heartGroup.visible) {
        this.hitMarker.position.copy(hitSprite.point);
        this.hitMarker.visible = false; // Hide hit marker completely
      } else {
        this.hitMarker.visible = false;
      }
    }
  }

  // Restore scene to 3D Viewer defaults
  endSession() {
    console.log("ARManager: AR Session ended.");
    this.session = null;
    this.controllerConnected = false;

    if (this.engine.vrControlPanel) {
      this.engine.vrControlPanel.visible = false;
    }

    const hudLayer = document.querySelector('.hud-layer');
    if (hudLayer && this.beforeXRSelectHandler) {
      hudLayer.removeEventListener('beforexrselect', this.beforeXRSelectHandler);
      this.beforeXRSelectHandler = null;
    }
    
    // Restore opaque background for desktop mode
    this.engine.renderer.setClearColor(0x050a12, 1.0);
    this.engine.renderer.setClearAlpha(1.0);

    if (this.reticle) {
      this.engine.scene.remove(this.reticle);
      this.reticle = null;
    }

    if (this.hitMarker) {
      this.engine.scene.remove(this.hitMarker);
      this.hitMarker = null;
    }

    if (this.controller) {
      this.controller.removeEventListener('select', this.onSelectCallback);
      if (this.onSqueezeStartCallback) {
        this.controller.removeEventListener('squeezestart', this.onSqueezeStartCallback);
        this.onSqueezeStartCallback = null;
      }
      if (this.onControllerConnected) {
        this.controller.removeEventListener('connected', this.onControllerConnected);
      }
      if (this.onControllerDisconnected) {
        this.controller.removeEventListener('disconnected', this.onControllerDisconnected);
      }
      this.engine.scene.remove(this.controller);
      this.controller = null;
    }

    const instr = document.getElementById('ar-instructions');
    if (instr) {
      instr.style.display = '';
    }
    
    // Reset background and heart transforms
    this.engine.scene.background = new THREE.Color(0x050a12);
    if (this.engine.heartGroup) {
      this.engine.heartGroup.position.set(0, 0.2, 0);
      this.engine.heartGroup.scale.set(1.0, 1.0, 1.0);
      this.engine.heartGroup.rotation.set(0, 0, 0);
      this.engine.heartGroup.visible = true;
    }
    
    document.body.classList.remove('xr-ar-active');
  }

  // Adjusts the heart group height dynamically once reference space is resolved
  adjustARHeight(isFloorSpace) {
    // Clear any active selection repositioning caches to align with new space coordinates
    this.engine.preSelectionHeartPosition = null;
    this.engine.preSelectionInfoPanelPosition = null;
    this.engine.preSelectionInfoPanelRotation = null;
    this.engine.targetHeartPosition = null;
    this.engine.targetInfoPanelPosition = null;
    this.engine.targetInfoPanelRotationY = undefined;

    if (this.engine.heartGroup) {
      const defaultY = isFloorSpace ? 1.2 : 0.0;
      this.engine.heartGroup.position.set(0, defaultY, -1.2);
    }

    if (this.engine.vrControlPanel) {
      const panelY = isFloorSpace ? 1.2 : 0.0;
      this.engine.vrControlPanel.position.set(-0.9, panelY, -1.2);
      this.engine.vrControlPanel.rotation.set(0, Math.PI / 6, 0);
    }
    if (this.engine.vrInfoPanel) {
      const panelY = isFloorSpace ? 1.2 : 0.0;
      this.engine.vrInfoPanel.position.set(0.9, panelY, -1.2);
      this.engine.vrInfoPanel.rotation.set(0, -Math.PI / 6, 0);
    }
  }
}
