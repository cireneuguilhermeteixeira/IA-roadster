import { randomGenome, WEIGHT_COUNT, type Genome } from "./network";

export type Individual = { genome: Genome; fitness: number; success: boolean };
export type GenerationRecord = { generation: number; best: number; mean: number; successRate: number; bestEver: number };
export type Checkpoint = { version: 1; shape: number[]; generation: number; champion: Genome; bestFitness: number; history: GenerationRecord[] };
export const STORAGE_KEY = "vectormind-neuroevolution-v1";
export const POPULATION = 32;
const ELITES = 4;
const chance = (probability: number) => Math.random() < probability;
function gaussian(): number {
  return Math.sqrt(-2*Math.log(Math.max(1e-12,Math.random()))) * Math.cos(2*Math.PI*Math.random());
}
export function breed(population: Individual[], champion: Genome | null): Genome[] {
  const ranked = [...population].sort((a,b)=>b.fitness-a.fitness);
  const pool = ranked.slice(0, Math.max(8, Math.floor(population.length*0.35)));
  const children = ranked.slice(0,ELITES).map(x=>x.genome.slice());
  if(champion) children[0]=champion.slice();
  function parent() { return pool[Math.floor(Math.random()*pool.length)].genome; }
  while(children.length<POPULATION) {
    if(chance(0.08)){children.push(randomGenome());continue;}
    const a=parent(),b=parent();
    const sigma=chance(0.2)?0.28:0.075;
    children.push(Array.from({length:WEIGHT_COUNT},(_,i)=>{
      const gene=chance(0.5)?a[i]:b[i];
      return Math.max(-4,Math.min(4,gene+(chance(0.12)?gaussian()*sigma:0)));
    }));
  }
  return children;
}
export function loadCheckpoint(): Checkpoint | null {
  try {
    const raw=localStorage.getItem(STORAGE_KEY);
    if(!raw)return null;
    const item=JSON.parse(raw) as Checkpoint;
    return item.version===1 && item.champion?.length===WEIGHT_COUNT && Number.isFinite(item.bestFitness) ? item : null;
  } catch {return null;}
}
export function saveCheckpoint(record: Checkpoint) {
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(record));return true;}catch{return false;}
}
