// Family Tree D3.js Visualization — draggable nodes with union points
(function () {
  const container = document.getElementById("tree-container");
  if (!container) return;

  const familyId = container.dataset.familyId;
  const width = container.clientWidth;
  const height = container.clientHeight;

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const g = svg.append("g");

  // Pan and zoom (pan via drag on background, zoom only via buttons)
  const zoomBehavior = d3
    .zoom()
    .scaleExtent([0.3, 2])
    .filter((event) => {
      if (event.type === "mousedown" || event.type === "touchstart") {
        var el = event.target;
        while (el && el !== svg.node()) {
          if (el.classList && el.classList.contains("node")) return false;
          el = el.parentNode;
        }
        return true;
      }
      return false;
    })
    .on("zoom", (event) => {
      g.attr("transform", event.transform);
    });
  svg.call(zoomBehavior);

  let fitTransform = d3.zoomIdentity;

  // Zoom controls
  const controls = document.createElement("div");
  controls.className = "tree-zoom-controls";
  controls.innerHTML = `
    <button id="zoom-in" title="Zoom in">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="6" x2="12" y2="18"/><line x1="6" y1="12" x2="18" y2="12"/></svg>
    </button>
    <button id="zoom-out" title="Zoom out">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="12" x2="18" y2="12"/></svg>
    </button>
    <button id="zoom-reset" title="Reset view">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
    </button>
  `;
  container.style.position = "relative";
  container.appendChild(controls);

  document.getElementById("zoom-in").addEventListener("click", () => {
    svg.transition().duration(250).call(zoomBehavior.scaleBy, 1.3);
  });
  document.getElementById("zoom-out").addEventListener("click", () => {
    svg.transition().duration(250).call(zoomBehavior.scaleBy, 0.7);
  });
  document.getElementById("zoom-reset").addEventListener("click", () => {
    svg.transition().duration(400).call(zoomBehavior.transform, fitTransform);
  });

  const NODE_WIDTH = 190;
  const NODE_HEIGHT = 56;
  const H_GAP = 50;   // horizontal gap between sibling nodes
  const V_GAP = 120;  // vertical gap between generations

  // Mutable positions keyed by id (person ids + synthetic union ids)
  var nodePositions = {};
  // Edges: { type, from, to, el }
  var edges = [];
  // Union nodes: keyed by union id, tracks { personId, spouseId, dotEl }
  var unionNodes = {};

  function unionId(p1, p2) {
    return "union_" + Math.min(p1, p2) + "_" + Math.max(p1, p2);
  }

  function computeUnionPos(uid) {
    var u = unionNodes[uid];
    if (!u) return;
    var p1 = nodePositions[u.personId];
    var p2 = nodePositions[u.spouseId];
    if (!p1 || !p2) return;
    nodePositions[uid].x = (p1.x + p2.x) / 2;
    nodePositions[uid].y = (p1.y + p2.y) / 2;
  }

  function loadTree() {
    d3.json("/family/" + familyId + "/api/tree").then((data) => {
      if (!data || !data.nodes || data.nodes.length === 0) {
        g.selectAll("*").remove();
        g.append("text")
          .attr("x", width / 2)
          .attr("y", height / 2)
          .attr("text-anchor", "middle")
          .attr("fill", "#8b7a5e")
          .text("No family data yet. Add some people to get started!");
        return;
      }
      renderTree(data);
    });
  }

  function renderTree(data) {
    g.selectAll("*").remove();
    nodePositions = {};
    edges = [];
    unionNodes = {};

    var peopleById = {};
    data.nodes.forEach(function(p) { peopleById[p.id] = p; });

    // Build parent lookup: child_id → [from_id, ...] (from_id may be a union uid or person id)
    var parentsOf = {};   // child_id → from_id (string or int)
    var childrenOf = {};  // from_id (string|int) → [child_id, ...]
    data.edges.forEach(function(e) {
      parentsOf[e.child] = e.from;
      if (!childrenOf[e.from]) childrenOf[e.from] = [];
      childrenOf[e.from].push(e.child);
    });

    // Build union lookup
    var unionByUid = {};
    data.unions.forEach(function(u) {
      unionByUid[u.uid] = u;
      unionNodes[u.uid] = { personId: u.p1, spouseId: u.p2 };
    });

    // Build spouse lookup: person_id → [spouse_id, ...]
    var spousesOf = {};
    data.unions.forEach(function(u) {
      if (!spousesOf[u.p1]) spousesOf[u.p1] = [];
      if (!spousesOf[u.p2]) spousesOf[u.p2] = [];
      spousesOf[u.p1].push(u.p2);
      spousesOf[u.p2].push(u.p1);
    });

    // --- Generational layout ---

    // Step 1: assign generation to each person
    // A person's generation = max(parent generations) + 1; parentless = 0
    var gen = {};
    var personIds = data.nodes.map(function(p) { return p.id; });

    // We need to resolve generations respecting parent->child order.
    // Use iterative relaxation (handles any DAG).
    personIds.forEach(function(id) { gen[id] = 0; });

    var changed = true;
    var iters = 0;
    while (changed && iters < 100) {
      changed = false;
      iters++;
      data.edges.forEach(function(e) {
        var fromId = e.from;
        var childId = e.child;
        // resolve parent generation: if from is a union, use the max of the two parents
        var parentGen;
        if (typeof fromId === 'string' && fromId.startsWith('union_')) {
          var u = unionByUid[fromId];
          parentGen = u ? Math.max(gen[u.p1] || 0, gen[u.p2] || 0) : 0;
        } else {
          parentGen = gen[fromId] || 0;
        }
        if ((gen[childId] || 0) <= parentGen) {
          gen[childId] = parentGen + 1;
          changed = true;
        }
      });
    }

    // Step 2: group people by generation
    var byGen = {};
    personIds.forEach(function(id) {
      var g_ = gen[id] || 0;
      if (!byGen[g_]) byGen[g_] = [];
      byGen[g_].push(id);
    });

    // Step 3: order within each generation — sort by average parent x (computed iteratively)
    // For gen 0, keep insertion order. For later gens, sort by parent position.
    var sortedGens = Object.keys(byGen).map(Number).sort(function(a, b) { return a - b; });

    // Step 4: assign x positions
    // Strategy: for each generation, space nodes out. Married couples are placed adjacent.
    // We'll place nodes left-to-right, skipping a slot for spouse adjacency.

    var SLOT = NODE_WIDTH + H_GAP;

    // Track which people have been x-positioned already (spouses placed inline)
    var xAssigned = {};
    var tempX = {};  // id → x (in slot units, before centering)

    sortedGens.forEach(function(g_) {
      var members = byGen[g_].slice();

      // Sort members by their parents' x to reduce edge crossings
      members.sort(function(a, b) {
        var ax = _parentX(a);
        var bx = _parentX(b);
        return ax - bx;
      });

      // Assign slots, placing spouses adjacent
      var slots = [];
      var placed = {};
      members.forEach(function(id) {
        if (placed[id]) return;
        slots.push(id);
        placed[id] = true;
        // If this person has a spouse in the same generation, place them next
        (spousesOf[id] || []).forEach(function(sid) {
          if (gen[sid] === g_ && !placed[sid]) {
            slots.push(sid);
            placed[sid] = true;
          }
        });
      });

      // Assign x
      var startSlot = 0;
      slots.forEach(function(id) {
        tempX[id] = startSlot;
        startSlot++;
      });
    });

    function _parentX(id) {
      var fromId = parentsOf[id];
      if (!fromId) return 0;
      if (typeof fromId === 'string' && fromId.startsWith('union_')) {
        var u = unionByUid[fromId];
        if (!u) return 0;
        var x1 = tempX[u.p1] !== undefined ? tempX[u.p1] : 0;
        var x2 = tempX[u.p2] !== undefined ? tempX[u.p2] : 0;
        return (x1 + x2) / 2;
      }
      return tempX[fromId] !== undefined ? tempX[fromId] : 0;
    }

    // Convert slot positions to pixel positions, centering each generation
    sortedGens.forEach(function(g_) {
      var members = byGen[g_];
      var slots = members.map(function(id) { return tempX[id]; });
      var minSlot = Math.min.apply(null, slots);
      var maxSlot = Math.max.apply(null, slots);
      var totalWidth = (maxSlot - minSlot) * SLOT;
      var startX = width / 2 - totalWidth / 2;

      members.forEach(function(id) {
        var px = startX + (tempX[id] - minSlot) * SLOT;
        var py = 80 + g_ * V_GAP;
        nodePositions[id] = { x: px, y: py };
      });
    });

    // Position union dots
    data.unions.forEach(function(u) {
      var p1pos = nodePositions[u.p1];
      var p2pos = nodePositions[u.p2];
      if (!p1pos || !p2pos) return;
      nodePositions[u.uid] = {
        x: (p1pos.x + p2pos.x) / 2,
        y: (p1pos.y + p2pos.y) / 2,
      };
    });

    // --- Draw layers ---
    const edgeLayer = g.append("g").attr("class", "edge-layer");
    const unionLayer = g.append("g").attr("class", "union-layer");
    const nodeLayer = g.append("g").attr("class", "node-layer");

    // Draw marriage lines: person1 → union dot → person2
    data.unions.forEach(function(u) {
      if (!nodePositions[u.p1] || !nodePositions[u.p2] || !nodePositions[u.uid]) return;

      var lineLeft = edgeLayer.append("line")
        .attr("stroke", "rgba(212, 168, 85, 0.5)")
        .attr("stroke-width", 2);
      var edgeLeft = { type: "spouse-left", from: u.p1, to: u.uid, el: lineLeft };
      edges.push(edgeLeft);

      var lineRight = edgeLayer.append("line")
        .attr("stroke", "rgba(212, 168, 85, 0.5)")
        .attr("stroke-width", 2);
      var edgeRight = { type: "spouse-right", from: u.uid, to: u.p2, el: lineRight };
      edges.push(edgeRight);

      var dot = unionLayer.append("circle")
        .attr("cx", nodePositions[u.uid].x)
        .attr("cy", nodePositions[u.uid].y)
        .attr("r", 4)
        .attr("fill", "rgba(212, 168, 85, 0.5)");
      unionNodes[u.uid].dotEl = dot;

      updateSimpleEdge(edgeLeft);
      updateSimpleEdge(edgeRight);
    });

    // Draw parent-child edges
    data.edges.forEach(function(e) {
      if (!nodePositions[e.from] || !nodePositions[e.child]) return;

      var pathEl = edgeLayer.append("path")
        .attr("class", "link")
        .attr("fill", "none")
        .attr("stroke", "#c4b898")
        .attr("stroke-width", 3)
        .attr("stroke-opacity", 0.6)
        .attr("stroke-linecap", "round");

      var edge = { type: "parent-child", from: e.from, to: e.child, el: pathEl };
      edges.push(edge);
      updateParentChildEdge(edge);
    });

    // Draw person nodes
    function makeNode(id, personData) {
      var pos = nodePositions[id];
      if (!pos) return;

      var nodeG = nodeLayer
        .append("g")
        .attr("class", "node")
        .attr("transform", "translate(" + pos.x + "," + pos.y + ")")
        .style("cursor", "grab");

      nodeG.append("rect")
        .attr("x", -NODE_WIDTH / 2)
        .attr("y", -NODE_HEIGHT / 2)
        .attr("width", NODE_WIDTH)
        .attr("height", NODE_HEIGHT)
        .attr("rx", 28)
        .attr("class", "person-card");

      nodeG.append("text")
        .attr("text-anchor", "middle")
        .attr("y", personData.birth_year ? -8 : 5)
        .attr("class", "person-name")
        .text(personData.name);

      nodeG.append("text")
        .attr("text-anchor", "middle")
        .attr("y", 12)
        .attr("class", "person-year")
        .text(personData.birth_year ? "b. " + personData.birth_year : "");

      pos.gEl = nodeG;

      var hasDragged = false;
      var dragBehavior = d3.drag()
        .on("start", function() {
          hasDragged = false;
          d3.select(this).style("cursor", "grabbing").raise();
        })
        .on("drag", function(event) {
          hasDragged = true;
          pos.x += event.dx;
          pos.y += event.dy;
          d3.select(this).attr("transform", "translate(" + pos.x + "," + pos.y + ")");
          recomputeUnionsFor(id);
          updateEdgesFor(id);
        })
        .on("end", function() {
          d3.select(this).style("cursor", "grab");
          if (!hasDragged) {
            window.location.href = "/family/" + familyId + "/person/" + id + "/edit";
          }
        });

      nodeG.call(dragBehavior);
    }

    data.nodes.forEach(function(p) {
      makeNode(p.id, p);
    });

    // Auto-fit
    var bounds = g.node().getBBox();
    if (bounds.width === 0 || bounds.height === 0) return;

    var padding = 60;
    var fullWidth = bounds.width + padding * 2;
    var fullHeight = bounds.height + padding * 2;
    var scale = Math.min(width / fullWidth, height / fullHeight, 1);
    var tx = width / 2 - (bounds.x + bounds.width / 2) * scale;
    var ty = height / 2 - (bounds.y + bounds.height / 2) * scale;

    fitTransform = d3.zoomIdentity.translate(tx, ty).scale(scale);
    svg.transition().duration(500).call(zoomBehavior.transform, fitTransform);
  }

  // Recompute union positions when a person is dragged
  function recomputeUnionsFor(personId) {
    for (var uid in unionNodes) {
      var u = unionNodes[uid];
      if (u.personId === personId || u.spouseId === personId) {
        computeUnionPos(uid);
        if (u.dotEl) {
          u.dotEl.attr("cx", nodePositions[uid].x).attr("cy", nodePositions[uid].y);
        }
        updateEdgesFor(uid);
      }
    }
  }

  // Simple straight-line edge (marriage halves)
  function updateSimpleEdge(edge) {
    var fromPos = nodePositions[edge.from];
    var toPos = nodePositions[edge.to];
    if (!fromPos || !toPos) return;

    var x1, y1, x2, y2;
    if (edge.type === "spouse-left") {
      x1 = fromPos.x + NODE_WIDTH / 2;
      y1 = fromPos.y;
      x2 = toPos.x;
      y2 = toPos.y;
    } else if (edge.type === "spouse-right") {
      x1 = fromPos.x;
      y1 = fromPos.y;
      x2 = toPos.x - NODE_WIDTH / 2;
      y2 = toPos.y;
    }

    edge.el.attr("x1", x1).attr("y1", y1).attr("x2", x2).attr("y2", y2);
  }

  function updateParentChildEdge(edge) {
    var fromPos = nodePositions[edge.from];
    var toPos = nodePositions[edge.to];
    if (!fromPos || !toPos) return;

    var sx = fromPos.x;
    var sy = fromPos.y + (unionNodes[edge.from] ? 0 : NODE_HEIGHT / 2);
    var tx = toPos.x;
    var ty = toPos.y - NODE_HEIGHT / 2;
    var midY = (sy + ty) / 2;

    edge.el.attr("d", "M" + sx + "," + sy + " C" + sx + "," + midY + " " + tx + "," + midY + " " + tx + "," + ty);
  }

  function updateEdgesFor(id) {
    edges.forEach(function(edge) {
      if (edge.from === id || edge.to === id) {
        if (edge.type === "parent-child") {
          updateParentChildEdge(edge);
        } else {
          updateSimpleEdge(edge);
        }
      }
    });
  }

  // Disable browser-level pinch/scroll zoom on the tree container
  container.addEventListener("wheel", function(e) { e.preventDefault(); }, { passive: false });
  container.addEventListener("touchmove", function(e) {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  container.addEventListener("gesturestart", function(e) { e.preventDefault(); }, { passive: false });
  container.addEventListener("gesturechange", function(e) { e.preventDefault(); }, { passive: false });

  loadTree();
})();
