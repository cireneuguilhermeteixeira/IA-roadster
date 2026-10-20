import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

export const MASS = 1450;
export const MAX_THRUST = 6000;
export const FIXED_DT = 1 / 120;
export const GRAVITY = -9.81;
type Waypoint = { point: THREE.Vector3; angle: number };
export type ThrusterVisual = {
  x: number;
  z: number;
  power: number;
  tilt: THREE.Group;
  yaw: THREE.Group;
  exhaust: THREE.Mesh;
  light: THREE.PointLight;
};
export type State = {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
};
export type FlightInputs = {
  torque: THREE.Vector3;
  base: number;
  powerLimit: number;
  forward: number;
  lateral: number;
  thrustDirection?: THREE.Vector3;
};
const asVector = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });

export class VehiclePhysics {
  readonly world: RAPIER.World;
  readonly body: RAPIER.RigidBody;
  private readonly thrusters: ThrusterVisual[];
  private readonly trackAt: (distance: number) => Waypoint;
  private readonly trackLength: number;
  private along = 0;
  private released = false;
  private landed = false;
  private readonly motorForce = 60000;
  constructor(
    ramp: THREE.Mesh,
    trackAt: (distance: number) => Waypoint,
    trackLength: number,
    thrusters: ThrusterVisual[],
    private readonly reactorsEnabled = true,
  ) {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = FIXED_DT;
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(115, 0.15, 115).setTranslation(0, -0.15, 0).setFriction(0.9),
    );
    // Reuse the *rendered* ramp triangle mesh as the actual physics collision surface.
    const geom = ramp.geometry as THREE.BufferGeometry;
    const coords = geom.getAttribute("position").array as Float32Array;
    const idx = geom.getIndex()!.array;
    this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(Float32Array.from(coords), Uint32Array.from(idx)).setFriction(
        0.35,
      ),
    );
    this.trackAt = trackAt;
    this.trackLength = trackLength;
    this.thrusters = thrusters;
    const start = trackAt(0).point;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start.x, start.y + 0.31, start.z)
      .setLinearDamping(0.035)
      .setAngularDamping(0.18)
      .setCcdEnabled(true)
      .setAdditionalMassProperties(
        MASS,
        { x: 0, y: 0, z: 0 },
        { x: 690, y: 3050, z: 2800 },
        { x: 0, y: 0, z: 0, w: 1 },
      );
    this.body = this.world.createRigidBody(desc);
    // One rounded underbody avoids the impulses caused by rigid, non-rolling tire spheres.
    this.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(2.12, 0.18, 1.04, 0.12)
        .setDensity(0)
        .setFriction(0.15)
        .setRestitution(0),
      this.body,
    );
  }
  reset() {
    this.released = false;
    this.landed = false;
    this.along = 0;
    const start = this.trackAt(0).point;
    this.body.setTranslation({ x: start.x, y: start.y + 0.31, z: 0 }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.disableThrusters();
    for (const t of this.thrusters) {
      t.yaw.visible = false;
      t.tilt.rotation.set(0, 0, 0);
    }
  }
  get flying() {
    return this.released;
  }
  get grounded() {
    return this.landed;
  }
  private disableThrusters() {
    for (const t of this.thrusters) {
      t.power = 0;
      t.exhaust.visible = false;
      t.light.intensity = 0;
    }
  }
  snapshot(): State {
    const p = this.body.translation(),
      r = this.body.rotation(),
      v = this.body.linvel(),
      w = this.body.angvel();
    return {
      position: new THREE.Vector3(p.x, p.y, p.z),
      rotation: new THREE.Quaternion(r.x, r.y, r.z, r.w),
      velocity: new THREE.Vector3(v.x, v.y, v.z),
      angularVelocity: new THREE.Vector3(w.x, w.y, w.z),
    };
  }
  private applyAt(force: THREE.Vector3, point: THREE.Vector3) {
    this.body.addForceAtPoint(asVector(force), asVector(point), true);
  }
  private trackDrive() {
    const state = this.snapshot();
    const exit = this.trackAt(this.trackLength).point;
    // The top exit is at the same X as part of the lower road: height matters.
    if (state.position.x <= exit.x + 0.3 && state.position.y >= exit.y - 2) {
      this.released = true;
      for (const thruster of this.thrusters) thruster.yaw.visible = true;
      return;
    }
    // Continuous closest point keeps the guide target from jumping between samples.
    let searchA = Math.max(0, this.along - 2);
    let searchB = Math.min(this.trackLength, this.along + 3);
    for (let i = 0; i < 16; i++) {
      const third = (searchB - searchA) / 3;
      const left = searchA + third;
      const right = searchB - third;
      if (
        this.trackAt(left).point.distanceToSquared(state.position) <
        this.trackAt(right).point.distanceToSquared(state.position)
      ) {
        searchB = right;
      } else {
        searchA = left;
      }
    }
    this.along = Math.max(this.along, (searchA + searchB) / 2);
    const route = this.trackAt(this.along);
    const tangent = new THREE.Vector3(Math.cos(route.angle), Math.sin(route.angle), 0);
    const normal = new THREE.Vector3(-Math.sin(route.angle), Math.cos(route.angle), 0);
    const destination = route.point.clone().addScaledVector(normal, 0.31);
    // The magnetic guide acts across the road, never against forward travel.
    const normalError = destination.sub(state.position).dot(normal);
    const normalSpeed = state.velocity.dot(normal);
    const normalForce = THREE.MathUtils.clamp(
      normalError * 85000 - normalSpeed * 22000,
      -65000,
      65000,
    );
    const lateralForce = THREE.MathUtils.clamp(
      -state.position.z * 45000 - state.velocity.z * 15000,
      -30000,
      30000,
    );
    const guide = normal.multiplyScalar(normalForce);
    guide.z = lateralForce;
    this.body.addForce(asVector(guide), true);
    const velocityAlong = state.velocity.dot(tangent);
    const remaining = this.trackLength - this.along;
    // Brake before the edge so the jets have a realistic amount of momentum to cancel.
    const targetSpeed = Math.min(18, Math.sqrt(16 * Math.max(remaining, 0)));
    const motorGain = remaining < 21 ? 10000 : 5000;
    this.body.addForce(
      asVector(
        tangent.multiplyScalar(
          THREE.MathUtils.clamp(
            (targetSpeed - velocityAlong) * motorGain,
            -this.motorForce,
            this.motorForce,
          ),
        ),
      ),
      true,
    );
    // Keep the roof oriented to the track by a physically applied PD torque.
    const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), route.angle);
    const delta = target.multiply(state.rotation.clone().invert());
    if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
    const axis = new THREE.Vector3(delta.x, delta.y, delta.z);
    const correction = axis.multiplyScalar(65000).addScaledVector(state.angularVelocity, -22000);
    correction.clampLength(0, 90000);
    this.body.addTorque(asVector(correction), true);
  }
  step(dt: number, input?: FlightInputs) {
    // Rapier keeps user forces and torques until they are explicitly cleared.
    // The ramp guide must stop acting as soon as the vehicle is released.
    this.body.resetForces(true);
    this.body.resetTorques(true);
    if (!this.released) this.trackDrive();
    else if (input && !this.landed) this.flightForces(dt, input);
    this.world.timestep = dt;
    this.world.step();
    if (this.released && !this.landed) {
      const position = this.body.translation();
      const velocity = this.body.linvel();
      if (position.y <= 0.33 && Math.abs(velocity.y) < 1) {
        this.landed = true;
        this.disableThrusters();
      }
    }
  }
  private flightForces(dt: number, input: FlightInputs) {
    const powerLimit = THREE.MathUtils.clamp(input.powerLimit, 0, 1);
    if (!this.reactorsEnabled || powerLimit === 0) {
      this.disableThrusters();
      return;
    }
    const state = this.snapshot(),
      q = state.rotation;
    for (const t of this.thrusters) {
      if (input.thrustDirection) {
        const localDirection = input.thrustDirection.clone().applyQuaternion(q.clone().invert());
        const target = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          localDirection,
        );
        t.tilt.quaternion.rotateTowards(target, 5 * dt);
      } else {
        t.tilt.rotation.x = THREE.MathUtils.damp(
          t.tilt.rotation.x,
          THREE.MathUtils.clamp(input.forward + (input.torque.y * t.z) / 60000, -0.65, 0.65),
          3,
          dt,
        );
        t.tilt.rotation.z = THREE.MathUtils.damp(
          t.tilt.rotation.z,
          THREE.MathUtils.clamp(-input.lateral + (input.torque.y * t.x) / 85000, -0.65, 0.65),
          3,
          dt,
        );
      }
      const localDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(t.tilt.quaternion);
      const direction = localDirection.clone().applyQuaternion(q);
      const alignment = input.thrustDirection
        ? THREE.MathUtils.clamp(direction.dot(input.thrustDirection), 0, 1)
        : 1;
      const verticalAuthority =
        Math.sign(localDirection.y || 1) * Math.max(0.25, Math.abs(localDirection.y));
      // r × F: roll contribution is -z*Fy; pitch contribution is x*Fy.
      const target = THREE.MathUtils.clamp(
        input.base * alignment -
          (input.torque.x * t.z) / (4 * 1.1 * 1.1 * MAX_THRUST * verticalAuthority) +
          (input.torque.z * t.x) / (4 * 1.76 * 1.76 * MAX_THRUST * verticalAuthority),
        0,
        powerLimit,
      );
      // A lower slider setting takes effect immediately, even while power is ramping down.
      t.power = Math.min(powerLimit, THREE.MathUtils.damp(t.power, target, 3, dt));
      const force = direction.multiplyScalar(t.power * MAX_THRUST);
      const mount = new THREE.Vector3(t.x, 0.17, t.z).applyQuaternion(q).add(state.position);
      this.applyAt(force, mount);
      t.exhaust.visible = t.power > 0.02;
      t.exhaust.scale.y = 0.38 + t.power * 1.7;
      t.light.intensity = t.power * 5;
    }
  }
}
