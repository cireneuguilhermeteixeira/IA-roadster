import * as THREE from "three";
import { VehiclePhysics, FIXED_DT, type FlightInputs, type State, type ThrusterVisual } from "../physics";
import { decode, forward, randomGenome, SHAPE, type Genome, type Trace } from "./network";
import { breed, loadCheckpoint, saveCheckpoint, POPULATION, type Checkpoint, type GenerationRecord, type Individual } from "./genetics";
import { encodeSensors } from "./sensors";

const MAX_SECONDS = 8;
function dummyThrusters(): ThrusterVisual[] {
  return [-1.76,1.76].flatMap(x => [-1.1,1.1].map(z => ({
    x,z,power:0, tilt:new THREE.Group(),yaw:new THREE.Group(),
    exhaust:new THREE.Mesh(),light:new THREE.PointLight(),
  })));
}
const noInput: FlightInputs = {torque:new THREE.Vector3(),base:0,powerLimit:1,forward:0,lateral:0};
export class EvolutionTrainer {
  readonly physics: VehiclePhysics;
  readonly history: GenerationRecord[]=[];
  generation=1;
  index=0;
  running=false;
  phase:"seed"|"episode"|"stopped"="seed";
  bestFitness=-Infinity;
  champion: Genome | null=null;
  currentTrace: Trace | null=null;
  episodeSeconds=0;
  episodes=0;
  private savedSeed: State | null=null;
  private genomes:Genome[]=Array.from({length:POPULATION},()=>randomGenome());
  private results:Individual[]=[];
  private minDistance=Infinity;
  private maxImpact=0;
  private initialized=false;
  constructor(ramp:THREE.Mesh,trackAt:(distance:number)=>{point:THREE.Vector3;angle:number},trackLength:number,private landing:THREE.Vector3) {
    this.physics=new VehiclePhysics(ramp,trackAt,trackLength,dummyThrusters(),true);
    const checkpoint=loadCheckpoint();
    if(checkpoint){
      this.generation=checkpoint.generation+1;
      this.bestFitness=checkpoint.bestFitness;
      this.champion=checkpoint.champion.slice();
      this.history.push(...checkpoint.history.slice(-200));
      this.genomes[0]=checkpoint.champion.slice();
      for(let i=1;i<POPULATION;i++)this.genomes[i]=checkpoint.champion.map(w=>Math.max(-4,Math.min(4,w+(Math.random()*2-1)*0.2)));
    }
  }
  start(){this.running=true;}
  pause(){this.running=false;}
  get progress(){return this.index/POPULATION;}
  private startEpisode() {
    if(!this.savedSeed)return;
    const seed=this.savedSeed;
    // Domain randomization changes initial attitude and velocities; never alter controller code per scenario.
    const jitter=new THREE.Quaternion().setFromEuler(new THREE.Euler(
      (Math.random()-0.5)*0.34,(Math.random()-0.5)*0.28,(Math.random()-0.5)*0.4
    ));
    this.physics.primeFlight({
      position:seed.position.clone().add(new THREE.Vector3((Math.random()-0.5)*2,(Math.random()-0.5)*2,(Math.random()-0.5)*2)),
      rotation:seed.rotation.clone().multiply(jitter),
      velocity:seed.velocity.clone().add(new THREE.Vector3((Math.random()-0.5)*3,(Math.random()-0.5)*2,(Math.random()-0.5)*3)),
      angularVelocity:new THREE.Vector3((Math.random()-0.5)*0.9,(Math.random()-0.5)*0.7,(Math.random()-0.5)*0.9),
    });
    this.episodeSeconds=0;this.minDistance=Infinity;this.maxImpact=0;
  }
  /** Called in bounded chunks from the render loop; no extra WebGL renderer or ML dependencies. */
  tick(budget=12) {
    if(!this.running)return;
    for(let step=0;step<budget;step++){
      if(this.phase==="seed"){
        this.physics.step(FIXED_DT);
        if(this.physics.flying){
          this.savedSeed=this.physics.snapshot();
          this.phase="episode";this.startEpisode();
        }
        continue;
      }
      if(this.phase!=="episode")return;
      const state=this.physics.snapshot();
      const genome=this.genomes[this.index];
      const sensors=encodeSensors(state,this.landing,this.episodeSeconds);
      const trace=forward(genome,sensors);
      this.currentTrace=trace;
      const jets=decode(trace.outputs);
      const controls:FlightInputs={...noInput,jets};
      this.physics.step(FIXED_DT,controls);
      this.episodeSeconds+=FIXED_DT;
      const distance=state.position.distanceTo(this.landing);
      this.minDistance=Math.min(this.minDistance,distance);
      this.maxImpact=Math.max(this.maxImpact,Math.abs(state.velocity.y));
      if(this.physics.grounded || state.position.y< -3 || this.episodeSeconds>=MAX_SECONDS){
        const finalState=this.physics.snapshot();
        const success=this.physics.grounded;
        const reward=this.fitness(finalState,success);
        this.results.push({genome:genome.slice(),fitness:reward,success});
        this.episodes++;
        this.index++;
        if(this.index>=POPULATION)this.nextGeneration();
        this.startEpisode();
      }
    }
  }
  private fitness(state:State,grounded:boolean) {
    const upright=new THREE.Vector3(0,1,0).applyQuaternion(state.rotation).y;
    const facing=new THREE.Vector3(1,0,0).applyQuaternion(state.rotation).dot(new THREE.Vector3(-1,0,0));
    const planar=Math.hypot(state.position.x-this.landing.x,state.position.z-this.landing.z);
    const horizontal=Math.hypot(state.velocity.x,state.velocity.z);
    const angular=state.angularVelocity.length();
    // Continuous shaped rewards before landing; success bonus prevents hovering forever.
    let score=60*Math.max(0,upright)+30*Math.max(0,facing);
    score+=90*Math.exp(-planar/8) + 25*Math.exp(-horizontal/5) + 20*Math.exp(-angular);
    score+=30*Math.exp(-Math.max(0,Math.abs(state.velocity.y)-2)/4);
    score+=25*Math.exp(-this.minDistance/15);
    score-=this.episodeSeconds*1.8;
    if(grounded){
      score+=160;
      score+=170*Math.max(0,upright)*Math.exp(-planar/5);
      score+=110*Math.exp(-horizontal/3)*Math.exp(-Math.abs(state.velocity.y)/3);
      score+=75*Math.max(0,facing);
    } else score-=80;
    if(!Number.isFinite(score))return -1e6;
    return score;
  }
  private nextGeneration() {
    this.results.sort((a,b)=>b.fitness-a.fitness);
    const best=this.results[0];
    const mean=this.results.reduce((s,r)=>s+r.fitness,0)/POPULATION;
    const successRate=this.results.filter(r=>r.success).length/POPULATION;
    if(best.fitness>this.bestFitness || !this.champion){
      this.bestFitness=best.fitness;this.champion=best.genome.slice();
    }
    this.history.push({generation:this.generation,best:best.fitness,mean,successRate,bestEver:this.bestFitness});
    if(this.history.length>200)this.history.shift();
    this.genomes=breed(this.results,this.champion);
    this.generation++;this.index=0;this.results=[];
    if(this.champion)saveCheckpoint(this.checkpoint());
  }
  checkpoint():Checkpoint{
    if(!this.champion)throw new Error("No champion has been trained yet");
    return {version:1,shape:[...SHAPE],generation:this.generation-1,champion:this.champion.slice(),bestFitness:this.bestFitness,history:this.history.slice()};
  }
  exportJSON(){
    const document=JSON.stringify(this.checkpoint(),null,2);
    const url=URL.createObjectURL(new Blob([document],{type:"application/json"}));
    const a=window.document.createElement("a");a.href=url;a.download="vectormind-champion.json";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  importJSON(raw:string){
    const value=JSON.parse(raw) as Checkpoint;
    if(value.version!==1||value.champion?.length!==this.genomes[0].length||!value.champion.every(Number.isFinite))throw Error("Invalid genome");
    this.champion=value.champion.slice();this.bestFitness=value.bestFitness;
    this.generation=value.generation+1;this.history.splice(0,this.history.length,...value.history.slice(-200));
    this.genomes=[this.champion.slice(),...Array.from({length:POPULATION-1},()=>this.champion!.map(v=>Math.max(-4,Math.min(4,v+(Math.random()-.5)*0.35))))];
    this.index=0;this.results=[];saveCheckpoint(this.checkpoint());
  }
}
