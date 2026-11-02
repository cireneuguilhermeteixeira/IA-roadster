import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

/** Approximate chassis mass in kilograms. */
export const MASS = 1450;
/** Maximum force, in newtons, produced by one fully powered thruster. */
export const MAX_THRUST = 6000;
/** Longitudinal and lateral offsets of the four thruster mounting points. */
export const THRUSTER_X = 1.56;
export const THRUSTER_Z = 0.7;
/** Fixed Rapier step in seconds; independent of the display refresh rate. */
export const FIXED_DT = 1 / 120;
/** World vertical acceleration in meters per second squared. */
export const GRAVITY = -9.81;
/** Position and tangent angle of one point along the ramp centerline. */
type Waypoint = { point: THREE.Vector3; angle: number };
/** Shared motor state: mount coordinates, current power, and Three.js visual parts. */
export type ThrusterVisual = {
  /** Local X/Z position of the motor relative to the body origin. */
  x: number;
  z: number;
  /** Current normalized thrust after power-limit and smoothing rules. */
  power: number;
  /** Nozzle pivot and deployable parent in the visible car or dummy equivalents. */
  tilt: THREE.Group;
  yaw: THREE.Group;
  /** Flame mesh and light driven by current motor power. */
  exhaust: THREE.Mesh;
  light: THREE.PointLight;
};
/** A detached snapshot of the car's position, orientation, and motion. */
export type State = {
  /** World-space center of mass and attitude quaternion. */
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  /** World-space linear velocity and angular velocity in rad/s. */
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
};
/** Commands accepted by the physics step from manual, automatic, or neural control. */
export type FlightInputs = {
  /** Requested body torque and common base power for the hand-coded controller. */
  torque: THREE.Vector3;
  base: number;
  /** Per-motor power ceiling after the user throttle and landing limiter. */
  powerLimit: number;
  /** Manual nozzle offsets in the car's forward and lateral directions. */
  forward: number;
  lateral: number;
  /** Optional world-space force direction used by automatic stabilization. */
  thrustDirection?: THREE.Vector3;
  /** Optional per-motor neural power and nozzle angles, overriding base control. */
  jets?: { power: number; tiltX: number; tiltZ: number }[];
  /** Cut neural thrust on a low-altitude collider contact. */
  cutOnContact?: boolean;
  touchdownCeiling?: number;
};
/** Convert a Three.js vector into the plain coordinate object expected by Rapier. */
const asVector = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });

/** Owns one independent Rapier world and applies the ramp and flight forces. */
export class VehiclePhysics {
  /** Rapier simulation, separate from any other VehiclePhysics instance. */
  readonly world: RAPIER.World;
  /** Dynamic rigid body whose state drives the visible car or a training episode. */
  readonly body: RAPIER.RigidBody;
  /** Static ground plane used for both support and ground-contact detection. */
  private readonly groundCollider: RAPIER.Collider;
  /** Static triangle mesh copied from the rendered ramp surface. */
  private readonly rampCollider: RAPIER.Collider;
  /** Rounded underbody collider attached to the dynamic car. */
  private readonly chassisCollider: RAPIER.Collider;
  /** Four motor mounts; training uses lightweight stand-ins for their visuals. */
  private readonly thrusters: ThrusterVisual[];
  /** Returns the geometric centerline point and tangent at a traveled distance. */
  private readonly trackAt: (distance: number) => Waypoint;
  /** Maximum distance accepted by trackAt before the upper exit. */
  private readonly trackLength: number;
  /** Monotonic distance reached along the ramp centerline. */
  private along = 0;
  /** True after the car reaches the upper exit and stops using the ramp guide. */
  private released = false;
  /** True once contact remains quiet long enough to declare a landing. */
  private landed = false;
  /** Consecutive contact time below the landing speed and spin thresholds. */
  private stableContactSeconds = 0;
  /** Latches the neural engine cutoff after a valid low-altitude contact. */
  private neuralEnginesCut = false;
  /** Force ceiling of the ramp drive motor, not of the four flight thrusters. */
  private readonly motorForce = 60000;
  /**
   * Build static surfaces and a dynamic chassis from the rendered ramp.
   * @param ramp Indexed Three.js deck mesh whose triangles become the Rapier ramp collider.
   * @param trackAt Centerline lookup used by the assisted ramp drive.
   * @param trackLength Total centerline distance to the upper exit.
   * @param thrusters Four motor mounts; dummy visual objects are sufficient during training.
   * @param reactorsEnabled Physical switch that can disable all flight thrust.
   */
  constructor(
    ramp: THREE.Mesh,
    trackAt: (distance: number) => Waypoint,
    trackLength: number,
    thrusters: ThrusterVisual[],
    private readonly reactorsEnabled = true, // Physical on/off switch for flight forces.
  ) {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = FIXED_DT;
    this.groundCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(115, 0.15, 115).setTranslation(0, -0.15, 0).setFriction(0.9),
    );
    // Reuse the *rendered* ramp triangle mesh as the actual physics collision surface.
    // The indexed visual ribbon supplies the vertices and faces of the ramp collider.
    const geom = ramp.geometry as THREE.BufferGeometry;
    const coords = geom.getAttribute("position").array as Float32Array;
    const idx = geom.getIndex()!.array;
    this.rampCollider = this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(Float32Array.from(coords), Uint32Array.from(idx)).setFriction(
        0.35,
      ),
    );
    this.trackAt = trackAt;
    this.trackLength = trackLength;
    this.thrusters = thrusters;
    // The body starts just above the road; damping and CCD stabilize fast contacts.
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
    // The visual wheels have no individual colliders or suspension joints.
    this.chassisCollider = this.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(2.12, 0.18, 1.04, 0.12)
        .setDensity(0)
        .setFriction(0.15)
        .setRestitution(0),
      this.body,
    );
  }
  /** Return this world and all motor state to the beginning of the ramp. */
  reset() {
    this.released = false;
    this.landed = false;
    this.stableContactSeconds = 0;
    this.neuralEnginesCut = false;
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
  /** Reuse the same rigid body for another flight, copying its starting transform and velocities. */
  primeFlight(state: State) {
    this.released = true;
    this.landed = false;
    this.stableContactSeconds = 0;
    this.neuralEnginesCut = false;
    this.body.setTranslation(asVector(state.position), true);
    this.body.setRotation(
      { x: state.rotation.x, y: state.rotation.y, z: state.rotation.z, w: state.rotation.w },
      true,
    );
    this.body.setLinvel(asVector(state.velocity), true);
    this.body.setAngvel(asVector(state.angularVelocity), true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    for (const t of this.thrusters) {
      t.power = 0;
      t.tilt.rotation.set(0, 0, 0);
      t.yaw.visible = true;
    }
  }
  /** Whether the car has reached the ramp exit. */
  get flying() {
    return this.released;
  }
  /** Whether low motion has persisted through a stable contact. */
  get grounded() {
    return this.landed;
  }
  /** Read Rapier contact manifolds; prefer the ramp when both surfaces touch. */
  contactSurface(): "ground" | "ramp" | null {
    const touching = (surface: RAPIER.Collider) => {
      let contact = false;
      this.world.contactPair(this.chassisCollider, surface, (manifold) => {
        if (manifold.numSolverContacts() > 0) contact = true;
      });
      return contact;
    };
    if (touching(this.rampCollider)) return "ramp";
    if (touching(this.groundCollider)) return "ground";
    return null;
  }
  /** Remove motor power and hide the corresponding exhaust effects. */
  private disableThrusters() {
    for (const t of this.thrusters) {
      t.power = 0;
      t.exhaust.visible = false;
      t.light.intensity = 0;
    }
  }
  /** Copy the current Rapier transform and velocities for controllers and scoring. */
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
  /** Apply a world-space force at a world-space point, producing torque as needed. */
  private applyAt(force: THREE.Vector3, point: THREE.Vector3) {
    this.body.addForceAtPoint(asVector(force), asVector(point), true);
  }
  /** Drive along the ramp while guiding the body toward its centerline and angle. */
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
    // Search only near the last progress value so the closest point cannot jump loops.
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
    // Tangent controls forward speed; normal controls separation from the road.
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
  /**
   * Clear old forces, apply this step's control, advance Rapier, and detect landing.
   * `dt` is simulated seconds, normally FIXED_DT; `input` is absent on the ramp.
   */
  step(dt: number, input?: FlightInputs) {
    // Rapier keeps user forces and torques until they are explicitly cleared.
    // The ramp guide must stop acting as soon as the vehicle is released.
    this.body.resetForces(true);
    this.body.resetTorques(true);
    if (!this.released) this.trackDrive();
    else if (input && !this.landed) this.flightForces(dt, input);
    this.world.timestep = dt;
    this.world.step();
    const contact = this.released ? this.contactSurface() : null;
    const touchdownHeight = this.body.translation().y <= (input?.touchdownCeiling ?? Infinity);
    if (input?.cutOnContact && contact && touchdownHeight) {
      this.neuralEnginesCut = true;
      this.disableThrusters();
    }
    if (this.released && !this.landed) {
      const velocity = this.body.linvel();
      const spin = this.body.angvel();
      const nearlyStill =
        Math.hypot(velocity.x, velocity.y, velocity.z) < 0.8 &&
        Math.hypot(spin.x, spin.y, spin.z) < 0.6;
      this.stableContactSeconds =
        nearlyStill && contact && (!input?.cutOnContact || touchdownHeight)
          ? this.stableContactSeconds + dt
          : 0;
      if (this.stableContactSeconds >= 0.4) {
        this.landed = true;
        this.disableThrusters();
      }
    }
  }
  /** Smooth nozzle and power commands before applying each motor at its mount. */
  private flightForces(dt: number, input: FlightInputs) {
    const powerLimit = THREE.MathUtils.clamp(input.powerLimit, 0, 1);
    if (!this.reactorsEnabled || this.neuralEnginesCut || powerLimit === 0) {
      this.disableThrusters();
      return;
    }
    // The same body orientation rotates local nozzle directions and mounts into world space.
    const state = this.snapshot(),
      q = state.rotation;
    for (const [index, t] of this.thrusters.entries()) {
      const direct = input.jets?.[index];
      if (direct) {
        t.tilt.rotation.x = THREE.MathUtils.damp(
          t.tilt.rotation.x,
          THREE.MathUtils.clamp(direct.tiltX, -0.65, 0.65),
          3,
          dt,
        );
        t.tilt.rotation.z = THREE.MathUtils.damp(
          t.tilt.rotation.z,
          THREE.MathUtils.clamp(direct.tiltZ, -0.65, 0.65),
          3,
          dt,
        );
      } else if (input.thrustDirection) {
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
        direct
          ? direct.power
          : input.base * alignment -
              (input.torque.x * t.z) / (4 * THRUSTER_Z ** 2 * MAX_THRUST * verticalAuthority) +
              (input.torque.z * t.x) / (4 * THRUSTER_X ** 2 * MAX_THRUST * verticalAuthority),
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
