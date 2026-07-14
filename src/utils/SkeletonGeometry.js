// Procedural 3D Holographic Skeleton Fallback Generator for MediXR
export function createProceduralSkeleton() {
  const skeletonGroup = new THREE.Group();
  skeletonGroup.name = "skeleton_model";

  // Holographic bone material
  const boneMat = new THREE.MeshStandardMaterial({
    color: 0x4da6ff,
    wireframe: true,
    transparent: true,
    opacity: 0.18
  });

  // 1. Spine (Vertebral Column)
  const spineGeo = new THREE.CylinderGeometry(0.04, 0.05, 1.8, 8);
  const spine = new THREE.Mesh(spineGeo, boneMat);
  spine.position.set(0, 0.2, -0.1);
  skeletonGroup.add(spine);

  // 2. Ribcage
  const ribcage = new THREE.Group();
  ribcage.position.set(0, 0.5, -0.05);
  for (let i = 0; i < 7; i++) {
    const ringGeo = new THREE.TorusGeometry(0.38 - i * 0.015, 0.012, 8, 24, Math.PI * 1.7);
    ringGeo.rotateX(Math.PI / 2);
    ringGeo.rotateY(Math.PI / 2); // align forward
    
    const ring = new THREE.Mesh(ringGeo, boneMat);
    ring.position.y = 0.25 - i * 0.12;
    ribcage.add(ring);
  }
  skeletonGroup.add(ribcage);

  // Sternum (Breastbone)
  const sternumGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8);
  const sternum = new THREE.Mesh(sternumGeo, boneMat);
  sternum.position.set(0, 0.45, 0.33);
  skeletonGroup.add(sternum);

  // 3. Skull (Head)
  const skullGeo = new THREE.SphereGeometry(0.24, 16, 16);
  const skull = new THREE.Mesh(skullGeo, boneMat);
  skull.scale.set(0.9, 1.15, 1.0); // elongate skull
  skull.position.set(0, 1.25, -0.05);
  skeletonGroup.add(skull);

  // Jaw (Mandible)
  const jawGeo = new THREE.BoxGeometry(0.18, 0.08, 0.18);
  const jaw = new THREE.Mesh(jawGeo, boneMat);
  jaw.position.set(0, 1.08, 0.02);
  skeletonGroup.add(jaw);

  // 4. Shoulders & Collarbones
  const shouldersGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.9, 8);
  shouldersGeo.rotateZ(Math.PI / 2);
  const shoulders = new THREE.Mesh(shouldersGeo, boneMat);
  shoulders.position.set(0, 0.85, -0.05);
  skeletonGroup.add(shoulders);

  // 5. Arms (Humerus bones)
  for (let side of [-1, 1]) {
    const armGeo = new THREE.CylinderGeometry(0.025, 0.02, 0.7, 8);
    armGeo.translate(0, -0.35, 0);
    const arm = new THREE.Mesh(armGeo, boneMat);
    arm.position.set(0.48 * side, 0.82, -0.05);
    arm.rotation.z = (Math.PI / 12) * -side; // dangle outward slightly
    skeletonGroup.add(arm);
  }

  // 6. Pelvis (Hips)
  const pelvisGeo = new THREE.TorusGeometry(0.32, 0.04, 8, 24);
  pelvisGeo.rotateX(Math.PI / 2.2);
  const pelvis = new THREE.Mesh(pelvisGeo, boneMat);
  pelvis.position.set(0, -0.65, -0.1);
  skeletonGroup.add(pelvis);

  // 7. Legs (Femur bones)
  for (let side of [-1, 1]) {
    const legGeo = new THREE.CylinderGeometry(0.035, 0.03, 0.8, 8);
    legGeo.translate(0, -0.4, 0);
    const leg = new THREE.Mesh(legGeo, boneMat);
    leg.position.set(0.24 * side, -0.68, -0.1);
    leg.rotation.z = (Math.PI / 24) * -side;
    skeletonGroup.add(leg);
  }

  // Position skeleton nicely centered
  skeletonGroup.position.set(0, 0.3, 0);
  skeletonGroup.userData = { isProcedural: true };
  
  return skeletonGroup;
}
