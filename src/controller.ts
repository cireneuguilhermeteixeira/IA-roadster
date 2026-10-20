import * as THREE from "three";
import { MASS,MAX_THRUST, type State, type FlightInputs } from "./physics";

export class FlightController {
  private readonly target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI);
  command(state:State,keys:Record<string,boolean>,auto:boolean,throttle:number,landing:THREE.Vector3): FlightInputs {
    const axis=(plus:string,minus:string)=>Number(Boolean(keys[plus]))-Number(Boolean(keys[minus]));
    const torque=new THREE.Vector3(axis("KeyA","KeyD")*14000,axis("KeyQ","KeyE")*8000,axis("KeyW","KeyS")*17000);
    let base=keys.ShiftLeft||keys.ShiftRight?1:throttle;
    let tiltX=0,tiltZ=0;
    if(auto) {
      const error=this.target.clone().multiply(state.rotation.clone().invert());
      if(error.w<0)error.set(-error.x,-error.y,-error.z,-error.w);
      const magnitude=2*Math.atan2(Math.hypot(error.x,error.y,error.z),Math.abs(error.w));
      const direction=new THREE.Vector3(error.x,error.y,error.z).normalize();
      const omega=state.angularVelocity;
      torque.add(new THREE.Vector3(
        direction.x*magnitude*15000-omega.x*14000,
        direction.y*magnitude*11000-omega.y*8500,
        direction.z*magnitude*17500-omega.z*16000
      ));
      torque.clampLength(0,32000);
      const up=new THREE.Vector3(0,1,0).applyQuaternion(state.rotation);
      if(up.y>0.5) {
        const descendTarget=state.position.y>10?-3.5:-1.5;
        const verticalAcceleration=THREE.MathUtils.clamp((descendTarget-state.velocity.y)*2.2,-8,12);
        base=THREE.MathUtils.clamp(MASS*(9.81+verticalAcceleration)/(4*MAX_THRUST*Math.max(0.5,up.y)),0,0.96);
        const desired=new THREE.Vector3(
          THREE.MathUtils.clamp((landing.x-state.position.x)*0.45-state.velocity.x*0.7,-4,4),
          9.81+verticalAcceleration,
          THREE.MathUtils.clamp((landing.z-state.position.z)*0.45-state.velocity.z*0.7,-4,4)
        ).applyQuaternion(state.rotation.clone().invert());
        tiltZ=THREE.MathUtils.clamp(-Math.atan2(desired.x,desired.y),-0.35,0.35);
        tiltX=THREE.MathUtils.clamp(Math.atan2(desired.z,desired.y),-0.35,0.35);
      } else base=0.72;
    }
    return {torque,base,tiltX,tiltZ,forward:axis("ArrowUp","ArrowDown")*0.5,lateral:axis("ArrowRight","ArrowLeft")*0.5};
  }
}
