import type { Trace } from "./network";
import type { GenerationRecord } from "./genetics";
function clear(canvas:HTMLCanvasElement){
  const ctx=canvas.getContext("2d");if(!ctx)return null;
  ctx.clearRect(0,0,canvas.width,canvas.height);return ctx;
}
export function drawNetwork(canvas:HTMLCanvasElement,trace:Trace){
  const ctx=clear(canvas);if(!ctx)return;
  const {width,height}=canvas;
  const layers=trace.layers;
  // Highlight neurons by signed activation; thin low-alpha connections keep the overview legible.
  for(let l=0;l<layers.length-1;l++){
    const a=layers[l],b=layers[l+1];
    const x1=18+l*(width-36)/(layers.length-1);
    const x2=18+(l+1)*(width-36)/(layers.length-1);
    ctx.strokeStyle="rgba(92,168,212,.10)";ctx.lineWidth=0.7;
    for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){
      ctx.beginPath();ctx.moveTo(x1,8+(i+0.5)*(height-16)/a.length);
      ctx.lineTo(x2,8+(j+0.5)*(height-16)/b.length);ctx.stroke();
    }
  }
  layers.forEach((layer,l)=>{
    const x=18+l*(width-36)/(layers.length-1);
    layer.forEach((value,j)=>{
      const y=8+(j+0.5)*(height-16)/layer.length;
      const t=Math.max(0,Math.min(1,Math.abs(value)));
      ctx.beginPath();ctx.arc(x,y,Math.min(4.6,2.1+t*2.8),0,Math.PI*2);
      ctx.fillStyle=value>=0?`rgba(66,214,248,${0.25+0.75*t})`:`rgba(255,165,90,${0.25+0.75*t})`;
      ctx.fill();
    });
  });
}
export function drawHistory(canvas:HTMLCanvasElement,history:GenerationRecord[]){
  const ctx=clear(canvas);if(!ctx)return;
  const w=canvas.width,h=canvas.height;
  if(history.length===0){ctx.fillStyle="#829bb3";ctx.font="12px sans-serif";ctx.fillText("Aguardando primeira geração...",12,h/2);return;}
  const values=history.flatMap(e=>[e.best,e.mean]);
  const lo=Math.min(...values),hi=Math.max(...values);
  const y=(v:number)=>h-10-(v-lo)/(hi-lo||1)*(h-24);
  for(const [key,color] of [["best","#64dbf4"],["mean","#eab57c"]] as const){
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();
    history.forEach((rec,i)=>{
      const x=10+(i/Math.max(1,history.length-1))*(w-20);
      if(i===0)ctx.moveTo(x,y(rec[key]));else ctx.lineTo(x,y(rec[key]));
    });ctx.stroke();
  }
  ctx.fillStyle="#94aac0";ctx.font="10px sans-serif";
  ctx.fillText(`G ${history.at(-1)?.generation} · melhor (azul) · média (laranja)`,8,12);
}
