// Model Loader Service with Procedural Fallback for MediXR
import { createProceduralHeart } from '../utils/HeartGeometry.js';
import { createProceduralSkeleton } from '../utils/SkeletonGeometry.js';

export class ModelLoader {
  constructor(manager) {
    this.loader = new THREE.GLTFLoader(manager);
    this.modelPath = 'assets/models/realistic_human_heart.glb'; // Procedural fallback: 7 separate anatomy parts
  }

  /**
   * Load the 3D skeleton model. If GLB file is missing, fallback to procedural skeleton.
   * @param {Function} onProgress - Callback for download progress tracking
   * @returns {Promise<THREE.Group>}
   */
  loadSkeletonModel(onProgress) {
    return new Promise(async (resolve) => {
      const path = 'assets/models/skeleton.glb';
      console.log(`ModelLoader: Skeleton GLB found! Loading...`);
      this.loader.load(
        path,
        (gltf) => {
          console.log("ModelLoader: Skeleton GLB loaded successfully!");
          const loadedModel = gltf.scene;

          // Cool glowing holographic-like bone material
          const skeletonBoneMat = new THREE.MeshStandardMaterial({
            color: 0x80b3ff,
            metalness: 0.15,
            roughness: 0.6,
            transparent: true,
            opacity: 0.28,
            side: THREE.DoubleSide
          });

          loadedModel.traverse((node) => {
            if (node.isMesh) {
              node.castShadow = true;
              node.receiveShadow = true;
              node.material = skeletonBoneMat;
            }
          });

          const origBox = new THREE.Box3().setFromObject(loadedModel);
          const origSize = origBox.getSize(new THREE.Vector3());

          const desiredHeight = 2.0;
          const scaleFactor = desiredHeight / (origSize.y || 1);
          loadedModel.scale.set(scaleFactor, scaleFactor, scaleFactor);

          loadedModel.position.set(0, 0, 0);
          loadedModel.updateMatrixWorld(true);
          const scaledBox = new THREE.Box3().setFromObject(loadedModel);
          const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
          const scaledMin = scaledBox.min;

          const wrapperGroup = new THREE.Group();
          wrapperGroup.name = "skeleton_model";
          wrapperGroup.add(loadedModel);

          loadedModel.position.set(
            -scaledCenter.x,
            -scaledMin.y,
            -scaledCenter.z
          );

          wrapperGroup.position.set(0, 0, 0);

          resolve(wrapperGroup);
        },
        (xhr) => {
          if (xhr.lengthComputable && onProgress) {
            onProgress((xhr.loaded / xhr.total) * 100);
          }
        },
        (error) => {
          console.warn("ModelLoader: Skeleton GLB failed to parse. Falling back to procedural skeleton.");
          const proceduralSkeleton = createProceduralSkeleton();
          resolve(proceduralSkeleton);
        }
      );
    });
  }

  /**
   * Load the 3D heart model. If GLB file is missing, fallback to procedural heart.
   * @param {Object} materials - Dictionary of physical materials to use for procedural model
   * @param {Function} onProgress - Callback for download progress tracking
   * @returns {Promise<THREE.Group>}
   */
  loadHeartModel(materials, onProgress) {
    return new Promise((resolve, reject) => {
      const path = 'assets/models/realistic_human_heart.glb';
      console.log(`ModelLoader: Attempting to load realistic human heart GLB: ${path}`);

      this.loader.load(
        path,
        (gltf) => {
          console.log("ModelLoader: Realistic heart GLB loaded successfully!");
          const loadedModel = gltf.scene;

          // Traverse — keep GLB's original photorealistic materials; only set up shadows & userData
          loadedModel.traverse((node) => {
            if (node.isMesh) {
              node.castShadow = true;
              node.receiveShadow = true;

              // Make sure each material has physically-based rendering enabled
              const mats = Array.isArray(node.material) ? node.material : [node.material];
              mats.forEach(mat => {
                if (mat) {
                  // Ensure full PBR quality
                  mat.needsUpdate = true;
                  // Store original values for highlight/restore effects
                  if (!mat.userData.originalColor) {
                    mat.userData = {
                      originalColor: mat.color ? mat.color.getHex() : 0xffffff,
                      originalOpacity: mat.opacity !== undefined ? mat.opacity : 1.0,
                      originalEmissive: mat.emissive ? mat.emissive.getHex() : 0x000000,
                      originalEmissiveIntensity: mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : 0.0
                    };
                  }
                }
              });

              // Map node name to anatomical ID for interactivity (labels, hover)
              const normalizedName = this.normalizeMeshName(node.name);
              const anatomyId = normalizedName || 'left_ventricle';
              node.userData = {
                ...node.userData,
                originalScale: node.scale.clone(),
                originalPosition: node.position.clone(),
                originalRotation: node.rotation.clone(),
                nameId: anatomyId
              };
              if (normalizedName) node.name = normalizedName;
            }
          });


          // Normalize scale of loaded model to a standard height of 1.6 units
          const heartBox = new THREE.Box3().setFromObject(loadedModel);
          const heartSize = heartBox.getSize(new THREE.Vector3());
          const targetHeight = 4.6;
          const scaleFactor = targetHeight / (heartSize.y || 1);
          loadedModel.scale.set(scaleFactor, scaleFactor, scaleFactor);

          // Center the loaded model's geometry
          loadedModel.updateMatrixWorld(true);
          const heartCenter = heartBox.getCenter(new THREE.Vector3());
          loadedModel.position.set(
            -heartCenter.x * scaleFactor,
            -heartCenter.y * scaleFactor + 0.2,
            -heartCenter.z * scaleFactor
          );

          const wrapperGroup = new THREE.Group();
          wrapperGroup.name = "heart_model";
          wrapperGroup.add(loadedModel);
          // Force matrix update so local-space bounding box reads are accurate
          wrapperGroup.updateMatrixWorld(true);

          // ── Auto-compute label anchors from mesh bounding box centres ──
          // This ensures labels point to the exact geometry regardless of GLB node names.
          const anatomyIds = [
            'left_ventricle', 'right_ventricle', 'left_atrium',
            'right_atrium', 'aorta', 'pulmonary_artery', 'vena_cava'
          ];
          const computedAnchors = {};
          const namedMeshes = {};

          wrapperGroup.traverse(node => {
            if (node.isMesh && node.userData && node.userData.nameId) {
              const id = node.userData.nameId;
              if (anatomyIds.includes(id)) {
                if (!namedMeshes[id]) namedMeshes[id] = [];
                namedMeshes[id].push(node);
              }
            }
          });

          anatomyIds.forEach(id => {
            const meshes = namedMeshes[id];
            if (meshes && meshes.length > 0) {
              // Merge bounding boxes of all meshes with this id
              const combined = new THREE.Box3();
              meshes.forEach(m => {
                const b = new THREE.Box3().setFromObject(m);
                combined.union(b);
              });
              // Get center in wrapperGroup's local space
              const worldCenter = combined.getCenter(new THREE.Vector3());
              const localCenter = wrapperGroup.worldToLocal(worldCenter);
              computedAnchors[id] = localCenter;
              console.log(`ModelLoader: Anchor for "${id}" auto-computed at`, localCenter);
            }
          });

          wrapperGroup.userData = {
            isRealisticModel: true,
            computedAnchors: Object.keys(computedAnchors).length > 0 ? computedAnchors : null
          };

          if (onProgress) onProgress(100);
          resolve(wrapperGroup);
        },
        // Progress callback
        (xhr) => {
          if (onProgress && xhr.total) {
            const percent = Math.round((xhr.loaded / xhr.total) * 100);
            onProgress(percent);
          }
        },
        // Error callback — abort loading; realistic model is mandatory
        (error) => {
          console.error("ModelLoader: Failed to load realistic heart GLB. Abort.", error);
          reject(error);
        }
      );
    });
  }

  /**
   * Normalize mesh node names from GLB to match our HeartData IDs
   * @param {string} name 
   * @returns {string|null}
   */
  normalizeMeshName(name) {
    const lowerName = name.toLowerCase();

    if (lowerName.includes('left_ventricle') || lowerName.includes('leftventricle') || lowerName === 'lv') {
      return 'left_ventricle';
    }
    if (lowerName.includes('right_ventricle') || lowerName.includes('rightventricle') || lowerName === 'rv') {
      return 'right_ventricle';
    }
    if (lowerName.includes('left_atrium') || lowerName.includes('leftatrium') || lowerName === 'la') {
      return 'left_atrium';
    }
    if (lowerName.includes('right_atrium') || lowerName.includes('rightatrium') || lowerName === 'ra') {
      return 'right_atrium';
    }
    if (lowerName.includes('aorta')) {
      return 'aorta';
    }
    if (lowerName.includes('pulmonary_artery') || lowerName.includes('pulmonaryartery') || lowerName.includes('pulmonary_trunk') || lowerName === 'pa') {
      return 'pulmonary_artery';
    }
    if (lowerName.includes('vena_cava') || lowerName.includes('venacava') || lowerName === 'vc' || lowerName.includes('svc') || lowerName.includes('ivc')) {
      return 'vena_cava';
    }

    return null;
  }
}
