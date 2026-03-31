// Family Tree D3.js Visualization — draggable nodes with union points
(function () {
  const container = document.getElementById("tree-container");
  if (!container) return;

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
  const SPOUSE_GAP = 40;
  const COUPLE_WIDTH = NODE_WIDTH * 2 + SPOUSE_GAP;

  // Mutable positions keyed by id (person ids + synthetic union ids)
  var nodePositions = {};
  // Edges: { type, from, to, el }
  var edges = [];
  // Union nodes: keyed by union id, tracks { personId, spouseId, dotEl }
  var unionNodes = {};

  function loadTree() {
    d3.json("/api/tree").then((data) => {
      if (!data || !data.root) {
        g.selectAll("*").remove();
        g.append("text")
          .attr("x", width / 2)
          .attr("y", height / 2)
          .attr("text-anchor", "middle")
          .attr("fill", "#8b7a5e")
          .text("No family data yet. Add some people to get started!");
        return;
      }
      renderTree(data.root);
    });
  }

  function unionId(pid, sid) {
    return "union_" + Math.min(pid, sid) + "_" + Math.max(pid, sid);
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

  function renderTree(rootData) {
    g.selectAll("*").remove();
    nodePositions = {};
    edges = [];
    unionNodes = {};

    const root = d3.hierarchy(rootData, (d) => d.children);
    const treeLayout = d3.tree().nodeSize([COUPLE_WIDTH + 40, 120]);
    treeLayout(root);

    const offsetX = width / 2 - root.x;
    const offsetY = 80;

    const edgeLayer = g.append("g").attr("class", "edge-layer");
    const unionLayer = g.append("g").attr("class", "union-layer");
    const nodeLayer = g.append("g").attr("class", "node-layer");

    // First pass: compute positions for people and create union nodes
    root.descendants().forEach((d) => {
      var nx = d.x + offsetX;
      var ny = d.y + offsetY;
      nodePositions[d.data.id] = { x: nx, y: ny };

      if (d.data.spouses && d.data.spouses.length > 0) {
        d.data.spouses.forEach((spouse) => {
          var sx = nx + NODE_WIDTH / 2 + SPOUSE_GAP + NODE_WIDTH / 2;
          nodePositions[spouse.id] = { x: sx, y: ny };

          // Create union node at midpoint
          var uid = unionId(d.data.id, spouse.id);
          nodePositions[uid] = { x: (nx + sx) / 2, y: ny };
          unionNodes[uid] = { personId: d.data.id, spouseId: spouse.id };
        });
      }
    });

    // Draw spouse edges: person -> union dot -> spouse (two line segments)
    root.descendants().forEach((d) => {
      if (d.data.spouses) {
        d.data.spouses.forEach((spouse) => {
          var uid = unionId(d.data.id, spouse.id);

          // Left half: person to union
          var lineLeft = edgeLayer.append("line")
            .attr("stroke", "rgba(212, 168, 85, 0.5)")
            .attr("stroke-width", 2);
          var edgeLeft = { type: "spouse-left", from: d.data.id, to: uid, el: lineLeft };
          edges.push(edgeLeft);

          // Right half: union to spouse
          var lineRight = edgeLayer.append("line")
            .attr("stroke", "rgba(212, 168, 85, 0.5)")
            .attr("stroke-width", 2);
          var edgeRight = { type: "spouse-right", from: uid, to: spouse.id, el: lineRight };
          edges.push(edgeRight);

          // Union dot (small invisible-ish circle)
          var dot = unionLayer.append("circle")
            .attr("cx", nodePositions[uid].x)
            .attr("cy", nodePositions[uid].y)
            .attr("r", 4)
            .attr("fill", "rgba(212, 168, 85, 0.5)");
          unionNodes[uid].dotEl = dot;

          updateSimpleEdge(edgeLeft);
          updateSimpleEdge(edgeRight);
        });
      }
    });

    // Draw parent-child edges: from union node (if spouses) or from parent directly
    root.links().forEach((link) => {
      var parentId = link.source.data.id;
      var childId = link.target.data.id;
      var spouseIds = (link.source.data.spouses || []).map(function(s) { return s.id; });

      // Determine the origin: union node if spouse exists, else the parent
      var fromId;
      if (spouseIds.length > 0) {
        fromId = unionId(parentId, spouseIds[0]);
      } else {
        fromId = parentId;
      }

      var pathEl = edgeLayer.append("path")
        .attr("class", "link")
        .attr("fill", "none")
        .attr("stroke", "#c4b898")
        .attr("stroke-width", 3)
        .attr("stroke-opacity", 0.6)
        .attr("stroke-linecap", "round");

      var edge = { type: "parent-child", from: fromId, to: childId, el: pathEl };
      edges.push(edge);
      updateParentChildEdge(edge);
    });

    // Draw person nodes
    function makeNode(id, personData) {
      var pos = nodePositions[id];

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
          // Recompute any union nodes this person belongs to
          recomputeUnionsFor(id);
          updateEdgesFor(id);
        })
        .on("end", function() {
          d3.select(this).style("cursor", "grab");
          if (!hasDragged) {
            window.location.href = "/person/" + id + "/edit";
          }
        });

      nodeG.call(dragBehavior);
    }

    root.descendants().forEach((d) => {
      makeNode(d.data.id, d.data);
      if (d.data.spouses) {
        d.data.spouses.forEach((spouse) => {
          makeNode(spouse.id, spouse);
        });
      }
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
        // Move the dot
        if (u.dotEl) {
          u.dotEl.attr("cx", nodePositions[uid].x).attr("cy", nodePositions[uid].y);
        }
        // Also update edges connected to this union
        updateEdgesFor(uid);
      }
    }
  }

  // Simple straight-line edge (spouse halves)
  function updateSimpleEdge(edge) {
    var fromPos = nodePositions[edge.from];
    var toPos = nodePositions[edge.to];
    if (!fromPos || !toPos) return;

    // For spouse-left: from person's right edge to union center
    // For spouse-right: from union center to spouse's left edge
    var x1, y1, x2, y2;

    if (edge.type === "spouse-left") {
      // from = person, to = union
      x1 = fromPos.x + NODE_WIDTH / 2;
      y1 = fromPos.y;
      x2 = toPos.x;
      y2 = toPos.y;
    } else if (edge.type === "spouse-right") {
      // from = union, to = spouse
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
