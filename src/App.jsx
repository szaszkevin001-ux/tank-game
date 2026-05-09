import { useEffect, useRef, useState } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const BORDER = 18, TW = 28, TH = 18;
const BASE_SPEED = 2.8, FRICTION = 0.82, BSPEED = 6.2;
const BASE_SHOOT_CD = 500, BASE_BULLET_LIFETIME = 180;
const BASE_DAMAGE = 10, BASE_BULLET_SIZE = 3.5;

// ─── SKINS ───────────────────────────────────────────────────────────────────
const SKINS = [
  { id: "default",  name: "Olive Drab",    body: "#22c55e", barrel: "#15803d", tread: "#333",    price: 0   },
  { id: "crimson",  name: "Crimson Ghost", body: "#ef4444", barrel: "#991b1b", tread: "#450a0a", price: 150 },
  { id: "sapphire", name: "Sapphire",      body: "#3b82f6", barrel: "#1d4ed8", tread: "#1e3a8a", price: 150 },
  { id: "solar",    name: "Solar Flare",   body: "#f59e0b", barrel: "#b45309", tread: "#451a03", price: 200 },
  { id: "void",     name: "Void Walker",   body: "#a855f7", barrel: "#6b21a8", tread: "#1a0533", price: 300 },
  { id: "chrome",   name: "Chrome",        body: "#94a3b8", barrel: "#475569", tread: "#1e293b", price: 300 },
  { id: "toxic",    name: "Toxic",         body: "#84cc16", barrel: "#3f6212", tread: "#1a2e05", price: 400 },
  { id: "inferno",  name: "Inferno",       body: "#f97316", barrel: "#c2410c", tread: "#431407", price: 500 },
  { id: "ice",      name: "Arctic",        body: "#67e8f9", barrel: "#0e7490", tread: "#083344", price: 500 },
  { id: "obsidian", name: "Obsidian",      body: "#1e1b4b", barrel: "#312e81", tread: "#0f0e2b", price: 750 },
];

// ─── MAPS ────────────────────────────────────────────────────────────────────
const MAPS = [
  {
    id: "open", name: "Open Field", desc: "No cover. Pure aim wins.",
    price: 0, bg: "#0d0d1a", grid: "#141428", border: "#1e1e3a", walls: [],
  },
  {
    id: "bunker", name: "Bunker", desc: "Central fortress. Control the middle.",
    price: 200, bg: "#0f0a05", grid: "#1a1208", border: "#3d2008",
    walls: [
      { x: 0.35, y: 0.35, w: 0.08, h: 0.30 },
      { x: 0.57, y: 0.35, w: 0.08, h: 0.30 },
      { x: 0.35, y: 0.35, w: 0.30, h: 0.08 },
      { x: 0.35, y: 0.57, w: 0.30, h: 0.08 },
    ],
  },
  {
    id: "maze", name: "Labyrinth", desc: "Tight corridors. Bullets ricochet everywhere.",
    price: 350, bg: "#00080a", grid: "#001214", border: "#004d5e",
    walls: [
      { x: 0.20, y: 0.20, w: 0.04, h: 0.30 },
      { x: 0.76, y: 0.20, w: 0.04, h: 0.30 },
      { x: 0.20, y: 0.50, w: 0.04, h: 0.30 },
      { x: 0.76, y: 0.50, w: 0.04, h: 0.30 },
      { x: 0.38, y: 0.15, w: 0.24, h: 0.04 },
      { x: 0.38, y: 0.81, w: 0.24, h: 0.04 },
      { x: 0.42, y: 0.38, w: 0.16, h: 0.04 },
      { x: 0.42, y: 0.58, w: 0.16, h: 0.04 },
    ],
  },
  {
    id: "pillars", name: "Temple", desc: "Pillar maze. Cover is everywhere.",
    price: 250, bg: "#080510", grid: "#100a1a", border: "#2d1b4e",
    walls: [
      { x: 0.25,  y: 0.25, w: 0.07, h: 0.07 },
      { x: 0.68,  y: 0.25, w: 0.07, h: 0.07 },
      { x: 0.25,  y: 0.68, w: 0.07, h: 0.07 },
      { x: 0.68,  y: 0.68, w: 0.07, h: 0.07 },
      { x: 0.465, y: 0.40, w: 0.07, h: 0.20 },
    ],
  },
  {
    id: "canyon", name: "Canyon", desc: "Long corridors. Snipers' paradise.",
    price: 300, bg: "#0a0502", grid: "#120a04", border: "#5c2d07",
    walls: [
      { x: 0.0,  y: 0.32, w: 0.38, h: 0.06 },
      { x: 0.62, y: 0.32, w: 0.38, h: 0.06 },
      { x: 0.0,  y: 0.62, w: 0.38, h: 0.06 },
      { x: 0.62, y: 0.62, w: 0.38, h: 0.06 },
    ],
  },
];

// ─── POWERUPS ─────────────────────────────────────────────────────────────────
const POWERUPS = [
  { id:"bounce",    icon:"◈",  name:"Ricochet Shell",  desc:"Bullets live 70% longer — maximum wall chaos.",     color:"#38bdf8", cat:"MOBILITY",  apply:(p)=>{ p.bulletLifetime=Math.round((p.bulletLifetime||BASE_BULLET_LIFETIME)*1.7); } },
  { id:"speed",     icon:"⚡",  name:"Nitro Boost",     desc:"Move 40% faster. Impossible to corner.",            color:"#facc15", cat:"MOBILITY",  apply:(p)=>{ p.speedMult=(p.speedMult||1)*1.4; } },
  { id:"firerate",  icon:"🔥", name:"Rapid Fire",       desc:"Fire 200ms sooner. Stack for full auto.",           color:"#f97316", cat:"FIREPOWER", apply:(p)=>{ p.shootCd=Math.max(60,(p.shootCd||BASE_SHOOT_CD)-200); } },
  { id:"damage",    icon:"💥", name:"Hollow Point",     desc:"+60% bullet damage per pickup.",                    color:"#ef4444", cat:"FIREPOWER", apply:(p)=>{ p.bulletDamage=(p.bulletDamage||BASE_DAMAGE)*1.6; } },
  { id:"trishot",   icon:"⟠",  name:"Triple Barrel",    desc:"Fire a 3-bullet spread simultaneously.",           color:"#a78bfa", cat:"FIREPOWER", apply:(p)=>{ p.triShot=(p.triShot||0)+1; } },
  { id:"shield",    icon:"🛡", name:"Armor Plating",    desc:"+50 HP, +20% damage reduction. Stacks to 70%.",    color:"#6ee7b7", cat:"DEFENSE",   apply:(p)=>{ p.hp=Math.min(p.maxHp+50,p.hp+50);p.maxHp+=50;p.damageReduction=Math.min(0.7,(p.damageReduction||0)+0.2); } },
  { id:"ghost",     icon:"👻", name:"Ghost Round",      desc:"Bullets phase through walls. Total map control.",   color:"#c4b5fd", cat:"FIREPOWER", apply:(p)=>{ p.ghostBullets=true; } },
  { id:"bigbullet", icon:"⬟",  name:"Slug Round",       desc:"Massive bullets that pierce through all enemies.",  color:"#fb923c", cat:"FIREPOWER", apply:(p)=>{ p.bulletSize=(p.bulletSize||BASE_BULLET_SIZE)*1.9;p.pierceBullets=true; } },
  { id:"magnet",    icon:"🧲", name:"Homing Protocol",  desc:"Bullets curve toward the nearest enemy.",           color:"#f472b6", cat:"UTILITY",   apply:(p)=>{ p.homingBullets=true; } },
  { id:"regen",     icon:"❤️", name:"Regeneration",     desc:"Slowly regenerate 0.08 HP per frame.",             color:"#4ade80", cat:"DEFENSE",   apply:(p)=>{ p.regen=(p.regen||0)+0.08; } },
  { id:"multishot", icon:"✦",  name:"Scatter Shot",     desc:"Fire 5 bullets in a wide fan pattern.",             color:"#fbbf24", cat:"FIREPOWER", apply:(p)=>{ p.multiShot=true; } },
  { id:"reflect",   icon:"🔰", name:"Deflector Shield", desc:"20% chance to reflect incoming bullets back.",      color:"#22d3ee", cat:"DEFENSE",   apply:(p)=>{ p.reflectChance=(p.reflectChance||0)+0.2; } },
  { id:"dash",      icon:"💨", name:"Afterburner",      desc:"Press Shift to dash. Short cooldown.",             color:"#a3e635", cat:"MOBILITY",  apply:(p)=>{ p.hasDash=true; } },
  { id:"explosive", icon:"💣", name:"Explosive Rounds", desc:"Bullets explode on impact — area damage.",         color:"#fca5a5", cat:"FIREPOWER", apply:(p)=>{ p.explosiveBullets=true; } },
];

// ─── UTILS ────────────────────────────────────────────────────────────────────
function makeTank(x, y, hp, skin) {
  return {
    x, y, angle: 0, vx: 0, vy: 0,
    hp, maxHp: hp,
    color: skin.body, barrel: skin.barrel, tread: skin.tread,
    lastShot: 0, speedMult: 1, shootCd: BASE_SHOOT_CD,
    bulletLifetime: BASE_BULLET_LIFETIME, bulletDamage: BASE_DAMAGE,
    bulletSize: BASE_BULLET_SIZE, damageReduction: 0,
    triShot: 0, ghostBullets: false, pierceBullets: false,
    homingBullets: false, multiShot: false,
    regen: 0, reflectChance: 0, hasDash: false, explosiveBullets: false,
    lastDash: 0, upgrades: {},
  };
}

function rectFromWall(w, W, H) {
  return { x: w.x * W, y: w.y * H, w: w.w * W, h: w.h * H };
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx+bw && ax+aw > bx && ay < by+bh && ay+ah > by;
}

function circleRect(cx, cy, r, rx, ry, rw, rh) {
  const nearX = Math.max(rx, Math.min(cx, rx+rw));
  const nearY = Math.max(ry, Math.min(cy, ry+rh));
  return Math.hypot(cx-nearX, cy-nearY) < r;
}

// ─── roundRect polyfill ───────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
  } else {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function TankWars() {
  const canvasRef    = useRef(null);
  const keysRef      = useRef({});
  const stateRef     = useRef(null);
  const modeRef      = useRef("");
  const scoreRef     = useRef(0);
  const waveRef      = useRef(0);
  const highScoreRef = useRef(0);
  const rafRef       = useRef(null);
  const p1WinsRef    = useRef(0);
  const p2WinsRef    = useRef(0);
  const pendingPuRef = useRef(false);
  const mapRef       = useRef(MAPS[0]);
  const dimRef       = useRef({ W: 800, H: 560 });

  const [screen,        setScreen]        = useState("menu");
  const [coins,         setCoins]         = useState(0);
  const [ownedSkins,    setOwnedSkins]    = useState(["default"]);
  const [ownedMaps,     setOwnedMaps]     = useState(["open"]);
  const [equippedSkin,  setEquippedSkin]  = useState("default");
  const [equippedMap,   setEquippedMap]   = useState("open");
  const [shopTab,       setShopTab]       = useState("skins");
  const [overData,      setOverData]      = useState({});
  const [hudData,       setHudData]       = useState({ hp1:100, hp2:100, maxHp1:100, maxHp2:100, score:0, wave:0, mode:"" });
  const [hoveredPu,     setHoveredPu]     = useState(null);
  const [hoveredMode,   setHoveredMode]   = useState(null);
  const [offeredPowerups, setOfferedPowerups] = useState([]);
  const [, rerender]   = useState(0);

  // ─── Responsive canvas
  useEffect(() => {
    function resize() {
      const vw = window.innerWidth, vh = window.innerHeight;
      const ratio = 800 / 560;
      let W, H;
      if (vw / vh > ratio) { H = vh - 60; W = H * ratio; }
      else { W = vw - 20; H = W / ratio; }
      dimRef.current = { W: Math.floor(W), H: Math.floor(H) };
      rerender(n => n + 1);
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // ─── Key listeners
  useEffect(() => {
    const down = e => {
      keysRef.current[e.key.toLowerCase()] = true;
      // FIX: also store right-shift by code so P2 dash doesn't conflict with P1 shift
      if (e.code === "ShiftRight") keysRef.current["rshift"] = true;
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) e.preventDefault();
    };
    const up = e => {
      keysRef.current[e.key.toLowerCase()] = false;
      if (e.code === "ShiftRight") keysRef.current["rshift"] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const getSkin = id => SKINS.find(s => s.id === id) || SKINS[0];
  const getMap  = id => MAPS.find(m => m.id === id)  || MAPS[0];

  function getRandomPowerups(n = 3) {
    return [...POWERUPS].sort(() => Math.random() - 0.5).slice(0, n);
  }

  function spawnWave(state, wave) {
    const { W, H } = dimRef.current;
    const count = Math.min(wave + 1, 12);
    const margin = 80;
    for (let i = 0; i < count; i++) {
      let ex, ey, tries = 0;
      do {
        ex = margin + Math.random() * (W - margin * 2);
        ey = margin + Math.random() * (H - margin * 2);
        tries++;
      } while (tries < 40 && Math.hypot(ex - state.p1.x, ey - state.p1.y) < 160);
      state.enemies.push({
        x: ex, y: ey, angle: 0,
        hp: 40 + wave * 6, maxHp: 40 + wave * 6,
        color: "#ef4444", barrel: "#991b1b", tread: "#3f0808",
        lastShot: 0, spd: 0.85 + wave * 0.07,
        shootDelay: Math.max(500, 1800 - wave * 90),
        isElite: wave > 3 && Math.random() < 0.25,
      });
    }
  }

  function startSurvival() {
    const { W, H } = dimRef.current;
    keysRef.current = {};
    scoreRef.current = 0; waveRef.current = 1;
    pendingPuRef.current = false;
    mapRef.current = getMap(equippedMap);
    const skin = getSkin(equippedSkin);
    stateRef.current = { p1: makeTank(W/2, H/2, 100, skin), p2: null, enemies: [], bullets: [], particles: [], explosions: [] };
    modeRef.current = "survival";
    spawnWave(stateRef.current, 1);
    setScreen("game");
  }

  function start2P() {
    const { W, H } = dimRef.current;
    keysRef.current = {};
    scoreRef.current = 0; waveRef.current = 0;
    p1WinsRef.current = 0; p2WinsRef.current = 0;
    pendingPuRef.current = false;
    mapRef.current = getMap(equippedMap);
    stateRef.current = {
      p1: makeTank(120, H/2, 100, getSkin(equippedSkin)),
      p2: makeTank(W - 120, H/2, 100, getSkin("crimson")),
      enemies: [], bullets: [], particles: [], explosions: [],
      roundOver: false, roundOverTimer: 0, roundWinner: "",
    };
    modeRef.current = "2p";
    setScreen("game");
  }

  function resetPvPRound() {
    const { W, H } = dimRef.current;
    const s = stateRef.current;
    s.p1 = makeTank(120, H/2, 100, getSkin(equippedSkin));
    s.p2 = makeTank(W - 120, H/2, 100, getSkin("crimson"));
    s.bullets = []; s.particles = []; s.enemies = []; s.explosions = [];
    s.roundOver = false; s.roundOverTimer = 0; s.roundWinner = "";
  }

  function handlePowerupPick(puId) {
    const pu = POWERUPS.find(p => p.id === puId);
    const p1 = stateRef.current.p1;
    pu.apply(p1);
    p1.upgrades[puId] = (p1.upgrades[puId] || 0) + 1;
    pendingPuRef.current = false;
    waveRef.current++;
    spawnWave(stateRef.current, waveRef.current);
    setHoveredPu(null);
    setScreen("game");
  }

  function buyItem(type, id, price) {
    if (coins < price) return;
    setCoins(c => c - price);
    if (type === "skin") setOwnedSkins(s => [...s, id]);
    if (type === "map")  setOwnedMaps(m => [...m, id]);
  }

  // ─── GAME LOOP ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== "game") return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const map = mapRef.current;

    function getWalls() {
      const { W, H } = dimRef.current;
      return (map.walls || []).map(w => rectFromWall(w, W, H));
    }

    function shootBullet(x, y, angle, shooterId, color, shooter) {
      stateRef.current.bullets.push({
        x, y, angle, shooterId, color,
        life: shooter?.bulletLifetime || BASE_BULLET_LIFETIME,
        maxLife: shooter?.bulletLifetime || BASE_BULLET_LIFETIME,
        bounces: 0,
        size: shooter?.bulletSize || BASE_BULLET_SIZE,
        ghost: shooter?.ghostBullets || false,
        pierce: shooter?.pierceBullets || false,
        homing: shooter?.homingBullets || false,
        explosive: shooter?.explosiveBullets || false,
        damage: shooter?.bulletDamage || BASE_DAMAGE,
        pierced: [],
      });
    }

    function spawnParticles(x, y, color, count = 8) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, spd = 1.5 + Math.random() * 4;
        stateRef.current.particles.push({ x, y, vx: Math.cos(a)*spd, vy: Math.sin(a)*spd, life: 30, maxLife: 30, color, size: 2 + Math.random()*2 });
      }
    }

    function spawnExplosion(x, y) {
      stateRef.current.explosions.push({ x, y, r: 0, maxR: 50, life: 18, maxLife: 18 });
      spawnParticles(x, y, "#f97316", 16);
    }

    function movePlayer(p, shooterId, fwd, back, left, right, fire, dash, ts) {
      const { W, H } = dimRef.current;
      const walls = getWalls();
      const speed = BASE_SPEED * (p.speedMult || 1);

      // Dash
      if (p.hasDash && dash && ts - p.lastDash > 1200) {
        p.vx += Math.cos(p.angle) * 12;
        p.vy += Math.sin(p.angle) * 12;
        p.lastDash = ts;
        spawnParticles(p.x, p.y, "#a3e635", 6);
      }

      let ax = 0, ay = 0;
      if (fwd)   ay -= 1;
      if (back)  ay += 1;
      if (left)  ax -= 1;
      if (right) ax += 1;
      if (ax && ay) { ax *= 0.707; ay *= 0.707; }

      p.vx = p.vx * FRICTION + ax * speed * (1 - FRICTION);
      p.vy = p.vy * FRICTION + ay * speed * (1 - FRICTION);
      if (Math.abs(p.vx) < 0.01) p.vx = 0;
      if (Math.abs(p.vy) < 0.01) p.vy = 0;

      if (p.regen > 0) p.hp = Math.min(p.maxHp, p.hp + p.regen);

      const hw = TW / 2, hh = TH / 2;
      const BL = BORDER + hw, BR = W - BORDER - hw, BT = BORDER + hh, BB = H - BORDER - hh;

      // Test X axis independently
      let newX = Math.max(BL, Math.min(BR, p.x + p.vx));
      for (const w of walls) {
        if (rectsOverlap(newX - hw, p.y - hh, TW, TH, w.x, w.y, w.w, w.h)) {
          newX = p.x;
          p.vx = 0;
          break;
        }
      }

      // Test Y axis independently (using resolved newX)
      let newY = Math.max(BT, Math.min(BB, p.y + p.vy));
      for (const w of walls) {
        if (rectsOverlap(newX - hw, newY - hh, TW, TH, w.x, w.y, w.w, w.h)) {
          newY = p.y;
          p.vy = 0;
          break;
        }
      }

      p.x = newX;
      p.y = newY;

      // Rotate toward movement direction
      if (ax || ay) {
        const ta = Math.atan2(ay, ax);
        let d = ta - p.angle;
        while (d >  Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        p.angle += d * 0.18;
      }

      // Shoot
      if (fire && ts - p.lastShot > (p.shootCd || BASE_SHOOT_CD)) {
        const bx = p.x + Math.cos(p.angle) * 17;
        const by = p.y + Math.sin(p.angle) * 17;
        shootBullet(bx, by, p.angle, shooterId, p.color, p);
        if (p.triShot > 0) {
          shootBullet(bx, by, p.angle - 0.22, shooterId, p.color, p);
          shootBullet(bx, by, p.angle + 0.22, shooterId, p.color, p);
        }
        if (p.multiShot) {
          for (let i = -2; i <= 2; i++) {
            if (i !== 0 && !(p.triShot > 0 && Math.abs(i) === 1))
              shootBullet(bx, by, p.angle + i * 0.18, shooterId, p.color, p);
          }
        }
        p.lastShot = ts;
      }
    }

    function drawTank(t, label) {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.angle);

      // Treads
      ctx.fillStyle = t.tread || "#333";
      ctx.fillRect(-TW/2 - 3, -TH/2 - 3, TW + 6, 5);
      ctx.fillRect(-TW/2 - 3,  TH/2 - 2, TW + 6, 5);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(-TW/2 - 3 + i*(TW+6)/4, -TH/2 - 3, 1, 5);
        ctx.fillRect(-TW/2 - 3 + i*(TW+6)/4,  TH/2 - 2, 1, 5);
      }

      // Body
      ctx.fillStyle = t.color;
      ctx.beginPath(); roundRect(ctx, -TW/2, -TH/2, TW, TH, 3); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath(); roundRect(ctx, -TW/2, -TH/2, TW, TH/2, 3); ctx.fill();

      // Turret
      ctx.fillStyle = t.barrel;
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); roundRect(ctx, 4, -2.5, 17, 5, 2); ctx.fill();

      // Shield aura
      if (t.damageReduction > 0) {
        ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI*2);
        ctx.strokeStyle = `rgba(110,231,183,${t.damageReduction * 0.55})`;
        ctx.lineWidth = 2.5; ctx.stroke();
      }

      // Dash glow
      if (t.hasDash) {
        ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI*2);
        ctx.strokeStyle = "rgba(163,230,53,0.2)";
        ctx.lineWidth = 1; ctx.stroke();
      }

      ctx.restore();

      // HP bar
      const bw = 38, ratio = Math.max(0, t.hp / t.maxHp);
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(t.x - bw/2, t.y - TH/2 - 11, bw, 5);
      ctx.fillStyle = ratio > 0.5 ? "#4ade80" : ratio > 0.25 ? "#facc15" : "#f87171";
      ctx.fillRect(t.x - bw/2, t.y - TH/2 - 11, bw * ratio, 5);

      if (label) {
        ctx.fillStyle = t.color; ctx.font = "bold 10px 'Courier New'"; ctx.textAlign = "center";
        ctx.fillText(label, t.x, t.y - TH/2 - 15); ctx.textAlign = "left";
      }
    }

    function updateBullet(b) {
      const { W, H } = dimRef.current;
      const walls = getWalls();

      // Homing
      if (b.homing && stateRef.current.enemies.length > 0 && b.shooterId === "p1") {
        let nearest = null, nearDist = Infinity;
        stateRef.current.enemies.forEach(e => {
          const d = Math.hypot(e.x - b.x, e.y - b.y);
          if (d < nearDist) { nearDist = d; nearest = e; }
        });
        if (nearest && nearDist < 280) {
          const ta = Math.atan2(nearest.y - b.y, nearest.x - b.x);
          let diff = ta - b.angle;
          while (diff >  Math.PI) diff -= 2 * Math.PI;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          b.angle += diff * 0.05;
        }
      }

      b.x += Math.cos(b.angle) * BSPEED;
      b.y += Math.sin(b.angle) * BSPEED;
      b.life--;

      if (!b.ghost) {
        const WL = BORDER + 2, WR = W - BORDER - 2, WT = BORDER + 2, WB = H - BORDER - 2;
        let bounced = false;

        if (b.x <= WL) { b.x = WL + 1; b.angle = Math.PI - b.angle; bounced = true; }
        else if (b.x >= WR) { b.x = WR - 1; b.angle = Math.PI - b.angle; bounced = true; }
        if (b.y <= WT) { b.y = WT + 1; b.angle = -b.angle; bounced = true; }
        else if (b.y >= WB) { b.y = WB - 1; b.angle = -b.angle; bounced = true; }

        for (const w of walls) {
          if (circleRect(b.x, b.y, b.size, w.x, w.y, w.w, w.h)) {
            const cx = w.x + w.w/2, cy = w.y + w.h/2;
            const dx = b.x - cx, dy = b.y - cy;
            if (Math.abs(dx / w.w) > Math.abs(dy / w.h)) b.angle = Math.PI - b.angle;
            else b.angle = -b.angle;
            bounced = true;
            break;
          }
        }

        if (bounced) { b.bounces++; spawnParticles(b.x, b.y, "#fff", 3); }
      }
    }

    let lastHudUpdate = 0;

    function loop(ts) {
      const { W, H } = dimRef.current;
      const s = stateRef.current;
      const keys = keysRef.current;
      const mode = modeRef.current;

      if (mode === "2p" && s.roundOver) {
        s.roundOverTimer -= 16;
        if (s.roundOverTimer <= 0) {
          if (p1WinsRef.current >= 3 || p2WinsRef.current >= 3) {
            const winner = p1WinsRef.current >= 3 ? "Player 1 Wins!" : "Player 2 Wins!";
            setScreen("over");
            setOverData({ title: winner, score: 0, best: 0, coins: 0 });
            return;
          }
          resetPvPRound();
        }
      } else {
        // FIX: P2 dash uses "rshift" (tracked via e.code) to avoid conflicting with P1's shift
        movePlayer(s.p1, "p1", keys["w"], keys["s"], keys["a"], keys["d"], keys[" "], keys["shift"], ts);
        if (s.p2) movePlayer(s.p2, "p2", keys["arrowup"], keys["arrowdown"], keys["arrowleft"], keys["arrowright"], keys["enter"], keys["rshift"], ts);

        if (mode === "survival") {
          const walls = getWalls();
          s.enemies.forEach(e => {
            const dx = s.p1.x - e.x, dy = s.p1.y - e.y, dist = Math.hypot(dx, dy);
            const ta = Math.atan2(dy, dx);
            let d = ta - e.angle;
            while (d >  Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            e.angle += d * 0.05;

            if (dist > 90) {
              const nx = e.x + Math.cos(e.angle) * e.spd;
              const ny = e.y + Math.sin(e.angle) * e.spd;
              const hw = TW/2, hh = TH/2;
              let blocked = false;
              for (const w of walls) if (rectsOverlap(nx - hw, ny - hh, TW, TH, w.x, w.y, w.w, w.h)) { blocked = true; break; }
              if (!blocked) {
                e.x = Math.max(BORDER + hw, Math.min(W - BORDER - hw, nx));
                e.y = Math.max(BORDER + hh, Math.min(H - BORDER - hh, ny));
              }
            }

            if (ts - e.lastShot > e.shootDelay) {
              shootBullet(e.x + Math.cos(e.angle)*16, e.y + Math.sin(e.angle)*16, e.angle, "enemy", "#f97316",
                { bulletLifetime: BASE_BULLET_LIFETIME, bulletSize: BASE_BULLET_SIZE + (e.isElite ? 2 : 0), bulletDamage: e.isElite ? 9 : 5 });
              if (e.isElite) {
                shootBullet(e.x + Math.cos(e.angle+0.3)*16, e.y + Math.sin(e.angle+0.3)*16, e.angle+0.3, "enemy", "#ff6b00",
                  { bulletLifetime: BASE_BULLET_LIFETIME, bulletSize: BASE_BULLET_SIZE, bulletDamage: 7 });
              }
              e.lastShot = ts;
            }
          });
        }

        s.bullets.forEach(b => updateBullet(b));

        // ── Hit detection
        s.bullets.forEach(b => {
          if (b.life <= 0) return;

          if (b.shooterId === "p1" || b.shooterId === "p2") {
            const target = b.shooterId === "p1" ? s.p2 : s.p1;

            s.enemies.forEach(e => {
              if (b.pierce && b.pierced.includes(e)) return;
              if (Math.hypot(b.x - e.x, b.y - e.y) < (b.size + 10)) {
                e.hp -= b.damage;
                if (b.explosive) spawnExplosion(b.x, b.y);
                if (b.pierce) { b.pierced.push(e); spawnParticles(b.x, b.y, b.color, 4); }
                else b.life = 0;
              }
            });

            if (target && target.hp > 0 && Math.hypot(b.x - target.x, b.y - target.y) < 15) {
              if (target.reflectChance > 0 && Math.random() < target.reflectChance) {
                b.angle += Math.PI;
                b.shooterId = b.shooterId === "p1" ? "p2" : "p1";
                spawnParticles(b.x, b.y, "#22d3ee", 5);
              } else {
                const dmg = b.damage * (1 - (target.damageReduction || 0));
                target.hp -= dmg;
                if (b.explosive) spawnExplosion(b.x, b.y);
                b.life = 0;
              }
            }

          } else if (b.shooterId === "enemy") {
            // FIX: guard explosive splash behind b.explosive check
            if (b.explosive && Math.hypot(b.x - s.p1.x, b.y - s.p1.y) < 55) {
              s.p1.hp -= b.damage * 0.5 * (1 - (s.p1.damageReduction || 0));
              spawnExplosion(b.x, b.y);
              b.life = 0;
            }
            if (b.life > 0 && s.p1.hp > 0 && Math.hypot(b.x - s.p1.x, b.y - s.p1.y) < 15) {
              if (s.p1.reflectChance > 0 && Math.random() < s.p1.reflectChance) {
                b.angle += Math.PI;
                b.shooterId = "p1_reflect";
                spawnParticles(b.x, b.y, "#22d3ee", 5);
              } else {
                const dmg = b.damage * (1 - (s.p1.damageReduction || 0));
                s.p1.hp -= dmg;
                if (b.explosive) spawnExplosion(b.x, b.y);
                b.life = 0;
              }
            }

          } else if (b.shooterId === "p1_reflect") {
            s.enemies.forEach(e => {
              if (Math.hypot(b.x - e.x, b.y - e.y) < (b.size + 10)) {
                e.hp -= b.damage * 2;
                b.life = 0;
              }
            });
          }
        });

        // Explosion area damage
        s.explosions.forEach(ex => {
          if (ex.life === ex.maxLife) {
            s.enemies.forEach(e => { if (Math.hypot(e.x - ex.x, e.y - ex.y) < ex.maxR) e.hp -= 15; });
          }
          ex.r += (ex.maxR - ex.r) * 0.3;
          ex.life--;
        });
        s.explosions = s.explosions.filter(e => e.life > 0);

        // Kill enemies
        const before = s.enemies.length;
        s.enemies = s.enemies.filter(e => {
          if (e.hp <= 0) { spawnParticles(e.x, e.y, e.isElite ? "#fbbf24" : "#f97316", e.isElite ? 16 : 10); return false; }
          return true;
        });
        const killed = before - s.enemies.length;
        if (killed > 0) {
          scoreRef.current += killed * 10 * waveRef.current;
          if (mode === "survival") s.p1.hp = Math.min(s.p1.maxHp, s.p1.hp + killed * 8);
        }

        s.bullets   = s.bullets.filter(b => b.life > 0);
        s.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vx *= 0.91; p.vy *= 0.91; p.life--; });
        s.particles = s.particles.filter(p => p.life > 0);

        // ── Wave clear
        if (mode === "survival" && s.enemies.length === 0 && !pendingPuRef.current) {
          pendingPuRef.current = true;
          const offers = getRandomPowerups(3);
          const waveCoins = Math.round(30 + waveRef.current * 15);
          setCoins(c => c + waveCoins);
          cancelAnimationFrame(rafRef.current);
          setOfferedPowerups(offers);
          setScreen("powerup");
          return;
        }

        // ── PvP round end
        if (mode === "2p" && !s.roundOver) {
          const p1Dead = s.p1.hp <= 0, p2Dead = s.p2 && s.p2.hp <= 0;
          if (p1Dead || p2Dead) {
            if (p1Dead) spawnParticles(s.p1.x, s.p1.y, s.p1.color);
            if (p2Dead) spawnParticles(s.p2.x, s.p2.y, s.p2.color);
            if (!p1Dead) p1WinsRef.current++;
            else if (!p2Dead) p2WinsRef.current++;
            s.roundOver = true; s.roundOverTimer = 2200;
            s.roundWinner = p1Dead && p2Dead ? "Draw!" : p1Dead ? "P2 wins the round!" : "P1 wins the round!";
          }
        }

        // ── Survival death
        if (mode === "survival" && s.p1.hp <= 0) {
          if (scoreRef.current > highScoreRef.current) highScoreRef.current = scoreRef.current;
          const earned = Math.round(waveRef.current * 20);
          setCoins(c => c + earned);
          setScreen("over");
          setOverData({ title: "Game Over", score: scoreRef.current, best: highScoreRef.current, wave: waveRef.current, coins: earned });
          return;
        }
      }

      // ── DRAW ──────────────────────────────────────────────────────────────
      ctx.fillStyle = map.bg; ctx.fillRect(0, 0, W, H);

      // Grid
      ctx.strokeStyle = map.grid; ctx.lineWidth = 0.8;
      const gSz = Math.round(W / 20);
      for (let x = 0; x < W; x += gSz) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += gSz) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

      // Border
      ctx.strokeStyle = map.border; ctx.lineWidth = BORDER * 2; ctx.strokeRect(0, 0, W, H);

      // Walls
      const walls = getWalls();
      walls.forEach(w => {
        ctx.fillStyle = map.border || "#1e293b";
        ctx.beginPath(); roundRect(ctx, w.x, w.y, w.w, w.h, 4); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
        ctx.beginPath(); roundRect(ctx, w.x, w.y, w.w, w.h, 4); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(w.x, w.y, w.w, Math.min(6, w.h));
      });

      // Explosions
      stateRef.current.explosions.forEach(ex => {
        const g = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, ex.r);
        g.addColorStop(0,   `rgba(255,200,50,${0.7 * (ex.life / ex.maxLife)})`);
        g.addColorStop(0.5, `rgba(255,100,20,${0.4 * (ex.life / ex.maxLife)})`);
        g.addColorStop(1,   `rgba(255,50,0,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.r, 0, Math.PI*2); ctx.fill();
      });

      // Particles
      stateRef.current.particles.forEach(p => {
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size || 2, 0, Math.PI*2); ctx.fill();
      });
      ctx.globalAlpha = 1;

      // Tanks
      const showLabels = modeRef.current === "2p";
      const st = stateRef.current;
      if (st.p1.hp > 0) drawTank(st.p1, showLabels ? "P1" : null);
      if (st.p2 && st.p2.hp > 0) drawTank(st.p2, showLabels ? "P2" : null);
      st.enemies.forEach(e => {
        if (e.isElite) {
          ctx.save(); ctx.translate(e.x, e.y);
          ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI*2);
          ctx.strokeStyle = "rgba(251,191,36,0.4)"; ctx.lineWidth = 2; ctx.stroke();
          ctx.restore();
        }
        drawTank(e, null);
      });

      // Bullets
      st.bullets.forEach(b => {
        const ageFrac = b.life / b.maxLife;
        ctx.globalAlpha = Math.min(1, ageFrac * 3);
        if (b.ghost || b.explosive) { ctx.shadowBlur = b.explosive ? 16 : 10; ctx.shadowColor = b.color; }
        ctx.beginPath(); ctx.arc(b.x, b.y, b.size, 0, Math.PI*2);
        ctx.fillStyle = b.color; ctx.fill();
        if (b.bounces > 0 || b.homing) { ctx.beginPath(); ctx.arc(b.x, b.y, b.size*0.4, 0, Math.PI*2); ctx.fillStyle = "#fff"; ctx.fill(); }
        ctx.shadowBlur = 0;
      });
      ctx.globalAlpha = 1;

      // Canvas HUD
      if (modeRef.current === "survival") {
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(W/2 - 70, 8, 140, 22);
        ctx.fillStyle = "#facc15"; ctx.font = `bold ${Math.round(W/65)}px 'Courier New'`; ctx.textAlign = "center";
        ctx.fillText(`◆ Wave ${waveRef.current} ◆`, W/2, 23); ctx.textAlign = "left";
      }
      if (modeRef.current === "2p") {
        ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(W/2 - 110, 8, 220, 24);
        ctx.font = "bold 13px 'Courier New'"; ctx.textAlign = "center";
        ctx.fillStyle = st.p1.color; ctx.fillText(`P1 ${p1WinsRef.current}`, W/2 - 44, 24);
        ctx.fillStyle = "#444"; ctx.fillText("—", W/2, 24);
        ctx.fillStyle = st.p2?.color || "#e879f9"; ctx.fillText(`${p2WinsRef.current} P2`, W/2 + 44, 24);
        ctx.textAlign = "left";
        if (st.roundOver) {
          ctx.fillStyle = "rgba(0,0,0,0.75)"; ctx.fillRect(W/2 - 150, H/2 - 36, 300, 68);
          ctx.fillStyle = "#facc15"; ctx.font = "bold 22px 'Courier New'"; ctx.textAlign = "center";
          ctx.fillText(st.roundWinner, W/2, H/2 - 4);
          ctx.fillStyle = "#555"; ctx.font = "12px 'Courier New'";
          ctx.fillText("Next round starting...", W/2, H/2 + 22); ctx.textAlign = "left";
        }
      }

      if (ts - lastHudUpdate > 100) {
        lastHudUpdate = ts;
        setHudData({
          hp1: Math.max(0, Math.round(st.p1.hp)), maxHp1: st.p1.maxHp,
          hp2: st.p2 ? Math.max(0, Math.round(st.p2.hp)) : 0, maxHp2: st.p2 ? st.p2.maxHp : 100,
          score: scoreRef.current, wave: waveRef.current, mode: modeRef.current,
        });
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [screen]);

  const { W, H } = dimRef.current;
  const p1 = stateRef.current?.p1;
  const catColor = { FIREPOWER: "#ef4444", MOBILITY: "#facc15", DEFENSE: "#6ee7b7", UTILITY: "#f472b6" };

  const styles = {
    root: { position: "fixed", inset: 0, background: "#05050e", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Courier New', monospace", userSelect: "none", overflow: "hidden" },
    card: (hovered, accent) => ({ padding: "28px 24px", background: hovered ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)", border: `1.5px solid ${hovered ? accent : "#0f172a"}`, borderRadius: 16, cursor: "pointer", transition: "all 0.2s ease", transform: hovered ? "translateY(-6px)" : "none", boxShadow: hovered ? `0 14px 50px ${accent}28` : "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }),
    btn: () => ({ padding: "10px 28px", background: "transparent", border: "1.5px solid #1e293b", borderRadius: 10, color: "#94a3b8", cursor: "pointer", fontSize: 13, fontFamily: "'Courier New'", letterSpacing: "0.08em", transition: "all 0.18s" }),
    tag: (color, active) => ({ fontSize: 9, letterSpacing: "0.2em", color: active ? color : "#1e293b", fontWeight: 700, border: `1px solid ${active ? color+"55" : "#0f172a"}`, borderRadius: 4, padding: "2px 8px", transition: "all 0.18s" }),
  };

  return (
    <div style={styles.root}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:0.6} 50%{opacity:1} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { from{background-position:200% center} to{background-position:-200% center} }
        .fade-in { animation: fadeIn 0.35s ease both; }
        ::-webkit-scrollbar { width:4px } ::-webkit-scrollbar-thumb { background:#1e293b; border-radius:2px }
      `}</style>

      {/* ── GLOBAL COIN DISPLAY ── */}
      {screen !== "menu" && screen !== "game" && (
        <div style={{ position: "fixed", top: 16, right: 20, background: "rgba(0,0,0,0.7)", border: "1px solid #1e293b", borderRadius: 8, padding: "6px 14px", fontSize: 13, color: "#facc15", zIndex: 100 }}>
          ◆ {coins.toLocaleString()}
        </div>
      )}

      {/* ════════════════════════════════ MENU ════════════════════════════════ */}
      {screen === "menu" && (
        <div className="fade-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: 700, padding: "0 20px", gap: 0 }}>
          <div style={{ textAlign: "center", marginBottom: 44 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.5em", color: "#1e3a5f", marginBottom: 10 }}>◆ TACTICAL ARENA ◆</div>
            <div style={{ display: "flex", gap: 0, justifyContent: "center" }}>
              <h1 style={{ fontSize: "clamp(48px,8vw,80px)", fontWeight: 900, letterSpacing: "0.12em", margin: 0, lineHeight: 0.95, background: "linear-gradient(135deg,#22c55e,#4ade80,#86efac)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundSize: "200%", animation: "shimmer 4s linear infinite" }}>TANK</h1>
              <h1 style={{ fontSize: "clamp(48px,8vw,80px)", fontWeight: 900, letterSpacing: "0.12em", margin: 0, lineHeight: 0.95, color: "#1e293b", WebkitTextStroke: "2px #1e3a5f" }}>&nbsp;WARS</h1>
            </div>
            <div style={{ fontSize: 11, color: "#334155", marginTop: 10, letterSpacing: "0.15em" }}>FULLSCREEN · CUSTOM MAPS · SHOP · 14 UPGRADES</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 30, background: "rgba(250,204,21,0.07)", border: "1px solid rgba(250,204,21,0.15)", borderRadius: 10, padding: "8px 20px" }}>
            <span style={{ fontSize: 18, color: "#facc15" }}>◆</span>
            <span style={{ fontSize: 22, fontWeight: 900, color: "#facc15" }}>{coins.toLocaleString()}</span>
            <span style={{ fontSize: 11, color: "#64748b", marginLeft: 4 }}>COINS</span>
          </div>

          <div style={{ display: "flex", gap: 16, marginBottom: 28, flexWrap: "wrap", justifyContent: "center" }}>
            {[
              { id: "survival", label: "SURVIVAL", sublabel: "vs AI Waves",    accent: "#22c55e", icon: "🎯", desc: "Endless enemy waves. Earn coins. Choose upgrades between rounds.", keys: ["WASD · Space"],              onClick: startSurvival },
              { id: "2p",       label: "PvP",      sublabel: "First to 3 Wins", accent: "#e879f9", icon: "⚔️", desc: "Two players, one arena. Outmaneuver and outgun your rival.",       keys: ["P1: WASD+Space", "P2: Arrows+Enter"], onClick: start2P },
            ].map(mode => {
              const hov = hoveredMode === mode.id;
              return (
                <div key={mode.id} onClick={mode.onClick} onMouseEnter={() => setHoveredMode(mode.id)} onMouseLeave={() => setHoveredMode(null)}
                  style={{ ...styles.card(hov, mode.accent), width: 220 }}>
                  <div style={{ fontSize: 32 }}>{mode.icon}</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: "0.1em", color: hov ? mode.accent : "#e2e8f0" }}>{mode.label}</div>
                    <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.12em", marginTop: 2 }}>{mode.sublabel}</div>
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", textAlign: "center", lineHeight: 1.7 }}>{mode.desc}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
                    {mode.keys.map(k => <span key={k} style={{ background: "#0a0a1a", border: "1px solid #1e293b", borderRadius: 5, padding: "2px 10px", fontSize: 10, color: "#475569" }}>{k}</span>)}
                  </div>
                  <div style={{ fontSize: 10, letterSpacing: "0.15em", color: hov ? mode.accent : "#1e293b", transition: "color 0.2s" }}>{hov ? "▶  PLAY" : "· · ·"}</div>
                </div>
              );
            })}

            {/* Shop card */}
            <div onClick={() => setScreen("shop")} onMouseEnter={() => setHoveredMode("shop")} onMouseLeave={() => setHoveredMode(null)}
              style={{ ...styles.card(hoveredMode === "shop", "#f59e0b"), width: 220 }}>
              <div style={{ fontSize: 32 }}>🛒</div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: "0.1em", color: hoveredMode === "shop" ? "#f59e0b" : "#e2e8f0" }}>SHOP</div>
                <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.12em", marginTop: 2 }}>Skins & Maps</div>
              </div>
              <div style={{ fontSize: 11, color: "#64748b", textAlign: "center", lineHeight: 1.7 }}>Unlock new tank skins and battle arenas. Earn coins by surviving waves.</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {["🎨 10 Skins", "🗺 5 Maps"].map(f => <span key={f} style={{ background: "#0a0a1a", border: "1px solid #1e293b", borderRadius: 5, padding: "2px 10px", fontSize: 10, color: "#475569" }}>{f}</span>)}
              </div>
              <div style={{ fontSize: 10, letterSpacing: "0.15em", color: hoveredMode === "shop" ? "#f59e0b" : "#1e293b", transition: "color 0.2s" }}>{hoveredMode === "shop" ? "▶  BROWSE" : "· · ·"}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 20, borderTop: "1px solid #0a0a1a", paddingTop: 18, fontSize: 11, color: "#334155", flexWrap: "wrap", justifyContent: "center" }}>
            <span>Skin: <span style={{ color: getSkin(equippedSkin).body }}>{getSkin(equippedSkin).name}</span></span>
            <span style={{ color: "#1e293b" }}>·</span>
            <span>Map: <span style={{ color: "#94a3b8" }}>{getMap(equippedMap).name}</span></span>
          </div>
        </div>
      )}

      {/* ════════════════════════════════ SHOP ════════════════════════════════ */}
      {screen === "shop" && (
        <div className="fade-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: 820, height: "100vh", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "20px 24px 0", width: "100%", boxSizing: "border-box" }}>
            <button onClick={() => setScreen("menu")} style={{ ...styles.btn(), fontSize: 12, padding: "6px 16px" }}
              onMouseEnter={e => e.currentTarget.style.borderColor="#38bdf8"}
              onMouseLeave={e => e.currentTarget.style.borderColor="#1e293b"}>← Back</button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#f8fafc", letterSpacing: "0.12em" }}>ARMORY</div>
              <div style={{ fontSize: 10, color: "#334155", letterSpacing: "0.15em" }}>SKINS & BATTLE ARENAS</div>
            </div>
            <div style={{ background: "rgba(250,204,21,0.08)", border: "1px solid rgba(250,204,21,0.2)", borderRadius: 10, padding: "8px 18px", fontSize: 16, color: "#facc15", fontWeight: 900 }}>◆ {coins.toLocaleString()}</div>
          </div>

          <div style={{ display: "flex", gap: 4, margin: "18px 0 0", padding: "4px", background: "#0a0a1a", borderRadius: 10 }}>
            {["skins", "maps"].map(t => (
              <button key={t} onClick={() => setShopTab(t)}
                style={{ padding: "8px 28px", background: shopTab===t ? "rgba(255,255,255,0.07)" : "transparent", border: shopTab===t ? "1px solid #1e293b" : "1px solid transparent", borderRadius: 8, color: shopTab===t ? "#e2e8f0" : "#334155", fontSize: 12, cursor: "pointer", fontFamily: "'Courier New'", letterSpacing: "0.1em", transition: "all 0.15s" }}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          <div style={{ overflowY: "auto", padding: "18px 24px 24px", width: "100%", boxSizing: "border-box" }}>
            {shopTab === "skins" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12 }}>
                {SKINS.map(skin => {
                  const owned = ownedSkins.includes(skin.id);
                  const equipped = equippedSkin === skin.id;
                  const canBuy = coins >= skin.price && !owned;
                  return (
                    <div key={skin.id} style={{ background: equipped ? "rgba(34,197,94,0.07)" : "rgba(255,255,255,0.02)", border: `1.5px solid ${equipped ? "#22c55e" : owned ? "#1e293b" : "#0f172a"}`, borderRadius: 12, padding: "16px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                      <svg width="70" height="50" viewBox="0 0 70 50">
                        <rect x="10" y="10" width="10" height="30" fill={skin.tread} rx="2"/>
                        <rect x="50" y="10" width="10" height="30" fill={skin.tread} rx="2"/>
                        <rect x="16" y="14" width="38" height="22" fill={skin.body} rx="3"/>
                        <rect x="16" y="14" width="38" height="11" fill="rgba(255,255,255,0.12)" rx="3"/>
                        <circle cx="35" cy="25" r="8" fill={skin.barrel}/>
                        <rect x="39" y="22.5" width="18" height="5" fill={skin.barrel} rx="2"/>
                      </svg>
                      <div style={{ fontSize: 11, fontWeight: 700, color: equipped ? "#22c55e" : "#94a3b8", textAlign: "center" }}>{skin.name}</div>
                      {equipped ? (
                        <div style={{ fontSize: 9, color: "#22c55e", border: "1px solid #22c55e44", borderRadius: 99, padding: "2px 10px", letterSpacing: "0.1em" }}>EQUIPPED</div>
                      ) : owned ? (
                        <button onClick={() => setEquippedSkin(skin.id)} style={{ fontSize: 10, color: "#94a3b8", background: "rgba(255,255,255,0.05)", border: "1px solid #1e293b", borderRadius: 8, padding: "4px 12px", cursor: "pointer", fontFamily: "'Courier New'" }}>Equip</button>
                      ) : (
                        <button onClick={() => buyItem("skin", skin.id, skin.price)} disabled={!canBuy}
                          style={{ fontSize: 10, color: canBuy ? "#facc15" : "#334155", background: canBuy ? "rgba(250,204,21,0.08)" : "transparent", border: `1px solid ${canBuy ? "rgba(250,204,21,0.3)" : "#0f172a"}`, borderRadius: 8, padding: "4px 12px", cursor: canBuy ? "pointer" : "default", fontFamily: "'Courier New'" }}>
                          ◆ {skin.price}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {shopTab === "maps" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14 }}>
                {MAPS.map(map => {
                  const owned = ownedMaps.includes(map.id);
                  const equipped = equippedMap === map.id;
                  const canBuy = coins >= map.price && !owned;
                  return (
                    <div key={map.id} style={{ background: equipped ? "rgba(34,197,94,0.06)" : "rgba(255,255,255,0.02)", border: `1.5px solid ${equipped ? "#22c55e" : owned ? "#1e293b" : "#0f172a"}`, borderRadius: 14, padding: "18px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                      <svg width="100%" height="80" style={{ background: map.bg, borderRadius: 8, border: `1px solid ${map.border}` }} viewBox="0 0 200 120">
                        {(map.walls || []).map((w, i) => (
                          <rect key={i} x={w.x*200} y={w.y*120} width={w.w*200} height={w.h*120} fill={map.border} rx="3" opacity="0.9"/>
                        ))}
                        <line x1="0" y1="0"   x2="200" y2="0"   stroke={map.border} strokeWidth="6"/>
                        <line x1="0" y1="120" x2="200" y2="120" stroke={map.border} strokeWidth="6"/>
                        <line x1="0" y1="0"   x2="0"   y2="120" stroke={map.border} strokeWidth="6"/>
                        <line x1="200" y1="0" x2="200" y2="120" stroke={map.border} strokeWidth="6"/>
                      </svg>
                      <div style={{ fontSize: 13, fontWeight: 700, color: equipped ? "#22c55e" : "#e2e8f0" }}>{map.name}</div>
                      <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.6 }}>{map.desc}</div>
                      {equipped ? (
                        <div style={{ fontSize: 9, color: "#22c55e", border: "1px solid #22c55e44", borderRadius: 99, padding: "3px 12px", letterSpacing: "0.1em", textAlign: "center" }}>SELECTED</div>
                      ) : owned ? (
                        <button onClick={() => setEquippedMap(map.id)} style={{ fontSize: 11, color: "#94a3b8", background: "rgba(255,255,255,0.04)", border: "1px solid #1e293b", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontFamily: "'Courier New'" }}>Select</button>
                      ) : (
                        <button onClick={() => buyItem("map", map.id, map.price)} disabled={!canBuy}
                          style={{ fontSize: 11, color: canBuy ? "#facc15" : "#334155", background: canBuy ? "rgba(250,204,21,0.07)" : "transparent", border: `1px solid ${canBuy ? "rgba(250,204,21,0.25)" : "#0f172a"}`, borderRadius: 8, padding: "6px 14px", cursor: canBuy ? "pointer" : "default", fontFamily: "'Courier New'" }}>
                          ◆ {map.price} — Unlock
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════ GAME ════════════════════════════════ */}
      {screen === "game" && (
        <div className="fade-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: "100%" }}>
          {/* HUD */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, width: W, padding: "0 4px", boxSizing: "border-box" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: getSkin(equippedSkin).body, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em" }}>P1</span>
              <div style={{ width: 90, height: 6, background: "#0a0a1a", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 3, transition: "width 0.15s", width: `${Math.min(100,(hudData.hp1/hudData.maxHp1)*100)}%`, background: hudData.hp1/hudData.maxHp1 > 0.5 ? "#4ade80" : hudData.hp1/hudData.maxHp1 > 0.25 ? "#facc15" : "#f87171" }}/>
              </div>
              <span style={{ color: "#e2e8f0", fontSize: 11, width: 36 }}>{hudData.hp1}/{hudData.maxHp1}</span>
            </div>
            {hudData.mode === "2p" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#e879f9", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em" }}>P2</span>
                <div style={{ width: 90, height: 6, background: "#0a0a1a", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 3, transition: "width 0.15s", width: `${Math.max(0,(hudData.hp2/hudData.maxHp2)*100)}%`, background: hudData.hp2/hudData.maxHp2 > 0.5 ? "#e879f9" : hudData.hp2/hudData.maxHp2 > 0.25 ? "#facc15" : "#f87171" }}/>
                </div>
                <span style={{ color: "#e2e8f0", fontSize: 11, width: 36 }}>{hudData.hp2}/{hudData.maxHp2}</span>
              </div>
            )}
            <div style={{ flex: 1 }}/>
            {hudData.mode === "survival" && (
              <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
                <span style={{ color: "#facc15", fontSize: 12, fontWeight: 700 }}>◆ Wave {hudData.wave}</span>
                <span style={{ color: "#475569", fontSize: 11 }}>Score <span style={{ color: "#fff" }}>{hudData.score.toLocaleString()}</span></span>
                <span style={{ color: "#475569", fontSize: 11 }}>Best <span style={{ color: "#facc15" }}>{highScoreRef.current.toLocaleString()}</span></span>
                <span style={{ color: "#facc15", fontSize: 11 }}>◆ {coins}</span>
              </div>
            )}
            {hudData.mode === "2p" && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12 }}>
                <span style={{ color: "#22c55e", fontWeight: 700 }}>P1 {p1WinsRef.current}</span>
                <span style={{ color: "#1e293b" }}>vs</span>
                <span style={{ color: "#e879f9", fontWeight: 700 }}>{p2WinsRef.current} P2</span>
                <span style={{ color: "#1e293b", fontSize: 10 }}>· first to 3</span>
              </div>
            )}
            <button onClick={() => { cancelAnimationFrame(rafRef.current); setScreen("menu"); }}
              style={{ fontSize: 10, color: "#334155", background: "transparent", border: "1px solid #0f172a", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: "'Courier New'" }}>✕ QUIT</button>
          </div>
          <canvas ref={canvasRef} width={W} height={H} style={{ border: "1px solid #0a0a1a", borderRadius: 6, display: "block" }}/>
          <div style={{ fontSize: 10, color: "#1e293b", letterSpacing: "0.06em" }}>
            {hudData.mode === "survival" && "WASD  move  ·  Space  fire  ·  Shift  dash  ·  Kill enemies to heal  ·  Upgrades between waves"}
            {hudData.mode === "2p" && "P1: WASD + Space   ·   P2: Arrows + Enter   ·   P2 dash: RShift   ·   Bullets bounce!   ·   First to 3 rounds"}
          </div>
        </div>
      )}

      {/* ════════════════════════════════ POWERUP ═════════════════════════════ */}
      {screen === "powerup" && (
        <div className="fade-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30, maxWidth: 800, padding: "0 20px" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.4em", color: "#22c55e", marginBottom: 10 }}>✓ WAVE {waveRef.current} CLEARED</div>
            <h2 style={{ fontSize: 38, fontWeight: 900, letterSpacing: "0.18em", color: "#f8fafc", margin: "0 0 8px" }}>UPGRADE</h2>
            <p style={{ color: "#475569", fontSize: 12, margin: 0 }}>Choose one enhancement — wave {waveRef.current + 1} awaits</p>
          </div>

          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            {offeredPowerups.map(pu => {
              const count = p1?.upgrades?.[pu.id] || 0;
              const hov = hoveredPu === pu.id;
              const cc = catColor[pu.cat] || "#888";
              return (
                <button key={pu.id} onClick={() => handlePowerupPick(pu.id)}
                  onMouseEnter={() => setHoveredPu(pu.id)} onMouseLeave={() => setHoveredPu(null)}
                  style={{ width: 200, padding: "26px 18px 20px", background: hov ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.025)", border: `1.5px solid ${hov ? pu.color : "#0f172a"}`, borderRadius: 16, cursor: "pointer", transition: "all 0.18s ease", transform: hov ? "translateY(-10px) scale(1.04)" : "none", boxShadow: hov ? `0 18px 55px ${pu.color}30` : "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 11, position: "relative", overflow: "hidden", outline: "none" }}>
                  {hov && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 65, background: `linear-gradient(to bottom,${pu.color}22,transparent)`, pointerEvents: "none" }}/>}
                  <div style={styles.tag(cc, hov)}>{pu.cat}</div>
                  <div style={{ fontSize: 42, lineHeight: 1, filter: hov ? `drop-shadow(0 0 18px ${pu.color})` : "none", transition: "filter 0.18s" }}>{pu.icon}</div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: hov ? pu.color : "#e2e8f0", letterSpacing: "0.06em", textAlign: "center", transition: "color 0.18s" }}>{pu.name}</div>
                  <div style={{ fontSize: 11, color: "#475569", textAlign: "center", lineHeight: 1.7 }}>{pu.desc}</div>
                  {count > 0 && <div style={{ background: `${pu.color}18`, border: `1px solid ${pu.color}44`, borderRadius: 999, padding: "3px 12px", fontSize: 10, color: pu.color }}>owned ×{count}</div>}
                  <div style={{ fontSize: 10, letterSpacing: "0.15em", color: hov ? pu.color : "#1e293b", transition: "color 0.18s", marginTop: 2 }}>{hov ? "▶  SELECT" : "· · ·"}</div>
                </button>
              );
            })}
          </div>

          {p1 && (
            <div style={{ display: "flex", gap: 20, alignItems: "center", fontSize: 11, color: "#334155", border: "1px solid #0a0a1a", borderRadius: 10, padding: "10px 24px", background: "#030308", flexWrap: "wrap", justifyContent: "center" }}>
              <span style={{ color: "#1e293b", letterSpacing: "0.1em" }}>STATS</span>
              <span>SPD <span style={{ color: "#facc15" }}>×{(p1.speedMult||1).toFixed(2)}</span></span>
              <span>CD <span style={{ color: "#f97316" }}>{p1.shootCd||BASE_SHOOT_CD}ms</span></span>
              <span>DMG <span style={{ color: "#ef4444" }}>{(p1.bulletDamage||BASE_DAMAGE).toFixed(0)}</span></span>
              <span>ARM <span style={{ color: "#6ee7b7" }}>{Math.round((p1.damageReduction||0)*100)}%</span></span>
              <span>HP <span style={{ color: "#4ade80" }}>{Math.round(p1.hp)}/{p1.maxHp}</span></span>
              <span>TTL <span style={{ color: "#38bdf8" }}>{p1.bulletLifetime||BASE_BULLET_LIFETIME}</span></span>
              {p1.triShot > 0   && <span style={{ color: "#a78bfa" }}>⟠ Triple</span>}
              {p1.multiShot     && <span style={{ color: "#fbbf24" }}>✦ Scatter</span>}
              {p1.ghostBullets  && <span style={{ color: "#c4b5fd" }}>👻 Ghost</span>}
              {p1.pierceBullets && <span style={{ color: "#fb923c" }}>⬟ Pierce</span>}
              {p1.homingBullets && <span style={{ color: "#f472b6" }}>🧲 Homing</span>}
              {p1.hasDash       && <span style={{ color: "#a3e635" }}>💨 Dash</span>}
              {p1.explosiveBullets && <span style={{ color: "#fca5a5" }}>💣 Explode</span>}
              {(p1.reflectChance||0) > 0 && <span style={{ color: "#22d3ee" }}>🔰 Reflect</span>}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════ GAME OVER ═══════════════════════════ */}
      {screen === "over" && (
        <div className="fade-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.5em", color: "#334155", marginBottom: 14 }}>— MATCH ENDED —</div>
            <h2 style={{ fontSize: 40, fontWeight: 900, color: "#facc15", letterSpacing: "0.1em", margin: 0 }}>{overData.title}</h2>
          </div>
          {overData.score > 0 && (
            <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
              {[
                { l: "SCORE",  v: overData.score?.toLocaleString(), c: "#fff"    },
                { l: "BEST",   v: overData.best?.toLocaleString(),  c: "#facc15" },
                { l: "WAVE",   v: overData.wave,                    c: "#38bdf8" },
                { l: "EARNED", v: `◆ ${overData.coins}`,            c: "#facc15" },
              ].map((s, i) => (
                <div key={i} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#334155", letterSpacing: "0.12em", marginBottom: 4 }}>{s.l}</div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: s.c }}>{s.v}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            {[
              { label: "▶  Play Again", accent: "#22c55e", onClick: () => modeRef.current === "survival" ? startSurvival() : start2P() },
              { label: "🛒  Shop",       accent: "#f59e0b", onClick: () => setScreen("shop") },
              { label: "⌂  Menu",        accent: "#38bdf8", onClick: () => setScreen("menu") },
            ].map(btn => (
              <button key={btn.label} onClick={btn.onClick}
                onMouseEnter={e => { e.currentTarget.style.borderColor = btn.accent; e.currentTarget.style.color = btn.accent; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e293b"; e.currentTarget.style.color = "#94a3b8"; }}
                style={{ padding: "10px 24px", background: "transparent", border: "1.5px solid #1e293b", borderRadius: 10, color: "#94a3b8", cursor: "pointer", fontSize: 13, fontFamily: "'Courier New'", letterSpacing: "0.08em", transition: "all 0.18s" }}>
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
