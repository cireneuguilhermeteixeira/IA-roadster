import { createCaatinga } from "./caatinga";
import { setupSkybox } from "./skybox";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export function createVisuals(view: HTMLElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#cfaa82");
  // Avoid skybox discoloration by linear fog compositing into a flat color.
  scene.fog = null;
  setupSkybox(scene);
  const camera = new THREE.PerspectiveCamera(
    58,
    innerWidth / innerHeight,
    0.1,
    1200,
  );
  camera.position.set(52, 31, 47);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  view.appendChild(renderer.domElement);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.maxDistance = 140;
  orbit.minDistance = 4;
  orbit.target.set(0, 23, 0);
  scene.add(new THREE.HemisphereLight(0xf7ead0, 0x7d654d, 2.0));
  const sun = new THREE.DirectionalLight(0xffe1b0, 2.9);
  sun.position.set(-55, 85, 35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -55;
  scene.add(sun);
  const standardMaterial = (color, metalness = 0.1, roughness = 0.5) =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness });
  const red = new THREE.MeshPhysicalMaterial({
    color: "#b30c28",
    metalness: 0.65,
    roughness: 0.23,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
  });
  const black = standardMaterial("#10131a", 0.45, 0.44);
  const carbon = standardMaterial("#202832", 0.66, 0.35);
  const chrome = standardMaterial("#a8b9c9", 0.92, 0.2);
  const glass = new THREE.MeshPhysicalMaterial({
    color: "#121f30",
    metalness: 0.45,
    roughness: 0.09,
    transparent: true,
    opacity: 0.88,
    clearcoat: 1,
  });
  const neon = new THREE.MeshBasicMaterial({ color: "#64dfff" });
  const addMesh = (geo, material, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const addBox = (p, w, h, d, m, x = 0, y = 0, z = 0) =>
    addMesh(new THREE.BoxGeometry(w, h, d), m, p, x, y, z);
  const ground = addMesh(
    new THREE.PlaneGeometry(230, 230),
    standardMaterial("#a7784d", 0.02, 0.98),
    scene,
    0,
    -0.03,
    0,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  createCaatinga(scene);
  // A fixed half-loop: the road itself bends upward until its exit is upside down.
  const RAMP_RADIUS = 20,
    RAMP_FLOOR = 0,
    RAMP_TOP = RAMP_FLOOR + 2 * RAMP_RADIUS;
  const ENTRY_LENGTH = 28,
    EXIT_LENGTH = 12,
    ROAD_WIDTH = 9;
  const arcLength = Math.PI * RAMP_RADIUS,
    trackLength = ENTRY_LENGTH + arcLength + EXIT_LENGTH;
  function trackAt(distance) {
    const d = THREE.MathUtils.clamp(distance, 0, trackLength);
    if (d <= ENTRY_LENGTH)
      return {
        point: new THREE.Vector3(d - ENTRY_LENGTH, RAMP_FLOOR, 0),
        angle: 0,
      };
    if (d <= ENTRY_LENGTH + arcLength) {
      const a = -Math.PI / 2 + (d - ENTRY_LENGTH) / RAMP_RADIUS;
      return {
        point: new THREE.Vector3(
          RAMP_RADIUS * Math.cos(a),
          RAMP_FLOOR + RAMP_RADIUS + RAMP_RADIUS * Math.sin(a),
          0,
        ),
        angle: a + Math.PI / 2,
      };
    }
    return {
      point: new THREE.Vector3(-(d - ENTRY_LENGTH - arcLength), RAMP_TOP, 0),
      angle: Math.PI,
    };
  }
  const landingX = trackAt(trackLength).point.x,
    landingZ = 0;
  const rampLandingHeight = RAMP_FLOOR + 0.36;
  function landingSurfaceAt(x, z) {
    const overEntry =
      x >= -ENTRY_LENGTH && x <= 0 && Math.abs(z) <= ROAD_WIDTH / 2;
    return overEntry ? rampLandingHeight : 0.67;
  }
  const landingRing = addMesh(
    new THREE.RingGeometry(2.9, 3.08, 64),
    new THREE.MeshBasicMaterial({
      color: "#e6c58c",
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    scene,
    landingX,
    RAMP_FLOOR + 0.09,
    landingZ,
  );
  landingRing.rotation.x = -Math.PI / 2;
  landingRing.castShadow = false;
  const ramp = new THREE.Group();
  scene.add(ramp);
  const deckMat = standardMaterial("#8b6a4d", 0.08, 0.95),
    edgeMat = standardMaterial("#c9b38e", 0.04, 0.92),
    stripeMat = standardMaterial("#e6d5b5", 0.02, 0.9);
  function roadRibbon(offset, width, normalOffset, material) {
    const vertices = [],
      indices = [],
      segments = 180;
    for (let i = 0; i <= segments; i++) {
      const { point, angle } = trackAt((trackLength * i) / segments),
        nx = -Math.sin(angle),
        ny = Math.cos(angle);
      for (const z of [offset - width / 2, offset + width / 2])
        vertices.push(
          point.x + nx * normalOffset,
          point.y + ny * normalOffset,
          z,
        );
      if (i < segments) {
        const k = i * 2;
        indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const surface = addMesh(geometry, material, ramp);
    surface.material.side = THREE.DoubleSide;
    return surface;
  }
  roadRibbon(0, ROAD_WIDTH, 0, deckMat);
  roadRibbon(0, 0.06, 0.065, stripeMat);
  for (const z of [-ROAD_WIDTH / 2, ROAD_WIDTH / 2]) {
    roadRibbon(z, 0.12, 0.055, edgeMat);
    roadRibbon(z * 0.84, 0.035, 0.065, stripeMat);
    roadRibbon(z, 0.12, -0.32, standardMaterial("#27435b", 0.2, 0.6));
  }
  // Thick ribs and columns make the curve legible from the side.
  const ribMat = standardMaterial("#6d523f", 0.08, 0.96);
  for (let d = 0; d <= trackLength; d += 3.5) {
    const { point, angle } = trackAt(d),
      rib = new THREE.Group();
    rib.position.copy(point);
    rib.rotation.z = angle;
    ramp.add(rib);
    addBox(rib, 1.15, 0.35, ROAD_WIDTH + 0.32, ribMat, 0, -0.22, 0);
  }
  for (const d of [4, ENTRY_LENGTH / 2, ENTRY_LENGTH - 2, ENTRY_LENGTH + arcLength - 2, trackLength - 2]) {
    const { point } = trackAt(d);
    for (const z of [-ROAD_WIDTH / 2 + 0.4, ROAD_WIDTH / 2 - 0.4])
      addBox(
        scene,
        0.34,
        point.y - 0.25,
        0.34,
        ribMat,
        point.x,
        (point.y - 0.25) / 2,
        z,
      );
  }
  // Vehicle local X: front; Z: left/right. Its origin is near the center of mass.
  const vehicle = new THREE.Group();
  scene.add(vehicle);
  const body = new THREE.Group();
  vehicle.add(body);
  // Keep an original procedural fallback until the licensed GLB is provided.
  const fallbackCar = new THREE.Group();
  body.add(fallbackCar);
  const stations = [
    [-2.65, 0.64, 0.78],
    [-2.0, 0.94, 1.04],
    [-1.2, 1.08, 1.08],
    [0.3, 1.1, 1.07],
    [1.5, 0.96, 1.02],
    [2.38, 0.77, 0.9],
    [2.7, 0.58, 0.71],
  ];
  const vertices = [],
    indices = [];
  for (const [x, top, width] of stations) {
    vertices.push(
      x,
      top,
      width,
      x,
      top,
      -width,
      x,
      0.13,
      width,
      x,
      0.13,
      -width,
    );
  }
  for (let i = 0; i < stations.length - 1; i++) {
    const a = i * 4,
      b = (i + 1) * 4;
    for (const [u, v] of [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ]) {
      indices.push(a + u, a + v, b + v, a + u, b + v, b + u);
    }
  }
  indices.push(0, 1, 3, 0, 3, 2);
  const end = (stations.length - 1) * 4;
  indices.push(end, end + 2, end + 3, end, end + 3, end + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  addMesh(geometry, red, fallbackCar);
  // Rounded hood, tapering cabin and dark roof.
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-1.48, 0);
  roofShape.lineTo(-0.9, 0.67);
  roofShape.lineTo(0.55, 0.72);
  roofShape.lineTo(1.06, 0);
  roofShape.closePath();
  const cabinGeo = new THREE.ExtrudeGeometry(roofShape, {
    depth: 1.6,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.1,
    bevelThickness: 0.1,
  });
  const cabin = addMesh(cabinGeo, glass, fallbackCar, 0, 1.0, -0.8);
  cabin.castShadow = true;
  addBox(fallbackCar, 3.5, 0.12, 2.03, carbon, -0.12, 0.3, 0);
  addBox(fallbackCar, 1.7, 0.11, 1.72, black, -0.12, 1.73, 0);
  for (const side of [-1, 1]) {
    addBox(fallbackCar, 3.5, 0.16, 0.1, carbon, -0.12, 0.17, side * 1.06);
    addBox(fallbackCar, 0.36, 0.065, 0.2, chrome, 0.55, 1.2, side * 1.02);
  }
  // Head and tail light ribbons, aerodynamic rear diffuser.
  for (const s of [-1, 1]) {
    const lamp = addBox(fallbackCar, 0.55, 0.055, 0.25, neon, 2.53, 0.74, s * 0.55);
    lamp.rotation.y = s * 0.18;
    addBox(
      fallbackCar,
      0.25,
      0.06,
      0.66,
      standardMaterial("#ff173c", 0.15, 0.25),
      -2.58,
      0.69,
      s * 0.57,
    );
  }
  addBox(fallbackCar, 0.38, 0.14, 1.85, black, -2.52, 0.1, 0);
  addBox(fallbackCar, 0.4, 0.12, 1.88, black, 2.52, 0.1, 0);
  for (const x of [-1.75, 1.76])
    for (const s of [-1, 1]) {
      const wheel = new THREE.Group();
      wheel.position.set(x, 0.17, s * 1.1);
      fallbackCar.add(wheel);
      const rubber = addMesh(
        new THREE.CylinderGeometry(0.48, 0.48, 0.28, 32),
        standardMaterial("#080a0d", 0, 0.95),
        wheel,
      );
      rubber.rotation.x = Math.PI / 2;
      const rim = addMesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.297, 16),
        chrome,
        wheel,
      );
      rim.rotation.x = Math.PI / 2;
      const hub = addMesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.315, 16),
        carbon,
        wheel,
      );
      hub.rotation.x = Math.PI / 2;
    }
  const subaru = new THREE.Group();
  body.add(subaru);
  const loader = new GLTFLoader();
  loader.load(
    "/models/2002_subaru_impreza_wrx_sti_extreme.glb",
    (gltf) => {
      const model = gltf.scene;
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      const dimensions = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      // Most glTF exports point along -Z. Convert that longitudinal axis to +X.
      const lengthAlongZ = dimensions.z > dimensions.x;
      const longitudinalSize = lengthAlongZ ? dimensions.z : dimensions.x;
      const factor = 4.5 / Math.max(longitudinalSize, 0.001);
      model.position.sub(center);
      const container = new THREE.Group();
      container.add(model);
      container.scale.setScalar(factor);
      // Face the Subaru into the half-loop (+X travel direction).
      container.rotation.y = lengthAlongZ ? Math.PI / 2 : Math.PI;
      subaru.add(container);
      // Position the center of the model close to the simulation's physical origin.
      subaru.position.y = 0.75;
      subaru.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      fallbackCar.visible = false;
      console.info("Subaru GLB loaded. Verify forward orientation and wheel alignment.");
    },
    undefined,
    (error) => {
      console.warn("Subaru GLB unavailable. Using procedural fallback.", error);
    },
  );
  // Four gimballed jets: local down = thrust reaction along vehicle up.
  const thrusters = [];
  const jetMounts: { tilt: THREE.Group; fallbackJet: THREE.Group }[] = [];
  for (const x of [-1.8, 1.8])
    for (const z of [-1.08, 1.08]) {
      const yaw = new THREE.Group();
      yaw.position.set(x, -0.1, z);
      body.add(yaw);
      const tilt = new THREE.Group();
      yaw.add(tilt);
      // The uploaded jetpack GLB replaces the procedural jet geometry.
      // A lightweight silhouette is used only if the file fails to load.
      const fallbackJet = new THREE.Group();
      tilt.add(fallbackJet);
      addMesh(new THREE.CylinderGeometry(0.12, 0.2, 0.55, 12), carbon, fallbackJet, 0, -0.31, 0);
      addMesh(new THREE.CylinderGeometry(0.2, 0.17, 0.11, 12), chrome, fallbackJet, 0, -0.62, 0);
      jetMounts.push({ tilt, fallbackJet });
      const exhaust = addMesh(
        new THREE.CylinderGeometry(0.09, 0.24, 0.94, 20, 1, true),
        new THREE.MeshBasicMaterial({
          color: "#39c5ff",
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
        tilt,
        0,
        -1.14,
        0,
      );
      exhaust.visible = false;
      const light = new THREE.PointLight("#46bfff", 0, 3.5);
      light.position.set(0, -0.72, 0);
      tilt.add(light);
      thrusters.push({ x, z, yaw, tilt, exhaust, light, power: 0 });
    }
  loader.load("/models/jetpack_propulsor.glb", (gltf) => {
    const original = gltf.scene;
    original.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(original);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = 0.75 / Math.max(size.x, size.y, size.z, 0.001);
    for (const mount of jetMounts) {
      const model = original.clone(true);
      model.position.sub(center);
      const pivot = new THREE.Group();
      pivot.position.y = -0.37;
      pivot.scale.setScalar(scale);
      pivot.add(model);
      mount.tilt.add(pivot);
      mount.fallbackJet.visible = false;
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) child.castShadow = true;
      });
    }
  }, undefined, (error) => console.warn("Jetpack asset load failed, using fallback.", error));
  return {
    scene,
    camera,
    renderer,
    orbit,
    trackAt,
    trackLength,
    landingX,
    landingZ,
    rampLandingHeight,
    landingSurfaceAt,
    vehicle,
    body,
    thrusters,
  };
}
