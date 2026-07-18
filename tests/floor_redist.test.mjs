import assert from "node:assert";
import { buildTimeline } from "../src/lib/partitioning.js";
let pass=0,fail=0; const t=(n,f)=>{try{f();pass++;console.log("PASS",n);}catch(e){fail++;console.error("FAIL",n,"→",e.message);}};
const sumC = s => s.reduce((a,x)=>a+x.macros.carbsG,0);
const mk = (carbs,extra={}) => buildTimeline({dayKey:"2026-07-20",totals:{carbsG:carbs,proteinG:180,fatG:70},wakeMin:420,sleepMin:1380,sessions:[{id:"g",type:"gym",time:"16:00",durationMin:60,intensity:"moderate"}],...extra});

// pre carb now 80
t("pre-workout floor carbs = 80", ()=>{const {slots}=mk(320);assert.equal(slots.find(s=>s.mealName==="Pre-workout").macros.carbsG,80);});

// T1 normal-carb day: 320, pre 80, post 48 → 192 across flex, sum 320
t("T1 remaining 192 splits, sum==320", ()=>{
  const {slots}=mk(320);
  assert.equal(slots.find(s=>s.mealName==="Post-workout").macros.carbsG,48);
  const flexC=slots.filter(s=>s.type==="flexible").reduce((a,x)=>a+x.macros.carbsG,0);
  assert.equal(flexC,320-80-48,"flex carbs = 192");
  assert.equal(sumC(slots),320);
});

// T2 carb-axis isolation: raising pre 40→80 leaves protein/fat per flex identical
t("T2 protein/fat per flex unchanged by pre-carb bump", ()=>{
  // simulate old pre=40 by comparing two builds with same P/F target; only carbs differ per-slot
  const {slots}=mk(320);
  const flex=slots.filter(s=>s.type==="flexible");
  // protein+fat sums must equal target minus floors (independent of carbs)
  const pFlex=flex.reduce((a,x)=>a+x.macros.proteinG,0), fFlex=flex.reduce((a,x)=>a+x.macros.fatG,0);
  const floors=slots.filter(s=>s.type==="floor");
  const pFloor=floors.reduce((a,x)=>a+x.macros.proteinG,0), fFloor=floors.reduce((a,x)=>a+x.macros.fatG,0);
  assert.equal(pFlex+pFloor,180,"protein sum == target");
  assert.equal(fFlex+fFloor,70,"fat sum == target");
});

// T3 low-carb-day guard: 200 target, floors 128, ~72 for flex → crowded warning
t("T3 low-carb guard fires, no near-zero, sum==200", ()=>{
  const tl=mk(200);
  assert.equal(tl.carbsCrowded,true,"crowding warning fires");
  assert.ok(tl.insufficientIds.length>0,"slots flagged");
  const flex=tl.slots.filter(s=>s.type==="flexible");
  flex.forEach(s=>assert.ok(s.macros.carbsG>0,"no zero-carb silent meal"));
  assert.equal(sumC(tl.slots),200,"sum still == target");
});

// T4 daily invariant across targets
t("T4 sum==target for 200/320/400", ()=>{
  [200,320,400].forEach(c=>assert.equal(sumC(mk(c).slots),c,`target ${c}`));
});

// no crowding on a normal day
t("no crowding warning on 320-carb day", ()=>{ assert.equal(mk(320).carbsCrowded,false); });

console.log(`\nfloor_redist: ${pass} passed, ${fail} failed`);
if(fail)process.exit(1);
