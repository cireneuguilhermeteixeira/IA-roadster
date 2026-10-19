import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';

// Experimental arcade physics: forces and torques are illustrative, not engineering-accurate.
const app=document.querySelector('#app');
app.innerHTML=`<div id="viewport"></div><aside class="hud"><h1>ROADSTER // VECTOR LAB</h1><div class="subtitle">ROTATING RAMP · 4 VECTOR THRUSTERS · RECOVERY</div><div class="stats"><div class="stat"><small>ALTITUDE</small><b id="alt">0 m</b></div><div class="stat"><small>ATTITUDE</small><b id="att">0°</b></div><div class="stat"><small>VERT. SPEED</small><b id="speed">0 m/s</b></div></div><div class="status" id="status">Pronto para girar a plataforma 180°.</div><div class="controls"><button class="primary" id="launch">GIRAR 180° + SOLTAR</button><button id="reset">REINICIAR</button><button id="auto">ESTABILIZAÇÃO: OFF</button><button id="camera">CÂMERA: SEGUIR</button></div><div class="section"><strong>Potência dos quatro propulsores</strong> <span id="percent" class="tag">50%</span><div class="bar"><span id="powerbar"></span></div><div class="row"><span>Potência</span><input id="throttle" type="range" min="0" max="100" value="50"/><span id="throttleValue">50%</span></div></div><div class="section"><strong>Comandos</strong><div class="hint"><strong>W / S</strong> inclinar nariz · <strong>A / D</strong> rolar · <strong>Q / E</strong> guinar<br/><strong>↑ / ↓</strong> vetorizar para frente/trás · <strong>← / →</strong> vetorizar lateralmente<br/><strong>Shift</strong> impulso máximo · <strong>T</strong> estabilização automática · <strong>R</strong> reiniciar<br/><strong>Mouse</strong> orbitar/zoom. A rampa gira com o carro e o libera invertido. Ligue a estabilização para recuperar ou tente manualmente.</div></div><div class="section warning">Modelo Roadster estilizado. Simulação de voo recreativa, sem representar um sistema real de propulsão.</div></aside><div class="bottom">THREE.JS · PROCEDURAL MESH · VECTOR THRUST SIMULATION</div>`;
const view=document.querySelector('#viewport');
const scene=new THREE.Scene();scene.background=new THREE.Color('#080e1a');scene.fog=new THREE.FogExp2('#080e1a',0.006);
const camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.1,1200);camera.position.set(13,52,19);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.35;view.appendChild(renderer.domElement);
const orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.maxDistance=140;orbit.minDistance=4;orbit.target.set(0,45,0);
scene.add(new THREE.HemisphereLight(0xb8d9ff,0x222633,2.2));const sun=new THREE.DirectionalLight(0xffffff,2.8);sun.position.set(28,85,32);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-90;sun.shadow.camera.right=90;sun.shadow.camera.top=90;sun.shadow.camera.bottom=-90;scene.add(sun);
const mat=(color,metalness=.1,roughness=.5)=>new THREE.MeshStandardMaterial({color,metalness,roughness});const red=new THREE.MeshPhysicalMaterial({color:'#b30c28',metalness:.65,roughness:.23,clearcoat:1,clearcoatRoughness:.12});const black=mat('#10131a',.45,.44);const carbon=mat('#202832',.66,.35);const chrome=mat('#a8b9c9',.92,.2);const glass=new THREE.MeshPhysicalMaterial({color:'#121f30',metalness:.45,roughness:.09,transparent:true,opacity:.88,clearcoat:1});const neon=new THREE.MeshBasicMaterial({color:'#64dfff'});
const mesh=(geo,material,parent,x=0,y=0,z=0)=>{const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m};
const box=(p,w,h,d,m,x=0,y=0,z=0)=>mesh(new THREE.BoxGeometry(w,h,d),m,p,x,y,z);
const ground=mesh(new THREE.PlaneGeometry(1000,1000),mat('#121d29',.08,.86),scene,0,-.03,0);ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;const grid=new THREE.GridHelper(500,100,0x30425b,0x1c2938);grid.position.y=.015;scene.add(grid);
for(let i=0;i<42;i++){let x=(i%7-3)*24,z=(Math.floor(i/7)-3)*24;const h=3+(i*17%11);const b=box(scene,5,h,5,mat('#141e29',.05,.85),x,h/2,z);b.castShadow=false;}
// Hoisted platform, hinged around the vehicle's longitudinal X axis.
const RAMP_HEIGHT=48;const platform=new THREE.Group();platform.position.set(0,RAMP_HEIGHT,0);scene.add(platform);
box(platform,9,.42,5.2,mat('#354359',.65,.38),0,-.4,0);box(platform,9,.10,.12,neon,0,-.16,2.5);box(platform,9,.10,.12,neon,0,-.16,-2.5);
for(let i=-4;i<=4;i++)box(platform,.08,.025,4.6,mat('#8494a9',.4,.4),i,-.16,0);
const supports=[];for(const [x,z] of [[-4,-2.25],[-4,2.25],[4,-2.25],[4,2.25]]){const column=box(scene,.28,RAMP_HEIGHT,.28,mat('#293649',.5,.5),x,RAMP_HEIGHT/2,z);supports.push(column);}
const underglow=new THREE.PointLight('#2bbafa',12,14);underglow.position.set(0,RAMP_HEIGHT-2,0);scene.add(underglow);
// Vehicle local X: front; Z: left/right. Its origin is near the center of mass.
const vehicle=new THREE.Group();scene.add(vehicle);const body=new THREE.Group();vehicle.add(body);
const stations=[[-2.65,.64,.78],[-2.0,.94,1.04],[-1.2,1.08,1.08],[.3,1.10,1.07],[1.5,.96,1.02],[2.38,.77,.9],[2.7,.58,.71]];
const vertices=[],indices=[];
for(const [x,top,width] of stations){vertices.push(x,top,width,x,top,-width,x,.13,width,x,.13,-width)}
for(let i=0;i<stations.length-1;i++){const a=i*4,b=(i+1)*4;for(const [u,v] of [[0,1],[0,2],[1,3],[2,3]]){indices.push(a+u,a+v,b+v,a+u,b+v,b+u)}}
indices.push(0,1,3,0,3,2);let end=(stations.length-1)*4;indices.push(end,end+2,end+3,end,end+3,end+1);
const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();mesh(geometry,red,body);
// Rounded hood, tapering cabin and dark roof.
const roofShape=new THREE.Shape();roofShape.moveTo(-1.48,0);roofShape.lineTo(-.9,.67);roofShape.lineTo(.55,.72);roofShape.lineTo(1.06,0);roofShape.closePath();
const cabinGeo=new THREE.ExtrudeGeometry(roofShape,{depth:1.6,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.10,bevelThickness:.1});
const cabin=mesh(cabinGeo,glass,body,0,1.00,-.8);cabin.castShadow=true;
box(body,3.5,.12,2.03,carbon,-.12,.3,0);box(body,1.7,.11,1.72,black,-.12,1.73,0);
for(const side of [-1,1]){box(body,3.5,.16,.10,carbon,-.12,.17,side*1.06);box(body,.36,.065,.2,chrome,.55,1.2,side*1.02);}
// Head and tail light ribbons, aerodynamic rear diffuser.
for(const s of [-1,1]){const lamp=box(body,.55,.055,.25,neon,2.53,.74,s*.55);lamp.rotation.y=s*.18;box(body,.25,.06,.66,mat('#ff173c',.15,.25),-2.58,.69,s*.57);}
box(body,.38,.14,1.85,black,-2.52,.1,0);box(body,.40,.12,1.88,black,2.52,.10,0);
for(const x of [-1.75,1.76])for(const s of [-1,1]){
 const wheel=new THREE.Group();wheel.position.set(x,.17,s*1.10);body.add(wheel);
 const rubber=mesh(new THREE.CylinderGeometry(.48,.48,.28,32),mat('#080a0d',0,.95),wheel);rubber.rotation.x=Math.PI/2;
 const rim=mesh(new THREE.CylinderGeometry(.30,.30,.297,16),chrome,wheel);rim.rotation.x=Math.PI/2;
 const hub=mesh(new THREE.CylinderGeometry(.12,.12,.315,16),carbon,wheel);hub.rotation.x=Math.PI/2;
}
// Four gimballed jets: local down = thrust reaction along vehicle up.
const thrusters=[];for(const x of [-1.8,1.8])for(const z of [-1.08,1.08]){
 const yaw=new THREE.Group();yaw.position.set(x,-.10,z);body.add(yaw);
 const tilt=new THREE.Group();yaw.add(tilt);
 const socket=mesh(new THREE.SphereGeometry(.18,16,12),chrome,tilt);
 const cylinder=mesh(new THREE.CylinderGeometry(.12,.20,.55,24),carbon,tilt,0,-.31,0);
 mesh(new THREE.CylinderGeometry(.20,.17,.11,24),chrome,tilt,0,-.62,0);
 const exhaust=mesh(new THREE.CylinderGeometry(.09,.24,.94,20,1,true),new THREE.MeshBasicMaterial({color:'#39c5ff',transparent:true,opacity:.5,side:THREE.DoubleSide,depthWrite:false}),tilt,0,-1.14,0);
 exhaust.visible=false;const light=new THREE.PointLight('#46bfff',0,3.5);light.position.set(0,-.72,0);tilt.add(light);
 thrusters.push({x,z,yaw,tilt,exhaust,light,power:0});
}
const ui={alt:document.querySelector('#alt'),att:document.querySelector('#att'),speed:document.querySelector('#speed'),status:document.querySelector('#status'),power:document.querySelector('#powerbar'),percent:document.querySelector('#percent'),throttle:document.querySelector('#throttle'),throttleValue:document.querySelector('#throttleValue'),auto:document.querySelector('#auto'),camera:document.querySelector('#camera')};
let mode='ready',flipT=0,auto=false,follow=true,throttle=.5;const keys={};
const pos=new THREE.Vector3(),vel=new THREE.Vector3(),omega=new THREE.Vector3(),quat=new THREE.Quaternion();const UP=new THREE.Vector3(0,1,0);const inertia=new THREE.Vector3(3.4,6,4.7);
function reset(){mode='ready';flipT=0;platform.rotation.x=0;pos.set(0,RAMP_HEIGHT+.65,0);vel.set(0,0,0);omega.set(0,0,0);quat.identity();vehicle.position.copy(pos);vehicle.quaternion.copy(quat);body.position.set(0,0,0);throttle=.5;ui.throttle.value=50;auto=false;ui.auto.textContent='ESTABILIZAÇÃO: OFF';ui.status.textContent='Pronto para girar a plataforma 180°.';ui.status.style.color='#9bdcff';for(const t of thrusters){t.power=0;t.yaw.rotation.set(0,0,0);t.tilt.rotation.set(0,0,0);} }
function toggleAuto(){auto=!auto;ui.auto.textContent=`ESTABILIZAÇÃO: ${auto?'ON':'OFF'}`;}
function launch(){if(mode!=='ready')reset();mode='flip';flipT=0;ui.status.textContent='Plataforma girando… 180°';}
document.querySelector('#launch').onclick=launch;document.querySelector('#reset').onclick=reset;ui.auto.onclick=toggleAuto;ui.camera.onclick=()=>{follow=!follow;ui.camera.textContent=`CÂMERA: ${follow?'SEGUIR':'LIVRE'}`};ui.throttle.oninput=()=>throttle=Number(ui.throttle.value)/100;
const prevent=new Set(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);addEventListener('keydown',e=>{if(prevent.has(e.code))e.preventDefault();keys[e.code]=true;if(e.repeat)return;if(e.code==='KeyT')toggleAuto();if(e.code==='KeyR')reset();if(e.code==='Enter')launch()});addEventListener('keyup',e=>{keys[e.code]=false});addEventListener('blur',()=>{for(const k in keys)keys[k]=false});
function axis(positive,negative){return Number(!!keys[positive])-Number(!!keys[negative]);}
const localAxis=new THREE.Vector3(),worldF=new THREE.Vector3(),worldT=new THREE.Vector3();
function simulate(dt){
 if(mode==='ready'){vehicle.position.copy(pos);vehicle.quaternion.identity();return;}
 if(mode==='flip'){
   flipT+=dt;const v=Math.min(flipT/3.2,1),smooth=v*v*(3-2*v);platform.rotation.x=Math.PI*smooth;quat.setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI*smooth);vehicle.position.copy(pos);vehicle.quaternion.copy(quat);
   if(v>=1){mode='flight';quat.setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI);vel.set(0,0,0);omega.set(.04,0,.07);ui.status.textContent='QUEDA LIVRE! Use W/A/S/D/Q/E e ative T para estabilizar.';}
   return;
 }
 if(mode==='landed')return;
 // Desired body-axis torque; stabilization derives a shortest-path quaternion error.
 let tx=axis('KeyA','KeyD')*13; // roll around car X
 let tz=axis('KeyW','KeyS')*15; // pitch around car Z
 let ty=axis('KeyQ','KeyE')*9;  // yaw around car Y
 if(auto){
   const inv=quat.clone().invert();const error=inv; // goal orientation: identity
   if(error.w<0)error.set(-error.x,-error.y,-error.z,-error.w);
   const angle=2*Math.acos(THREE.MathUtils.clamp(error.w,-1,1));
   const sinHalf=Math.sqrt(Math.max(1-error.w*error.w,0));
   const errorAxis=sinHalf>.0001?new THREE.Vector3(error.x,error.y,error.z).divideScalar(sinHalf):new THREE.Vector3(1,0,0);
   const localW=omega.clone().applyQuaternion(quat.clone().invert());
   tx+=THREE.MathUtils.clamp(errorAxis.x*angle*17-localW.x*9,-32,32);
   ty+=THREE.MathUtils.clamp(errorAxis.y*angle*12-localW.y*7,-20,20);
   tz+=THREE.MathUtils.clamp(errorAxis.z*angle*18-localW.z*10,-36,36);
 }
 let totalF=new THREE.Vector3(0,-9.81,0),torqueLocal=new THREE.Vector3();const xarm=1.8,zarm=1.08;
 const base=(keys.ShiftLeft||keys.ShiftRight)?1:throttle;
 const strafe=axis('ArrowRight','ArrowLeft')*.33;
 const forward=axis('ArrowUp','ArrowDown')*.33;
 for(const t of thrusters){
   // Differential upward thrust creates roll/pitch torque; limit for saturation.
   let power=THREE.MathUtils.clamp(base + tx*(-t.z)/(4*zarm*zarm*24) + tz*t.x/(4*xarm*xarm*24),0,1);
   t.power=power;
   // Gimbal axes: tilt.z controls lateral nozzle tilt, tilt.x longitudinal.
   const targetZ=THREE.MathUtils.clamp(-strafe+ty*t.x*.018,-.40,.40);
   const targetX=THREE.MathUtils.clamp(forward+ty*t.z*.018,-.40,.40);
   t.tilt.rotation.z=THREE.MathUtils.damp(t.tilt.rotation.z,targetZ,7,dt);
   t.tilt.rotation.x=THREE.MathUtils.damp(t.tilt.rotation.x,targetX,7,dt);
   const reaction=new THREE.Vector3(0,1,0).applyEuler(t.tilt.rotation).multiplyScalar(power*24); // acceleration
   worldF.copy(reaction).applyQuaternion(quat);totalF.add(worldF);
   torqueLocal.add(new THREE.Vector3(t.x,-.10,t.z).cross(reaction));
   t.exhaust.visible=power>.025;t.exhaust.scale.y=.38+power*1.7;t.light.intensity=power*5;
 }
 // Angular acceleration in local body principal axes; simple damping.
 const bodyOmega=omega.clone().applyQuaternion(quat.clone().invert());
 const alpha=new THREE.Vector3(torqueLocal.x/inertia.x,torqueLocal.y/inertia.y,torqueLocal.z/inertia.z).addScaledVector(bodyOmega,-2.1);
 omega.addScaledVector(alpha.applyQuaternion(quat),dt);omega.clampLength(0,5.7);
 const speed=omega.length();if(speed>1e-7){const dq=new THREE.Quaternion().setFromAxisAngle(omega.clone().normalize(),speed*dt);quat.premultiply(dq).normalize();}
 vel.addScaledVector(totalF,dt);vel.multiplyScalar(Math.exp(-.045*dt));pos.addScaledVector(vel,dt);
 if(pos.y<=.67){pos.y=.67;mode='landed';vel.set(0,0,0);omega.set(0,0,0);const upright=new THREE.Vector3(0,1,0).applyQuaternion(quat).dot(UP)>.72;ui.status.textContent=upright?'POUSO CONCLUÍDO! Reinicie para tentar novamente.':'IMPACTO! O carro não estava estabilizado. Reinicie.';ui.status.style.color=upright?'#87f5bb':'#ff9e9e';}
 vehicle.position.copy(pos);vehicle.quaternion.copy(quat);
}
reset();const clock=new THREE.Clock();let accumulator=0;const FIXED=1/120;const tmp=new THREE.Vector3();
function frame(){requestAnimationFrame(frame);const dt=Math.min(clock.getDelta(),.05);accumulator+=dt;while(accumulator>=FIXED){simulate(FIXED);accumulator-=FIXED;}
 const currentUp=new THREE.Vector3(0,1,0).applyQuaternion(quat),tilt=Math.acos(THREE.MathUtils.clamp(currentUp.dot(UP),-1,1))*180/Math.PI;
 ui.alt.textContent=`${Math.max(0,pos.y-.67).toFixed(1)} m`;ui.att.textContent=`${tilt.toFixed(0)}°`;ui.speed.textContent=`${vel.y.toFixed(1)} m/s`;
 ui.percent.textContent=`${Math.round(throttle*100)}%`;ui.throttleValue.textContent=`${Math.round(throttle*100)}%`;ui.power.style.width=`${Math.round(throttle*100)}%`;
 if(follow){const desired=new THREE.Vector3(13,8,19).add(pos);camera.position.lerp(desired,Math.min(1,2.1*dt));orbit.target.lerp(pos,Math.min(1,3*dt));}
 orbit.update();renderer.render(scene,camera);
}frame();addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
