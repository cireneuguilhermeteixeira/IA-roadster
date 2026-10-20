import * as THREE from "three";

// Smaller play area with intentionally sparse, larger vegetation meshes.
export function createCaatinga(scene: THREE.Scene): void {
  let seed = 20261020;
  const random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296;
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0x456d3d, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x70874d, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x527a49, roughness: 1, flatShading: true }),
  ];
  const wood = new THREE.MeshStandardMaterial({ color: 0x65513d, roughness: 1 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8b725b, roughness: 1 });
  const environment = new THREE.Group();
  scene.add(environment);

  // At most ~two meshes per tree; silhouette detail is provided by the panorama.
  function vegetation1(height: number, material: THREE.Material): THREE.Group {
    const root = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.25, height * 0.74, 6), wood);
    stem.position.y = height * 0.37;
    root.add(stem);
    const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(height * 0.31, 0), material);
    canopy.scale.set(1.22, 0.58, 1.1);
    canopy.position.y = height * 0.81;
    root.add(canopy);
    return root;
  }
  function vegetation2(height: number): THREE.Group {
    const root = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.24, height, 7), materials[0]);
    stem.position.y = height / 2;
    root.add(stem);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.11, height * 0.45, 6),
        materials[0],
      );
      arm.position.set(side * 0.3, height * 0.68, 0);
      arm.rotation.z = -side * 0.44;
      root.add(arm);
    }
    return root;
  }
  function vegetation3(height: number, material: THREE.Material): THREE.Group {
    const root = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, height * 0.78, 6), wood);
    trunk.position.y = height * 0.39;
    root.add(trunk);
    const leaves = new THREE.Mesh(
      new THREE.ConeGeometry(height * 0.42, height * 0.55, 7),
      material,
    );
    leaves.position.y = height * 0.84;
    root.add(leaves);
    return root;
  }

  // Clusters close to the ramp, not hundreds of objects scattered to the horizon.
  // Fixed positions avoid blocking the ramp and keep the landing lane open.
  const clusters = [
    [-35, -20],
    [-23, -23],
    [-10, -19],
    [7, -20],
    [19, -23],
    [31, -19],
    [-36, 20],
    [-23, 24],
    [-10, 19],
    [8, 21],
    [20, 25],
    [34, 19],
    [-51, -27],
    [-51, 28],
    [43, -33],
    [45, 31],
  ];
  for (const [cx, cz] of clusters) {
    const count = 2 + Math.floor(random() * 2);
    for (let j = 0; j < count; j++) {
      const x = cx + (random() - 0.5) * 9;
      const z = cz + (random() - 0.5) * 9;
      const height = 5.5 + random() * 5;
      const variant = random();
      const material = materials[Math.floor(random() * materials.length)];
      const plant =
        variant < 0.42
          ? vegetation1(height, material)
          : variant < 0.63
            ? vegetation2(height)
            : vegetation3(height, material);
      plant.position.set(x, 0, z);
      plant.rotation.y = random() * Math.PI * 2;
      plant.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = false;
        }
      });
      environment.add(plant);
    }
  }
  const stoneGeometry = new THREE.DodecahedronGeometry(0.65, 0);
  for (let i = 0; i < 24; i++) {
    const x = (random() - 0.5) * 150;
    const z = (random() < 0.5 ? -1 : 1) * (12 + random() * 55);
    const stone = new THREE.Mesh(stoneGeometry, stoneMat);
    stone.position.set(x, 0.18, z);
    stone.scale.set(0.65 + random(), 0.45, 0.65 + random());
    environment.add(stone);
  }
}
