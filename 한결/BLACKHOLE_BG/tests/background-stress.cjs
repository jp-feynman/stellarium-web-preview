// Accelerated background lifecycle test, independent of DOM / GPU.
// node tests/background-stress.cjs [wall seconds]
const assert=require('node:assert/strict');
global.BBH=require('../bbh-physics.js');
const Sim=require('../bbh-sim.js'),Hero=require('../gravity-hero.js');
let seed=90731;Math.random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
const h=Object.create(Hero.prototype);
Object.assign(h,{sim:new Sim({c:450,eob:true,hist:4096}),w:1440,h:900,R1:11,C:450,SQ27:3*Math.sqrt(3),kRad:140/1440*Math.PI/180,
 EXIT_MERGERS:4,RESPAWN:4,MAX_BH:3,OMEGA_REF:4,slow:1,reduce:false,spawnAt:[],clicks:[],seenEvents:0,drag:null,
 onStage:()=>{},host:{classList:{remove:()=>{}}},virtualWall:0,now:()=>h.virtualWall});
h._seed();
const seconds=Number(process.argv[2]||600),dt=1/30,t0=performance.now();
let maxMass=0,maxPopulation=0,retired=0;const seen=new Set();
for(let i=0;i<Math.ceil(seconds/dt);i++){
 h.virtualWall=(i+1)*dt;h._step(h.virtualWall,dt);
 const population=h.sim.bodies.reduce((n,b)=>n+(b.eob?2:1),0);maxPopulation=Math.max(maxPopulation,population);
 assert.ok(population<=3);
 for(const b of h.sim.bodies){
  assert.ok(Number.isFinite(b.x+b.y+b.vx+b.vy+b.M));maxMass=Math.max(maxMass,b.M);
  if(b.retiring){assert.ok(b.mergerCount>=4);}
  if(b.retiring&&!seen.has(b.retiring)){seen.add(b.retiring);retired++;}
 }
 for(const q of h.sim.components())assert.ok(Number.isFinite(q.x+q.y+q.rho+q.M));
}
assert.ok(retired>0,'test must exercise retirement');
// Retirement is governed by completed mergers, never by an earlier size limit.
console.log(JSON.stringify({pass:true,wallSeconds:seconds,frames:Math.ceil(seconds/dt),physicsSeconds:h.sim.t,
 mergers:h.sim.events.length,retirements:retired,maxMass,maxShadowRadius:maxMass*h.SQ27,maxPopulation,
 pendingRespawns:h.spawnAt.length,cpuMs:performance.now()-t0},null,2));
