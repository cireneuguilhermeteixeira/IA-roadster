import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { createVisuals } from "./visuals";
import { VehiclePhysics, FIXED_DT } from "./physics";
import { FlightController } from "./controller";
import "./style.css";

const view = createVisuals(document.querySelector<HTMLElement>("#viewport")!);
const {scene,camera,renderer,orbit,vehicle,thrusters,trackAt,trackLength,rampSurface,landingX,landingZ}=view;
const ui = {
  alt:document.querySelector<HTMLElement>("#alt")!,
  att:document.querySelector<HTMLElement>("#att")!,
  speed:document.querySelector<HTMLElement>("#speed")!,
  status:document.querySelector<HTMLElement>("#status")!,
  power:document.querySelector<HTMLElement>("#powerbar")!,
  percent:document.querySelector<HTMLElement>("#percent")!,
  throttle:document.querySelector<HTMLInputElement>("#throttle")!,
  throttleValue:document.querySelector<HTMLElement>("#throttleValue")!,
  auto:document.querySelector<HTMLElement>("#auto")!,
  camera:document.querySelector<HTMLElement>("#camera")!,
};
const keys:Record<string,boolean>={};
const controller=new FlightController();
let physics:VehiclePhysics;
let mode:"ready"|"ramp"|"flight"="ready";
let auto=false,follow=true,throttle=0.5;
const landing=new THREE.Vector3(landingX,0,landingZ);
function reset() {
  physics.reset();mode="ready";auto=false;throttle=0.5;
  ui.auto.textContent="ESTABILIZAÇÃO: OFF";
  ui.throttle.value="50";ui.status.textContent="Pronto para acelerar na rampa.";
  const pos=physics.snapshot().position;
  orbit.target.copy(pos);camera.position.copy(pos).add(new THREE.Vector3(12,7,12));
}
function launch(){reset();mode="ramp";ui.status.textContent="Acelerando na rampa...";}
document.querySelector<HTMLElement>("#launch")!.onclick=launch;
document.querySelector<HTMLElement>("#reset")!.onclick=reset;
ui.auto.onclick=()=>{auto=!auto;ui.auto.textContent=`ESTABILIZAÇÃO: ${auto?"ON":"OFF"}`;};
ui.camera.onclick=()=>{follow=!follow;ui.camera.textContent=`CÂMERA: ${follow?"SEGUIR":"LIVRE"}`;};
ui.throttle.oninput=()=>{throttle=Number(ui.throttle.value)/100;};
const prevent=new Set(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"]);
addEventListener("keydown",(event:KeyboardEvent)=>{
  if(prevent.has(event.code))event.preventDefault();
  keys[event.code]=true;
  if(event.repeat)return;
  if(event.code==="KeyT")ui.auto.click();
  if(event.code==="KeyR")reset();
  if(event.code==="Enter")launch();
});
addEventListener("keyup",(event:KeyboardEvent)=>keys[event.code]=false);
addEventListener("blur",()=>Object.keys(keys).forEach(key=>keys[key]=false));
const clock=new THREE.Clock();
let accumulator=0;
function frame(){
  requestAnimationFrame(frame);
  const dt=Math.min(clock.getDelta(),0.05);
  accumulator+=dt*0.55;
  while(accumulator>=FIXED_DT){
    const state=physics.snapshot();
    const controls=controller.command(state,keys,auto,throttle,landing);
    physics.step(FIXED_DT,mode,controls);
    if(mode==="ramp"&&physics.flying) {
      mode="flight";
      ui.status.textContent="LIBERADO! Controle os propulsores para estabilizar.";
    }
    accumulator-=FIXED_DT;
  }
  const state=physics.snapshot();
  vehicle.position.copy(state.position);
  vehicle.quaternion.copy(state.rotation);
  const inclination=THREE.MathUtils.radToDeg(
    Math.acos(THREE.MathUtils.clamp(new THREE.Vector3(0,1,0).applyQuaternion(state.rotation).y,-1,1))
  );
  ui.alt.textContent=`${Math.max(0,state.position.y).toFixed(1)} m`;
  ui.att.textContent=`${inclination.toFixed(0)}°`;
  ui.speed.textContent=`${state.velocity.y.toFixed(1)} m/s`;
  ui.percent.textContent=`${Math.round(throttle*100)}%`;
  ui.throttleValue.textContent=ui.percent.textContent;
  ui.power.style.width=ui.percent.textContent;
  if(follow){
    const shift=state.position.clone().sub(orbit.target);
    camera.position.add(shift);orbit.target.copy(state.position);
  }
  orbit.update();
  renderer.render(scene,camera);
}
(async()=>{
  await RAPIER.init();
  physics=new VehiclePhysics(rampSurface,trackAt,trackLength,thrusters);
  reset();frame();
})().catch(error=>{console.error(error);ui.status.textContent="Erro inicializando a física: "+error;});
addEventListener("resize",()=>{
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});
