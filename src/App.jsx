import { useEffect, useRef, useState, useCallback } from "react";

// ─── SUPABASE CONFIG ────────────────────────────────────────────────────────
// Replace these with your actual Supabase project URL and anon key
const SUPABASE_URL = "https://gnzeqdxqfbbupfhfumgz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImduemVxZHhxZmJidXBmaGZ1bWd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MTM0MzAsImV4cCI6MjA5NDQ4OTQzMH0.MjXP8SY9Cr0IMzvjKtILJzb_roG9iVl8K3ShidSKwuo";
const SUPABASE_DISABLED = !SUPABASE_URL || SUPABASE_URL.includes("your_project.supabase.co") || SUPABASE_ANON_KEY.includes("YOUR_ANON_KEY") || SUPABASE_ANON_KEY.length < 20;

async function sbFetch(path, opts = {}) {
  if (SUPABASE_DISABLED) {
    console.warn("Supabase fetch skipped: invalid project URL or anon key.");
    return null;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: opts.prefer || "",
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) return null;
    try { return await res.json(); } catch { return null; }
  } catch (error) {
    console.warn("Supabase fetch failed:", error);
    return null;
  }
}

// ─── Simple local password/profile helpers (stores profiles in localStorage)
async function hashPassword(pw) {
  try {
    const enc = new TextEncoder().encode(pw);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return null;
  }
}

async function setPasswordForUser(username, password) {
  if (!username || !password) return false;
  const h = await hashPassword(password);
  if (!h) return false;
  try { localStorage.setItem(`tank_profile_pw_${username}`, h); return true; } catch { return false; }
}

async function verifyPasswordForUser(username, password) {
  try {
    const stored = localStorage.getItem(`tank_profile_pw_${username}`);
    if (!stored) return false;
    const h = await hashPassword(password);
    return h === stored;
  } catch { return false; }
}

function saveProfileForUser(username, profileObj) {
  if (!username) return false;
  try { localStorage.setItem(`tank_profile_${username}`, JSON.stringify(profileObj)); return true; } catch { return false; }
}

function loadProfileForUser(username) {
  if (!username) return null;
  try { const s = localStorage.getItem(`tank_profile_${username}`); return s ? JSON.parse(s) : null; } catch { return null; }
}

// ─── Supabase profile register / login helpers
async function registerWithSupabase(username, password, localProfile) {
  if (SUPABASE_DISABLED) return { ok: false, msg: 'Supabase not configured' };
  if (!username || !password) return { ok: false, msg: 'Missing username or password' };
  // check existing
  const existing = await sbFetch(`/profiles?username=eq.${encodeURIComponent(username)}&select=id`);
  if (existing && existing.length > 0) return { ok: false, msg: 'Username already taken' };
  const pwHash = await hashPassword(password);
  const body = {
    username,
    password_hash: pwHash,
    coins: localProfile?.coins || 0,
    owned_skins: localProfile?.ownedSkins || ["default"],
    equipped_skin: localProfile?.equippedSkin || "default",
    created_at: new Date().toISOString(),
  };
  const res = await sbFetch('/profiles', { method: 'POST', prefer: 'return=representation', body: JSON.stringify(body) });
  if (!res) return { ok: false, msg: 'Failed to register (network or server error)' };
  return { ok: true, data: res };
}

async function loginWithSupabase(username, password) {
  if (SUPABASE_DISABLED) return { ok: false, msg: 'Supabase not configured' };
  if (!username || !password) return { ok: false, msg: 'Missing username or password' };
  const rows = await sbFetch(`/profiles?username=eq.${encodeURIComponent(username)}&select=*&limit=1`);
  if (!rows || rows.length === 0) return { ok: false, msg: 'User not found' };
  const row = rows[0];
  const h = await hashPassword(password);
  if (h !== row.password_hash) return { ok: false, msg: 'Invalid credentials' };
  // success
  return { ok: true, data: row };
}

// Supabase leaderboard helpers
async function fetchLeaderboard() {
  const data = await sbFetch("/leaderboard?order=score.desc&limit=10&select=*");
  return data || [];
}
async function submitScore(username, score, wave, skin) {
  // Upsert: if same username exists with lower score, update it
  const existing = await sbFetch(`/leaderboard?username=eq.${encodeURIComponent(username)}&select=id,score`);
  if (existing && existing.length > 0) {
    if (score > existing[0].score) {
      await sbFetch(`/leaderboard?id=eq.${existing[0].id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ score, wave, skin, date: new Date().toISOString().slice(0,10) }),
      });
    }
  } else {
    await sbFetch("/leaderboard", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify({ username, score, wave, skin, date: new Date().toISOString().slice(0,10) }),
    });
  }
  return fetchLeaderboard();
}

// ─── SUPABASE REALTIME (for online PvP) ──────────────────────────────────────
// Uses Supabase Realtime broadcast channel — no DB table needed
function createRealtimeChannel(channelName, onMessage) {
  if (SUPABASE_DISABLED) {
    console.warn("Supabase realtime disabled: invalid project URL or anon key.");
    return {
      send: () => {},
      close: () => {},
    };
  }

  const wsUrl = `${SUPABASE_URL.replace("https://", "wss://")}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;
  let ws = null;
  let heartbeat = null;
  let closed = false;

  function connect() {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({ topic: `realtime:${channelName}`, event: "phx_join", payload: {}, ref: "1" }));
      heartbeat = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: "hb" }));
      }, 25000);
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === "broadcast" && msg.payload?.event) {
          onMessage(msg.payload.event, msg.payload.payload);
        }
      } catch (error) {
        console.warn("Supabase realtime message parse failed:", error);
      }
    };
    ws.onerror = (error) => {
      console.warn("Supabase realtime socket error:", error);
    };
    ws.onclose = () => {
  return () => { window.removeEventListener("resize", resize); cancelAnimationFrame(rafRef.current); }
      clearInterval(heartbeat);

  useEffect(() => {
  const name = (usernameInput || "").trim();
  setIsExistingProfile(!!(name && localStorage.getItem(`tank_profile_${name}`)));
  if (!name) setProfileMessage("");
  }, [usernameInput]);
      if (!closed) setTimeout(connect, 2000);
    };
  }

  connect();

  function send(event, payload) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        topic: `realtime:${channelName}`,
        event: "broadcast",
        payload: { event, payload },
        ref: String(Date.now()),
      }));
    }
  }

  function close() {
    closed = true;
    clearInterval(heartbeat);
    ws && ws.close();
  }

  return { send, close };
}

// ─── GAME CONSTANTS ──────────────────────────────────────────────────────────
const BORDER = 18, TW = 30, TH = 20;
const BASE_SPEED = 2.8, FRICTION = 0.82, BSPEED = 6.2;
const BASE_SHOOT_CD = 500, BASE_BULLET_LIFETIME = 180;
const BASE_DAMAGE = 10, BASE_BULLET_SIZE = 3.5;

const SKINS = [
  { id: "default",  name: "Olive Drab",    body: "#4a7c3f", barrel: "#2d5a24", tread: "#2a2a1a",    price: 0   },
  { id: "crimson",  name: "Crimson Ghost", body: "#b91c1c", barrel: "#7f1d1d", tread: "#3b0a0a", price: 150 },
  { id: "sapphire", name: "Sapphire",      body: "#1d4ed8", barrel: "#1e3a8a", tread: "#0f2060", price: 150 },
  { id: "solar",    name: "Solar Flare",   body: "#d97706", barrel: "#92400e", tread: "#3a1800", price: 200 },
  { id: "void",     name: "Void Walker",   body: "#7c3aed", barrel: "#4c1d95", tread: "#1a0533", price: 300 },
  { id: "chrome",   name: "Chrome",        body: "#64748b", barrel: "#334155", tread: "#0f172a", price: 300 },
  { id: "toxic",    name: "Toxic",         body: "#65a30d", barrel: "#3f6212", tread: "#1a2e05", price: 400 },
  { id: "inferno",  name: "Inferno",       body: "#ea580c", barrel: "#9a3412", tread: "#431407", price: 500 },
  { id: "ice",      name: "Arctic",        body: "#0e7490", barrel: "#164e63", tread: "#042f3e", price: 500 },
  { id: "obsidian", name: "Obsidian",      body: "#312e81", barrel: "#1e1b4b", tread: "#0a0928", price: 750 },
];

// Single map used for all modes (Open Field)
const OPEN_MAP = { id: "open", name: "Open Field", desc: "No cover. Pure aim wins.", bg: "#0d0d1a", grid: "#141428", border: "#1e1e3a", walls: [] };

const MAPS = [
  { id: "open",    name: "Open Field",  desc: "No cover. Pure aim wins.",                   bg: "#0d0d1a", grid: "#141428", border: "#1e1e3a", walls: [] },
  {
    id: "bunker", name: "Bunker", desc: "Central fortress.",
    bg: "#0f0a05", grid: "#1a1208", border: "#3d2008",
    walls: [
      { x: 0.35, y: 0.33, w: 0.30, h: 0.07 },
      { x: 0.35, y: 0.60, w: 0.30, h: 0.07 },
      { x: 0.62, y: 0.33, w: 0.07, h: 0.34 },
      { x: 0.35, y: 0.33, w: 0.07, h: 0.09 },
      { x: 0.35, y: 0.58, w: 0.07, h: 0.09 },
    ]
  },
  {
    id: "maze", name: "Labyrinth", desc: "Tight corridors.",
    bg: "#00080a", grid: "#001214", border: "#004d5e",
    walls: [
      { x:0.20,y:0.20,w:0.04,h:0.30 },{ x:0.76,y:0.20,w:0.04,h:0.30 },
      { x:0.20,y:0.50,w:0.04,h:0.30 },{ x:0.76,y:0.50,w:0.04,h:0.30 },
      { x:0.38,y:0.15,w:0.24,h:0.04 },{ x:0.38,y:0.81,w:0.24,h:0.04 },
      { x:0.42,y:0.38,w:0.16,h:0.04 },{ x:0.42,y:0.58,w:0.16,h:0.04 }
    ]
  },
  {
    id: "pillars", name: "Temple", desc: "Pillar maze.",
    bg: "#080510", grid: "#100a1a", border: "#2d1b4e",
    walls: [
      { x:0.25, y:0.25, w:0.08, h:0.08 },
      { x:0.67, y:0.25, w:0.08, h:0.08 },
      { x:0.25, y:0.67, w:0.08, h:0.08 },
      { x:0.67, y:0.67, w:0.08, h:0.08 },
      { x:0.44, y:0.30, w:0.12, h:0.08 },
      { x:0.44, y:0.62, w:0.12, h:0.08 },
    ]
  },
  {
    id: "canyon", name: "Canyon", desc: "Long corridors.",
    bg: "#0a0502", grid: "#120a04", border: "#5c2d07",
    walls: [
      { x:0.0,y:0.32,w:0.38,h:0.06 },{ x:0.62,y:0.32,w:0.38,h:0.06 },
      { x:0.0,y:0.62,w:0.38,h:0.06 },{ x:0.62,y:0.62,w:0.38,h:0.06 }
    ]
  },
];

const POWERUPS = [
  { id:"bounce",    icon:"◈",  name:"Ricochet Shell",   desc:"Bullets live 70% longer.",             color:"#38bdf8", cat:"MOBILITY",  apply:(p)=>{ p.bulletLifetime=Math.round((p.bulletLifetime||BASE_BULLET_LIFETIME)*1.7); } },
  { id:"speed",     icon:"⚡",  name:"Nitro Boost",      desc:"Move 40% faster.",                     color:"#facc15", cat:"MOBILITY",  apply:(p)=>{ p.speedMult=(p.speedMult||1)*1.4; } },
  { id:"firerate",  icon:"🔥", name:"Rapid Fire",        desc:"Fire 200ms sooner.",                   color:"#f97316", cat:"FIREPOWER", apply:(p)=>{ p.shootCd=Math.max(60,(p.shootCd||BASE_SHOOT_CD)-200); } },
  { id:"damage",    icon:"💥", name:"Hollow Point",      desc:"+60% bullet damage.",                  color:"#ef4444", cat:"FIREPOWER", apply:(p)=>{ p.bulletDamage=(p.bulletDamage||BASE_DAMAGE)*1.6; } },
  { id:"trishot",   icon:"⟠",  name:"Triple Barrel",     desc:"Fire 3-bullet spread.",               color:"#a78bfa", cat:"FIREPOWER", apply:(p)=>{ p.triShot=(p.triShot||0)+1; } },
  { id:"shield",    icon:"🛡", name:"Armor Plating",     desc:"+50 HP, +20% dmg reduction.",         color:"#6ee7b7", cat:"DEFENSE",   apply:(p)=>{ p.hp=Math.min(p.maxHp+50,p.hp+50);p.maxHp+=50;p.damageReduction=Math.min(0.7,(p.damageReduction||0)+0.2); } },
  { id:"ghost",     icon:"👻", name:"Ghost Round",       desc:"Bullets phase through walls.",         color:"#c4b5fd", cat:"FIREPOWER", apply:(p)=>{ p.ghostBullets=true; } },
  { id:"bigbullet", icon:"⬟",  name:"Slug Round",        desc:"Massive piercing bullets.",            color:"#fb923c", cat:"FIREPOWER", apply:(p)=>{ p.bulletSize=(p.bulletSize||BASE_BULLET_SIZE)*1.9;p.pierceBullets=true; } },
  { id:"magnet",    icon:"🧲", name:"Homing Protocol",   desc:"Bullets curve to nearest enemy.",      color:"#f472b6", cat:"UTILITY",   apply:(p)=>{ p.homingBullets=true; } },
  { id:"regen",     icon:"❤️", name:"Regeneration",      desc:"Regen 0.08 HP/frame.",                color:"#4ade80", cat:"DEFENSE",   apply:(p)=>{ p.regen=(p.regen||0)+0.08; } },
  { id:"multishot", icon:"✦",  name:"Scatter Shot",      desc:"5 bullets in a wide fan.",             color:"#fbbf24", cat:"FIREPOWER", apply:(p)=>{ p.multiShot=true; } },
  { id:"reflect",   icon:"🔰", name:"Deflector Shield",  desc:"20% chance reflect bullets.",          color:"#22d3ee", cat:"DEFENSE",   apply:(p)=>{ p.reflectChance=(p.reflectChance||0)+0.2; } },
  { id:"dash",      icon:"💨", name:"Afterburner",       desc:"Shift to dash.",                       color:"#a3e635", cat:"MOBILITY",  apply:(p)=>{ p.hasDash=true; } },
  { id:"explosive", icon:"💣", name:"Explosive Rounds",  desc:"Bullets explode on impact.",           color:"#fca5a5", cat:"FIREPOWER", apply:(p)=>{ p.explosiveBullets=true; } },
  { id:"doubleshot",icon:"⊕",  name:"Twin Cannon",       desc:"Fire 2 parallel bullets.",             color:"#818cf8", cat:"FIREPOWER", apply:(p)=>{ p.doubleShot=true; } },
  { id:"slowfield", icon:"❄️", name:"Cryo Field",        desc:"Bullets slow enemies on hit.",         color:"#7dd3fc", cat:"UTILITY",   apply:(p)=>{ p.cryoBullets=true; } },
  { id:"vampire",   icon:"🩸", name:"Lifesteal",         desc:"Drain 30% dmg dealt as HP.",           color:"#fb7185", cat:"DEFENSE",   apply:(p)=>{ p.lifeSteal=true; } },
  { id:"overcharge",icon:"⚡",  name:"Overcharge",        desc:"Next shot crits for 300% dmg.",        color:"#fde68a", cat:"FIREPOWER", apply:(p)=>{ p.overchargeCd=0; p.hasOvercharge=true; } },
  { id:"barrier",   icon:"🔷", name:"Energy Barrier",   desc:"Block 1 bullet every 5 sec.",          color:"#60a5fa", cat:"DEFENSE",   apply:(p)=>{ p.barrierCd=0; p.hasBarrier=true; } },
  { id:"warpshot",  icon:"◎",  name:"Warp Shot",         desc:"Teleport bullet on wall hit.",         color:"#d946ef", cat:"UTILITY",   apply:(p)=>{ p.warpBullets=true; } },
];

// Boss-only powerups (stronger / unique effects)
const BOSS_POWERUPS = [
  { id: "boss_shield", icon: "🔷", name: "Titan Barrier", desc: "Block two bullets for 15s.", color: "#60a5fa", apply: (p) => { p.hasBarrier = true; p.barrierStacks = 2; p.barrierCd = 0; } },
  { id: "boss_overdrive", icon: "⚡", name: "Overdrive", desc: "+30% fire rate permanently for the run.", color: "#f97316", apply: (p) => { p.shootCd = Math.max(40, (p.shootCd || BASE_SHOOT_CD) * 0.7); } },
  { id: "boss_rail", icon: "🔭", name: "Rail Condenser", desc: "Build a charged rail shot every 20s.", color: "#fbbf24", apply: (p) => { p.hasRail = true; p.railCd = 0; } },
  { id: "boss_drone", icon: "🤖", name: "Drone Companion", desc: "Spawn a small attack drone on spawn.", color: "#34d399", apply: (p) => { p.hasDrone = true; } },
];

const BOSS_TYPES = ["siege","splitter","stealth","railgun","summoner"];

// Skill tree perks
const PERKS = [
  { id: "reload_speed", name: "Reload Boost", desc: "+5% fire rate", cost: 1, apply: (p) => { p.permanentUpgrades.reloadSpeed = (p.permanentUpgrades.reloadSpeed||0) + 0.05; } },
  { id: "start_shield", name: "Starting Shield", desc: "Begin each run with +40 max HP", cost: 2, apply: (p) => { p.permanentUpgrades.startShield = true; } },
  { id: "crit_chance", name: "Sharpshot", desc: "+2% crit chance per upgrade", cost: 1, apply: (p) => { p.permanentUpgrades.critChance = (p.permanentUpgrades.critChance||0) + 0.02; } },
  { id: "extra_reroll", name: "Reroll Master", desc: "+1 powerup reroll per run", cost: 2, apply: (p) => { p.permanentUpgrades.extraReroll = (p.permanentUpgrades.extraReroll||0) + 1; } },
  { id: "damage_boost", name: "Piercing Rounds", desc: "+10% bullet damage", cost: 1, apply: (p) => { p.permanentUpgrades.damageBuff = (p.permanentUpgrades.damageBuff||0) + 0.1; } },
  { id: "regen_passive", name: "Resilience", desc: "Regen 0.02 HP per frame in-run", cost: 2, apply: (p) => { p.permanentUpgrades.passiveRegen = (p.permanentUpgrades.passiveRegen||0) + 0.02; } },
];

// Game modes
const GAME_MODES = [
  { id: "survival", name: "Survival", icon: "🎯", desc: "Endless waves. Upgrades. Leaderboard.", color: "#22c55e" },
  { id: "koth", name: "King of Hill", icon: "👑", desc: "Control center. First to 5 points.", color: "#f97316" },
  { id: "horde", name: "Horde Mode", icon: "🧟", desc: "100 waves. Pure endurance.", color: "#ef4444" },
  { id: "oneshot", name: "One-Shot", icon: "⚡", desc: "One hit = death. Pure skill.", color: "#facc15" },
];

// Arena events
const ARENA_EVENTS = [
  { id: "meteor", name: "Meteor Shower" },
  { id: "shrink", name: "Shrinking Arena" },
  { id: "blackout", name: "Blackout" },
];

function makeTank(x, y, hp, skin) {
  return {
    x, y, angle: 0, vx: 0, vy: 0,
    hp, maxHp: hp,
    color: skin.body, barrel: skin.barrel, tread: skin.tread,
    accent: skin.accent || "#ffffff",
    lastShot: 0, speedMult: 1, shootCd: BASE_SHOOT_CD,
    bulletLifetime: BASE_BULLET_LIFETIME, bulletDamage: BASE_DAMAGE,
    bulletSize: BASE_BULLET_SIZE, damageReduction: 0,
    triShot: 0, ghostBullets: false, pierceBullets: false,
    homingBullets: false, multiShot: false, doubleShot: false,
    cryoBullets: false, lifeSteal: false,
    hasOvercharge: false, overchargeCd: 0,
    hasBarrier: false, barrierCd: 0, barrierStacks: 0,
    warpBullets: false,
    regen: 0, reflectChance: 0, hasDash: false, explosiveBullets: false,
    lastDash: 0, upgrades: {},
    slowTimer: 0,
    // ultimate abilities
    abilities: { empCd: 0, strikeCd: 0 },
    stunTimer: 0,
    // game feel
    lastHitFlash: 0, bulletTrailColor: "#fff", recoilX: 0, recoilY: 0,
    // passives
    passiveRegen: 0, shieldBoost: 0,
  };
}

function rectFromWall(w, W, H) { return { x: w.x*W, y: w.y*H, w: w.w*W, h: w.h*H }; }
function rectsOverlap(ax,ay,aw,ah,bx,by,bw,bh) { return ax<bx+bw&&ax+aw>bx&&ay<by+bh&&ay+ah>by; }
function circleRect(cx,cy,r,rx,ry,rw,rh) { const nx=Math.max(rx,Math.min(cx,rx+rw)),ny=Math.max(ry,Math.min(cy,ry+rh)); return Math.hypot(cx-nx,cy-ny)<r; }

function hasLineOfSight(ax, ay, bx, by, walls) {
  const steps = 20;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = ax + (bx - ax) * t;
    const py = ay + (by - ay) * t;
    for (const w of walls) {
      if (px >= w.x && px <= w.x + w.w && py >= w.y && py <= w.y + w.h) return false;
    }
  }
  return true;
}

function roundRect(ctx,x,y,w,h,r) {
  if (typeof ctx.roundRect==="function") { ctx.roundRect(x,y,w,h,r); return; }
  const rr=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y); ctx.lineTo(x+w-rr,y); ctx.arcTo(x+w,y,x+w,y+rr,rr);
  ctx.lineTo(x+w,y+h-rr); ctx.arcTo(x+w,y+h,x+w-rr,y+h,rr);
  ctx.lineTo(x+rr,y+h); ctx.arcTo(x,y+h,x,y+h-rr,rr);
  ctx.lineTo(x,y+rr); ctx.arcTo(x,y,x+rr,y,rr);
  ctx.closePath();
}

// ── Detect touch device ──────────────────────────────────────────────────────
const isTouchDevice = () => ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// ── Generate a short random room code ───────────────────────────────────────
function genRoomCode() {
  return Math.random().toString(36).slice(2,7).toUpperCase();
}

export default function TankWars() {
  const canvasRef    = useRef(null);
  const keysRef      = useRef({});
  const stateRef     = useRef(null);
  const shakeRef     = useRef(0);
  const modeRef      = useRef("");
  const scoreRef     = useRef(0);
  const waveRef      = useRef(0);
  const highScoreRef = useRef(0);
  const rafRef       = useRef(null);
  const p1WinsRef    = useRef(0);
  const p2WinsRef    = useRef(0);
  const pendingPuRef = useRef(false);
  const mapRef       = useRef(MAPS[0]);
  const dimRef       = useRef({ W:800, H:560 });

  // Online PvP refs
  const onlinePvpRef    = useRef(null); // { channel, role: "host"|"guest", roomCode }
  const onlineRoleRef   = useRef(null); // "host" or "guest"
  const onlineReadyRef  = useRef({ host: false, guest: false });
  const lastSentRef     = useRef(0);

  // Touch control refs
  const moveJoystickRef  = useRef(null);
  const aimJoystickRef   = useRef(null);
  const moveTouchIdRef   = useRef(null);
  const aimTouchIdRef    = useRef(null);
  const touchFireRef     = useRef(false);
  const isMobileRef      = useRef(false);

  const [screen,           setScreen]           = useState("username");
  const [username,         setUsername]         = useState("");
  const [usernameInput,    setUsernameInput]     = useState("");
  const [passwordInput,    setPasswordInput]     = useState("");
  const [profileMessage,   setProfileMessage]    = useState("");
  const [isExistingProfile,setIsExistingProfile]= useState(false);
  const [coins,            setCoins]            = useState(0);
  const [ownedSkins,       setOwnedSkins]       = useState(["default"]);
  const [equippedSkin,     setEquippedSkin]     = useState("default");
  const [overData,         setOverData]         = useState({});
  const [hudData,          setHudData]          = useState({ hp1:100,hp2:100,maxHp1:100,maxHp2:100,score:0,wave:0,mode:"" });
  const [hoveredPu,        setHoveredPu]        = useState(null);
  const [hoveredMode,      setHoveredMode]      = useState(null);
  const [offeredPowerups,  setOfferedPowerups]  = useState([]);
  const [comboNotify,      setComboNotify]      = useState(null);
  const [screen2,          setScreen2]          = useState(null);
  const [dailyChallenge,   setDailyChallenge]   = useState(null);
  const [droneCompanion,   setDroneCompanion]   = useState(null);
  const [leaderboard,      setLeaderboard]      = useState([]);
  const [lbLoading,        setLbLoading]        = useState(false);
  const [isMobile,         setIsMobile]         = useState(false);
  const [isLandscape,      setIsLandscape]      = useState(true);
  const [, rerender]      = useState(0);

  // Online PvP UI state
  const [onlineTab,        setOnlineTab]        = useState("create"); // "create" | "join"
  const [roomCodeInput,    setRoomCodeInput]    = useState("");
  const [currentRoomCode,  setCurrentRoomCode]  = useState("");
  const [onlineStatus,     setOnlineStatus]     = useState(""); // status message
  const [onlineWaiting,    setOnlineWaiting]    = useState(false);
  const [pvpMapChoice,     setPvpMapChoice]     = useState("open");

  // --- progression defaults in localStorage ----
  function loadFullProfile(name){
    const p = loadProfileForUser(name) || {};
    return { coins: p.coins||0, ownedSkins: p.ownedSkins||["default"], equippedSkin: p.equippedSkin||"default", level: p.level||1, xp: p.xp||0, perkPoints: p.perkPoints||0, permanentUpgrades: p.permanentUpgrades||{} };
  }
  function saveFullProfile(name, prof){
    const base = loadProfileForUser(name) || {};
    const merged = { ...base, coins: prof.coins, ownedSkins: prof.ownedSkins, equippedSkin: prof.equippedSkin, level: prof.level, xp: prof.xp, perkPoints: prof.perkPoints, permanentUpgrades: prof.permanentUpgrades };
    saveProfileForUser(name, merged);
  }

  function grantXp(name, amount){
    if(!name) return;
    const prof = loadFullProfile(name);
    prof.xp = (prof.xp||0) + amount;
    const lvlUpXp = 100 + (prof.level-1)*50;
    while(prof.xp >= lvlUpXp){
      prof.xp -= lvlUpXp; prof.level = (prof.level||1) + 1; prof.perkPoints = (prof.perkPoints||0) + 1; // 1 point per level
    }
    saveFullProfile(name, prof);
    setCoins(prof.coins||0); // ensure coins reflect profile
  }

  function applyPermanentUpgradesToTank(p, prof){
    if(!prof) return;
    const up = prof.permanentUpgrades||{};
    if(up.reloadSpeed) p.shootCd = Math.max(40, (p.shootCd||BASE_SHOOT_CD) * (1 - up.reloadSpeed));
    if(up.startShield) { p.hp = Math.min(p.maxHp, p.hp + 40); p.maxHp += 40; }
    if(up.critChance) { p.critBonus = (p.critBonus||0) + up.critChance; }
    if(up.damageBuff) p.bulletDamage = (p.bulletDamage||BASE_DAMAGE) * (1 + up.damageBuff);
    if(up.passiveRegen) p.passiveRegen = (p.passiveRegen||0) + up.passiveRegen;
  }

  function getDailyChallenge() {
    const seed = Math.floor(Date.now() / 86400000);
    const challenges = [
      { name: "Explosive Only", desc: "Only explosive rounds", modifier: (p) => { p.explosiveBullets=true; } },
      { name: "Speed Demon", desc: "Enemies 1.5x faster", modifier: (s) => { s.enemySpeedMult=1.5; } },
      { name: "Hardcore", desc: "One hit = death", modifier: (p) => { p.oneShot=true; } },
      { name: "No Heal", desc: "No healing", modifier: (p) => { p.noHealing=true; } },
    ];
    return challenges[seed % challenges.length];
  }

  function getArenaEvent() {
    const r = Math.random();
    if(r<0.3) return ARENA_EVENTS[0];
    if(r<0.6) return ARENA_EVENTS[1];
    return ARENA_EVENTS[2];
  }

  useEffect(() => {
    const mobile = isTouchDevice();
    setIsMobile(mobile);
    isMobileRef.current = mobile;

    function getOrientation() {
      if (window.screen.orientation) return window.screen.orientation.type.startsWith("landscape");
      return window.innerWidth > window.innerHeight;
    }

    function resize() {
      const vw = window.innerWidth, vh = window.innerHeight;
      const ratio = 800 / 560;
      const landscape = getOrientation();
      setIsLandscape(landscape);
      let W, H;
      if (mobile) {
        if (landscape) {
          const hudH = 36;
          H = vh - hudH - 8; W = H * ratio;
          if (W > vw - 8) { W = vw - 8; H = W / ratio; }
        } else {
          W = vw - 8; H = W / ratio;
          const maxH = vh * 0.52;
          if (H > maxH) { H = maxH; W = H * ratio; }
        }
      } else {
        if (vw / vh > ratio) { H = vh - 60; W = H * ratio; } else { W = vw - 20; H = W / ratio; }
      }
      dimRef.current = { W: Math.floor(W), H: Math.floor(H) };
      rerender(n => n + 1);
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", () => setTimeout(resize, 120));
    if (window.screen.orientation) window.screen.orientation.addEventListener("change", resize);
    return () => {
      window.removeEventListener("resize", resize);
      if (window.screen.orientation) window.screen.orientation.removeEventListener("change", resize);
    };
  }, []);

  // Keyboard controls
  useEffect(()=>{
    const down=e=>{
      keysRef.current[e.key.toLowerCase()]=true;
      if(e.code==="ShiftRight") keysRef.current["rshift"]=true;
      if([" ","arrowup","arrowdown","arrowleft","arrowright"].includes(e.key.toLowerCase())) e.preventDefault();
    };
    const up=e=>{
      keysRef.current[e.key.toLowerCase()]=false;
      if(e.code==="ShiftRight") keysRef.current["rshift"]=false;
    };
    window.addEventListener("keydown",down);
    window.addEventListener("keyup",up);
    return ()=>{window.removeEventListener("keydown",down);window.removeEventListener("keyup",up);};
  },[]);

  // Touch controls
  const handleCanvasTouch = useCallback((e) => {
    e.preventDefault();
    if (!isMobileRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    for (const touch of e.changedTouches) {
      const tx = touch.clientX, ty = touch.clientY;
      if (e.type === "touchstart") {
        if (tx < midX) {
          if (moveTouchIdRef.current === null) { moveTouchIdRef.current = touch.identifier; moveJoystickRef.current = { startX: tx, startY: ty, currentX: tx, currentY: ty }; }
        } else {
          if (aimTouchIdRef.current === null) { aimTouchIdRef.current = touch.identifier; aimJoystickRef.current = { startX: tx, startY: ty, currentX: tx, currentY: ty }; touchFireRef.current = true; }
        }
      } else if (e.type === "touchmove") {
        if (touch.identifier === moveTouchIdRef.current && moveJoystickRef.current) { moveJoystickRef.current.currentX = tx; moveJoystickRef.current.currentY = ty; }
        if (touch.identifier === aimTouchIdRef.current && aimJoystickRef.current) {
          aimJoystickRef.current.currentX = tx; aimJoystickRef.current.currentY = ty;
          touchFireRef.current = Math.hypot(tx - aimJoystickRef.current.startX, ty - aimJoystickRef.current.startY) > 5;
        }
      } else if (e.type === "touchend" || e.type === "touchcancel") {
        if (touch.identifier === moveTouchIdRef.current) { moveTouchIdRef.current = null; moveJoystickRef.current = null; }
        if (touch.identifier === aimTouchIdRef.current) { aimTouchIdRef.current = null; aimJoystickRef.current = null; touchFireRef.current = false; }
      }
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isMobileRef.current) return;
    canvas.addEventListener("touchstart", handleCanvasTouch, { passive: false });
    canvas.addEventListener("touchmove", handleCanvasTouch, { passive: false });
    canvas.addEventListener("touchend", handleCanvasTouch, { passive: false });
    canvas.addEventListener("touchcancel", handleCanvasTouch, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", handleCanvasTouch);
      canvas.removeEventListener("touchmove", handleCanvasTouch);
      canvas.removeEventListener("touchend", handleCanvasTouch);
      canvas.removeEventListener("touchcancel", handleCanvasTouch);
    };
  }, [screen, handleCanvasTouch]);

  const getSkin = id=>SKINS.find(s=>s.id===id)||SKINS[0];
  const getMap  = id=>MAPS.find(m=>m.id===id)||MAPS[0];

  function getRandomPowerups(n=4) {
    return [...POWERUPS].sort(()=>Math.random()-0.5).slice(0,n);
  }

  function spawnWave(state,wave) {
    const {W,H}=dimRef.current;
    const count=Math.min(wave+1,14);
    const margin=80;
    for(let i=0;i<count;i++){
      let ex,ey,tries=0;
      do { ex=margin+Math.random()*(W-margin*2); ey=margin+Math.random()*(H-margin*2); tries++; }
      while(tries<40&&Math.hypot(ex-state.p1.x,ey-state.p1.y)<160);
      const isElite=wave>3&&Math.random()<0.3;
      const isBoss=wave>5&&Math.random()<0.1&&i===0;
      const enemy = {
        x:ex,y:ey,angle:0,vx:0,vy:0,
        hp:(isBoss?200:40)+wave*(isBoss?15:6),
        maxHp:(isBoss?200:40)+wave*(isBoss?15:6),
        color:isBoss?"#fbbf24":isElite?"#f87171":"#ef4444",
        barrel:isBoss?"#b45309":isElite?"#991b1b":"#991b1b",
        tread:isBoss?"#451a03":isElite?"#450a0a":"#3f0808",
        lastShot:0,
        spd:isBoss?0.7:(0.85+wave*0.07),
        shootDelay:Math.max(isBoss?300:500,1800-wave*90),
        isElite,isBoss,
        slowTimer:0,
        aiState:"approach",
        strafeDir:Math.random()<0.5?1:-1,
        strafeTimer:0,
        stuckTimer:0,
        lastX:ex,lastY:ey,
        waypointX:null,waypointY:null,
        flankAngle:Math.random()*Math.PI*2,
      };
      if(isBoss){
        enemy.bossType = BOSS_TYPES[Math.floor(Math.random()*BOSS_TYPES.length)];
        enemy.maxHp = enemy.hp = Math.round(enemy.hp * (1.8 + Math.random()*1.2));
        enemy.spd = 0.5;
        enemy.shootDelay = Math.max(220, enemy.shootDelay*0.6);
        enemy.bossMeta = {};
        // type-specific tweaks
        if(enemy.bossType === "siege"){
          enemy.siege = true; enemy.siegeTimer = 0; enemy.color = "#d97706"; enemy.barrel = "#92400e";
        } else if(enemy.bossType === "splitter"){
          enemy.splitter = true; enemy.splitCount = 2; enemy.color = "#ef4444"; enemy.barrel = "#7f1d1d";
        } else if(enemy.bossType === "stealth"){
          enemy.stealth = true; enemy.visibleTimer = 0; enemy.color = "#94a3b8"; enemy.barrel = "#475569";
        } else if(enemy.bossType === "railgun"){
          enemy.railgun = true; enemy.railCharge = 0; enemy.railCooldown = 0; enemy.color = "#60a5fa";
        } else if(enemy.bossType === "summoner"){
          enemy.summoner = true; enemy.summonCd = 0; enemy.color = "#34d399";
        }
        state.lastWaveHadBoss = true;
        // announce boss
        if(state.bossAnnounce==null) state.bossAnnounce = { text: `BOSS: ${enemy.bossType.toUpperCase()}`, timer: 240 };
      }
      // assign enemy behavior types for variety
      if(!isBoss){
        const r=Math.random();
        if(r<0.08) enemy.type='sniper';
        else if(r<0.14) enemy.type='kamikaze';
        else if(r<0.20) enemy.type='turret';
        else if(r<0.26) enemy.type='healer';
        else if(r<0.40) enemy.type='scout';
      }
      state.enemies.push(enemy);
    }
  }

  function startSurvival() {
    const {W,H}=dimRef.current;
    keysRef.current={};
    scoreRef.current=0; waveRef.current=1;
    pendingPuRef.current=false;
    moveJoystickRef.current=null; aimJoystickRef.current=null;
    moveTouchIdRef.current=null; aimTouchIdRef.current=null;
    touchFireRef.current=false;
    const randomMap=MAPS[Math.floor(Math.random()*MAPS.length)];
    mapRef.current=randomMap;
    const skin=getSkin(equippedSkin);
    stateRef.current={p1:makeTank(W/2,H/2,100,skin),p2:null,enemies:[],bullets:[],particles:[],explosions:[],drones:[],arenaSize:1,slowMotion:0};
    // apply permanent progression upgrades from profile
    if(username){
      const prof = loadFullProfile(username);
      applyPermanentUpgradesToTank(stateRef.current.p1, prof);
    }
    modeRef.current="survival";
    spawnWave(stateRef.current,1);
    setScreen("game");
  }

  function start2P() {
    const {W,H}=dimRef.current;
    keysRef.current={};
    scoreRef.current=0; waveRef.current=0;
    p1WinsRef.current=0; p2WinsRef.current=0;
    pendingPuRef.current=false;
    mapRef.current=getMap(pvpMapChoice);
    stateRef.current={
      p1:makeTank(120,H/2,100,getSkin(equippedSkin)),
      p2:makeTank(W-120,H/2,100,getSkin("crimson")),
      enemies:[],bullets:[],particles:[],explosions:[],
      roundOver:false,roundOverTimer:0,roundWinner:"",
    };
    modeRef.current="2p";
    setScreen("game");
  }

  // ── Online PvP: Create Room ──────────────────────────────────────────────
  function createOnlineRoom() {
    if (SUPABASE_DISABLED) {
      setOnlineStatus("Online PvP is unavailable. Configure your Supabase URL and anon key.");
      setOnlineWaiting(false);
      return;
    }

    const code = genRoomCode();
    setCurrentRoomCode(code);
    setOnlineStatus("Waiting for opponent to join...");
    setOnlineWaiting(true);
    onlineRoleRef.current = "host";
    onlineReadyRef.current = { host: false, guest: false };

    const channel = createRealtimeChannel(`tankwars-${code}`, (event, payload) => {
      if (event === "join") {
        // Guest joined — send ack + map choice
        setOnlineStatus("Opponent found! Starting...");
        channel.send("ack", { map: pvpMapChoice, hostSkin: equippedSkin });
        onlineReadyRef.current.host = true;
        onlineReadyRef.current.guest = true;
        setTimeout(() => startOnlineGame("host", code, pvpMapChoice, channel), 500);
      }
      if (event === "state") {
        // Incoming opponent state update (guest → host mirror)
        applyRemoteState(payload);
      }
    });

    onlinePvpRef.current = { channel, role: "host", roomCode: code };
  }

  function joinOnlineRoom(code) {
    if (!code.trim()) return;
    if (SUPABASE_DISABLED) {
      setOnlineStatus("Online PvP is unavailable. Configure your Supabase URL and anon key.");
      setOnlineWaiting(false);
      return;
    }

    const upper = code.trim().toUpperCase();
    setOnlineStatus("Connecting...");
    setOnlineWaiting(true);
    onlineRoleRef.current = "guest";
    onlineReadyRef.current = { host: false, guest: false };

    const channel = createRealtimeChannel(`tankwars-${upper}`, (event, payload) => {
      if (event === "ack") {
        // Host acknowledged, start game
        setOnlineStatus("Connected! Starting...");
        setTimeout(() => startOnlineGame("guest", upper, payload.map || "open", channel), 500);
      }
      if (event === "state") {
        applyRemoteState(payload);
      }
    });

    onlinePvpRef.current = { channel, role: "guest", roomCode: upper };
    // Signal host that guest has joined
    setTimeout(() => channel.send("join", { guestSkin: equippedSkin }), 800);
  }

  function applyRemoteState(payload) {
    if (!stateRef.current) return;
    const s = stateRef.current;
    const role = onlineRoleRef.current;
    // Host controls p1, guest controls p2. Each side receives the other's data.
    if (role === "host" && payload.p2) {
      Object.assign(s.p2, payload.p2);
      if (payload.bullets) {
        // Merge remote bullets (tagged remote=true)
        s.bullets = s.bullets.filter(b => !b.remote);
        payload.bullets.forEach(b => s.bullets.push({ ...b, remote: true }));
      }
    } else if (role === "guest" && payload.p1) {
      Object.assign(s.p1, payload.p1);
      if (payload.bullets) {
        s.bullets = s.bullets.filter(b => !b.remote);
        payload.bullets.forEach(b => s.bullets.push({ ...b, remote: true }));
      }
    }
  }

  function startOnlineGame(role, roomCode, mapId, channel) {
    const {W,H} = dimRef.current;
    keysRef.current = {};
    scoreRef.current = 0;
    p1WinsRef.current = 0; p2WinsRef.current = 0;
    pendingPuRef.current = false;
    mapRef.current = getMap(mapId);

    const hostSkin = getSkin(equippedSkin);
    const guestSkin = getSkin("crimson");

    stateRef.current = {
      p1: makeTank(120, H/2, 100, hostSkin),
      p2: makeTank(W-120, H/2, 100, guestSkin),
      enemies: [], bullets: [], particles: [], explosions: [],
      roundOver: false, roundOverTimer: 0, roundWinner: "",
    };

    onlinePvpRef.current = { channel, role, roomCode };
    modeRef.current = "online";
    setOnlineWaiting(false);
    setOnlineStatus("");
    setScreen("game");
  }

  function cleanupOnlineRoom() {
    if (onlinePvpRef.current?.channel) {
      onlinePvpRef.current.channel.close();
      onlinePvpRef.current = null;
    }
    onlineRoleRef.current = null;
    setOnlineWaiting(false);
    setOnlineStatus("");
    setCurrentRoomCode("");
    setRoomCodeInput("");
  }

  function resetPvPRound() {
    const {W,H}=dimRef.current;
    const s=stateRef.current;
    s.p1=makeTank(120,H/2,100,getSkin(equippedSkin));
    s.p2=makeTank(W-120,H/2,100,getSkin("crimson"));
    s.bullets=[];s.particles=[];s.enemies=[];s.explosions=[];
    s.roundOver=false;s.roundOverTimer=0;s.roundWinner="";
  }

  function handlePowerupPick(puId) {
    const pu=POWERUPS.find(p=>p.id===puId);
    const p1=stateRef.current.p1;
    pu.apply(p1);
    // grant small XP and coins for picking
    grantXp(username, 8 + Math.round(waveRef.current * 2));
    setCoins(c=>c+5);
    // detect simple synergies
    if(p1.ghostBullets && p1.explosiveBullets){
      p1.ghostExplodeWalls = true; setComboNotify({text:"Combo: Phasing Explosions",timer:160});
    }
    if(p1.cryoBullets && p1.homingBullets){ setComboNotify({text:"Combo: Cryo Homing",timer:160}); p1.homingCries=true; }
    if(p1.multiShot && p1.pierceBullets){ setComboNotify({text:"Combo: Bullet Storm",timer:160}); }
    if(p1.lifeSteal && p1.shootCd < BASE_SHOOT_CD - 100){ setComboNotify({text:"Combo: Vampire Barrage",timer:160}); }
    if(p1.cryoBullets && p1.triShot){ setComboNotify({text:"Combo: Frost Spread",timer:160}); }
    if(p1.explosiveBullets && p1.doubleShot){ setComboNotify({text:"Combo: Double Blast",timer:160}); }
    p1.upgrades[puId]=(p1.upgrades[puId]||0)+1;
    // spawn drone if companion unlocked
    if(droneCompanion && Math.random()<0.4){
      const d={x:p1.x+Math.random()*40-20,y:p1.y+Math.random()*40-20,vx:0,vy:0,angle:0,type:droneCompanion};
      stateRef.current.drones.push(d);
    }
    pendingPuRef.current=false;
    waveRef.current++;
    spawnWave(stateRef.current,waveRef.current);
    // trigger arena event every 3 waves
    if(waveRef.current % 3 === 0){
      const ev=getArenaEvent();
      if(ev) {
        setComboNotify({text:`Arena: ${ev.name}`,timer:180});
        if(ev.id==='meteor'){
          for(let i=0;i<4;i++) setTimeout(()=>spawnExplosion(BORDER+Math.random()*800, BORDER+Math.random()*560), i*400);
        } else if(ev.id==='shrink'){
          stateRef.current.arenaSize = Math.max(0.6, stateRef.current.arenaSize - 0.15);
        } else if(ev.id==='blackout'){
          stateRef.current.blackoutTimer = 180;
        }
      }
    }
    setHoveredPu(null);
    setScreen("game");
  }

  function buyItem(type,id,price) {
    if(coins<price) return;
    setCoins(c=>c-price);
    if(type==="skin") setOwnedSkins(s=>[...s,id]);
  }

  async function loadLeaderboard() {
    setLbLoading(true);
    const data = await fetchLeaderboard();
    setLeaderboard(data);
    setLbLoading(false);
  }

  // ─── GAME LOOP ─────────────────────────────────────────────────────────────
  useEffect(()=>{
    if(screen!=="game") return;
    const canvas=canvasRef.current;
    const ctx=canvas.getContext("2d");
    const map=mapRef.current;

    function getWalls() {
      const {W,H}=dimRef.current;
      return (map.walls||[]).map(w=>rectFromWall(w,W,H));
    }

    function shootBullet(x,y,angle,shooterId,color,shooter,critMult=1) {
      stateRef.current.bullets.push({
        x,y,angle,shooterId,color,
        life:shooter?.bulletLifetime||BASE_BULLET_LIFETIME,
        maxLife:shooter?.bulletLifetime||BASE_BULLET_LIFETIME,
        bounces:0,
        size:shooter?.bulletSize||BASE_BULLET_SIZE,
        ghost:shooter?.ghostBullets||false,
        pierce:shooter?.pierceBullets||false,
        homing:shooter?.homingBullets||false,
        explosive:shooter?.explosiveBullets||false,
        cryo:shooter?.cryoBullets||false,
        warp:shooter?.warpBullets||false,
        damage:(shooter?.bulletDamage||BASE_DAMAGE)*critMult,
        pierced:[],
        isCrit:critMult>1,
        shooterRef:shooter,
        remote:false,
      });
    }

    function spawnParticles(x,y,color,count=8) {
      for(let i=0;i<count;i++){
        const a=Math.random()*Math.PI*2,spd=1.5+Math.random()*4;
        stateRef.current.particles.push({x,y,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd,life:30,maxLife:30,color,size:2+Math.random()*2});
      }
    }

    function spawnExplosion(x,y) {
      stateRef.current.explosions.push({x,y,r:0,maxR:50,life:18,maxLife:18});
      spawnParticles(x,y,"#f97316",16);
      // screen shake
      shakeRef.current = Math.max(shakeRef.current, 10);
      // slow-motion on explosion
      if(!stateRef.current.slowMotion) stateRef.current.slowMotion = 0;
      stateRef.current.slowMotion = Math.min(stateRef.current.slowMotion + 8, 60);
      // damage destructible walls if present
      const map = mapRef.current;
      if(map && map.destructibleWalls){
        for(const w of map.destructibleWalls){
          const dx = x - (w.x + w.w/2), dy = y - (w.y + w.h/2);
          const dist = Math.hypot(dx,dy);
          if(dist < 120){ w.hp = (w.hp||20) - Math.round((120-dist)/8); }
        }
        map.destructibleWalls = (map.destructibleWalls||[]).filter(w=> (w.hp||0) > 0 );
      }
    }

    function getMobileInput(p, ts) {
      const DEAD = 12;
      let ax = 0, ay = 0, fire = false, dash = false;
      const mj = moveJoystickRef.current;
      if (mj) {
        const dx = mj.currentX - mj.startX, dy = mj.currentY - mj.startY;
        const dist = Math.hypot(dx, dy);
        if (dist > DEAD) { ax = dx / Math.max(dist, 1); ay = dy / Math.max(dist, 1); }
      }
      const aj = aimJoystickRef.current;
      if (aj) {
        const dx = aj.currentX - aj.startX, dy = aj.currentY - aj.startY;
        const dist = Math.hypot(dx, dy);
        if (dist > DEAD) { const targetAngle = Math.atan2(dy, dx); p.angle = targetAngle; }
        fire = touchFireRef.current;
      }
      dash = keysRef.current["shift"] || false;
      return { ax, ay, fire, dash };
    }

    function movePlayer(p, shooterId, fwd, back, left, right, fire, dash, ts) {
      const {W,H}=dimRef.current;
      const walls=getWalls();
      const slowMult=p.slowTimer>0?0.45:1;
      const speed=BASE_SPEED*(p.speedMult||1)*slowMult;
      if(p.slowTimer>0) p.slowTimer--;

      if(p.hasDash&&dash&&ts-p.lastDash>1200){
        p.vx+=Math.cos(p.angle)*12;p.vy+=Math.sin(p.angle)*12;
        p.lastDash=ts;spawnParticles(p.x,p.y,"#a3e635",6);
      }

      let ax=0,ay=0;
      if(isMobileRef.current && shooterId==="p1") {
        const mi = getMobileInput(p, ts);
        ax = mi.ax; ay = mi.ay; fire = mi.fire || fire; dash = mi.dash || dash;
      } else {
        if(fwd) ay-=1; if(back) ay+=1; if(left) ax-=1; if(right) ax+=1;
        if(ax&&ay){ax*=0.707;ay*=0.707;}
      }

      p.vx=p.vx*FRICTION+ax*speed*(1-FRICTION);
      p.vy=p.vy*FRICTION+ay*speed*(1-FRICTION);
      if(Math.abs(p.vx)<0.01) p.vx=0;
      if(Math.abs(p.vy)<0.01) p.vy=0;

      if(p.regen>0) p.hp=Math.min(p.maxHp,p.hp+p.regen);
      if(p.hasBarrier&&p.barrierCd>0) p.barrierCd--;
      if(p.hasOvercharge&&p.overchargeCd>0) p.overchargeCd--;

      const hw=TW/2,hh=TH/2;
      const BL=BORDER+hw,BR=W-BORDER-hw,BT=BORDER+hh,BB=H-BORDER-hh;
      let newX=Math.max(BL,Math.min(BR,p.x+p.vx));
      for(const w of walls){if(rectsOverlap(newX-hw,p.y-hh,TW,TH,w.x,w.y,w.w,w.h)){newX=p.x;p.vx=0;break;}}
      let newY=Math.max(BT,Math.min(BB,p.y+p.vy));
      for(const w of walls){if(rectsOverlap(newX-hw,newY-hh,TW,TH,w.x,w.y,w.w,w.h)){newY=p.y;p.vy=0;break;}}
      p.x=newX;p.y=newY;

      if(!(isMobileRef.current && shooterId==="p1" && aimJoystickRef.current)) {
        if(ax||ay){
          const ta=Math.atan2(ay,ax);
          let d=ta-p.angle;
          while(d>Math.PI) d-=2*Math.PI;
          while(d<-Math.PI) d+=2*Math.PI;
          p.angle+=d*0.18;
        }
      }

      if(fire&&ts-p.lastShot>(p.shootCd||BASE_SHOOT_CD)){
        const critMult=(p.hasOvercharge&&p.overchargeCd<=0)?3:1;
        if(p.hasOvercharge&&p.overchargeCd<=0) p.overchargeCd=300;
        const bx=p.x+Math.cos(p.angle)*17, by=p.y+Math.sin(p.angle)*17;
        shootBullet(bx,by,p.angle,shooterId,p.color,p,critMult);
        if(p.doubleShot){
          const perp=p.angle+Math.PI/2;
          shootBullet(p.x+Math.cos(perp)*6+Math.cos(p.angle)*15,p.y+Math.sin(perp)*6+Math.sin(p.angle)*15,p.angle,shooterId,p.color,p,critMult);
          shootBullet(p.x-Math.cos(perp)*6+Math.cos(p.angle)*15,p.y-Math.sin(perp)*6+Math.sin(p.angle)*15,p.angle,shooterId,p.color,p,critMult);
        }
        if(p.triShot>0){
          shootBullet(bx,by,p.angle-0.22,shooterId,p.color,p,critMult);
          shootBullet(bx,by,p.angle+0.22,shooterId,p.color,p,critMult);
        }
        if(p.multiShot){
          for(let i=-2;i<=2;i++){
            if(i!==0&&!(p.triShot>0&&Math.abs(i)===1))
              shootBullet(bx,by,p.angle+i*0.18,shooterId,p.color,p,critMult);
          }
        }
        p.lastShot=ts;
      }

      // Ultimate abilities: EMP (Q) and Airstrike (E)
      if(shooterId==='p1'){
        if(keysRef.current['q'] && p.abilities.empCd<=0){
          // EMP: stun nearby enemies
          p.abilities.empCd = 9000; // 9s
          const R=140;
          stateRef.current.enemies.forEach(en=>{ if(Math.hypot(en.x-p.x,en.y-p.y)<R) en.slowTimer = Math.max(en.slowTimer||0, 120); });
          spawnParticles(p.x,p.y,"#60a5fa",20); setComboNotify({text:"EMP Pulse",timer:120});
        }
        if(keysRef.current['e'] && p.abilities.strikeCd<=0){
          // Airstrike: spawn 3 explosions in front of player
          p.abilities.strikeCd = 12000;
          for(let i=1;i<=3;i++){ const tx=p.x+Math.cos(p.angle)*(80+i*40)+((Math.random()-0.5)*30); const ty=p.y+Math.sin(p.angle)*(80+i*40)+((Math.random()-0.5)*30); setTimeout(()=>spawnExplosion(tx,ty), i*220); }
          setComboNotify({text:"Airstrike Called",timer:160});
        }
      }
    }

    function updateEnemyAI(e, target, ts, walls, W, H) {
      if (!target || target.hp <= 0) return;
      const dx = target.x - e.x, dy = target.y - e.y;
      const dist = Math.hypot(dx, dy);
      const canSee = hasLineOfSight(e.x, e.y, target.x, target.y, walls);
      const hpRatio = e.hp / e.maxHp;
      const hw = TW / 2, hh = TH / 2;
      const BL = BORDER + hw, BR = W - BORDER - hw, BT = BORDER + hh, BB = H - BORDER - hh;

      e.stuckTimer = (e.stuckTimer || 0) + 1;
      if (e.stuckTimer >= 60) {
        const moved = Math.hypot(e.x - (e.lastX || e.x), e.y - (e.lastY || e.y));
        if (moved < 8) {
          let wx, wy, valid = false;
          for (let attempt = 0; attempt < 12; attempt++) {
            wx = BL + Math.random() * (BR - BL); wy = BT + Math.random() * (BB - BT); valid = true;
            for (const w of walls) { if (rectsOverlap(wx - hw - 10, wy - hh - 10, TW + 20, TH + 20, w.x, w.y, w.w, w.h)) { valid = false; break; } }
            if (valid) break;
          }
          if (valid) { e.waypointX = wx; e.waypointY = wy; }
        }
        e.lastX = e.x; e.lastY = e.y; e.stuckTimer = 0;
      }

      if (hpRatio < 0.3) e.aiState = "retreat";
      else if (!canSee) e.aiState = "flank";
      else if (dist < 140) e.aiState = "strafe";
      else e.aiState = "approach";

      let moveAngle = Math.atan2(dy, dx);
      let moveSpeed = e.spd * (e.slowTimer > 0 ? 0.3 : 1);

      if (e.waypointX !== null) {
        const wdx = e.waypointX - e.x, wdy = e.waypointY - e.y, wdist = Math.hypot(wdx, wdy);
        if (wdist < 20) { e.waypointX = null; e.waypointY = null; } else moveAngle = Math.atan2(wdy, wdx);
      } else if (e.aiState === "retreat") {
        moveAngle = Math.atan2(-dy, -dx) + (e.strafeDir * 0.6);
      } else if (e.aiState === "strafe") {
        e.strafeTimer = (e.strafeTimer || 0) + 1;
        if (e.strafeTimer > 90 + Math.random() * 60) { e.strafeDir *= -1; e.strafeTimer = 0; }
        const perpAngle = Math.atan2(dy, dx) + Math.PI / 2 * e.strafeDir;
        const distError = dist - 120;
        const approachBlend = Math.max(-0.4, Math.min(0.4, distError / 200));
        moveAngle = perpAngle + approachBlend;
      } else if (e.aiState === "flank") {
        e.flankAngle = (e.flankAngle || 0) + 0.02 * e.strafeDir;
        moveAngle = Math.atan2(dy, dx) + e.flankAngle * 0.5;
      } else {
        moveAngle = Math.atan2(dy, dx) + (Math.sin(ts * 0.003 + e.flankAngle) * 0.25);
      }

      // type-specific overrides
      if(e.type==='sniper'){
        // keep distance
        if(dist < 220) moveAngle = Math.atan2(-dy,-dx);
        moveSpeed = e.spd * 0.6;
        e.shootDelay = Math.max(1200, e.shootDelay*1.4);
      } else if(e.type==='kamikaze'){
        // charge when close
        moveSpeed = e.spd * 1.6;
        if(dist < 80){ e.hp = 0; spawnExplosion(e.x,e.y); }
      } else if(e.type==='turret'){
        // stay mostly stationary and rotate
        moveSpeed = 0; const aimAngle = Math.atan2(dy,dx); let dA = aimAngle - e.angle; while(dA>Math.PI) dA-=2*Math.PI; while(dA<-Math.PI) dA+=2*Math.PI; e.angle += dA*0.12; e.shootDelay = Math.max(300, e.shootDelay*0.6);
      } else if(e.type==='healer'){
        // heal nearby allies
        moveSpeed = e.spd * 0.9;
        if(ts % 600 < 16){
          stateRef.current.enemies.forEach(ee=>{ if(ee!==e && Math.hypot(ee.x-e.x,ee.y-e.y)<120) ee.hp = Math.min(ee.maxHp, ee.hp + 8); });
        }
      } else if(e.type==='scout'){
        moveSpeed = e.spd * 1.6;
      }

      const vx = Math.cos(moveAngle) * moveSpeed, vy = Math.sin(moveAngle) * moveSpeed;
      let newX = Math.max(BL, Math.min(BR, e.x + vx)), blockedX = false;
      for (const w of walls) { if (rectsOverlap(newX - hw, e.y - hh, TW, TH, w.x, w.y, w.w, w.h)) { newX = e.x; blockedX = true; break; } }
      let newY = Math.max(BT, Math.min(BB, e.y + vy)), blockedY = false;
      for (const w of walls) { if (rectsOverlap(newX - hw, newY - hh, TW, TH, w.x, w.y, w.w, w.h)) { newY = e.y; blockedY = true; break; } }
      if (blockedX && blockedY) e.stuckTimer += 20;
      e.x = newX; e.y = newY;

      const travelTime = dist / BSPEED;
      const predX = target.x + (target.vx || 0) * travelTime, predY = target.y + (target.vy || 0) * travelTime;
      const aimAngle = Math.atan2(predY - e.y, predX - e.x);
      let angleDiff = aimAngle - e.angle;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      e.angle += angleDiff * 0.1;

      // Boss-specific behaviors
      if (e.summoner) {
        e.summonCd = (e.summonCd || 0) - 16;
        if (e.summonCd <= 0) {
          e.summonCd = 1200 + Math.random() * 600;
          // spawn a small drone
          const droneHp = Math.max(20, Math.round(e.maxHp * 0.08));
          const dx = (Math.random() - 0.5) * 40, dy = (Math.random() - 0.5) * 40;
          stateRef.current.enemies.push({ x: e.x + dx, y: e.y + dy, angle: 0, vx: 0, vy: 0, hp: droneHp, maxHp: droneHp, color: "#ecfccb", barrel: "#86efac", tread: "#a3e635", lastShot: 0, spd: 1.6, shootDelay: 900, isElite: false, isBoss: false, slowTimer: 0, aiState: "approach", strafeDir: Math.random() < 0.5 ? 1 : -1, strafeTimer: 0, stuckTimer: 0, lastX: e.x, lastY: e.y, waypointX: null, waypointY: null, flankAngle: Math.random() * Math.PI * 2 });
        }
      }

      if (e.railgun) {
        if (!e.railCooldown) e.railCooldown = 0;
        if (e.railCharge && e.railCharge > 0) {
          e.railCharge += 16;
          if (e.railCharge > 420) {
            // fire rail shot
            const bx = e.x + Math.cos(e.angle) * 16, by = e.y + Math.sin(e.angle) * 16;
            shootBullet(bx, by, e.angle, "enemy", "#60a5fa", { bulletLifetime: BASE_BULLET_LIFETIME * 2, bulletSize: BASE_BULLET_SIZE * 3, bulletDamage: 40, explosive: false });
            e.railCharge = 0; e.railCooldown = 2000;
          }
        } else {
          e.railCooldown = Math.max(0, (e.railCooldown || 0) - 16);
          if (e.railCooldown <= 0 && Math.random() < 0.008) { e.railCharge = 1; }
        }
      }

      if (e.siege) {
        e.siegeTimer = (e.siegeTimer || 0) - 16;
        if (e.siegeTimer <= 0 && Math.random() < 0.06) {
          e.siegeTimer = 800 + Math.random() * 800;
          // fire an explosive mortar (simulated with explosive bullet)
          const bx = e.x + Math.cos(e.angle) * 16, by = e.y + Math.sin(e.angle) * 16;
          shootBullet(bx, by, e.angle, "enemy", "#b45309", { bulletLifetime: BASE_BULLET_LIFETIME * 1.2, bulletSize: BASE_BULLET_SIZE * 2, bulletDamage: 22, explosive: true });
        }
      }

      if (e.stealth) {
        e.visibleTimer = Math.max(0, (e.visibleTimer || 0) - 16);
      }

      if (canSee && Math.abs(angleDiff) < 0.25 && ts - e.lastShot > e.shootDelay) {
        const bx = e.x + Math.cos(e.angle) * 16, by = e.y + Math.sin(e.angle) * 16;
        shootBullet(bx, by, e.angle, "enemy", "#f97316", { bulletLifetime: BASE_BULLET_LIFETIME, bulletSize: BASE_BULLET_SIZE + (e.isElite ? 2 : 0) + (e.isBoss ? 3 : 0), bulletDamage: e.isBoss ? 14 : e.isElite ? 9 : 5 });
        if (e.isElite || e.isBoss) shootBullet(e.x + Math.cos(e.angle + 0.3) * 16, e.y + Math.sin(e.angle + 0.3) * 16, e.angle + 0.3, "enemy", e.isBoss ? "#fbbf24" : "#ff6b00", { bulletLifetime: BASE_BULLET_LIFETIME, bulletSize: BASE_BULLET_SIZE, bulletDamage: e.isBoss ? 10 : 7 });
        if (e.isBoss) shootBullet(e.x + Math.cos(e.angle - 0.3) * 16, e.y + Math.sin(e.angle - 0.3) * 16, e.angle - 0.3, "enemy", "#fbbf24", { bulletLifetime: BASE_BULLET_LIFETIME, bulletSize: BASE_BULLET_SIZE, bulletDamage: 10 });
        e.lastShot = ts;
        // make stealth bosses visible briefly when they fire
        if (e.stealth) e.visibleTimer = 180;
      } else if (!canSee && ts - e.lastShot > e.shootDelay * 2 && dist < 200) {
        shootBullet(e.x + Math.cos(e.angle) * 16, e.y + Math.sin(e.angle) * 16, e.angle, "enemy", "#f97316", { bulletLifetime: BASE_BULLET_LIFETIME, bulletSize: BASE_BULLET_SIZE, bulletDamage: e.isBoss ? 14 : e.isElite ? 9 : 5 });
        e.lastShot = ts;
      }
      if (e.slowTimer > 0) e.slowTimer--;
    }

    function drawTank(t, label) {
      ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.angle);
      const treadH = 6, treadW = TW + 10, treadY = TH / 2 + 1;
      ctx.fillStyle = t.tread;
      ctx.beginPath(); roundRect(ctx, -treadW/2, -treadY - treadH, treadW, treadH, 3); ctx.fill();
      ctx.beginPath(); roundRect(ctx, -treadW/2, treadY, treadW, treadH, 3); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 0.8;
      const segCount = 8;
      for (let i = 0; i <= segCount; i++) {
        const segX = -treadW/2 + (i * treadW / segCount);
        ctx.beginPath(); ctx.moveTo(segX, -treadY - treadH); ctx.lineTo(segX, -treadY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(segX, treadY); ctx.lineTo(segX, treadY + treadH); ctx.stroke();
      }
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      const wheelXPositions = [-TW/2+2, -TW/6, TW/6, TW/2-2], wheelR = 3.2;
      for (const wx of wheelXPositions) {
        ctx.beginPath(); ctx.arc(wx, -treadY - treadH/2, wheelR, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(wx, treadY + treadH/2, wheelR, 0, Math.PI*2); ctx.fill();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 0.8;
      for (const wx of wheelXPositions) {
        ctx.beginPath(); ctx.arc(wx, -treadY - treadH/2, wheelR - 1, 0, Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.arc(wx, treadY + treadH/2, wheelR - 1, 0, Math.PI*2); ctx.stroke();
      }
      ctx.fillStyle = t.color;
      ctx.beginPath(); roundRect(ctx, -TW/2, -TH/2, TW, TH, 4); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-TW/2+4, 0); ctx.lineTo(TW/2-4, 0); ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      for (const [bx,by] of [[-TW/2+4,-TH/2+4],[TW/2-4,-TH/2+4],[-TW/2+4,TH/2-4],[TW/2-4,TH/2-4]]) {
        ctx.beginPath(); ctx.arc(bx, by, 1.5, 0, Math.PI*2); ctx.fill();
      }
      const grad = ctx.createLinearGradient(0, -TH/2, 0, 0);
      grad.addColorStop(0, "rgba(255,255,255,0.22)"); grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); roundRect(ctx, -TW/2, -TH/2, TW, TH/2, 4); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.beginPath(); ctx.arc(0, 0, 9.5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = t.barrel; ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.beginPath(); ctx.arc(-1.5, -2, 4.5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.beginPath(); roundRect(ctx, 5, -3.5, 20, 7, 2); ctx.fill();
      ctx.fillStyle = t.barrel; ctx.beginPath(); roundRect(ctx, 6, -2.5, 18, 5, 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.fillRect(7, -2.5, 16, 1.5);
      ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.beginPath(); roundRect(ctx, 22, -3, 4, 6, 1.5); ctx.fill();
      ctx.fillStyle = t.barrel; ctx.beginPath(); roundRect(ctx, 22.5, -2.5, 3, 5, 1); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.beginPath(); ctx.arc(-2, 1, 4, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = t.color; ctx.beginPath(); ctx.arc(-2, 1, 2.8, 0, Math.PI*2); ctx.fill();
      if (t.damageReduction > 0) { ctx.beginPath(); ctx.arc(0, 0, 25, 0, Math.PI*2); ctx.strokeStyle = `rgba(110,231,183,${t.damageReduction*0.6})`; ctx.lineWidth = 2.5; ctx.stroke(); }
      if (t.hasBarrier && t.barrierCd <= 0) { ctx.beginPath(); ctx.arc(0, 0, 27, 0, Math.PI*2); ctx.strokeStyle = "rgba(96,165,250,0.7)"; ctx.lineWidth = 2; ctx.stroke(); }
      if (t.hasDash) { ctx.beginPath(); ctx.arc(0, 0, 28, 0, Math.PI*2); ctx.strokeStyle = "rgba(163,230,53,0.15)"; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.restore();
      const bw = 42, ratio = Math.max(0, t.hp / t.maxHp);
      ctx.fillStyle = "#080808"; ctx.fillRect(t.x-bw/2, t.y-TH/2-13, bw, 6);
      ctx.fillStyle = ratio>0.5?"#4ade80":ratio>0.25?"#facc15":"#f87171";
      ctx.fillRect(t.x-bw/2, t.y-TH/2-13, bw*ratio, 6);
      ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth=0.5;
      ctx.strokeRect(t.x-bw/2, t.y-TH/2-13, bw, 6);
      if (label) { ctx.fillStyle = t.color; ctx.font = "bold 10px 'Courier New'"; ctx.textAlign = "center"; ctx.fillText(label, t.x, t.y-TH/2-18); ctx.textAlign = "left"; }
      if (t.slowTimer > 0) { ctx.globalAlpha = 0.4; ctx.fillStyle = "#7dd3fc"; ctx.beginPath(); ctx.arc(t.x, t.y, 16, 0, Math.PI*2); ctx.fill(); ctx.globalAlpha = 1; }
    }

    function updateBullet(b) {
      const {W,H}=dimRef.current;
      const walls=getWalls();
      if(b.homing&&stateRef.current.enemies.length>0&&b.shooterId==="p1"){
        let nearest=null,nearDist=Infinity;
        stateRef.current.enemies.forEach(e=>{const d=Math.hypot(e.x-b.x,e.y-b.y);if(d<nearDist){nearDist=d;nearest=e;}});
        if(nearest&&nearDist<280){
          const ta=Math.atan2(nearest.y-b.y,nearest.x-b.x);
          let diff=ta-b.angle;
          while(diff>Math.PI) diff-=2*Math.PI;
          while(diff<-Math.PI) diff+=2*Math.PI;
          b.angle+=diff*0.05;
        }
      }
      b.x+=Math.cos(b.angle)*BSPEED; b.y+=Math.sin(b.angle)*BSPEED; b.life--;
      if(!b.ghost){
        const WL=BORDER+2,WR=W-BORDER-2,WT=BORDER+2,WB=H-BORDER-2;
        let bounced=false;
        if(b.x<=WL){b.x=WL+1;b.angle=Math.PI-b.angle;bounced=true;}
        else if(b.x>=WR){b.x=WR-1;b.angle=Math.PI-b.angle;bounced=true;}
        if(b.y<=WT){b.y=WT+1;b.angle=-b.angle;bounced=true;}
        else if(b.y>=WB){b.y=WB-1;b.angle=-b.angle;bounced=true;}
        for(const w of walls){
          if(circleRect(b.x,b.y,b.size,w.x,w.y,w.w,w.h)){
            if(b.warp){
              const {W:WW,H:HH}=dimRef.current;
              b.x=BORDER+20+Math.random()*(WW-BORDER*2-40); b.y=BORDER+20+Math.random()*(HH-BORDER*2-40);
              spawnParticles(b.x,b.y,"#d946ef",6);
            } else {
              const cx=w.x+w.w/2,cy=w.y+w.h/2,dx=b.x-cx,dy=b.y-cy;
              if(Math.abs(dx/w.w)>Math.abs(dy/w.h)) b.angle=Math.PI-b.angle;
              else b.angle=-b.angle;
              bounced=true;
            }
            break;
          }
        }
        if(bounced){b.bounces++;spawnParticles(b.x,b.y,"#fff",3);}
      }
    }

    function drawMobileControls() {
      const {W,H}=dimRef.current;
      const jRadius = Math.min(W, H) * 0.1, knobR = jRadius * 0.45;
      const lx = W * 0.2, ly = H * 0.75;
      const mj = moveJoystickRef.current;
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(lx, ly, jRadius, 0, Math.PI*2);
      ctx.strokeStyle = "#22c55e"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#22c55e"; ctx.beginPath();
      if (mj) { const dx = mj.currentX - mj.startX, dy = mj.currentY - mj.startY; const dist = Math.min(Math.hypot(dx, dy), jRadius * 0.6); const ang = Math.atan2(dy, dx); ctx.arc(lx + Math.cos(ang)*dist, ly + Math.sin(ang)*dist, knobR, 0, Math.PI*2); } else { ctx.arc(lx, ly, knobR, 0, Math.PI*2); }
      ctx.fill();
      const rx = W * 0.8, ry = H * 0.75;
      const aj = aimJoystickRef.current;
      ctx.beginPath(); ctx.arc(rx, ry, jRadius, 0, Math.PI*2);
      ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#ef4444"; ctx.beginPath();
      if (aj) { const dx = aj.currentX - aj.startX, dy = aj.currentY - aj.startY; const dist = Math.min(Math.hypot(dx, dy), jRadius * 0.6); const ang = Math.atan2(dy, dx); ctx.arc(rx + Math.cos(ang)*dist, ry + Math.sin(ang)*dist, knobR, 0, Math.PI*2); } else { ctx.arc(rx, ry, knobR, 0, Math.PI*2); }
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#fff"; ctx.font = `${Math.round(jRadius*0.3)}px 'Courier New'`; ctx.textAlign = "center";
      ctx.fillText("MOVE", lx, ly + jRadius + jRadius*0.4);
      ctx.fillText("AIM/FIRE", rx, ry + jRadius + jRadius*0.4);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }

    let lastHudUpdate=0;

    function loop(ts) {
      // slow-motion effect: skip update frames
      if(stateRef.current?.slowMotion && stateRef.current.slowMotion > 0){
        stateRef.current.slowMotion -= 16;
        if(stateRef.current.slowMotion > 0) { rafRef.current=requestAnimationFrame(loop); return; }
      }

      const {W,H}=dimRef.current;
      const s=stateRef.current;
      const keys=keysRef.current;
      const mode=modeRef.current;
      const walls=getWalls();

      const is2PLike = mode==="2p" || mode==="online";

      if(is2PLike && s.roundOver){
        s.roundOverTimer-=16;
        if(s.roundOverTimer<=0){
          if(p1WinsRef.current>=3||p2WinsRef.current>=3){
            const winner=p1WinsRef.current>=3?"Player 1 Wins!":"Player 2 Wins!";
            if(mode==="online") cleanupOnlineRoom();
            setScreen("over"); setOverData({title:winner,score:0,best:0,coins:0}); return;
          }
          resetPvPRound();
        }
      } else {
        // Online: only move your own tank locally
        if(mode==="online") {
          const role = onlineRoleRef.current;
          if(role==="host") {
            movePlayer(s.p1,"p1",keys["w"],keys["s"],keys["a"],keys["d"],keys[" "],keys["shift"],ts);
          } else {
            // Guest controls p2 with arrow keys
            movePlayer(s.p2,"p2",keys["arrowup"],keys["arrowdown"],keys["arrowleft"],keys["arrowright"],keys["enter"],keys["rshift"],ts);
          }
          // Broadcast local state ~30fps
          if(ts - lastSentRef.current > 33 && onlinePvpRef.current?.channel) {
            const channel = onlinePvpRef.current.channel;
            if(role==="host") {
              const myBullets = s.bullets.filter(b=>b.shooterId==="p1"&&!b.remote).map(b=>({ x:b.x,y:b.y,angle:b.angle,life:b.life,maxLife:b.maxLife,size:b.size,color:b.color,damage:b.damage,shooterId:b.shooterId,ghost:b.ghost,pierce:b.pierce,explosive:b.explosive,cryo:b.cryo }));
              channel.send("state",{ p1:{ x:s.p1.x,y:s.p1.y,angle:s.p1.angle,hp:s.p1.hp,maxHp:s.p1.maxHp,vx:s.p1.vx,vy:s.p1.vy }, bullets:myBullets });
            } else {
              const myBullets = s.bullets.filter(b=>b.shooterId==="p2"&&!b.remote).map(b=>({ x:b.x,y:b.y,angle:b.angle,life:b.life,maxLife:b.maxLife,size:b.size,color:b.color,damage:b.damage,shooterId:b.shooterId,ghost:b.ghost,pierce:b.pierce,explosive:b.explosive,cryo:b.cryo }));
              channel.send("state",{ p2:{ x:s.p2.x,y:s.p2.y,angle:s.p2.angle,hp:s.p2.hp,maxHp:s.p2.maxHp,vx:s.p2.vx,vy:s.p2.vy }, bullets:myBullets });
            }
            lastSentRef.current = ts;
          }
        } else {
          movePlayer(s.p1,"p1",keys["w"],keys["s"],keys["a"],keys["d"],keys[" "],keys["shift"],ts);
          if(s.p2) movePlayer(s.p2,"p2",keys["arrowup"],keys["arrowdown"],keys["arrowleft"],keys["arrowright"],keys["enter"],keys["rshift"],ts);
        }

        if(mode==="survival"){
          s.enemies.forEach(e=>{ if(e.stunTimer>0) e.stunTimer = Math.max(0, e.stunTimer-16); else updateEnemyAI(e, s.p1, ts, walls, W, H); });
        }

        // abilities cooldowns (global tick)
        if(s.p1){ s.p1.abilities.empCd = Math.max(0, (s.p1.abilities.empCd||0)-16); s.p1.abilities.strikeCd = Math.max(0, (s.p1.abilities.strikeCd||0)-16); }

        s.bullets.forEach(b=>updateBullet(b));

        s.bullets.forEach(b=>{
          if(b.life<=0) return;
          if(b.shooterId==="p1"||b.shooterId==="p2"){
            const target=b.shooterId==="p1"?s.p2:s.p1;
            s.enemies.forEach(e=>{
              if(b.pierce&&b.pierced.includes(e)) return;
              if(Math.hypot(b.x-e.x,b.y-e.y)<(b.size+12)){
                e.hp-=b.damage;
                if(b.cryo) e.slowTimer=120;
                if(b.explosive) spawnExplosion(b.x,b.y);
                if(b.shooterRef?.lifeSteal) b.shooterRef.hp=Math.min(b.shooterRef.maxHp,b.shooterRef.hp+b.damage*0.3);
                if(b.pierce){b.pierced.push(e);spawnParticles(b.x,b.y,b.color,4);}
                else b.life=0;
                spawnParticles(b.x,b.y,b.isCrit?"#fde68a":b.color,b.isCrit?12:5);
              }
            });
            if(target&&target.hp>0&&Math.hypot(b.x-target.x,b.y-target.y)<15){
              if(target.hasBarrier&&target.barrierCd<=0){ target.barrierCd=300; spawnParticles(b.x,b.y,"#60a5fa",8); b.life=0; }
              else if(target.reflectChance>0&&Math.random()<target.reflectChance){ b.angle+=Math.PI; b.shooterId=b.shooterId==="p1"?"p2":"p1"; spawnParticles(b.x,b.y,"#22d3ee",5); }
              else { const dmg=b.damage*(1-(target.damageReduction||0)); target.hp-=dmg; if(b.cryo) target.slowTimer=120; if(b.explosive) spawnExplosion(b.x,b.y); b.life=0; }
            }
          } else if(b.shooterId==="enemy"){
            if(b.explosive&&Math.hypot(b.x-s.p1.x,b.y-s.p1.y)<55){ s.p1.hp-=b.damage*0.5*(1-(s.p1.damageReduction||0)); spawnExplosion(b.x,b.y); b.life=0; }
            if(b.life>0&&s.p1.hp>0&&Math.hypot(b.x-s.p1.x,b.y-s.p1.y)<15){
              if(s.p1.hasBarrier&&s.p1.barrierCd<=0){ s.p1.barrierCd=300; spawnParticles(b.x,b.y,"#60a5fa",8); b.life=0; }
              else if(s.p1.reflectChance>0&&Math.random()<s.p1.reflectChance){ b.angle+=Math.PI; b.shooterId="p1_reflect"; spawnParticles(b.x,b.y,"#22d3ee",5); }
              else { const dmg=b.damage*(1-(s.p1.damageReduction||0)); s.p1.hp-=dmg; if(b.explosive) spawnExplosion(b.x,b.y); b.life=0; }
            }
          } else if(b.shooterId==="p1_reflect"){
            s.enemies.forEach(e=>{ if(Math.hypot(b.x-e.x,b.y-e.y)<(b.size+10)){e.hp-=b.damage*2;b.life=0;} });
          }
        });

        s.explosions.forEach(ex=>{
          if(ex.life===ex.maxLife) s.enemies.forEach(e=>{if(Math.hypot(e.x-ex.x,e.y-ex.y)<ex.maxR) e.hp-=15;});
          ex.r+=(ex.maxR-ex.r)*0.3; ex.life--;
        });
        s.explosions=s.explosions.filter(e=>e.life>0);

        const before=s.enemies.length;
        s.enemies=s.enemies.filter(e=>{
          if(e.hp<=0){
            // splitter boss spawns children
            if(e.splitter && !(e._splitDone)){
              e._splitDone = true;
              const cnt = e.splitCount || 2;
              for(let si=0;si<cnt;si++){
                const ang = Math.random()*Math.PI*2;
                const nx = e.x + Math.cos(ang)*18, ny = e.y + Math.sin(ang)*18;
                const childHp = Math.max(20, Math.round(e.maxHp * 0.28));
                s.enemies.push({ x:nx,y:ny,angle:0,vx:0,vy:0,hp:childHp,maxHp:childHp,color:'#fb7185',barrel:'#e11d48',tread:'#7f1d1d',lastShot:0,spd:1.1,shootDelay:800,isElite:false,isBoss:false,slowTimer:0,aiState:'approach',strafeDir:Math.random()<0.5?1:-1,strafeTimer:0,stuckTimer:0,lastX:nx,lastY:ny,waypointX:null,waypointY:null,flankAngle:Math.random()*Math.PI*2});
              }
            }
            spawnParticles(e.x,e.y,e.isBoss?"#fbbf24":e.isElite?"#f87171":"#f97316",e.isBoss?24:e.isElite?16:10);
            return false;
          }
          return true;
        });
        const killed=before-s.enemies.length;
        if(killed>0){
          scoreRef.current+=killed*10*waveRef.current;
          if(mode==="survival") s.p1.hp=Math.min(s.p1.maxHp,s.p1.hp+killed*8);
        }

        s.bullets=s.bullets.filter(b=>b.life>0);
        s.particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vx*=0.91;p.vy*=0.91;p.life--;});
        s.particles=s.particles.filter(p=>p.life>0);

        if(mode==="survival"&&s.enemies.length===0&&!pendingPuRef.current){
          pendingPuRef.current=true;
          let offers;
          if(s.lastWaveHadBoss){
            offers = [...BOSS_POWERUPS].sort(()=>Math.random()-0.5).slice(0,4);
            s.lastWaveHadBoss = false;
          } else {
            offers = getRandomPowerups(4);
          }
          const waveCoins=Math.round(30+waveRef.current*15);
          setCoins(c=>c+waveCoins);
          cancelAnimationFrame(rafRef.current);
          setOfferedPowerups(offers);
          setScreen("powerup");
          return;
        }

        if(is2PLike&&!s.roundOver){
          const p1Dead=s.p1.hp<=0, p2Dead=s.p2&&s.p2.hp<=0;
          if(p1Dead||p2Dead){
            if(p1Dead) spawnParticles(s.p1.x,s.p1.y,s.p1.color);
            if(p2Dead) spawnParticles(s.p2.x,s.p2.y,s.p2.color);
            if(!p1Dead) p1WinsRef.current++;
            else if(!p2Dead) p2WinsRef.current++;
            s.roundOver=true; s.roundOverTimer=2200;
            s.roundWinner=p1Dead&&p2Dead?"Draw!":p1Dead?"P2 wins the round!":"P1 wins the round!";
          }
        }

        if(mode==="survival"&&s.p1.hp<=0){
          if(scoreRef.current>highScoreRef.current) highScoreRef.current=scoreRef.current;
          const earned=Math.round(waveRef.current*20);
          setCoins(c=>c+earned);
          // Submit to Supabase leaderboard
          submitScore(username||"Anonymous", scoreRef.current, waveRef.current, equippedSkin).then(lb=>setLeaderboard(lb||[]));
          setScreen("over");
          setOverData({title:"Game Over",score:scoreRef.current,best:highScoreRef.current,wave:waveRef.current,coins:earned});
          return;
        }
      }

      // ── DRAW ──────────────────────────────────────────────────────────────
      // apply screen shake
      let _shaked=false;
      if(shakeRef.current>0){ const sx=(Math.random()*2-1)*shakeRef.current, sy=(Math.random()*2-1)*shakeRef.current; ctx.save(); ctx.translate(sx,sy); shakeRef.current = Math.max(0, shakeRef.current-0.5); _shaked=true; }
      ctx.fillStyle=map.bg; ctx.fillRect(0,0,W,H);
      ctx.strokeStyle=map.grid; ctx.lineWidth=0.8;
      const gSz=Math.round(W/20);
      for(let x=0;x<W;x+=gSz){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
      for(let y=0;y<H;y+=gSz){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
      ctx.strokeStyle=map.border; ctx.lineWidth=BORDER*2; ctx.strokeRect(0,0,W,H);

      walls.forEach(w=>{
        ctx.fillStyle=map.border||"#1e293b";
        ctx.beginPath(); roundRect(ctx,w.x,w.y,w.w,w.h,4); ctx.fill();
        ctx.fillStyle="rgba(255,255,255,0.08)"; ctx.fillRect(w.x,w.y,w.w,Math.min(5,w.h));
        ctx.fillStyle="rgba(0,0,0,0.3)"; ctx.fillRect(w.x,w.y+w.h-Math.min(4,w.h),w.w,Math.min(4,w.h));
        ctx.strokeStyle="rgba(255,255,255,0.05)"; ctx.lineWidth=1;
        ctx.beginPath(); roundRect(ctx,w.x,w.y,w.w,w.h,4); ctx.stroke();
      });
      // destructible walls
      const dws = map.destructibleWalls || [];
      dws.forEach(w=>{
        ctx.fillStyle = "#6b7280";
        ctx.beginPath(); roundRect(ctx,w.x,w.y,w.w,w.h,4); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(w.x,w.y,w.w,Math.min(6,w.h));
        // HP bar
        const hpPct = Math.max(0, (w.hp||20)/20);
        ctx.fillStyle = "#ef4444"; ctx.fillRect(w.x, w.y - 8, w.w * hpPct, 4);
      });

      s.explosions.forEach(ex=>{
        const g=ctx.createRadialGradient(ex.x,ex.y,0,ex.x,ex.y,ex.r);
        g.addColorStop(0,`rgba(255,200,50,${0.7*(ex.life/ex.maxLife)})`);
        g.addColorStop(0.5,`rgba(255,100,20,${0.4*(ex.life/ex.maxLife)})`);
        g.addColorStop(1,"rgba(255,50,0,0)");
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(ex.x,ex.y,ex.r,0,Math.PI*2); ctx.fill();
      });

      s.particles.forEach(p=>{
        ctx.globalAlpha=p.life/p.maxLife;
        ctx.fillStyle=p.color;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.size||2,0,Math.PI*2); ctx.fill();
      });
      ctx.globalAlpha=1;

      const showLabels=is2PLike;
      if(s.p1.hp>0) drawTank(s.p1,showLabels?"P1":null);
      // draw hit flash overlay
      if(s.p1.lastHitFlash>0){
        ctx.globalAlpha = Math.max(0, s.p1.lastHitFlash/15) * 0.4;
        ctx.fillStyle = "#ff6b6b";
        ctx.beginPath(); ctx.arc(s.p1.x,s.p1.y,TW/2+5,0,Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
        s.p1.lastHitFlash -= 16;
      }
      if(s.p2&&s.p2.hp>0) drawTank(s.p2,showLabels?"P2":null);
      if(s.p2 && s.p2.lastHitFlash>0){
        ctx.globalAlpha = Math.max(0, s.p2.lastHitFlash/15) * 0.4;
        ctx.fillStyle = "#ff6b6b";
        ctx.beginPath(); ctx.arc(s.p2.x,s.p2.y,TW/2+5,0,Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
        s.p2.lastHitFlash -= 16;
      }
      s.enemies.forEach(e=>{
        // railgun warning line
        if(e.railgun && e.railCharge && e.railCharge>0){
          const progress = Math.min(1, e.railCharge / 420);
          ctx.save(); ctx.globalAlpha = 0.25 + 0.65 * progress; ctx.strokeStyle = `rgba(255,80,80,${0.9*progress})`; ctx.lineWidth = 2 + 6*progress;
          ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(s.p1.x, s.p1.y); ctx.stroke(); ctx.restore();
        }

        if(e.isBoss){
          ctx.save(); ctx.translate(e.x,e.y);
          ctx.beginPath(); ctx.arc(0,0,32,0,Math.PI*2); ctx.strokeStyle="rgba(251,191,36,0.5)"; ctx.lineWidth=3; ctx.stroke();
          ctx.beginPath(); ctx.arc(0,0,36,0,Math.PI*2); ctx.strokeStyle="rgba(251,191,36,0.2)"; ctx.lineWidth=2; ctx.stroke();
          ctx.restore();
        } else if(e.isElite){
          ctx.save(); ctx.translate(e.x,e.y);
          ctx.beginPath(); ctx.arc(0,0,28,0,Math.PI*2); ctx.strokeStyle="rgba(251,191,36,0.35)"; ctx.lineWidth=2; ctx.stroke();
          ctx.restore();
        }

        // stealth bosses are invisible unless visibleTimer > 0
        if(e.stealth && (!e.visibleTimer || e.visibleTimer<=0)){
          // draw a faint shimmer occasionally (subtle indicator)
          if(Math.random()<0.004){ ctx.globalAlpha=0.06; ctx.fillStyle=e.color; ctx.beginPath(); ctx.arc(e.x,e.y,10,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1; }
          return;
        }

        drawTank(e,null);
      });

      // draw drones
      const drones = s.drones || [];
      drones.forEach(d=>{
        ctx.save(); ctx.translate(d.x,d.y);
        const t = DRONE_TYPES[d.type];
        ctx.fillStyle = "#34d399";
        ctx.beginPath(); ctx.arc(0,0,6,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = "#10b981";
        ctx.beginPath(); ctx.arc(0,0,3,0,Math.PI*2); ctx.fill();
        ctx.restore();
      });

      s.bullets.forEach(b=>{
        const ageFrac=b.life/b.maxLife;
        ctx.globalAlpha=Math.min(1,ageFrac*3);
        if(b.ghost||b.explosive||b.isCrit){ctx.shadowBlur=b.isCrit?20:b.explosive?16:10;ctx.shadowColor=b.isCrit?"#fde68a":b.color;}
        if(b.cryo){ctx.shadowBlur=8;ctx.shadowColor="#7dd3fc";}
        ctx.beginPath(); ctx.arc(b.x,b.y,b.size,0,Math.PI*2);
        ctx.fillStyle=b.isCrit?"#fde68a":b.cryo?"#7dd3fc":b.color; ctx.fill();
        if(b.bounces>0||b.homing){ctx.beginPath();ctx.arc(b.x,b.y,b.size*0.4,0,Math.PI*2);ctx.fillStyle="#fff";ctx.fill();}
        ctx.shadowBlur=0;
      });
      ctx.globalAlpha=1;

      if(mode==="survival"){
        ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(W/2-80,8,160,22);
        ctx.fillStyle="#facc15"; ctx.font=`bold ${Math.round(W/65)}px 'Courier New'`; ctx.textAlign="center";
        ctx.fillText(`◆ Wave ${waveRef.current} — ${map.name} ◆`,W/2,23); ctx.textAlign="left";
      }
      // combo / synergy notifications
      if(comboNotify && comboNotify.timer>0){
        comboNotify.timer -= 16;
        ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(12,8,260,28);
        ctx.fillStyle = "#c7f9d3"; ctx.font = "bold 13px 'Courier New'"; ctx.textAlign = "left";
        ctx.fillText(comboNotify.text, 20, 28);
        if(comboNotify.timer<=0) setComboNotify(null);
      }
      if(is2PLike){
        ctx.fillStyle="rgba(0,0,0,0.6)"; ctx.fillRect(W/2-110,8,220,24);
        ctx.font="bold 13px 'Courier New'"; ctx.textAlign="center";
        ctx.fillStyle=s.p1.color; ctx.fillText(`P1 ${p1WinsRef.current}`,W/2-44,24);
        ctx.fillStyle="#444"; ctx.fillText("—",W/2,24);
        ctx.fillStyle=s.p2?.color||"#e879f9"; ctx.fillText(`${p2WinsRef.current} P2`,W/2+44,24);
        ctx.textAlign="left";
        if(s.roundOver){
          ctx.fillStyle="rgba(0,0,0,0.75)"; ctx.fillRect(W/2-150,H/2-36,300,68);
          ctx.fillStyle="#facc15"; ctx.font="bold 22px 'Courier New'"; ctx.textAlign="center";
          ctx.fillText(s.roundWinner,W/2,H/2-4);
          ctx.fillStyle="#555"; ctx.font="12px 'Courier New'";
          ctx.fillText("Next round starting...",W/2,H/2+22); ctx.textAlign="left";
        }
      }

      if(isMobileRef.current) drawMobileControls();

      if(ts-lastHudUpdate>100){
        lastHudUpdate=ts;
        setHudData({
          hp1:Math.max(0,Math.round(s.p1.hp)),maxHp1:s.p1.maxHp,
          hp2:s.p2?Math.max(0,Math.round(s.p2.hp)):0,maxHp2:s.p2?s.p2.maxHp:100,
          score:scoreRef.current,wave:waveRef.current,mode,
        });
      }

      // boss announcement overlay
      if(s.bossAnnounce){
        s.bossAnnounce.timer -= 16;
        ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(W/2-220,H/2-40,440,80);
        ctx.fillStyle = "#facc15"; ctx.font = "bold 20px 'Courier New'"; ctx.textAlign = "center";
        ctx.fillText(s.bossAnnounce.text, W/2, H/2+6);
        if(s.bossAnnounce.timer<=0) s.bossAnnounce = null;
      }

      if(_shaked) ctx.restore();
      rafRef.current=requestAnimationFrame(loop);
    }

    rafRef.current=requestAnimationFrame(loop);
    return ()=>cancelAnimationFrame(rafRef.current);
  },[screen]);

  const {W,H}=dimRef.current;
  const p1=stateRef.current?.p1;
  const catColor={FIREPOWER:"#ef4444",MOBILITY:"#facc15",DEFENSE:"#6ee7b7",UTILITY:"#f472b6"};

  function MiniTank({skin, size=70}) {
    const s=SKINS.find(x=>x.id===skin)||SKINS[0];
    const scale=size/70;
    return (
      <svg width={size} height={Math.round(56*scale)} viewBox="0 0 70 56">
        <rect x="8" y="4" width="54" height="8" fill={s.tread} rx="3"/>
        <rect x="8" y="44" width="54" height="8" fill={s.tread} rx="3"/>
        {[14,22,30,38,46,54].map(x=>(<g key={x}><line x1={x} y1="4" x2={x} y2="12" stroke="rgba(255,255,255,0.18)" strokeWidth="0.8"/><line x1={x} y1="44" x2={x} y2="52" stroke="rgba(255,255,255,0.18)" strokeWidth="0.8"/></g>))}
        {[14,24,35,46,56].map(wx=>(<g key={wx}><circle cx={wx} cy="8" r="3.5" fill="rgba(0,0,0,0.5)"/><circle cx={wx} cy="8" r="2.2" stroke="rgba(255,255,255,0.2)" strokeWidth="0.7" fill="none"/><circle cx={wx} cy="48" r="3.5" fill="rgba(0,0,0,0.5)"/><circle cx={wx} cy="48" r="2.2" stroke="rgba(255,255,255,0.2)" strokeWidth="0.7" fill="none"/></g>))}
        <rect x="13" y="13" width="44" height="30" fill={s.body} rx="4"/>
        <line x1="16" y1="28" x2="54" y2="28" stroke="rgba(0,0,0,0.3)" strokeWidth="1"/>
        <rect x="13" y="13" width="44" height="15" fill="rgba(255,255,255,0.18)" rx="4" opacity="0.8"/>
        {[[17,17],[53,17],[17,39],[53,39]].map(([bx,by],i)=>(<circle key={i} cx={bx} cy={by} r="1.5" fill="rgba(0,0,0,0.35)"/>))}
        <circle cx="35" cy="28" r="9" fill="rgba(0,0,0,0.4)"/>
        <circle cx="35" cy="28" r="8" fill={s.barrel}/>
        <circle cx="33" cy="26" r="4" fill="rgba(255,255,255,0.15)"/>
        <rect x="40" y="25.5" width="20" height="5" fill={s.barrel} rx="2"/>
        <rect x="41" y="25.5" width="18" height="1.8" fill="rgba(255,255,255,0.15)"/>
        <rect x="58" y="25" width="3" height="6" fill="rgba(0,0,0,0.5)" rx="1"/>
        <circle cx="32" cy="29" r="3" fill={s.body}/>
        <circle cx="32" cy="29" r="1.8" fill="rgba(0,0,0,0.4)"/>
      </svg>
    );
  }

  const styles = {
    root: { position:"fixed",inset:0,background:"#05050e",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Courier New',monospace",userSelect:"none",overflow:"hidden",touchAction:"none" },
    btn: { padding:"10px 28px",background:"transparent",border:"1.5px solid #1e293b",borderRadius:10,color:"#94a3b8",cursor:"pointer",fontSize:13,fontFamily:"'Courier New'",letterSpacing:"0.08em",transition:"all 0.18s" },
    input: { background:"rgba(255,255,255,0.05)",border:"1.5px solid #1e293b",borderRadius:10,color:"#f8fafc",fontSize:15,fontFamily:"'Courier New'",letterSpacing:"0.08em",padding:"10px 16px",outline:"none",width:"100%",boxSizing:"border-box",transition:"border-color 0.2s" },
  };

  return (
    <div style={styles.root}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:0.6}50%{opacity:1}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{from{background-position:200% center}to{background-position:-200% center}}
        .fade-in{animation:fadeIn 0.35s ease both}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px}
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        button { touch-action: manipulation; }
        input:focus { border-color: #22c55e !important; }
      `}</style>

      {screen!=="menu"&&screen!=="game"&&screen!=="username"&&(
        <div style={{position:"fixed",top:16,right:20,background:"rgba(0,0,0,0.7)",border:"1px solid #1e293b",borderRadius:8,padding:"6px 14px",fontSize:13,color:"#facc15",zIndex:100}}>◆ {coins.toLocaleString()}</div>
      )}

      {/* ── USERNAME ENTRY ─────────────────────────────────────────────────── */}
      {screen==="username"&&(
        <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:28,padding:"0 24px",maxWidth:420,width:"100%"}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:10,letterSpacing:"0.5em",color:"#1e3a5f",marginBottom:10}}>◆ TACTICAL ARENA ◆</div>
            <div style={{display:"flex",gap:0,justifyContent:"center"}}>
              <h1 style={{fontSize:"clamp(40px,10vw,72px)",fontWeight:900,letterSpacing:"0.12em",margin:0,lineHeight:0.95,background:"linear-gradient(135deg,#22c55e,#4ade80,#86efac)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundSize:"200%",animation:"shimmer 4s linear infinite"}}>TANK</h1>
              <h1 style={{fontSize:"clamp(40px,10vw,72px)",fontWeight:900,letterSpacing:"0.12em",margin:0,lineHeight:0.95,color:"#1e293b",WebkitTextStroke:"2px #1e3a5f"}}>&nbsp;WARS</h1>
            </div>
          </div>
          <div style={{width:"100%",display:"flex",flexDirection:"column",gap:14}}>
            <div style={{fontSize:11,color:"#475569",letterSpacing:"0.12em",textAlign:"center"}}>ENTER YOUR CALLSIGN</div>
            <input
              style={styles.input}
              placeholder="Commander name..."
              maxLength={20}
              value={usernameInput}
              onChange={e=>setUsernameInput(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"&&usernameInput.trim()){ setUsername(usernameInput.trim()); setScreen("menu"); }}}
              autoFocus
            />
            <button
              onClick={()=>{ if(usernameInput.trim()){ setUsername(usernameInput.trim()); setScreen("menu"); }}}
              disabled={!usernameInput.trim()}
              style={{...styles.btn,background:usernameInput.trim()?"rgba(34,197,94,0.1)":"transparent",borderColor:usernameInput.trim()?"#22c55e":"#1e293b",color:usernameInput.trim()?"#22c55e":"#334155",fontSize:14,letterSpacing:"0.2em",padding:"12px 0",width:"100%",cursor:usernameInput.trim()?"pointer":"default"}}
            >
              ▶ ENTER BATTLE
            </button>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <input
                style={styles.input}
                placeholder={isExistingProfile?"Enter password to restore":"Set a password (optional)"}
                type="password"
                value={passwordInput}
                onChange={e=>setPasswordInput(e.target.value)}
              />
              <div style={{display:"flex",gap:8}}>
                <div style={{display:"flex",flexDirection:"column",gap:8,flex:1}}>
                  {isExistingProfile ? (
                    <button
                      onClick={async ()=>{
                        const name = (usernameInput||"").trim();
                        if(!name) return;
                        setProfileMessage("Checking local password...");
                        const ok = await verifyPasswordForUser(name,passwordInput);
                        if(ok) {
                          const prof = loadProfileForUser(name);
                          if(prof) {
                            setCoins(prof.coins||0);
                            setOwnedSkins(prof.ownedSkins||["default"]);
                            setEquippedSkin(prof.equippedSkin||"default");
                            setProfileMessage("Profile restored (local)");
                            setUsername(name);
                            setScreen("menu");
                            return;
                          }
                        }
                        // fallback to Supabase if configured
                        if (!passwordInput) { setProfileMessage("Enter password to restore"); return; }
                        if (!SUPABASE_DISABLED) {
                          setProfileMessage("Checking Supabase credentials...");
                          const res = await loginWithSupabase(name,passwordInput);
                          if(!res.ok) { setProfileMessage(res.msg); return; }
                          const row = Array.isArray(res.data)?res.data[0]:res.data;
                          setCoins(row.coins||0);
                          setOwnedSkins(row.owned_skins||["default"]);
                          setEquippedSkin(row.equipped_skin||"default");
                          saveProfileForUser(name,{ coins:row.coins||0, ownedSkins:row.owned_skins||["default"], equippedSkin:row.equipped_skin||"default" });
                          setProfileMessage("Profile restored (Supabase)");
                          setUsername(name);
                          setScreen("menu");
                          return;
                        }
                        setProfileMessage("Invalid password or no profile found");
                      }}
                      style={{...styles.btn,background:"rgba(34,197,94,0.06)",borderColor:"#0f172a",color:"#22c55e"}}
                    >
                      Restore Profile
                    </button>
                  ) : (
                    <button
                      onClick={async ()=>{
                        const name = (usernameInput||"").trim();
                        if(!name) return;
                        if(!passwordInput) { setProfileMessage("Enter a password to save your profile"); return; }
                        const ok = await setPasswordForUser(name,passwordInput);
                        // save current minimal profile
                        saveProfileForUser(name,{ coins, ownedSkins, equippedSkin });
                        if(ok) {
                          setProfileMessage("Password set and profile saved (local)");
                          setUsername(name);
                          setScreen("menu");
                        } else {
                          setProfileMessage("Failed to save profile");
                        }
                      }}
                      style={{...styles.btn,background:"rgba(34,197,94,0.06)",borderColor:"#0f172a",color:"#22c55e"}}
                    >
                      Set Password & Save (Local)
                    </button>
                  )}

                  {!SUPABASE_DISABLED && (
                    <div style={{display:"flex",gap:8}}>
                      <button
                        onClick={async ()=>{
                          const name = (usernameInput||"").trim();
                          if(!name || !passwordInput) { setProfileMessage("Enter username and password"); return; }
                          setProfileMessage("Registering on Supabase...");
                          const res = await registerWithSupabase(name,passwordInput,{ coins, ownedSkins, equippedSkin });
                          if(!res.ok) { setProfileMessage(res.msg); return; }
                          const row = Array.isArray(res.data)?res.data[0]:res.data;
                          setCoins(row.coins||0);
                          setOwnedSkins(row.owned_skins||["default"]);
                          setEquippedSkin(row.equipped_skin||"default");
                          saveProfileForUser(name,{ coins:row.coins||0, ownedSkins:row.owned_skins||["default"], equippedSkin:row.equipped_skin||"default" });
                          setProfileMessage("Registered and saved (Supabase)");
                          setUsername(name);
                          setScreen("menu");
                        }}
                        style={{...styles.btn,flex:1,background:"rgba(59,130,246,0.08)",borderColor:"#0b1220",color:"#60a5fa"}}
                      >
                        Register (Supabase)
                      </button>
                      <button
                        onClick={async ()=>{
                          const name = (usernameInput||"").trim();
                          if(!name || !passwordInput) { setProfileMessage("Enter username and password"); return; }
                          setProfileMessage("Logging in via Supabase...");
                          const res = await loginWithSupabase(name,passwordInput);
                          if(!res.ok) { setProfileMessage(res.msg); return; }
                          const row = Array.isArray(res.data)?res.data[0]:res.data;
                          setCoins(row.coins||0);
                          setOwnedSkins(row.owned_skins||["default"]);
                          setEquippedSkin(row.equipped_skin||"default");
                          saveProfileForUser(name,{ coins:row.coins||0, ownedSkins:row.owned_skins||["default"], equippedSkin:row.equipped_skin||"default" });
                          setProfileMessage("Logged in (Supabase)");
                          setUsername(name);
                          setScreen("menu");
                        }}
                        style={{...styles.btn,flex:1,background:"rgba(16,185,129,0.06)",borderColor:"#042f23",color:"#34d399"}}
                      >
                        Login (Supabase)
                      </button>
                    </div>
                  )}

                  <div style={{display:"flex",marginTop:4}}>
                    <button
                      onClick={()=>{ if(usernameInput.trim()){ setUsername(usernameInput.trim()); setScreen("menu"); }}}
                      style={{...styles.btn,flex:1,background:"transparent",borderColor:"#1e293b",color:"#334155"}}
                    >
                      Skip
                    </button>
                  </div>
                </div>
              </div>
              {profileMessage&&<div style={{fontSize:12,color:"#86efac"}}>{profileMessage}</div>}
            </div>
          </div>
          <div style={{fontSize:10,color:"#1e293b",letterSpacing:"0.06em",textAlign:"center"}}>No account required · Scores go to global leaderboard</div>
        </div>
      )}

      {/* ── MAIN MENU ──────────────────────────────────────────────────────── */}
      {screen==="menu"&&(
        <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",width:"100%",maxWidth:760,padding:"0 16px",gap:0,overflowY:"auto",maxHeight:"100vh"}}>
          <div style={{textAlign:"center",marginBottom:isMobile?16:36,marginTop:isMobile?12:0}}>
            <div style={{fontSize:isMobile?8:10,letterSpacing:"0.5em",color:"#1e3a5f",marginBottom:8}}>◆ TACTICAL ARENA ◆</div>
            <div style={{display:"flex",gap:0,justifyContent:"center"}}>
              <h1 style={{fontSize:`clamp(${isMobile?"32px":"48px"},8vw,80px)`,fontWeight:900,letterSpacing:"0.12em",margin:0,lineHeight:0.95,background:"linear-gradient(135deg,#22c55e,#4ade80,#86efac)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundSize:"200%",animation:"shimmer 4s linear infinite"}}>TANK</h1>
              <h1 style={{fontSize:`clamp(${isMobile?"32px":"48px"},8vw,80px)`,fontWeight:900,letterSpacing:"0.12em",margin:0,lineHeight:0.95,color:"#1e293b",WebkitTextStroke:"2px #1e3a5f"}}>&nbsp;WARS</h1>
            </div>
            <div style={{fontSize:10,color:"#334155",marginTop:6}}>Commander: <span style={{color:"#22c55e"}}>{username}</span></div>
          </div>

          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:isMobile?16:28,background:"rgba(250,204,21,0.07)",border:"1px solid rgba(250,204,21,0.15)",borderRadius:10,padding:"8px 20px"}}>
            <span style={{fontSize:18,color:"#facc15"}}>◆</span>
            <span style={{fontSize:22,fontWeight:900,color:"#facc15"}}>{coins.toLocaleString()}</span>
            <span style={{fontSize:11,color:"#64748b",marginLeft:4}}>COINS</span>
          </div>

          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(auto-fit,minmax(175px,1fr))",gap:isMobile?10:14,marginBottom:isMobile?16:24,width:"100%"}}>
            {/* Survival */}
            <div onClick={startSurvival} onMouseEnter={()=>!isMobile&&setHoveredMode("survival")} onMouseLeave={()=>!isMobile&&setHoveredMode(null)}
              style={{padding:isMobile?"16px 10px":"22px 18px",background:hoveredMode==="survival"?"rgba(34,197,94,0.06)":"rgba(255,255,255,0.02)",border:`1.5px solid ${hoveredMode==="survival"?"#22c55e":"#0f172a"}`,borderRadius:16,cursor:"pointer",transition:"all 0.2s ease",transform:hoveredMode==="survival"?"translateY(-6px)":"none",display:"flex",flexDirection:"column",alignItems:"center",gap:isMobile?8:12,WebkitTapHighlightColor:"transparent"}}>
              <div style={{fontSize:isMobile?24:30}}>🎯</div>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:isMobile?14:18,fontWeight:900,letterSpacing:"0.1em",color:hoveredMode==="survival"?"#22c55e":"#e2e8f0"}}>SURVIVAL</div>
                {!isMobile&&<div style={{fontSize:10,color:"#475569",marginTop:2}}>RANDOM MAP EACH RUN</div>}
              </div>
              {!isMobile&&<div style={{fontSize:11,color:"#64748b",textAlign:"center",lineHeight:1.7}}>Endless waves. Upgrades. Global leaderboard.</div>}
            </div>

            {/* Local PvP */}
            <div onMouseEnter={()=>!isMobile&&setHoveredMode("2p")} onMouseLeave={()=>!isMobile&&setHoveredMode(null)}
              style={{padding:isMobile?"16px 10px":"22px 18px",background:hoveredMode==="2p"?"rgba(232,121,249,0.06)":"rgba(255,255,255,0.02)",border:`1.5px solid ${hoveredMode==="2p"?"#e879f9":"#0f172a"}`,borderRadius:16,transition:"all 0.2s ease",display:"flex",flexDirection:"column",alignItems:"center",gap:isMobile?8:10,WebkitTapHighlightColor:"transparent"}}>
              <div style={{fontSize:isMobile?24:30}}>⚔️</div>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:isMobile?14:18,fontWeight:900,letterSpacing:"0.1em",color:hoveredMode==="2p"?"#e879f9":"#e2e8f0"}}>LOCAL PvP</div>
                {!isMobile&&<div style={{fontSize:10,color:"#475569",marginTop:2}}>SAME KEYBOARD</div>}
              </div>
              {isMobile?(
                <button onClick={start2P} style={{fontSize:11,color:"#e879f9",background:"rgba(232,121,249,0.1)",border:"1.5px solid #e879f9",borderRadius:10,padding:"6px 16px",cursor:"pointer",fontFamily:"'Courier New'",touchAction:"manipulation"}}>▶ PLAY</button>
              ):(
                <>
                  <div style={{display:"flex",flexWrap:"wrap",gap:4,justifyContent:"center"}}>
                    {MAPS.map(m=>(
                      <button key={m.id} onClick={e=>{e.stopPropagation();setPvpMapChoice(m.id);}}
                        style={{fontSize:9,padding:"3px 8px",background:pvpMapChoice===m.id?"rgba(232,121,249,0.15)":"rgba(0,0,0,0.3)",border:`1px solid ${pvpMapChoice===m.id?"#e879f9":"#1e293b"}`,borderRadius:6,color:pvpMapChoice===m.id?"#e879f9":"#475569",cursor:"pointer",fontFamily:"'Courier New'",transition:"all 0.15s"}}>
                        {m.name}
                      </button>
                    ))}
                  </div>
                  <button onClick={start2P} style={{padding:"8px 24px",background:"rgba(232,121,249,0.1)",border:"1.5px solid #e879f9",borderRadius:10,color:"#e879f9",cursor:"pointer",fontSize:12,fontFamily:"'Courier New'",letterSpacing:"0.08em"}}>▶ PLAY</button>
                </>
              )}
            </div>

            {/* Online PvP */}
            <div onClick={()=>setScreen("online")} onMouseEnter={()=>!isMobile&&setHoveredMode("online")} onMouseLeave={()=>!isMobile&&setHoveredMode(null)}
              style={{padding:isMobile?"16px 10px":"22px 18px",background:hoveredMode==="online"?"rgba(56,189,248,0.06)":"rgba(255,255,255,0.02)",border:`1.5px solid ${hoveredMode==="online"?"#38bdf8":"#0f172a"}`,borderRadius:16,cursor:"pointer",transition:"all 0.2s ease",transform:hoveredMode==="online"?"translateY(-6px)":"none",display:"flex",flexDirection:"column",alignItems:"center",gap:isMobile?8:12,WebkitTapHighlightColor:"transparent"}}>
              <div style={{fontSize:isMobile?24:30}}>🌐</div>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:isMobile?14:18,fontWeight:900,letterSpacing:"0.1em",color:hoveredMode==="online"?"#38bdf8":"#e2e8f0"}}>ONLINE PvP</div>
                {!isMobile&&<div style={{fontSize:10,color:"#475569",marginTop:2}}>PLAY ANYWHERE</div>}
              </div>
              {!isMobile&&<div style={{fontSize:11,color:"#64748b",textAlign:"center",lineHeight:1.7}}>Share a room code with a friend.</div>}
            </div>

            {/* Shop */}
            <div onClick={()=>setScreen("shop")} onMouseEnter={()=>!isMobile&&setHoveredMode("shop")} onMouseLeave={()=>!isMobile&&setHoveredMode(null)}
              style={{padding:isMobile?"16px 10px":"22px 18px",background:hoveredMode==="shop"?"rgba(245,158,11,0.06)":"rgba(255,255,255,0.02)",border:`1.5px solid ${hoveredMode==="shop"?"#f59e0b":"#0f172a"}`,borderRadius:16,cursor:"pointer",transition:"all 0.2s ease",display:"flex",flexDirection:"column",alignItems:"center",gap:isMobile?8:12,WebkitTapHighlightColor:"transparent"}}>
              <div style={{fontSize:isMobile?24:30}}>🛒</div>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:isMobile?14:18,fontWeight:900,letterSpacing:"0.1em",color:hoveredMode==="shop"?"#f59e0b":"#e2e8f0"}}>SHOP</div>
                {!isMobile&&<div style={{fontSize:10,color:"#475569",marginTop:2}}>TANK SKINS</div>}
              </div>
            </div>

            {/* Leaderboard */}
            <div onClick={()=>{loadLeaderboard();setScreen("leaderboard");}} onMouseEnter={()=>!isMobile&&setHoveredMode("lb")} onMouseLeave={()=>!isMobile&&setHoveredMode(null)}
              style={{padding:isMobile?"16px 10px":"22px 18px",background:hoveredMode==="lb"?"rgba(56,189,248,0.06)":"rgba(255,255,255,0.02)",border:`1.5px solid ${hoveredMode==="lb"?"#38bdf8":"#0f172a"}`,borderRadius:16,cursor:"pointer",transition:"all 0.2s ease",display:"flex",flexDirection:"column",alignItems:"center",gap:isMobile?8:12,WebkitTapHighlightColor:"transparent"}}>
              <div style={{fontSize:isMobile?24:30}}>🏆</div>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:isMobile?14:18,fontWeight:900,letterSpacing:"0.1em",color:hoveredMode==="lb"?"#38bdf8":"#e2e8f0"}}>SCORES</div>
                {!isMobile&&<div style={{fontSize:10,color:"#475569",marginTop:2}}>GLOBAL TOP 10</div>}
              </div>
            </div>
          </div>

          {/* Progression & Challenges */}
          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:isMobile?10:14,marginBottom:isMobile?16:24,width:"100%"}}>
            {/* Skill Tree */}
            <div onClick={()=>setScreen2("skillTree")} onMouseEnter={()=>!isMobile&&setHoveredMode("skills")} onMouseLeave={()=>!isMobile&&setHoveredMode(null)}
              style={{padding:isMobile?"16px 10px":"22px 18px",background:hoveredMode==="skills"?"rgba(34,197,94,0.06)":"rgba(255,255,255,0.02)",border:`1.5px solid ${hoveredMode==="skills"?"#22c55e":"#0f172a"}`,borderRadius:16,cursor:"pointer",transition:"all 0.2s ease",transform:hoveredMode==="skills"?"translateY(-6px)":"none",display:"flex",flexDirection:"column",alignItems:"center",gap:isMobile?8:10,WebkitTapHighlightColor:"transparent"}}>
              <div style={{fontSize:isMobile?24:28}}>🎖️</div>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:isMobile?14:16,fontWeight:900,letterSpacing:"0.1em",color:hoveredMode==="skills"?"#22c55e":"#e2e8f0"}}>UPGRADES</div>
                {!isMobile&&<div style={{fontSize:10,color:"#475569",marginTop:2}}>SKILL TREE</div>}
              </div>
            </div>

            {/* Daily Challenge */}
            <div onClick={()=>{setDailyChallenge(getDailyChallenge());setScreen2("dailyChallenge");}} onMouseEnter={()=>!isMobile&&setHoveredMode("daily")} onMouseLeave={()=>!isMobile&&setHoveredMode(null)}
              style={{padding:isMobile?"16px 10px":"22px 18px",background:hoveredMode==="daily"?"rgba(250,204,21,0.06)":"rgba(255,255,255,0.02)",border:`1.5px solid ${hoveredMode==="daily"?"#facc15":"#0f172a"}`,borderRadius:16,cursor:"pointer",transition:"all 0.2s ease",transform:hoveredMode==="daily"?"translateY(-6px)":"none",display:"flex",flexDirection:"column",alignItems:"center",gap:isMobile?8:10,WebkitTapHighlightColor:"transparent"}}>
              <div style={{fontSize:isMobile?24:28}}>⭐</div>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:isMobile?14:16,fontWeight:900,letterSpacing:"0.1em",color:hoveredMode==="daily"?"#facc15":"#e2e8f0"}}>CHALLENGE</div>
                {!isMobile&&<div style={{fontSize:10,color:"#475569",marginTop:2}}>DAILY QUEST</div>}
              </div>
            </div>
          </div>


          <div style={{display:"flex",gap:isMobile?10:20,borderTop:"1px solid #0a0a1a",paddingTop:10,paddingBottom:isMobile?12:0,fontSize:isMobile?10:11,color:"#334155",flexWrap:"wrap",justifyContent:"center"}}>
            <span>Skin: <span style={{color:SKINS.find(s=>s.id===equippedSkin)?.body}}>{SKINS.find(s=>s.id===equippedSkin)?.name}</span></span>
            <span style={{color:"#1e293b"}}>·</span>
            <button onClick={()=>{setUsername("");setUsernameInput("");setScreen("username");}} style={{background:"none",border:"none",color:"#334155",cursor:"pointer",fontFamily:"'Courier New'",fontSize:isMobile?10:11,padding:0}}>Change callsign</button>
            {isMobile&&<span style={{color:"#475569",fontSize:9,width:"100%",textAlign:"center"}}>Left joystick: move · Right joystick: aim/fire</span>}
          </div>
        </div>
      )}

      {/* ── ONLINE PVP LOBBY ──────────────────────────────────────────────── */}
      {screen==="online"&&(
        <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",width:"100%",maxWidth:460,padding:"0 16px",gap:20}}>
          <div style={{display:"flex",alignItems:"center",gap:16,width:"100%",paddingTop:isMobile?12:0}}>
            <button onClick={()=>{cleanupOnlineRoom();setScreen("menu");}} style={{...styles.btn,fontSize:12,padding:"6px 16px"}}>← Back</button>
            <div>
              <div style={{fontSize:isMobile?16:20,fontWeight:900,color:"#38bdf8",letterSpacing:"0.12em"}}>ONLINE PvP</div>
              <div style={{fontSize:10,color:"#334155",letterSpacing:"0.1em"}}>Playing as <span style={{color:"#22c55e"}}>{username}</span></div>
            </div>
          </div>

          {/* Map selector */}
          <div style={{width:"100%",background:"rgba(255,255,255,0.02)",border:"1px solid #0f172a",borderRadius:12,padding:"14px 16px"}}>
            <div style={{fontSize:10,color:"#334155",letterSpacing:"0.12em",marginBottom:10}}>SELECT MAP (host decides)</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {MAPS.map(m=>(
                <button key={m.id} onClick={()=>setPvpMapChoice(m.id)}
                  style={{fontSize:10,padding:"4px 10px",background:pvpMapChoice===m.id?"rgba(56,189,248,0.15)":"rgba(0,0,0,0.3)",border:`1px solid ${pvpMapChoice===m.id?"#38bdf8":"#1e293b"}`,borderRadius:6,color:pvpMapChoice===m.id?"#38bdf8":"#475569",cursor:"pointer",fontFamily:"'Courier New'",transition:"all 0.15s"}}>
                  {m.name}
                </button>
              ))}
            </div>
          </div>

          {/* Tab selector */}
          {!onlineWaiting&&(
            <div style={{display:"flex",gap:4,background:"#0a0a1a",borderRadius:10,padding:"4px",width:"100%"}}>
              {["create","join"].map(t=>(
                <button key={t} onClick={()=>setOnlineTab(t)}
                  style={{flex:1,padding:"8px",background:onlineTab===t?"rgba(255,255,255,0.07)":"transparent",border:onlineTab===t?"1px solid #1e293b":"1px solid transparent",borderRadius:8,color:onlineTab===t?"#e2e8f0":"#334155",fontSize:12,cursor:"pointer",fontFamily:"'Courier New'",letterSpacing:"0.1em",transition:"all 0.15s"}}>
                  {t==="create"?"CREATE ROOM":"JOIN ROOM"}
                </button>
              ))}
            </div>
          )}

          {/* Create Room */}
          {!onlineWaiting&&onlineTab==="create"&&(
            <div style={{width:"100%",display:"flex",flexDirection:"column",gap:14}}>
              <div style={{fontSize:11,color:"#475569",lineHeight:1.8,textAlign:"center"}}>Create a private room and share the code with your opponent. You'll play as <span style={{color:"#22c55e"}}>P1</span> (WASD + Space).</div>
              <button onClick={createOnlineRoom}
                style={{...styles.btn,background:"rgba(56,189,248,0.1)",borderColor:"#38bdf8",color:"#38bdf8",fontSize:14,padding:"12px",width:"100%",letterSpacing:"0.15em"}}>
                🌐 CREATE ROOM
              </button>
            </div>
          )}

          {/* Join Room */}
          {!onlineWaiting&&onlineTab==="join"&&(
            <div style={{width:"100%",display:"flex",flexDirection:"column",gap:14}}>
              <div style={{fontSize:11,color:"#475569",textAlign:"center"}}>Enter the 5-letter room code from your opponent. You'll play as <span style={{color:"#e879f9"}}>P2</span> (Arrows + Enter).</div>
              <input
                style={styles.input}
                placeholder="Room code (e.g. ABCD1)"
                maxLength={5}
                value={roomCodeInput}
                onChange={e=>setRoomCodeInput(e.target.value.toUpperCase())}
                onKeyDown={e=>e.key==="Enter"&&joinOnlineRoom(roomCodeInput)}
              />
              <button onClick={()=>joinOnlineRoom(roomCodeInput)}
                disabled={roomCodeInput.length!==5}
                style={{...styles.btn,background:roomCodeInput.length===5?"rgba(232,121,249,0.1)":"transparent",borderColor:roomCodeInput.length===5?"#e879f9":"#1e293b",color:roomCodeInput.length===5?"#e879f9":"#334155",fontSize:14,padding:"12px",width:"100%",letterSpacing:"0.15em",cursor:roomCodeInput.length===5?"pointer":"default"}}>
                ⚔️ JOIN ROOM
              </button>
            </div>
          )}

          {/* Waiting state */}
          {onlineWaiting&&(
            <div style={{width:"100%",display:"flex",flexDirection:"column",alignItems:"center",gap:20}}>
              {currentRoomCode&&(
                <div style={{textAlign:"center",background:"rgba(56,189,248,0.05)",border:"1px solid rgba(56,189,248,0.2)",borderRadius:14,padding:"20px 28px",width:"100%"}}>
                  <div style={{fontSize:10,color:"#334155",letterSpacing:"0.15em",marginBottom:8}}>YOUR ROOM CODE</div>
                  <div style={{fontSize:36,fontWeight:900,color:"#38bdf8",letterSpacing:"0.3em"}}>{currentRoomCode}</div>
                  <div style={{fontSize:10,color:"#475569",marginTop:8}}>Share this with your opponent</div>
                </div>
              )}
              <div style={{display:"flex",alignItems:"center",gap:12,color:"#475569",fontSize:13}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:"#22c55e",animation:"pulse 1.5s infinite"}}/>
                {onlineStatus}
              </div>
              <button onClick={cleanupOnlineRoom} style={{...styles.btn,fontSize:12,color:"#450a0a",borderColor:"#1a0a0a"}}
                onMouseEnter={e=>{e.currentTarget.style.color="#ef4444";e.currentTarget.style.borderColor="#ef4444";}}
                onMouseLeave={e=>{e.currentTarget.style.color="#450a0a";e.currentTarget.style.borderColor="#1a0a0a";}}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── LEADERBOARD ───────────────────────────────────────────────────── */}
      {screen==="leaderboard"&&(
        <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",width:"100%",maxWidth:600,padding:"0 16px",overflowY:"auto",maxHeight:"100vh"}}>
          <div style={{display:"flex",alignItems:"center",gap:20,padding:`${isMobile?"12px":"0"} 0 20px`,width:"100%"}}>
            <button onClick={()=>setScreen("menu")} style={{...styles.btn,fontSize:12,padding:"6px 16px"}}>← Back</button>
            <div>
              <div style={{fontSize:isMobile?16:20,fontWeight:900,color:"#f8fafc",letterSpacing:"0.12em"}}>LEADERBOARD</div>
              <div style={{fontSize:10,color:"#334155",letterSpacing:"0.15em"}}>GLOBAL TOP SCORES</div>
            </div>
            <div style={{marginLeft:"auto"}}>
              <button onClick={loadLeaderboard} style={{...styles.btn,fontSize:11,padding:"5px 14px"}}>{lbLoading?"...":"↻ Refresh"}</button>
            </div>
          </div>
          {lbLoading?(
            <div style={{color:"#334155",fontSize:13,marginTop:40,textAlign:"center",animation:"pulse 1.5s infinite"}}>Loading...</div>
          ):leaderboard.length===0?(
            <div style={{color:"#334155",fontSize:13,marginTop:40,textAlign:"center"}}>No runs recorded yet.<br/><span style={{color:"#475569"}}>Play Survival to get on the board!</span></div>
          ):(
            <div style={{width:"100%",display:"flex",flexDirection:"column",gap:8,paddingBottom:20}}>
              {leaderboard.map((entry,i)=>{
                const skin=SKINS.find(s=>s.id===entry.skin)||SKINS[0];
                const medals=["🥇","🥈","🥉"];
                const isMe = entry.username===username;
                return (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:14,background:isMe?"rgba(34,197,94,0.07)":i===0?"rgba(250,204,21,0.07)":i===1?"rgba(148,163,184,0.05)":i===2?"rgba(180,83,9,0.05)":"rgba(255,255,255,0.02)",border:`1px solid ${isMe?"rgba(34,197,94,0.35)":i===0?"rgba(250,204,21,0.2)":i<3?"rgba(255,255,255,0.06)":"#0f172a"}`,borderRadius:12,padding:"12px 16px"}}>
                    <div style={{fontSize:20,width:28,textAlign:"center"}}>{medals[i]||`#${i+1}`}</div>
                    <div style={{width:40,height:28,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <MiniTank skin={entry.skin} size={40}/>
                    </div>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{fontSize:18,fontWeight:900,color:isMe?"#22c55e":i===0?"#facc15":i===1?"#94a3b8":i===2?"#b45309":"#e2e8f0"}}>{entry.score?.toLocaleString()}</div>
                        {isMe&&<span style={{fontSize:8,color:"#22c55e",border:"1px solid #22c55e44",borderRadius:99,padding:"1px 6px",letterSpacing:"0.1em"}}>YOU</span>}
                      </div>
                      <div style={{fontSize:10,color:"#475569"}}>{entry.username} · Wave {entry.wave} · {skin.name}</div>
                    </div>
                    <div style={{fontSize:10,color:"#334155"}}>{entry.date}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── SHOP (Skins only) ─────────────────────────────────────────────── */}
      {screen==="shop"&&(
        <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",width:"100%",maxWidth:860,height:"100vh",overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",gap:isMobile?12:20,padding:`${isMobile?"12px 16px":"20px 24px"} 0`,width:"100%",paddingLeft:isMobile?16:24,paddingRight:isMobile?16:24}}>
            <button onClick={()=>setScreen("menu")} style={{...styles.btn,fontSize:12,padding:"6px 16px"}}>← Back</button>
            <div style={{flex:1}}>
              <div style={{fontSize:isMobile?16:22,fontWeight:900,color:"#f8fafc",letterSpacing:"0.12em"}}>ARMORY</div>
              <div style={{fontSize:10,color:"#334155",letterSpacing:"0.15em"}}>TANK SKINS</div>
            </div>
            <div style={{background:"rgba(250,204,21,0.08)",border:"1px solid rgba(250,204,21,0.2)",borderRadius:10,padding:"8px 14px",fontSize:14,color:"#facc15",fontWeight:900}}>◆ {coins.toLocaleString()}</div>
          </div>

          <div style={{overflowY:"auto",padding:isMobile?"12px 16px 80px":"18px 24px 24px",width:"100%"}}>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(auto-fill,minmax(130px,1fr))":"repeat(auto-fill,minmax(155px,1fr))",gap:isMobile?8:12}}>
              {SKINS.map(skin=>{
                const owned=ownedSkins.includes(skin.id);
                const equipped=equippedSkin===skin.id;
                const canBuy=coins>=skin.price&&!owned;
                return (
                  <div key={skin.id} style={{background:equipped?"rgba(34,197,94,0.07)":"rgba(255,255,255,0.02)",border:`1.5px solid ${equipped?"#22c55e":owned?"#1e293b":"#0f172a"}`,borderRadius:12,padding:isMobile?"12px 8px":"16px 12px",display:"flex",flexDirection:"column",alignItems:"center",gap:isMobile?6:10}}>
                    <MiniTank skin={skin.id} size={isMobile?52:70}/>
                    <div style={{fontSize:10,fontWeight:700,color:equipped?"#22c55e":"#94a3b8",textAlign:"center"}}>{skin.name}</div>
                    {equipped?(
                      <div style={{fontSize:9,color:"#22c55e",border:"1px solid #22c55e44",borderRadius:99,padding:"2px 10px",letterSpacing:"0.1em"}}>EQUIPPED</div>
                    ):owned?(
                      <button onClick={()=>setEquippedSkin(skin.id)} style={{fontSize:10,color:"#94a3b8",background:"rgba(255,255,255,0.05)",border:"1px solid #1e293b",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontFamily:"'Courier New'",touchAction:"manipulation"}}>Equip</button>
                    ):(
                      <button onClick={()=>buyItem("skin",skin.id,skin.price)} disabled={!canBuy}
                        style={{fontSize:10,color:canBuy?"#facc15":"#334155",background:canBuy?"rgba(250,204,21,0.08)":"transparent",border:`1px solid ${canBuy?"rgba(250,204,21,0.3)":"#0f172a"}`,borderRadius:8,padding:"4px 10px",cursor:canBuy?"pointer":"default",fontFamily:"'Courier New'",touchAction:"manipulation"}}>
                        ◆ {skin.price}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Portrait-mode nudge */}
      {isMobile && !isLandscape && (screen==="game"||screen==="powerup") && (
        <div style={{position:"fixed",inset:0,zIndex:999,background:"rgba(5,5,14,0.96)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20,padding:24}}>
          <div style={{fontSize:64,animation:"rotateHint 1.8s ease-in-out infinite"}}>📱</div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:18,fontWeight:900,color:"#facc15",letterSpacing:"0.15em",marginBottom:8}}>ROTATE DEVICE</div>
            <div style={{fontSize:12,color:"#475569",lineHeight:1.8}}>Tank Wars plays best in <span style={{color:"#22c55e"}}>landscape mode</span>.<br/>Rotate your phone to continue.</div>
          </div>
          {hudData.mode==="survival"&&(
            <div style={{display:"flex",gap:24,borderTop:"1px solid #0f172a",paddingTop:16}}>
              <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#334155",letterSpacing:"0.1em"}}>WAVE</div><div style={{fontSize:22,fontWeight:900,color:"#38bdf8"}}>{hudData.wave}</div></div>
              <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#334155",letterSpacing:"0.1em"}}>SCORE</div><div style={{fontSize:22,fontWeight:900,color:"#fff"}}>{hudData.score.toLocaleString()}</div></div>
            </div>
          )}
          <button onClick={()=>{cancelAnimationFrame(rafRef.current);if(modeRef.current==="online")cleanupOnlineRoom();setScreen("menu");}}
            style={{marginTop:8,fontSize:11,color:"#334155",background:"transparent",border:"1px solid #0f172a",borderRadius:8,padding:"8px 20px",cursor:"pointer",fontFamily:"'Courier New'",touchAction:"manipulation"}}>
            ✕ Quit to Menu
          </button>
          <style>{`@keyframes rotateHint{0%{transform:rotate(0deg)}40%{transform:rotate(90deg)}60%{transform:rotate(90deg)}100%{transform:rotate(0deg)}}`}</style>
        </div>
      )}

      {/* ── GAME CANVAS ───────────────────────────────────────────────────── */}
      {screen==="game"&&(
        <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:isMobile&&isLandscape?2:isMobile?4:8,width:"100%"}}>
          <div style={{display:"flex",alignItems:"center",gap:isMobile?8:16,width:W,padding:"0 4px",boxSizing:"border-box"}}>
            <div style={{display:"flex",alignItems:"center",gap:5}}>
              <span style={{color:SKINS.find(s=>s.id===equippedSkin)?.body,fontSize:isMobile&&isLandscape?9:10,fontWeight:700}}>P1</span>
              <div style={{width:isMobile?(isLandscape?60:70):90,height:5,background:"#0a0a1a",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:3,transition:"width 0.15s",width:`${Math.min(100,(hudData.hp1/hudData.maxHp1)*100)}%`,background:hudData.hp1/hudData.maxHp1>0.5?"#4ade80":hudData.hp1/hudData.maxHp1>0.25?"#facc15":"#f87171"}}/>
              </div>
              <span style={{color:"#e2e8f0",fontSize:isMobile&&isLandscape?9:10}}>{hudData.hp1}</span>
            </div>
            {(hudData.mode==="2p"||hudData.mode==="online")&&(
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{color:"#e879f9",fontSize:isMobile&&isLandscape?9:10,fontWeight:700}}>P2</span>
                <div style={{width:isMobile?(isLandscape?60:70):90,height:5,background:"#0a0a1a",borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",borderRadius:3,transition:"width 0.15s",width:`${Math.max(0,(hudData.hp2/hudData.maxHp2)*100)}%`,background:"#e879f9"}}/>
                </div>
                <span style={{color:"#e2e8f0",fontSize:isMobile&&isLandscape?9:10}}>{hudData.hp2}</span>
              </div>
            )}
            <div style={{flex:1}}/>
            {hudData.mode==="survival"&&(
              <div style={{display:"flex",gap:isMobile?6:18,alignItems:"center"}}>
                <span style={{color:"#facc15",fontSize:isMobile&&isLandscape?9:isMobile?10:12,fontWeight:700}}>W{hudData.wave}</span>
                <span style={{color:"#fff",fontSize:isMobile&&isLandscape?9:isMobile?10:11}}>{hudData.score.toLocaleString()}</span>
                <span style={{color:"#facc15",fontSize:isMobile&&isLandscape?9:10}}>◆{coins}</span>
              </div>
            )}
            {(hudData.mode==="2p"||hudData.mode==="online")&&isMobile&&(
              <div style={{display:"flex",gap:6,alignItems:"center",fontSize:isMobile&&isLandscape?9:11}}>
                <span style={{color:"#22c55e",fontWeight:700}}>P1 {p1WinsRef.current}</span>
                <span style={{color:"#1e293b"}}>–</span>
                <span style={{color:"#e879f9",fontWeight:700}}>{p2WinsRef.current} P2</span>
              </div>
            )}
            <button onClick={()=>{cancelAnimationFrame(rafRef.current);if(modeRef.current==="online")cleanupOnlineRoom();setScreen("menu");}}
              style={{fontSize:10,color:"#334155",background:"transparent",border:"1px solid #0f172a",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontFamily:"'Courier New'",touchAction:"manipulation",lineHeight:1}}>✕</button>
          </div>

          <canvas ref={canvasRef} width={W} height={H} style={{border:"1px solid #0a0a1a",borderRadius:6,display:"block",touchAction:"none"}}/>

          {(!isMobile || !isLandscape) && (
            isMobile ? (
              <div style={{fontSize:9,color:"#1e293b",letterSpacing:"0.05em",textAlign:"center"}}>Left side: move · Right side: aim &amp; fire</div>
            ) : (
              <div style={{fontSize:10,color:"#1e293b",letterSpacing:"0.06em"}}>
                {hudData.mode==="survival"&&"WASD move · Space fire · Shift dash · Kill to heal"}
                {hudData.mode==="2p"&&"P1: WASD+Space+Shift · P2: Arrows+Enter+RShift"}
                {hudData.mode==="online"&&(onlineRoleRef.current==="host"?"You are P1: WASD + Space to shoot":"You are P2: Arrows + Enter to shoot")}
              </div>
            )
          )}
        </div>
      )}

      {/* ── POWERUP PICK ──────────────────────────────────────────────────── */}
      {screen==="powerup"&&(
        <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:isMobile?14:24,maxWidth:900,padding:"0 16px",width:"100%",overflowY:"auto",maxHeight:"100vh"}}>
          <div style={{textAlign:"center",paddingTop:isMobile?12:0}}>
            <div style={{fontSize:10,letterSpacing:"0.4em",color:"#22c55e",marginBottom:8}}>✓ WAVE {waveRef.current} CLEARED</div>
            <h2 style={{fontSize:isMobile?24:34,fontWeight:900,letterSpacing:"0.18em",color:"#f8fafc",margin:"0 0 4px"}}>UPGRADE</h2>
            <p style={{color:"#475569",fontSize:11,margin:0}}>Choose one — wave {waveRef.current+1} awaits</p>
          </div>
          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)",gap:isMobile?8:12,width:"100%"}}>
            {offeredPowerups.map(pu=>{
              const count=p1?.upgrades?.[pu.id]||0;
              const hov=hoveredPu===pu.id;
              const cc=catColor[pu.cat]||"#888";
              return (
                <button key={pu.id} onClick={()=>handlePowerupPick(pu.id)}
                  onMouseEnter={()=>!isMobile&&setHoveredPu(pu.id)} onMouseLeave={()=>!isMobile&&setHoveredPu(null)}
                  style={{padding:isMobile?"14px 10px":"22px 16px 18px",background:hov?"rgba(255,255,255,0.06)":"rgba(255,255,255,0.025)",border:`1.5px solid ${hov?pu.color:"#0f172a"}`,borderRadius:16,cursor:"pointer",transition:"all 0.18s ease",transform:hov?"translateY(-10px) scale(1.04)":"none",display:"flex",flexDirection:"column",alignItems:"center",gap:isMobile?6:10,position:"relative",overflow:"hidden",outline:"none",touchAction:"manipulation",WebkitTapHighlightColor:"transparent"}}>
                  <div style={{fontSize:9,letterSpacing:"0.15em",color:hov?cc:"#334155",fontWeight:700}}>{pu.cat}</div>
                  <div style={{fontSize:isMobile?28:38,lineHeight:1}}>{pu.icon}</div>
                  <div style={{fontWeight:800,fontSize:isMobile?10:12,color:hov?pu.color:"#e2e8f0",letterSpacing:"0.04em",textAlign:"center"}}>{pu.name}</div>
                  {!isMobile&&<div style={{fontSize:10,color:"#475569",textAlign:"center",lineHeight:1.7}}>{pu.desc}</div>}
                  {count>0&&<div style={{fontSize:9,color:pu.color}}>×{count}</div>}
                </button>
              );
            })}
          </div>
          {p1&&!isMobile&&(
            <div style={{display:"flex",gap:12,alignItems:"center",fontSize:11,color:"#334155",border:"1px solid #0a0a1a",borderRadius:10,padding:"10px 20px",background:"#030308",flexWrap:"wrap",justifyContent:"center",marginBottom:16}}>
              <span style={{color:"#1e293b",letterSpacing:"0.1em"}}>STATS</span>
              <span>SPD <span style={{color:"#facc15"}}>×{(p1.speedMult||1).toFixed(2)}</span></span>
              <span>CD <span style={{color:"#f97316"}}>{p1.shootCd||BASE_SHOOT_CD}ms</span></span>
              <span>DMG <span style={{color:"#ef4444"}}>{(p1.bulletDamage||BASE_DAMAGE).toFixed(0)}</span></span>
              <span>HP <span style={{color:"#4ade80"}}>{Math.round(p1.hp)}/{p1.maxHp}</span></span>
            </div>
          )}
        </div>
      )}

      {/* ── GAME OVER ─────────────────────────────────────────────────────── */}
      {screen==="over"&&(
        <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:isMobile?16:24,padding:"0 16px",textAlign:"center"}}>
          <div>
            <div style={{fontSize:10,letterSpacing:"0.5em",color:"#334155",marginBottom:14}}>— MATCH ENDED —</div>
            <h2 style={{fontSize:isMobile?28:40,fontWeight:900,color:"#facc15",letterSpacing:"0.1em",margin:0}}>{overData.title}</h2>
          </div>
          {overData.score>0&&(
            <div style={{display:"flex",gap:isMobile?20:32,alignItems:"center",flexWrap:"wrap",justifyContent:"center"}}>
              {[
                {l:"SCORE",v:overData.score?.toLocaleString(),c:"#fff"},
                {l:"BEST",v:overData.best?.toLocaleString(),c:"#facc15"},
                {l:"WAVE",v:overData.wave,c:"#38bdf8"},
                {l:"EARNED",v:`◆ ${overData.coins}`,c:"#facc15"},
              ].map((s,i)=>(
                <div key={i} style={{textAlign:"center"}}>
                  <div style={{fontSize:10,color:"#334155",letterSpacing:"0.12em",marginBottom:4}}>{s.l}</div>
                  <div style={{fontSize:isMobile?22:28,fontWeight:900,color:s.c}}>{s.v}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,auto)",gap:10,marginTop:8}}>
            {[
              {label:"▶  Play Again",accent:"#22c55e",onClick:()=>modeRef.current==="survival"?startSurvival():start2P()},
              {label:"🏆  Scores",accent:"#38bdf8",onClick:()=>{loadLeaderboard();setScreen("leaderboard");}},
              {label:"🛒  Shop",accent:"#f59e0b",onClick:()=>setScreen("shop")},
              {label:"⌂  Menu",accent:"#38bdf8",onClick:()=>setScreen("menu")},
            ].map(btn=>(
              <button key={btn.label} onClick={btn.onClick}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=btn.accent;e.currentTarget.style.color=btn.accent;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="#1e293b";e.currentTarget.style.color="#94a3b8";}}
                style={{padding:isMobile?"12px 16px":"10px 24px",background:"transparent",border:"1.5px solid #1e293b",borderRadius:10,color:"#94a3b8",cursor:"pointer",fontSize:isMobile?12:13,fontFamily:"'Courier New'",letterSpacing:"0.08em",transition:"all 0.18s",touchAction:"manipulation"}}>
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── SKILL TREE ─────────────────────────────────────────────────────── */}
      {screen2=="="="skillTree"&&(
        <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:24,padding:"0 16px",textAlign:"center",overflowY:"auto",maxHeight:"100vh"}}>
          <div>
            <h2 style={{fontSize:isMobile?24:34,fontWeight:900,color:"#22c55e",letterSpacing:"0.1em",margin:"0 0 8px"}}>SKILL TREE</h2>
            {username&&<p style={{color:"#94a3b8",fontSize:11,margin:0}}>Level {username ? (loadFullProfile(username)?.level||1) : 1} • {username ? (loadFullProfile(username)?.perkPoints||0) : 0} Points Available</p>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:16,width:"100%",maxWidth:600}}>
            {PERKS.map(perk=>(
              <button key={perk.id} onClick={()=>{
                if(!username) return;
                const prof = loadFullProfile(username);
                if((prof.perkPoints||0) >= perk.cost){
                  prof.perkPoints = (prof.perkPoints||0) - perk.cost;
                  perk.apply(prof);
                  saveFullProfile(username, prof);
                  setComboNotify({text:`Unlocked: ${perk.name}`,timer:200});
                }
              }} style={{padding:"16px",background:"rgba(34,197,94,0.08)",border:"1.5px solid #22c55e",borderRadius:16,cursor:"pointer",color:"#e2e8f0",textAlign:"left",transition:"all 0.2s"}} onMouseEnter={e=>{e.currentTarget.style.background="rgba(34,197,94,0.15)";}} onMouseLeave={e=>{e.currentTarget.style.background="rgba(34,197,94,0.08)";}}>\n                <div style={{fontSize:14,fontWeight:800,color:"#22c55e",marginBottom:4}}>{perk.name}</div>
                <div style={{fontSize:11,color:"#94a3b8",marginBottom:6}}>{perk.desc}</div>
                <div style={{fontSize:10,color:"#64748b"}}>Cost: {perk.cost} Point{perk.cost>1?"s":""}</div>
              </button>
            ))}
          </div>
          <button onClick={()=>setScreen2(null)} style={{...styles.btn,background:"rgba(255,255,255,0.08)",borderColor:"#0f172a",color:"#94a3b8"}}>← Back</button>
        </div>
      )}

      {/* ── DAILY CHALLENGE ─────────────────────────────────────────────────── */}
      {screen2=="="="dailyChallenge"&&(
        <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:28,padding:"0 16px",textAlign:"center",maxWidth:600}}>
          <div>
            <h2 style={{fontSize:isMobile?28:36,fontWeight:900,color:"#facc15",letterSpacing:"0.1em",margin:"0 0 12px"}}>DAILY CHALLENGE</h2>
            <div style={{fontSize:11,color:"#94a3b8"}}>Resets at midnight UTC</div>
          </div>
          {dailyChallenge && (
            <div style={{background:"rgba(250,204,21,0.1)",border:"2px solid #facc15",borderRadius:16,padding:"24px",width:"100%"}}>
              <div style={{fontSize:28,marginBottom:12}}>⭐</div>
              <h3 style={{fontSize:20,fontWeight:900,color:"#facc15",margin:"0 0 8px"}}>{dailyChallenge.name}</h3>
              <p style={{color:"#94a3b8",margin:0,fontSize:12}}>{dailyChallenge.desc}</p>
            </div>
          )}
          <button onClick={()=>{setScreen2(null);startSurvival();}} style={{padding:"14px 32px",background:"rgba(250,204,21,0.15)",border:"1.5px solid #facc15",borderRadius:10,color:"#facc15",cursor:"pointer",fontSize:13,fontFamily:"'Courier New'",letterSpacing:"0.1em",fontWeight:700}}>▶ START CHALLENGE</button>
          <button onClick={()=>setScreen2(null)} style={{...styles.btn,background:"rgba(255,255,255,0.08)",borderColor:"#0f172a",color:"#94a3b8"}}>← Back</button>
        </div>
      )}
      
