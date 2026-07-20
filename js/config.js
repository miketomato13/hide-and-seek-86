// Constants and tuning knobs. Change numbers here to rebalance the game.
// Hide + Seek '86 — v3
// New in v3: ability system. Sprint (L2), Blink (L4), Decoy (L6),
// Frost Nova (L8), Stun Bolt (L10). Hotkeys: Space + 1/2/3/4, or tap the
// hotbar. Frozen/stunned bots are harmless statues until they recover.

const W = 960, H = 600;

// ---------- Abilities ----------
const ABILITIES = [
  {id:'sprint', name:'SPRINT', label:'SPC', unlock:2,  cd:6,  color:'#00e5ff'},
  {id:'blink',  name:'BLINK',  label:'Q',   unlock:4,  cd:10, color:'#8c1eff'},
  {id:'decoy',  name:'DECOY',  label:'E',   unlock:6,  cd:15, color:'#00ffa3'},
  {id:'nova',   name:'NOVA',   label:'R',   unlock:8,  cd:18, color:'#7fd4ff'},
  {id:'bolt',   name:'BOLT',   label:'F',   unlock:10, cd:12, color:'#ffd319'},
];
const NOVA_RADIUS = 170, NOVA_FREEZE = 2.5;
const BLINK_DIST = 160;
const DECOY_LIFE = 4, SPRINT_TIME = 2, SPRINT_MULT = 1.5;
const BOLT_SPEED = 460, BOLT_STUN = 3;
const LEVEL_TIME = 30;
const POWERUPS = [
  {id:'reset',  name:'CD RESET',   color:'#8c1eff'},
  {id:'freeze', name:'TIME FREEZE',color:'#7fd4ff'},
  {id:'clock',  name:'-8 SEC',     color:'#ff2975'},
  {id:'cloak',  name:'CLOAK',      color:'#00ffa3'},
];
const CRATE_LIFE = 10, CRATE_MAX = 2, CRATE_PICKUP_R = 22;
const FREEZE_TIME = 2, CLOAK_TIME = 3, CLOCK_CUT = 8;

// ---------- Difficulty ----------
const DIFFICULTIES = {
  easy: {label:'EASY', speedMul:0.68, visionMul:0.65, bushBubbleMul:0.72, sweepMul:2.2, searchMul:0.5, botMul:0.75},
  hard: {label:'HARD', speedMul:1,    visionMul:1,    bushBubbleMul:1,    sweepMul:1,   searchMul:1,   botMul:1},
};
let difficulty = 'hard';
const DIFF = () => DIFFICULTIES[difficulty];

