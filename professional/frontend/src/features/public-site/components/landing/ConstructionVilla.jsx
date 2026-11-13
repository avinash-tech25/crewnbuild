import { useEffect, useRef, useState } from "react";
import DayNightSwitch from "./DayNightSwitch.jsx";
import { buildMaterials, buildPlan, buildVilla } from "./villaGeometry.js";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";

/**
 * The villa, built in Three.js.
 *
 * Every piece of geometry is generated in code rather than loaded from a model file, so the
 * scene costs no downloads and starts the moment the bundle does. Drag to turn it; the
 * Day/Night control eases the whole environment between two lighting setups.
 */

const DAY = {
  sky: "#8fbadf",
  skyTop: "#3f7cbb",
  ground: "#9aa383",
  sun: "#fff3d8",
  sunIntensity: 2.6,
  hemisphere: 1.05,
  ambient: 0.5,
  fill: 0.75,
  glass: "#7f9db4",
  glassGlow: 0.05,
  lamp: 0,
  charcoal: "#24262a",
  wall: "#e9e1d4",
};

const NIGHT = {
  sky: "#2c3f6b",
  skyTop: "#141e3a",
  ground: "#2f3038",
  sun: "#9db4e4",
  sunIntensity: 0.55,
  hemisphere: 0.26,
  ambient: 0.16,
  fill: 0.16,
  glass: "#ffc46a",
  glassGlow: 1.05,
  lamp: 12,
  charcoal: "#3f4249",
  wall: "#9a9184",
};

// Camera sits on a fixed arc; dragging moves it around the model rather than moving the model.
const ORBIT_RADIUS = 33;
// The compound reaches further forward than back, so the orbit is centred on the plot
// rather than on the origin, which would otherwise push the gate out of shot.
const PLOT_CENTRE_Z = 1.75;
const ORBIT_HEIGHT = 0.72;
const IDLE_SPIN = 0.0009;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}


export default function ConstructionVilla({ className = "", isNight: nightFromParent, onModeChange }) {
  const hostRef = useRef(null);
  const [ownNight, setOwnNight] = useState(false);
  const isNight = nightFromParent === undefined ? ownNight : nightFromParent;

  const chooseMode = (night) => {
    if (onModeChange) onModeChange(night);
    else setOwnNight(night);
  };
  const reducedMotion = usePrefersReducedMotion();

  // The scene is built once and driven through refs, so React never re-renders on a frame.
  const nightTarget = useRef(0);
  const settings = useRef({ reducedMotion });
  settings.current = { reducedMotion };

  useEffect(() => { nightTarget.current = isNight ? 1 : 0; }, [isNight]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const build = { geometries: [], parts: [], planLines: [] };
    const materials = buildMaterials();
    const scene = new Scene();

    // The sky is a vertical gradient rather than one flat colour, so the backdrop has some
    // depth and the horizon stays light enough to read the roofline against after dark.
    const SKY_WIDTH = 512;
    const SKY_HEIGHT = 256;
    const skyCanvas = document.createElement("canvas");
    skyCanvas.width = SKY_WIDTH;
    skyCanvas.height = SKY_HEIGHT;
    const skyContext = skyCanvas.getContext("2d");
    const skyTexture = new CanvasTexture(skyCanvas);
    skyTexture.colorSpace = SRGBColorSpace;
    // Wrapped sideways so the sky can be slid round with the camera and the stars travel
    // with it rather than sitting pinned to the screen.
    skyTexture.wrapS = RepeatWrapping;
    scene.background = skyTexture;
    scene.fog = new Fog(DAY.sky, 50, 70);

    // Only the top of the backdrop is ever in shot, since the ground covers the rest, so
    // the stars sit in that band and fade out towards the bottom of it.
    const STAR_BAND = SKY_HEIGHT * 0.34;
    const stars = Array.from({ length: 240 }, () => {
      const y = Math.random() * STAR_BAND;
      return {
        x: Math.random() * SKY_WIDTH,
        y,
        size: Math.random() < 0.18 ? 2 : 1,
        brightness: (0.4 + Math.random() * 0.6) * (1 - (y / STAR_BAND) * 0.45),
      };
    });

    // Streaks that cross the sky now and then. Each starts on one side and heads for the
    // other, at its own angle and speed, so no two run the same way.
    const SHOOT_TRAVEL = 150;
    const SHOOT_TAIL = 46;
    const shootingStars = Array.from({ length: 3 }, (unused, index) => ({
      progress: 1,
      wait: 1.5 + index * 2.4,
      x: 0,
      y: 0,
      dx: 1,
      dy: 0.1,
      speed: 1,
    }));

    // Aurora curtains: each is a wavy column of colour that fades out downwards, and they
    // drift across at their own pace so the sky never settles into a fixed pattern.
    const AURORA = [
      { colour: "94, 234, 172", width: 170, speed: 9, phase: 0 },
      { colour: "120, 200, 255", width: 210, speed: -6, phase: 220 },
      { colour: "168, 148, 255", width: 130, speed: 13, phase: 400 },
    ];

    let skyTop = DAY.skyTop;
    let skyHorizon = DAY.sky;
    let starlight = 0;
    let auroraPhase = 0;
    let skyDirty = true;

    const wrapAcross = (x) => ((x % SKY_WIDTH) + SKY_WIDTH) % SKY_WIDTH;

    const paintAurora = () => {
      const depth = SKY_HEIGHT * 0.46;

      // Each curtain is drawn as a run of narrow columns. Blurring them as they go down
      // melts the columns into one sheet instead of leaving a row of hard stripes.
      skyContext.save();
      skyContext.filter = "blur(5px)";

      for (const band of AURORA) {
        const start = band.phase + auroraPhase * band.speed;

        for (let step = 0; step < band.width; step += 3) {
          const along = step / band.width;
          // Soft at both edges of the curtain, rippling along its length as it drifts.
          const edge = Math.sin(along * Math.PI);
          const ripple = 0.55 + 0.3 * Math.sin(along * 4 + auroraPhase + band.phase) + 0.15 * Math.sin(along * 11 - auroraPhase * 1.7);
          const height = depth * edge * ripple;
          const alpha = 0.26 * edge * ripple * starlight;
          // Transparent at the very top as well as the bottom, or the curtain ends flat
          // against the top of the frame and reads as a cut rather than a glow.
          const column = skyContext.createLinearGradient(0, 0, 0, height);
          column.addColorStop(0, `rgba(${band.colour}, 0)`);
          column.addColorStop(0.3, `rgba(${band.colour}, ${alpha})`);
          column.addColorStop(1, `rgba(${band.colour}, 0)`);
          skyContext.fillStyle = column;

          // The blur cannot bleed past the edge of the canvas, so a column sitting on the
          // wrap seam is drawn again on the far side to keep the curtain continuous.
          const x = wrapAcross(start + step);
          skyContext.fillRect(x, 0, 4.5, height);
          if (x < 14) skyContext.fillRect(x + SKY_WIDTH, 0, 4.5, height);
          else if (x > SKY_WIDTH - 14) skyContext.fillRect(x - SKY_WIDTH, 0, 4.5, height);
        }
      }

      skyContext.restore();
    };

    const paintSky = () => {
      const gradient = skyContext.createLinearGradient(0, 0, 0, SKY_HEIGHT);
      gradient.addColorStop(0, skyTop);
      gradient.addColorStop(0.18, skyHorizon);
      gradient.addColorStop(1, skyHorizon);
      skyContext.fillStyle = gradient;
      skyContext.fillRect(0, 0, SKY_WIDTH, SKY_HEIGHT);

      skyContext.fillStyle = "#ffffff";
      for (const star of stars) {
        skyContext.globalAlpha = star.brightness * starlight;
        skyContext.fillRect(star.x, star.y, star.size, star.size);
      }
      skyContext.globalAlpha = 1;

      if (starlight > 0.05) paintAurora();

      for (const streak of shootingStars) {
        if (streak.progress >= 1) continue;
        const headX = streak.x + streak.dx * streak.progress * SHOOT_TRAVEL;
        const headY = streak.y + streak.dy * streak.progress * SHOOT_TRAVEL;
        const tailX = headX - streak.dx * SHOOT_TAIL;
        const tailY = headY - streak.dy * SHOOT_TAIL;
        // Brightest halfway across, so each one arrives and leaves rather than blinking.
        const glow = Math.sin(streak.progress * Math.PI) * starlight;
        const trail = skyContext.createLinearGradient(tailX, tailY, headX, headY);
        trail.addColorStop(0, "rgba(255, 255, 255, 0)");
        trail.addColorStop(1, `rgba(255, 255, 255, ${glow})`);
        skyContext.strokeStyle = trail;
        skyContext.lineWidth = 1.6;
        skyContext.beginPath();
        skyContext.moveTo(tailX, tailY);
        skyContext.lineTo(headX, headY);
        skyContext.stroke();
      }

      skyTexture.needsUpdate = true;
    };

    // Moves the streaks on and reports whether any is still in flight, which is the only
    // time the sky has to be redrawn. Their timers are frozen by day.
    const advanceShootingStars = (seconds) => {
      let flying = false;

      for (const streak of shootingStars) {
        if (streak.progress >= 1) {
          if (starlight < 0.5) continue;
          streak.wait -= seconds;
          if (streak.wait > 0) continue;
          streak.progress = 0;
          streak.wait = 3 + Math.random() * 7;
          streak.x = Math.random() * SKY_WIDTH;
          streak.y = Math.random() * STAR_BAND * 0.4;
          const heading = streak.x > SKY_WIDTH / 2 ? -1 : 1;
          streak.dx = heading * (0.6 + Math.random() * 0.6);
          streak.dy = 0.05 + Math.random() * 0.12;
          streak.speed = 1.2 + Math.random() * 0.8;
        }
        streak.progress = Math.min(1, streak.progress + seconds * streak.speed);
        flying = true;
      }

      return flying;
    };

    // A near plane this close eats depth precision; the scene is only ~40 units across.
    const camera = new PerspectiveCamera(34, 1, 1, 140);
    const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.style.touchAction = "pan-y";

    const groundGeometry = new PlaneGeometry(140, 140);
    const ground = new Mesh(groundGeometry, materials.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    build.geometries.push(groundGeometry);

    const villa = buildVilla(materials, build);
    scene.add(villa);

    const plan = buildPlan(materials, build);
    scene.add(plan);

    const hemisphere = new HemisphereLight("#eaf2ff", "#8a8f88", DAY.hemisphere);
    const ambient = new AmbientLight("#ffffff", DAY.ambient);
    const sun = new DirectionalLight(DAY.sun, DAY.sunIntensity);
    sun.position.set(16, 22, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -14;
    sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.0009;
    // A cool back light, night only, so the dark roof slabs keep an edge against the sky.
    const rim = new DirectionalLight("#a8c4ff", 0);
    rim.position.set(-15, 12, -18);
    // A soft fill opposite the sun. The left flank and the whole rear of the house face
    // away from it, and without this they flatten out into one dim grey mass.
    const fill = new DirectionalLight("#c8d8ea", DAY.fill);
    fill.position.set(-16, 11, -14);
    scene.add(hemisphere, ambient, sun, rim, fill);

    // Every lamp in the scene, each with the strength it burns at relative to the night
    // level. Lights inside a room still spill onto the facades, since none of them cast
    // shadows, which is how the windows read as lit from within.
    const makeLamp = (colour, range, strength, x, y, z) => {
      const light = new PointLight(colour, 0, range, 2);
      light.position.set(x, y, z);
      light.visible = false;
      scene.add(light);
      return { light, strength };
    };

    const lamps = [
      makeLamp("#ffb45e", 16, 1.0, 2.0, 5.4, 5.2),
      makeLamp("#ffc978", 14, 0.8, -6.5, 2.4, 5.4),
      makeLamp("#ffd9a0", 22, 1.6, -0.6, 2.4, 0.4),
      makeLamp("#ffd9a0", 22, 1.6, 0.4, 6.0, -0.4),
      makeLamp("#ffca82", 18, 0.7, 6.4, 2.6, 10.4),
      makeLamp("#ffd9a0", 16, 0.9, 2.4, 9.5, 0.9),
      makeLamp("#7fd4ff", 12, 0.6, 6.7, 1.1, -4.6),
      // The wing over the garage, the yard behind the house, the side lawn and the middle
      // of the forecourt had no lamp near them at all.
      makeLamp("#ffd9a0", 18, 1.2, 7.5, 5.6, 0.55),
      makeLamp("#ffca82", 12, 0.5, 6.6, 2.4, 1.0),
      makeLamp("#ffc978", 20, 0.8, -2.0, 2.6, -5.6),
      makeLamp("#ffc978", 16, 0.6, -7.6, 2.4, -1.5),
      makeLamp("#ffc978", 18, 0.7, 0.0, 2.8, 8.0),
    ];

    paintSky();

    build.parts.sort((a, b) => a.baseY - b.baseY);

    let angle = -0.72;
    let lastFrame = performance.now();
    let lastSkyPaint = 0;
    let velocity = 0;
    let dragging = false;
    let lastX = 0;
    let night = nightTarget.current;
    let raised = 0;
    let building = false;
    let visible = true;
    let frame = 0;

    const dayColour = new Color();
    const nightColour = new Color();
    const blended = new Color();
    const mixColour = (from, to, amount) => {
      dayColour.set(from);
      nightColour.set(to);
      return blended.copy(dayColour).lerp(nightColour, amount);
    };

    const BUILD_MS = 6200;
    const SPREAD = 0.6;
    // The opening stretch marks the plan out on the ground; the walls only start to rise
    // once it is complete, and the lines fade away underneath them as they go up.
    const PLAN_SHARE = 0.36;
    const PLAN_SPREAD = 0.75;
    const RISE_START = 0.3;
    const PLAN_FADE = 0.6;

    // The plan draws itself line by line, each one growing from one end. `deck` is the top
    // of the slab as it is poured; the lines ride up on it so they stay on the floor while
    // the walls grow out of them, instead of being buried the moment the slab appears.
    const applyPlan = (progress, deck) => {
      const fade = Math.min(1, Math.max(0, (raised - PLAN_FADE) / 0.25));
      materials.planLine.opacity = 1 - fade;

      const total = build.planLines.length;
      build.planLines.forEach((line, index) => {
        const start = (index / Math.max(1, total - 1)) * PLAN_SPREAD;
        const step = Math.min(1, Math.max(0, (progress - start) / (1 - PLAN_SPREAD)));
        const drawn = Math.max(0.0001, 1 - Math.pow(1 - step, 3));
        line.mesh.scale[line.axis] = drawn;
        line.mesh.position[line.axis] = line.from + (line.length * drawn) / 2;
        line.mesh.position.y = 0.07 + deck;
        line.mesh.visible = drawn > 0.002 && fade < 1;
      });
    };

    // Each piece grows upward from its own base. The pieces were sorted by height, so the
    // villa assembles itself from the slab up rather than everything appearing at once.
    const applyBuild = () => {
      const rise = Math.max(0, (raised - RISE_START) / (1 - RISE_START));
      lamps.forEach(({ light }) => {
        light.visible = rise > 0.05;
      });

      const total = build.parts.length;
      build.parts.forEach((part, index) => {
        const start = (index / Math.max(1, total - 1)) * SPREAD;
        const step = Math.min(1, Math.max(0, (rise - start) / (1 - SPREAD)));
        const eased = 1 - Math.pow(1 - step, 3);
        const scale = Math.max(0.0001, eased);
        part.mesh.scale.y = scale;
        part.mesh.visible = eased > 0.001;
        if (!part.anchored) part.mesh.position.y = part.baseY + (part.height * scale) / 2;
      });

      // The parts are sorted by base height, so the first of them is the ground slab.
      const slab = build.parts[0];
      applyPlan(Math.min(1, raised / PLAN_SHARE), slab.height * slab.mesh.scale.y);
    };

    const applyLighting = () => {
      skyTop = mixColour(DAY.skyTop, NIGHT.skyTop, night).getStyle();
      const horizon = mixColour(DAY.sky, NIGHT.sky, night);
      skyHorizon = horizon.getStyle();
      starlight = night;
      // Marked rather than painted here: applyLighting runs every frame of the fade, and
      // redrawing the blurred aurora that often is what made switching mode crawl.
      skyDirty = true;
      scene.fog.color.copy(horizon);
      materials.ground.color.copy(mixColour(DAY.ground, NIGHT.ground, night));
      materials.glass.color.copy(mixColour(DAY.glass, NIGHT.glass, night));
      materials.glass.emissive.copy(materials.glass.color);
      materials.glass.emissiveIntensity = DAY.glassGlow + (NIGHT.glassGlow - DAY.glassGlow) * night;
      sun.color.copy(mixColour(DAY.sun, NIGHT.sun, night));
      sun.intensity = DAY.sunIntensity + (NIGHT.sunIntensity - DAY.sunIntensity) * night;
      sun.castShadow = night < 0.6;
      rim.intensity = 1.5 * night;
      fill.intensity = DAY.fill + (NIGHT.fill - DAY.fill) * night;
      materials.charcoal.color.copy(mixColour(DAY.charcoal, NIGHT.charcoal, night));
      materials.wall.color.copy(mixColour(DAY.wall, NIGHT.wall, night));
      hemisphere.intensity = DAY.hemisphere + (NIGHT.hemisphere - DAY.hemisphere) * night;
      ambient.intensity = DAY.ambient + (NIGHT.ambient - DAY.ambient) * night;
      lamps.forEach(({ light, strength }) => {
        light.intensity = NIGHT.lamp * strength * night;
      });
      materials.water.emissiveIntensity = 0.06 + 0.55 * night;
      // The sun sinks as night comes in, so the shadows lengthen on the way down.
      sun.position.set(16 - 8 * night, 22 - 16 * night, 12 + 6 * night);
    };

    const resize = () => {
      const { clientWidth, clientHeight } = host;
      if (!clientWidth || !clientHeight) return;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight, false);
    };

    const render = () => {
      const { reducedMotion: still } = settings.current;
      const now = performance.now();
      // Clamped so a tab coming back from the background does not jump the animation.
      const seconds = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;

      if (!dragging) {
        if (Math.abs(velocity) > 0.00002) {
          angle += velocity;
          velocity *= 0.94;
        } else {
          velocity = 0;
          if (!still) angle += IDLE_SPIN;
        }
      }

      if (raised < 1) {
        if (still) {
          raised = 1;
        } else if (building) {
          raised = Math.min(1, raised + (seconds * 1000) / BUILD_MS);
        }
        applyBuild();
      }

      const gap = nightTarget.current - night;
      if (Math.abs(gap) > 0.002) {
        night += gap * (still ? 0.4 : 0.1);
        applyLighting();
      } else if (night !== nightTarget.current) {
        night = nightTarget.current;
        applyLighting();
      }

      camera.position.set(
        Math.sin(angle) * ORBIT_RADIUS,
        ORBIT_RADIUS * ORBIT_HEIGHT * 0.52,
        Math.cos(angle) * ORBIT_RADIUS + PLOT_CENTRE_Z,
      );
      // Aiming below the middle of the house lifts it up the frame and leaves the
      // compound and the gate in shot along the bottom.
      camera.lookAt(0, 3.2, PLOT_CENTRE_Z);
      skyTexture.offset.x = -angle / (Math.PI * 2);

      auroraPhase += seconds;

      // A streak needs every frame to look smooth. The aurora only drifts, so it repaints a
      // few times a second rather than redrawing the whole sky on every one.
      const streaking = advanceShootingStars(seconds);
      if (streaking || ((skyDirty || starlight > 0.05) && now - lastSkyPaint > 70)) {
        paintSky();
        lastSkyPaint = now;
        skyDirty = false;
      }

      renderer.render(scene, camera);

      frame = window.requestAnimationFrame(render);
    };

    const onPointerDown = (event) => {
      dragging = true;
      lastX = event.clientX;
      velocity = 0;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grabbing";
    };

    const onPointerMove = (event) => {
      if (!dragging) return;
      const travelled = (event.clientX - lastX) * 0.006;
      angle -= travelled;
      velocity = -travelled * 0.5;
      lastX = event.clientX;
    };

    const onPointerUp = (event) => {
      if (!dragging) return;
      dragging = false;
      renderer.domElement.releasePointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grab";
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);

    const observer = new ResizeObserver(resize);
    observer.observe(host);

    // Nothing renders while the section is off screen.
    const watcher = new IntersectionObserver(
      ([entry]) => {
        const nowVisible = entry.isIntersecting;
        if (nowVisible === visible) return;
        visible = nowVisible;
        if (visible && !frame) frame = window.requestAnimationFrame(render);
        if (!visible && frame) {
          window.cancelAnimationFrame(frame);
          frame = 0;
        }
      },
      { threshold: 0.05 },
    );
    watcher.observe(host);

    // The villa waits to go up until the section has climbed into the top 60% of the
    // viewport. Trimming 40% off the bottom of the root box is what moves that line up.
    // Arriving rewinds it, so scrolling back to the section plays the build again. Leaving
    // only stops the clock — the villa stays standing while it scrolls away.
    const buildWatcher = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting === building) return;
        building = entry.isIntersecting;
        if (!building) return;
        raised = 0;
        applyBuild();
        if (!frame) frame = window.requestAnimationFrame(render);
      },
      { rootMargin: "0px 0px -40% 0px" },
    );
    buildWatcher.observe(host);

    resize();
    applyBuild();
    applyLighting();
    frame = window.requestAnimationFrame(render);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      watcher.disconnect();
      buildWatcher.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      build.geometries.forEach((geometry) => geometry.dispose());
      Object.values(materials).forEach((material) => material.dispose());
      renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      className={`relative isolate overflow-hidden rounded-3xl border border-white/15 shadow-[0_28px_44px_rgba(0,0,0,.22)] ${className}`}
    >
      <div ref={hostRef} className="h-[420px] w-full max-wide:h-[330px]" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="pointer-events-auto">
          <DayNightSwitch night={isNight} onChange={chooseMode} />
        </div>
        <p className="text-[11px] font-semibold" style={{ color: isNight ? "#ffffff" : "#17201c", opacity: 0.6 }}>
          Drag to rotate
        </p>
      </div>
    </div>
  );
}
