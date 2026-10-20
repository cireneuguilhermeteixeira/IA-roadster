import * as THREE from "three";

/** Seeded, lightweight vegetation inspired by Ceará's semi-arid Caatinga biome.
 * All objects are purely decorative and have no physical colliders.
 */
export function createCaatinga(scene: THREE.Scene): void {
  let seed = 20261020;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  const sandy = new THREE.MeshStandardMaterial({ color: 0xa87b52, roughness: 1 });
  const rock = new THREE.MeshStandardMaterial({ color: 0x796954, roughness: 0.98 });
  const cactus = new THREE.MeshStandardMaterial({ color: 0x426d3c, roughness: 0.9 });
  const trunk = new THREE.MeshStandardMaterial({ color: 0x735842, roughness: 1 });
  const palms = new THREE.MeshStandardMaterial({ color: 0x758149, side: THREE.DoubleSide, roughness: 0.95 });
  const branches = new THREE.MeshStandardMaterial({ color: 0x74644b, roughness: 1 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x777c40, roughness: 1, side: THREE.DoubleSide });

  const cylinder = (parent: THREE.Object3D, radiusA: number, radiusB: number, height: number, material: THREE.Material, sides = 7) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusA, radiusB, height, sides), material);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const stalk = (parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material) => {
    const direction = b.clone().sub(a);
    const mesh = cylinder(parent, radius * 0.75, radius, direction.length(), material, 6);
    mesh.position.copy(a).addScaledVector(direction, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return mesh;
  };
  function mandacaru(height: number): THREE.Group {
    const group = new THREE.Group();
    stalk(group, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, height, 0), 0.17, cactus);
    for (const [i, side] of [-1, 1].entries()) {
      const h = height * (0.32 + i * 0.21);
      const out = new THREE.Vector3(side * 0.5, h + 0.12, 0.07);
      stalk(group, new THREE.Vector3(0, h, 0), out, 0.1, cactus);
      stalk(group, out, new THREE.Vector3(out.x, h + height * 0.42, out.z), 0.09, cactus);
    }
    return group;
  }
  function carnauba(height: number): THREE.Group {
    const group = new THREE.Group();
    const top = new THREE.Vector3(0, height, 0);
    stalk(group, new THREE.Vector3(0, 0, 0), top, 0.13, trunk);
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const reach = 1.3 + (i % 3) * 0.16;
      const tip = new THREE.Vector3(Math.cos(angle) * reach, height - 0.45, Math.sin(angle) * reach);
      const base = new THREE.Vector3(0, height - 0.05, 0);
      stalk(group, base, tip, 0.023, branches);
      const mid = base.clone().lerp(tip, 0.52).add(new THREE.Vector3(0, 0.25, 0));
      const l = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(0.34);
      const geo = new THREE.BufferGeometry().setFromPoints([base, mid.clone().add(l), tip, mid.clone().sub(l)]);
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      geo.computeVertexNormals();
      const frond = new THREE.Mesh(geo, palms);
      frond.castShadow = true;
      group.add(frond);
    }
    return group;
  }
  function dryTree(height: number): THREE.Group {
    const group = new THREE.Group();
    const root = new THREE.Vector3();
    const crown = new THREE.Vector3(0, height * 0.7, 0);
    stalk(group, root, crown, 0.11, branches);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const end = new THREE.Vector3(Math.cos(angle) * height * 0.34, height * (0.8 + random() * 0.25), Math.sin(angle) * height * 0.34);
      stalk(group, crown, end, 0.052, branches);
      if (i % 2 === 0) {
        const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(height * 0.19, 0), leaf);
        tuft.position.copy(end);
        tuft.scale.y = 0.55;
        group.add(tuft);
      }
    }
    return group;
  }
  const terrainPatches = new THREE.Group();
  scene.add(terrainPatches);
  for (let i = 0; i < 210; i++) {
    const x = (random() - 0.5) * 510;
    const z = (random() - 0.5) * 510;
    // Leave ample clearance around the ramp, landing zone, and approach.
    if (Math.abs(z) < 19 && x > -95 && x < 40) continue;
    const choice = random();
    const item = choice < 0.20 ? carnauba(5 + random() * 4) :
      choice < 0.49 ? mandacaru(2 + random() * 2.8) : dryTree(2.4 + random() * 2.3);
    item.position.set(x, 0, z);
    item.rotation.y = random() * Math.PI * 2;
    item.scale.multiplyScalar(0.8 + random() * 0.5);
    terrainPatches.add(item);
  }
  for (let i = 0; i < 160; i++) {
    const x = (random() - 0.5) * 460;
    const z = (random() - 0.5) * 460;
    if (Math.abs(z) < 13 && x > -95 && x < 40) continue;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25 + random() * 0.7, 0), i % 3 ? rock : sandy);
    stone.position.set(x, 0.04, z);
    stone.scale.y = 0.4 + random() * 0.5;
    stone.rotation.y = random() * Math.PI;
    stone.receiveShadow = true;
    terrainPatches.add(stone);
  }
}
