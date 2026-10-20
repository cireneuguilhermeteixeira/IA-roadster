import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

export const MASS = 1450;
export const MAX_THRUST = 11000;
export const FIXED_DT = 1 / 120;
export const GRAVITY = -9.81;
const FOUR_WHEELS = [
  new THREE.Vector3(-1.76, 0.17, -1.1),
  new THREE.Vector3(-1.76, 0.17, 1.1),
  new THREE.Vector3(1.76, 0.17, -1.1),
  new THREE.Vector3(1.76, 0.17, 1.1),
];
type Waypoint = { point: THREE.Vector3; angle: number };
export type ThrusterVisual = {x:number;z:number;power:number;tilt:THREE.Group;yaw:THREE.Group;exhaust:THREE.Mesh;light:THREE.PointLight};
export type State = {
  position: THREE.Vector3; rotation: THREE.Quaternion; velocity: THREE.Vector3; angularVelocity: THREE.Vector3;
};
export type FlightInputs = { torque: THREE.Vector3; base: number; forward: number; lateral: number; tiltX?:number;tiltZ?:number };
const asVector = (v: THREE.Vector3) => ({ x:v.x, y:v.y, z:v.z });
const asQuaternion = (q: THREE.Quaternion) => ({ x:q.x, y:q.y, z:q.z, w:q.w });

export class VehiclePhysics {
  readonly world: RAPIER.World;
  readonly body: RAPIER.RigidBody;
  private readonly thrusters: ThrusterVisual[];
  private readonly trackAt: (distance:number)=>Waypoint;
  private readonly trackLength: number;
  private along = 0;
  private released = false;
  private readonly motorForce = 32000;
  constructor(
    ramp: THREE.Mesh,
    trackAt: (distance:number)=>Waypoint,
    trackLength: number,
    thrusters: ThrusterVisual[],
  ) {
    this.world = new RAPIER.World({x:0,y:GRAVITY,z:0});
    this.world.timestep = FIXED_DT;
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(115,0.15,115).setTranslation(0,-0.15,0).setFriction(0.9));
    // Reuse the *rendered* ramp triangle mesh as the actual physics collision surface.
    const geom = ramp.geometry as THREE.BufferGeometry;
    const coords = geom.getAttribute("position").array as Float32Array;
    const idx = geom.getIndex()!.array;
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(
      Float32Array.from(coords), Uint32Array.from(idx)
    ).setFriction(0.95));
    this.trackAt=trackAt;
    this.trackLength=trackLength;
    this.thrusters=thrusters;
    const start=trackAt(0).point;
    const desc=RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start.x,start.y+0.63,start.z)
      .setLinearDamping(0.035)
      .setAngularDamping(0.18)
      .setCcdEnabled(true)
      .setAdditionalMassProperties(MASS,{x:0,y:0,z:0},{x:690,y:3050,z:2800},{x:0,y:0,z:0,w:1});
    this.body=this.world.createRigidBody(desc);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(2.18,0.33,0.85)
      .setTranslation(0,0.53,0).setDensity(0).setFriction(0.8),this.body);
    // Physical tire collision volumes, fixed to chassis for the initial prototype.
    for(const mount of FOUR_WHEELS) {
      this.world.createCollider(RAPIER.ColliderDesc.ball(0.45).setTranslation(mount.x,mount.y,mount.z)
        .setFriction(1.2).setRestitution(0.05).setDensity(0),this.body);
    }
  }
  reset() {
    this.released=false;this.along=0;
    const start=this.trackAt(0).point;
    this.body.setTranslation({x:start.x,y:start.y+0.63,z:0},true);
    this.body.setRotation({x:0,y:0,z:0,w:1},true);
    this.body.setLinvel({x:0,y:0,z:0},true);
    this.body.setAngvel({x:0,y:0,z:0},true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    for(const t of this.thrusters) {
      t.power=0;t.yaw.visible=false;t.tilt.rotation.set(0,0,0);
      t.exhaust.visible=false;t.light.intensity=0;
    }
  }
  get flying(){return this.released;}
  get progress(){return this.along;}
  snapshot(): State {
    const p=this.body.translation(),r=this.body.rotation(),v=this.body.linvel(),w=this.body.angvel();
    return {
      position:new THREE.Vector3(p.x,p.y,p.z),
      rotation:new THREE.Quaternion(r.x,r.y,r.z,r.w),
      velocity:new THREE.Vector3(v.x,v.y,v.z),
      angularVelocity:new THREE.Vector3(w.x,w.y,w.z),
    };
  }
  private applyAt(force:THREE.Vector3,point:THREE.Vector3) {
    this.body.addForceAtPoint(asVector(force),asVector(point),true);
  }
  private trackDrive(dt:number) {
    const state=this.snapshot();
    // Closest-point search is control logic only; Rapier remains authoritative for position.
    const searchA=Math.max(0,this.along-5), searchB=Math.min(this.trackLength,this.along+8);
    let nearest=this.along,best=Infinity;
    for(let s=searchA;s<=searchB;s+=0.4) {
      const p=this.trackAt(s).point;
      const dist=p.distanceToSquared(state.position);
      if(dist<best){best=dist;nearest=s;}
    }
    this.along=Math.max(this.along,nearest);
    const route=this.trackAt(this.along);
    const tangent=new THREE.Vector3(Math.cos(route.angle),Math.sin(route.angle),0);
    const normal=new THREE.Vector3(-Math.sin(route.angle),Math.cos(route.angle),0);
    const destination=route.point.clone().addScaledVector(normal,0.64);
    const error=destination.sub(state.position);
    // The loop requires explicit active magnetic guide forces; never teleport the chassis.
    const guide=error.multiplyScalar(120000).addScaledVector(state.velocity,-16500);
    guide.clampLength(0,220000);
    this.body.addForce(asVector(guide),true);
    const velocityAlong=state.velocity.dot(tangent);
    this.body.addForce(asVector(tangent.multiplyScalar(
      THREE.MathUtils.clamp((25-velocityAlong)*11000,-this.motorForce,this.motorForce)
    )),true);
    // Keep the roof oriented to the track by a physically applied PD torque.
    const target=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),route.angle);
    const delta=target.multiply(state.rotation.clone().invert());
    if(delta.w<0)delta.set(-delta.x,-delta.y,-delta.z,-delta.w);
    const axis=new THREE.Vector3(delta.x,delta.y,delta.z);
    const correction=axis.multiplyScalar(65000).addScaledVector(state.angularVelocity,-22000);
    correction.clampLength(0,90000);
    this.body.addTorque(asVector(correction),true);
    // Release only after physically reaching the exit.
    if(this.along>=this.trackLength-0.5 && state.position.x<=this.trackAt(this.trackLength).point.x+1) {
      this.released=true;
      for(const t of this.thrusters)t.yaw.visible=true;
    }
  }
  step(dt:number, mode:"ready"|"ramp"|"flight",input:FlightInputs) {
    if(mode==="ready")return;
    if(!this.released) this.trackDrive(dt);
    else this.flightForces(dt,input);
    this.world.timestep=dt;
    this.world.step();
  }
  private flightForces(dt:number,input:FlightInputs) {
    const state=this.snapshot(),q=state.rotation;
    for(const t of this.thrusters) {
      // r × F: roll contribution is -z*Fy; pitch contribution is x*Fy.
      const target=THREE.MathUtils.clamp(input.base
        -input.torque.x*t.z/(4*1.1*1.1*MAX_THRUST)
        +input.torque.z*t.x/(4*1.76*1.76*MAX_THRUST),0,1);
      t.power=THREE.MathUtils.damp(t.power,target,5,dt);
      t.tilt.rotation.x=THREE.MathUtils.damp(t.tilt.rotation.x,THREE.MathUtils.clamp((input.tiltX??0)+input.forward+input.torque.y*t.z/60000,-0.65,0.65),4,dt);
      t.tilt.rotation.z=THREE.MathUtils.damp(t.tilt.rotation.z,THREE.MathUtils.clamp((input.tiltZ??0)-input.lateral+input.torque.y*t.x/85000,-0.65,0.65),4,dt);
      const direction=new THREE.Vector3(0,1,0).applyEuler(t.tilt.rotation).applyQuaternion(q);
      const force=direction.multiplyScalar(t.power*MAX_THRUST);
      const mount=new THREE.Vector3(t.x,0.17,t.z).applyQuaternion(q).add(state.position);
      this.applyAt(force,mount);
      t.exhaust.visible=t.power>0.02;
      t.exhaust.scale.y=0.38+t.power*1.7;
      t.light.intensity=t.power*5;
    }
  }
}
