import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";

/**
 * Every piece of the villa, drawn from plain boxes and cylinders.
 *
 * Each helper adds its meshes to the group it is given and records them in `store`, which
 * the scene uses to drive the build-up animation and to release memory afterwards.
 */

// One box, positioned by its centre. Geometry and materials are shared by the caller.
function addBox(parent, material, width, height, depth, x, y, z, store) {
  const geometry = new BoxGeometry(width, height, depth);
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  store.geometries.push(geometry);
  store.parts.push({ mesh, baseY: y - height / 2, height, anchored: false });
  return mesh;
}

// A run of window panes along one face. `axis` says which way the run travels: "x" for the
// front elevations, "z" for the side ones. Guessing it from the pane depth put the side
// bands out in mid-air, so the caller states it.
function addWindowBand(parent, materials, count, paneWidth, height, x, y, z, depth, axis, store, facing = 1) {
  const gap = 0.16;
  const totalWidth = count * paneWidth + (count - 1) * gap;

  for (let index = 0; index < count; index += 1) {
    const offset = -totalWidth / 2 + paneWidth / 2 + index * (paneWidth + gap);
    // The frame is larger all round and set back, so the glass stands proud of it. Sharing
    // a front face with the frame makes the two surfaces fight for depth and flicker.
    const frameWidth = paneWidth + 0.2;
    const frameHeight = height + 0.2;
    const frameDepth = depth + 0.16;

    if (axis === "x") {
      addBox(parent, materials.accent, frameWidth, frameHeight, frameDepth, x + offset, y, z - 0.06 * facing, store);
      addBox(parent, materials.glass, paneWidth, height, depth, x + offset, y, z + 0.07 * facing, store);
    } else {
      addBox(parent, materials.accent, frameDepth, frameHeight, frameWidth, x - 0.06 * facing, y, z + offset, store);
      addBox(parent, materials.glass, depth, height, paneWidth, x + 0.07 * facing, y, z + offset, store);
    }
  }
}

function addTree(parent, materials, x, z, scale, store, baseY = 0.5) {
  const tree = new Group();
  tree.position.set(x, baseY, z);
  // Each tree is turned a little differently, so a row of them does not read as clones.
  tree.rotation.y = (x * 1.7 + z * 0.9) % Math.PI;

  const trunkGeometry = new CylinderGeometry(0.09 * scale, 0.18 * scale, 1.7 * scale, 6);
  const trunk = new Mesh(trunkGeometry, materials.trunk);
  trunk.position.y = 0.85 * scale;
  trunk.castShadow = true;
  tree.add(trunk);
  store.geometries.push(trunkGeometry);

  // Overlapping clumps rather than one ball. A single stretched sphere reads as a balloon;
  // four offset ones give the canopy an uneven silhouette.
  const canopy = [
    { radius: 0.8, x: 0, y: 2.1, z: 0, material: materials.foliage },
    { radius: 0.56, x: 0.36, y: 2.62, z: -0.14, material: materials.foliage },
    { radius: 0.52, x: -0.44, y: 1.86, z: 0.3, material: materials.foliageDeep },
    { radius: 0.44, x: 0.22, y: 1.78, z: -0.4, material: materials.foliageDeep },
  ];

  for (const clump of canopy) {
    const geometry = new SphereGeometry(clump.radius * scale, 7, 5);
    const blob = new Mesh(geometry, clump.material);
    blob.position.set(clump.x * scale, clump.y * scale, clump.z * scale);
    blob.castShadow = true;
    tree.add(blob);
    store.geometries.push(geometry);
  }

  parent.add(tree);
  store.parts.push({ mesh: tree, baseY, height: 3.2 * scale, anchored: true });
}

// A frame swing on the roof terrace. Built as one group so the seat and its hangers rise
// together instead of each piece growing from its own base.
function addSwing(parent, materials, x, z, baseY, store) {
  const swing = new Group();
  swing.position.set(x, baseY, z);

  const piece = (material, width, height, depth, px, py, pz) => {
    const geometry = new BoxGeometry(width, height, depth);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    swing.add(mesh);
    store.geometries.push(geometry);
  };

  piece(materials.charcoal, 0.14, 1.8, 0.14, -1.1, 0.9, 0);
  piece(materials.charcoal, 0.14, 1.8, 0.14, 1.1, 0.9, 0);
  piece(materials.charcoal, 2.5, 0.15, 0.15, 0, 1.77, 0);
  piece(materials.charcoal, 0.06, 1.15, 0.06, -0.72, 1.14, 0);
  piece(materials.charcoal, 0.06, 1.15, 0.06, 0.72, 1.14, 0);
  piece(materials.accent, 1.7, 0.1, 0.52, 0, 0.58, 0);
  piece(materials.accent, 1.7, 0.42, 0.08, 0, 0.8, -0.22);

  // Festoon lights slung under the beam; they use the window material so they come on at night.
  for (let index = 0; index < 6; index += 1) {
    piece(materials.glass, 0.12, 0.14, 0.12, -1.0 + index * 0.4, 1.63, 0);
  }

  parent.add(swing);
  store.parts.push({ mesh: swing, baseY, height: 1.9, anchored: true });
}

// A compound-wall pier carrying a lamp. The lamp head uses the window material, so it
// lights up with the rest of the house after dark.
function addPier(parent, materials, x, z, store) {
  addBox(parent, materials.plinth, 0.55, 1.5, 0.55, x, 1.25, z, store);
  addBox(parent, materials.accent, 0.64, 0.1, 0.64, x, 2.03, z, store);
  addBox(parent, materials.glass, 0.3, 0.34, 0.3, x, 2.24, z, store);
  addBox(parent, materials.charcoal, 0.4, 0.08, 0.4, x, 2.44, z, store);
}

// The car is one group anchored at the ground, so the build sequence raises it whole
// rather than stretching its wheels.
function addCar(parent, materials, x, z, store) {
  const car = new Group();
  car.position.set(x, 0.5, z);

  const piece = (material, width, height, depth, px, py, pz) => {
    const geometry = new BoxGeometry(width, height, depth);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    car.add(mesh);
    store.geometries.push(geometry);
  };

  piece(materials.car, 1.8, 0.62, 3.8, 0, 0.62, 0);
  piece(materials.car, 1.56, 0.56, 1.9, 0, 1.18, -0.2);
  piece(materials.carGlass, 1.58, 0.4, 0.12, 0, 1.2, 0.74);
  piece(materials.carGlass, 1.58, 0.4, 0.12, 0, 1.2, -1.14);
  piece(materials.carGlass, 0.12, 0.38, 1.7, 0.79, 1.2, -0.2);
  piece(materials.carGlass, 0.12, 0.38, 1.7, -0.79, 1.2, -0.2);
  // Plain housings, not the window material, so the car never lights up.
  piece(materials.plinth, 0.42, 0.2, 0.1, 0.58, 0.72, 1.92);
  piece(materials.plinth, 0.42, 0.2, 0.1, -0.58, 0.72, 1.92);

  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      const geometry = new CylinderGeometry(0.34, 0.34, 0.26, 12);
      const wheel = new Mesh(geometry, materials.tyre);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 0.9, 0.34, end * 1.3);
      wheel.castShadow = true;
      car.add(wheel);
      store.geometries.push(geometry);
    }
  }

  parent.add(car);
  store.parts.push({ mesh: car, baseY: 0.5, height: 1.6, anchored: true });
}

// A field of paving laid in two tones, with a joint left between tiles so the pattern
// reads from a distance rather than turning into one flat slab.
function addPaving(parent, materials, area, store) {
  const step = area.size + 0.09;
  for (let row = 0; row < area.rows; row += 1) {
    for (let column = 0; column < area.columns; column += 1) {
      const tone = (row + column) % 2 === 0 ? materials.tilePale : materials.tileWarm;
      addBox(
        parent,
        tone,
        area.size,
        0.07,
        area.size,
        area.x + column * step,
        0.53,
        area.z + row * step,
        store,
      );
    }
  }
}

// A timber panel tucked under a roof slab. Where the roof overhangs, this underside is the
// part you actually see, so it carries the warm walnut that sets the tone of the elevation.
function addSoffit(parent, materials, width, depth, x, slabBottom, z, store) {
  addBox(parent, materials.timber, width, 0.07, depth, x, slabBottom - 0.025, z, store);
}

// Downlights recessed into a soffit. They share the window material, so they warm up along
// with the rest of the house after dark.
function addDownlights(parent, materials, count, spacing, x, y, z, store) {
  for (let index = 0; index < count; index += 1) {
    addBox(parent, materials.glass, 0.2, 0.05, 0.2, x + index * spacing, y, z, store);
  }
}


// A round column, registered like any box so the build sequence raises it the same way.
function addColumn(parent, material, radius, height, x, y, z, store) {
  const geometry = new CylinderGeometry(radius, radius, height, 20);
  const column = new Mesh(geometry, material);
  column.position.set(x, y, z);
  column.castShadow = true;
  column.receiveShadow = true;
  parent.add(column);
  store.geometries.push(geometry);
  store.parts.push({ mesh: column, baseY: y - height / 2, height, anchored: false });
}

// Sliding glass doors onto the back garden: two full-height panes in a bronze surround
// with a meeting stile between them. The rear wall faces the other way, so every piece
// stands proud on the negative side of it.
function addGlassDoor(parent, materials, x, z, store) {
  addBox(parent, materials.accent, 3.5, 2.95, 0.2, x, 1.98, z - 0.02, store);
  addBox(parent, materials.accent, 3.5, 0.1, 0.34, x, 0.53, z - 0.1, store);

  for (const side of [-1, 1]) {
    addBox(parent, materials.glass, 1.62, 2.7, 0.12, x + side * 0.87, 1.95, z - 0.16, store);
    addBox(parent, materials.accent, 0.06, 0.9, 0.08, x + side * 0.25, 1.9, z - 0.25, store);
  }

  addBox(parent, materials.accent, 0.14, 2.7, 0.16, x, 1.95, z - 0.17, store);
}

// The main entrance: a pair of tall timber leaves in a bronze surround, with a glazed
// transom over them so the doorway lights up under the portico after dark.
function addEntranceDoor(parent, materials, x, z, store) {
  addBox(parent, materials.accent, 2.9, 3.45, 0.2, x, 2.08, z + 0.02, store);

  for (const side of [-1, 1]) {
    addBox(parent, materials.timber, 1.26, 2.6, 0.14, x + side * 0.66, 1.85, z + 0.16, store);
    addBox(parent, materials.accent, 0.07, 1.5, 0.09, x + side * 0.23, 1.9, z + 0.25, store);
  }

  addBox(parent, materials.glass, 2.58, 0.5, 0.12, x, 3.42, z + 0.16, store);
}

// A planting trough, run along the balcony edge so the first floor is not a bare rail.
function addPlanter(parent, materials, width, x, y, z, store) {
  addBox(parent, materials.timber, width, 0.42, 0.5, x, y, z, store);
  addBox(parent, materials.foliage, width - 0.3, 0.34, 0.42, x, y + 0.35, z, store);
}

// A low safety wall with a capping rail, used around the roof and the balcony.
function addParapet(parent, materials, width, height, depth, x, y, z, store) {
  addBox(parent, materials.wall, width, height, depth, x, y, z, store);
  addBox(parent, materials.accent, width + 0.08, 0.14, depth + 0.08, x, y + height / 2 + 0.04, z, store);
}

// The gym over the garage. The garage deck is carried up to first-floor level so the two
// halves of the house join, and the room on top runs into the side wall and tucks under
// the main roof, which is what makes it read as part of the first floor.
function addGymWing(parent, materials, store) {
  addBox(parent, materials.wall, 3.2, 3.04, 4.1, 7.5, 5.62, 0.55, store);
  addWindowBand(parent, materials, 1, 1.5, 2.2, 8.2, 5.7, 2.65, 0.12, "x", store);
  addWindowBand(parent, materials, 2, 1.4, 2.2, 9.05, 5.7, 0.55, 0.12, "z", store);

  // Door out onto the terrace the raised deck leaves in front of the gym.
  addBox(parent, materials.accent, 1.26, 2.12, 0.1, 6.6, 5.16, 2.63, store);
  addBox(parent, materials.glass, 1.0, 1.92, 0.12, 6.6, 5.12, 2.7, store);

  addBox(parent, materials.charcoal, 3.5, 0.38, 5.2, 7.6, 7.29, 0.6, store);
  addSoffit(parent, materials, 3.0, 4.7, 7.6, 7.1, 0.6, store);
  addBox(parent, materials.accent, 3.6, 0.07, 0.08, 7.6, 7.13, 3.21, store);
  addDownlights(parent, materials, 3, 1.1, 6.6, 7.01, 2.8, store);

  addParapet(parent, materials, 4.5, 0.7, 0.2, 7.05, 4.45, 3.85, store);
  addParapet(parent, materials, 0.2, 0.7, 1.5, 9.15, 4.45, 3.15, store);
}

// A modern entrance gate: two leaves of horizontal slats hung between the driveway posts,
// with a lit reveal down the joint so the entrance shows up after dark.
function addGate(parent, materials, x, z, store) {
  for (const side of [-1, 1]) {
    const leaf = x + side * 1.25;
    addBox(parent, materials.charcoal, 2.42, 1.9, 0.16, leaf, 1.45, z, store);
    for (let index = 0; index < 8; index += 1) {
      addBox(parent, materials.accent, 2.3, 0.14, 0.22, leaf, 0.66 + index * 0.22, z, store);
    }
  }
  addBox(parent, materials.glass, 0.12, 1.9, 0.26, x, 1.45, z, store);
}

// A chandelier for the double-height entrance: a drop rod carrying three tiers of glass
// pieces. They use the window material, so the fitting lights with the rest of the house.
function addChandelier(parent, materials, x, ceiling, z, store) {
  addBox(parent, materials.charcoal, 0.08, 2.54, 0.08, x, ceiling - 1.23, z, store);

  const tiers = [
    { radius: 0.62, drop: 1.6, count: 10 },
    { radius: 0.42, drop: 2.1, count: 8 },
    { radius: 0.22, drop: 2.5, count: 5 },
  ];

  for (const tier of tiers) {
    const plate = tier.radius * 2;
    addBox(parent, materials.charcoal, plate, 0.06, plate, x, ceiling - tier.drop + 0.15, z, store);

    for (let index = 0; index < tier.count; index += 1) {
      const angle = (index / tier.count) * Math.PI * 2;
      const dropX = x + Math.cos(angle) * tier.radius;
      const dropZ = z + Math.sin(angle) * tier.radius;
      addBox(parent, materials.glass, 0.1, 0.34, 0.1, dropX, ceiling - tier.drop, dropZ, store);
    }
  }
}

// One line of the setting-out plan, lying on the ground. It grows from its lower end, so
// the plan looks like it is being marked out rather than switched on.
function addPlanLine(parent, material, axis, length, x, z, store) {
  const width = axis === "x" ? length : 0.12;
  const depth = axis === "x" ? 0.12 : length;
  const geometry = new BoxGeometry(width, 0.04, depth);
  const line = new Mesh(geometry, material);
  line.position.set(x, 0.04, z);
  parent.add(line);
  store.geometries.push(geometry);
  const from = (axis === "x" ? x : z) - length / 2;
  store.planLines.push({ mesh: line, axis, length, from });
}

// The four sides of a room, a boundary or any other rectangle on the plan.
function addPlanRoom(parent, material, minX, minZ, maxX, maxZ, store) {
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  addPlanLine(parent, material, "x", maxX - minX, midX, minZ, store);
  addPlanLine(parent, material, "x", maxX - minX, midX, maxZ, store);
  addPlanLine(parent, material, "z", maxZ - minZ, minX, midZ, store);
  addPlanLine(parent, material, "z", maxZ - minZ, maxX, midZ, store);
}

// The floor plan, set out on the ground before anything is built. The order the lines are
// added in is the order they are drawn: the boundary, then the house, then the rooms.
export function buildPlan(materials, store) {
  const plan = new Group();
  const line = materials.planLine;

  addPlanRoom(plan, line, -9.85, -7.45, 9.85, 10.95, store);
  addPlanRoom(plan, line, -5.6, -3.3, 4.4, 4.1, store);
  addPlanRoom(plan, line, 4.4, -1.5, 9.0, 3.8, store);
  addPlanRoom(plan, line, 4.7, -6.5, 8.7, -2.7, store);

  // Rooms inside the house.
  addPlanLine(plan, line, "x", 10.0, -0.6, 0.2, store);
  addPlanLine(plan, line, "z", 3.5, -1.8, -1.55, store);
  addPlanLine(plan, line, "z", 3.9, 1.4, 2.15, store);
  addPlanLine(plan, line, "x", 4.4, -3.4, 2.0, store);

  // Steps and drive.
  addPlanLine(plan, line, "x", 5.2, 1.2, 6.2, store);
  addPlanLine(plan, line, "z", 6.7, 4.3, 7.15, store);
  addPlanLine(plan, line, "z", 6.7, 8.9, 7.15, store);

  return plan;
}

// The whole villa, returned as one group so the camera can orbit around its centre.
export function buildVilla(materials, store) {
  const villa = new Group();

  addBox(villa, materials.plinth, 20, 0.5, 18.5, 0, 0.25, 1.75, store);
  addBox(villa, materials.wall, 10, 3.4, 7.4, -0.6, 2.18, 0.4, store);
  addBox(villa, materials.charcoal, 11, 0.35, 8.4, -0.6, 4.05, 0.4, store);
  addBox(villa, materials.wall, 11.4, 3.2, 6.4, 0.4, 5.85, -0.4, store);
  addBox(villa, materials.charcoal, 12.4, 0.4, 7.4, 0.4, 7.63, -0.4, store);

  addSoffit(villa, materials, 10.5, 7.9, -0.6, 3.875, 0.4, store);
  addSoffit(villa, materials, 11.9, 6.9, 0.4, 7.43, -0.4, store);
  addBox(villa, materials.accent, 11.1, 0.07, 0.08, -0.6, 3.905, 4.61, store);
  addBox(villa, materials.accent, 12.5, 0.07, 0.08, 0.4, 7.46, 3.31, store);
  addDownlights(villa, materials, 7, 1.7, -4.6, 7.34, 2.93, store);

  // Ground-floor glazing on the two faces the camera sweeps past.
  addWindowBand(villa, materials, 3, 1.7, 2.3, -2.33, 2.2, 4.15, 0.12, "x", store);
  addWindowBand(villa, materials, 3, 1.6, 2.3, -5.6, 2.2, 0.4, 0.12, "z", store, -1);

  // Upper glazing, taller and continuous.
  addWindowBand(villa, materials, 4, 1.7, 2.2, 1.0, 5.9, 2.9, 0.12, "x", store);
  addWindowBand(villa, materials, 1, 1.5, 2.2, 6.2, 5.9, -2.4, 0.12, "z", store);


  addBox(villa, materials.accent, 1.5, 3.2, 0.3, 4.4, 2.1, 4.2, store);
  addEntranceDoor(villa, materials, 2.05, 4.1, store);

  // Steps and terrace.
  addBox(villa, materials.plinth, 4.4, 0.22, 1.5, 1.2, 0.6, 5.4, store);
  addBox(villa, materials.plinth, 5.2, 0.22, 1.5, 1.2, 0.42, 6.2, store);
  addBox(villa, materials.charcoal, 6.4, 0.14, 0.14, -1.4, 3.9, 4.2, store);

  // Low boundary wall and planters.
  // Rear elevation: glass doors onto the garden below, a window band and a small balcony above.
  addGlassDoor(villa, materials, -0.6, -3.3, store);
  addWindowBand(villa, materials, 2, 1.6, 2.2, -0.6, 5.9, -3.65, 0.12, "x", store, -1);
    // First-floor door onto the rear balcony. Glazed, so it lights up with the house.
    addBox(villa, materials.accent, 1.26, 2.12, 0.1, 2.2, 5.46, -3.63, store);
    addBox(villa, materials.glass, 1.0, 1.92, 0.12, 2.2, 5.42, -3.7, store);

  addBox(villa, materials.charcoal, 5.8, 0.25, 1.7, 0.4, 4.33, -4.45, store);
  addParapet(villa, materials, 5.8, 0.75, 0.2, 0.4, 4.83, -5.2, store);
  addParapet(villa, materials, 0.2, 0.75, 1.7, -2.4, 4.83, -4.45, store);
  addParapet(villa, materials, 0.2, 0.75, 1.7, 3.2, 4.83, -4.45, store);

  // Roof terrace: a lawn deck, planters, a couple of shrubs and a swing.
  addBox(villa, materials.foliage, 6.8, 0.1, 5.2, 2.6, 7.89, 0.2, store);
  addBox(villa, materials.foliage, 4.2, 0.36, 0.7, 2.6, 8.1, 2.5, store);
  addBox(villa, materials.foliage, 0.7, 0.36, 3.2, 5.7, 8.1, 0.2, store);
  addTree(villa, materials, 5.6, 2.3, 0.5, store, 7.93);
  addTree(villa, materials, -0.4, -2.4, 0.42, store, 7.93);
  addSwing(villa, materials, 2.4, 0.9, 7.93, store);

  // Lanterns standing along the terrace edge.
  addBox(villa, materials.glass, 0.18, 0.26, 0.18, -0.6, 8.08, 2.5, store);
  addBox(villa, materials.glass, 0.18, 0.26, 0.18, 5.7, 8.08, -2.2, store);

  // Compound wall around the plot, broken at the driveway, with lamp piers and a run of
  // small lights along the front.
  addBox(villa, materials.plinth, 13.7, 1.1, 0.3, -2.85, 1.05, 10.8, store);
  addBox(villa, materials.plinth, 0.9, 1.1, 0.3, 9.25, 1.05, 10.8, store);
  addBox(villa, materials.plinth, 19.4, 1.1, 0.3, 0, 1.05, -7.3, store);
  addBox(villa, materials.plinth, 0.3, 1.1, 18.4, -9.7, 1.05, 1.75, store);
  addBox(villa, materials.plinth, 0.3, 1.1, 18.4, 9.7, 1.05, 1.75, store);

  addPier(villa, materials, -9.7, 10.8, store);
  addPier(villa, materials, -5.0, 10.8, store);
  addPier(villa, materials, -0.3, 10.8, store);
  addPier(villa, materials, 4.1, 10.8, store);
  addPier(villa, materials, 8.9, 10.8, store);
  addPier(villa, materials, 9.7, 10.8, store);
  addGate(villa, materials, 6.4, 10.8, store);
  addPier(villa, materials, -9.7, -7.3, store);
  addPier(villa, materials, 9.7, -7.3, store);

  // Decoration lights strung along the top of the front wall.
  for (let index = 0; index < 8; index += 1) {
    addBox(villa, materials.glass, 0.16, 0.18, 0.16, -8.6 + index * 1.62, 1.68, 10.8, store);
  }
  addBox(villa, materials.foliage, 5.5, 0.5, 1.2, -5.5, 0.75, 5.6, store);

  // Entrance portico: the two stone columns now run the full height of the house and carry
  // the roof forward over the door, so the front reads as one tall opening rather than a
  // porch stuck on the ground floor.
  addColumn(villa, materials.stone, 0.4, 7.0, -0.4, 3.995, 5.8, store);
  addColumn(villa, materials.stone, 0.4, 7.0, 4.3, 3.995, 5.8, store);
  addBox(villa, materials.charcoal, 6.0, 0.46, 3.3, 2.0, 7.63, 4.55, store);
  addSoffit(villa, materials, 5.6, 2.9, 2.0, 7.4, 4.55, store);
  addBox(villa, materials.accent, 6.1, 0.07, 0.08, 2.0, 7.44, 6.21, store);
  addDownlights(villa, materials, 4, 1.3, 0.4, 7.31, 5.4, store);
  addChandelier(villa, materials, 2.0, 7.34, 5.2, store);

  // A bay projecting from the upper floor, with its own capping band.
  addBox(villa, materials.wall, 2.2, 2.6, 0.8, -4.2, 5.9, 3.1, store);
  addBox(villa, materials.charcoal, 2.5, 0.24, 1.0, -4.2, 7.29, 3.15, store);

  // Stair enclosure standing on the roof.
  addBox(villa, materials.wall, 3.0, 2.3, 3.0, -3.0, 9.0, -1.2, store);
    // Door onto the terrace: bronze frame, solid leaf, like the entrance below.
    addBox(villa, materials.accent, 1.16, 2.1, 0.1, -3.0, 8.86, 0.31, store);
    addBox(villa, materials.charcoal, 0.92, 1.86, 0.12, -3.0, 8.8, 0.37, store);
  addBox(villa, materials.charcoal, 3.3, 0.24, 3.3, -3.0, 10.24, -1.2, store);

  // Safety wall around the roof.
  addParapet(villa, materials, 12.4, 0.7, 0.25, 0.4, 8.2, 3.175, store);
  addParapet(villa, materials, 12.4, 0.7, 0.25, 0.4, 8.2, -3.975, store);
  addParapet(villa, materials, 0.25, 0.7, 7.4, -5.275, 8.2, -0.4, store);
  addParapet(villa, materials, 0.25, 0.7, 7.4, 6.475, 8.2, -0.4, store);

  // Safety wall around the first-floor balcony.
  addParapet(villa, materials, 11, 0.75, 0.2, -0.6, 4.6, 4.5, store);
  addParapet(villa, materials, 0.2, 0.75, 1.8, -6.0, 4.6, 3.7, store);
  addParapet(villa, materials, 0.2, 0.75, 1.8, 4.8, 4.6, 3.7, store);
  addPlanter(villa, materials, 10.2, -0.6, 4.44, 4.05, store);

  // Garage attached to the right flank, tucked under the cantilevered upper floor.
  addBox(villa, materials.wall, 0.28, 3.35, 5.0, 8.86, 2.175, 1.0, store);
  addBox(villa, materials.wall, 4.75, 3.35, 0.28, 6.62, 2.175, -1.36, store);
  addBox(villa, materials.charcoal, 5.4, 0.34, 5.8, 6.65, 3.98, 1.05, store);
  addBox(villa, materials.accent, 5.5, 0.16, 0.3, 6.65, 3.86, 3.9, store);
  addSoffit(villa, materials, 4.2, 4.5, 6.5, 3.81, 1.15, store);
  addGymWing(villa, materials, store);
  addCar(villa, materials, 6.6, 1.1, store);
  addBox(villa, materials.plinth, 4.6, 0.08, 6.7, 6.6, 0.53, 7.15, store);

  // Ground finishes inside the compound: lawn down the open flank, paving across the rear
  // and a border band following the wall.
  addBox(villa, materials.grass, 3.6, 0.07, 16.9, -7.6, 0.525, 1.55, store);

  addPaving(villa, materials, { x: -4.6, z: -6.2, columns: 5, rows: 2, size: 1.6 }, store);
  addPaving(villa, materials, { x: -4.0, z: 5.2, columns: 5, rows: 3, size: 1.6 }, store);

  addBox(villa, materials.tileBand, 19.1, 0.07, 0.5, 0, 0.515, 10.35, store);
  addBox(villa, materials.tileBand, 19.1, 0.07, 0.5, 0, 0.515, -6.85, store);
  addBox(villa, materials.tileBand, 0.5, 0.07, 17.2, -9.25, 0.515, 1.75, store);
  addBox(villa, materials.tileBand, 0.5, 0.07, 17.2, 9.25, 0.515, 1.75, store);

  // Swimming pool in the rear corner, behind the garage: a coping ring with the water set
  // just below it, so the edge reads as a lip rather than a painted rectangle.
  addBox(villa, materials.plinth, 4.4, 0.18, 0.4, 6.7, 0.59, -2.7, store);
  addBox(villa, materials.plinth, 4.4, 0.18, 0.4, 6.7, 0.59, -6.5, store);
  addBox(villa, materials.plinth, 0.4, 0.18, 3.8, 4.7, 0.59, -4.6, store);
  addBox(villa, materials.plinth, 0.4, 0.18, 3.8, 8.7, 0.59, -4.6, store);
  addBox(villa, materials.water, 3.6, 0.12, 3.4, 6.7, 0.56, -4.6, store);

  addTree(villa, materials, -7.6, 4.6, 1.15, store);
  addTree(villa, materials, -7.4, 8.8, 1.05, store);
  addTree(villa, materials, 3.6, 9.5, 0.8, store);
  addTree(villa, materials, -8.4, -2.4, 0.9, store);

  return villa;
}

export function buildMaterials() {
  return {
    plinth: new MeshStandardMaterial({ color: "#cfc4b3", roughness: 0.95 }),
    wall: new MeshStandardMaterial({ color: "#e9e1d4", roughness: 0.82 }),
    charcoal: new MeshStandardMaterial({ color: "#24262a", roughness: 0.7 }),
    accent: new MeshStandardMaterial({ color: "#9c6b39", roughness: 0.42, metalness: 0.35 }),
    timber: new MeshStandardMaterial({ color: "#6f4526", roughness: 0.62 }),
    stone: new MeshStandardMaterial({ color: "#c2ab93", roughness: 0.88 }),
    trunk: new MeshStandardMaterial({ color: "#5a4530", roughness: 1 }),
    car: new MeshStandardMaterial({ color: "#c0392b", roughness: 0.42, metalness: 0.18 }),
    carGlass: new MeshStandardMaterial({ color: "#2b3440", roughness: 0.2, metalness: 0.35 }),
    tyre: new MeshStandardMaterial({ color: "#20242a", roughness: 0.9 }),
    tilePale: new MeshStandardMaterial({ color: "#ded2c1", roughness: 0.85 }),
    tileWarm: new MeshStandardMaterial({ color: "#c3b5a2", roughness: 0.9 }),
    tileBand: new MeshStandardMaterial({ color: "#a3937f", roughness: 0.95 }),
    grass: new MeshStandardMaterial({ color: "#748c52", roughness: 1 }),
    water: new MeshStandardMaterial({
      color: "#2f93c4",
      roughness: 0.08,
      metalness: 0.3,
      emissive: new Color("#1d6f96"),
      emissiveIntensity: 0.06,
    }),
    foliage: new MeshStandardMaterial({ color: "#5f7a45", roughness: 1 }),
    foliageDeep: new MeshStandardMaterial({ color: "#3f5730", roughness: 1 }),
    glass: new MeshStandardMaterial({
      color: "#7f9db4",
      roughness: 0.18,
      metalness: 0.1,
      emissive: new Color("#7f9db4"),
      emissiveIntensity: 0.05,
    }),
    ground: new MeshStandardMaterial({ color: "#bbb0a0", roughness: 1 }),
    planLine: new MeshStandardMaterial({
      color: "#f0b323",
      emissive: new Color("#f0b323"),
      emissiveIntensity: 0.9,
      roughness: 0.6,
      transparent: true,
    }),
  };
}
