// Family Tree D3.js Visualization — draggable nodes with union points
(function () {
  const container = document.getElementById("tree-container");
  if (!container) return;

  const familyId = container.dataset.familyId;
  const viewOnly = container.dataset.viewOnly === 'true';
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

    // Step 1: assign generation to each person via iterative relaxation
    var gen = {};
    var personIds = data.nodes.map(function(p) { return p.id; });
    personIds.forEach(function(id) { gen[id] = 0; });

    var changed = true;
    var iters = 0;
    while (changed && iters < 100) {
      changed = false;
      iters++;
      data.edges.forEach(function(e) {
        var fromId = e.from;
        var childId = e.child;
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

    // Step 2: group by generation
    var byGen = {};
    personIds.forEach(function(id) {
      var g_ = gen[id] || 0;
      if (!byGen[g_]) byGen[g_] = [];
      byGen[g_].push(id);
    });
    var sortedGens = Object.keys(byGen).map(Number).sort(function(a, b) { return a - b; });

    // Step 3: build "family groups" — clusters of people connected by marriage
    // Each group = a set of people in the same generation linked by spouse edges.
    // Within a group, we keep a canonical order: the "primary" person (most children
    // or first encountered) in the center, spouses flanking.

    var SLOT = NODE_WIDTH + H_GAP;

    // Build adjacency for same-gen spouses
    function sameGenSpouses(id) {
      return (spousesOf[id] || []).filter(function(sid) { return gen[sid] === gen[id]; });
    }

    // Build family groups per generation using union-find
    function buildFamilyGroups(members) {
      var parent = {};
      members.forEach(function(id) { parent[id] = id; });
      function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
      function unite(a, b) { parent[find(a)] = find(b); }

      members.forEach(function(id) {
        sameGenSpouses(id).forEach(function(sid) {
          if (parent[sid] !== undefined) unite(id, sid);
        });
      });

      var groups = {};
      members.forEach(function(id) {
        var root = find(id);
        if (!groups[root]) groups[root] = [];
        groups[root].push(id);
      });
      return Object.values(groups);
    }

    // Order members within a family group: pick the person with the most children
    // as "primary", place them with their spouses adjacent
    function orderGroup(group) {
      if (group.length === 1) return group;

      // Find the person who has children with the most different partners (primary)
      var childCount = {};
      group.forEach(function(id) {
        var count = 0;
        for (var uid in unionByUid) {
          var u = unionByUid[uid];
          if (u.p1 === id || u.p2 === id) {
            count += (childrenOf[uid] || []).length;
          }
        }
        childCount[id] = count;
      });

      // Sort: primary (most children) first, then their spouses in order
      var sorted = group.slice().sort(function(a, b) { return childCount[b] - childCount[a]; });
      var primary = sorted[0];

      // BFS from primary along spouse edges to get ordered chain
      var visited = {};
      var ordered = [];
      var queue = [primary];
      visited[primary] = true;
      while (queue.length > 0) {
        var cur = queue.shift();
        ordered.push(cur);
        sameGenSpouses(cur).forEach(function(sid) {
          if (!visited[sid] && group.indexOf(sid) >= 0) {
            visited[sid] = true;
            queue.push(sid);
          }
        });
      }
      // Add any unvisited (shouldn't happen but safety)
      group.forEach(function(id) { if (!visited[id]) ordered.push(id); });
      return ordered;
    }

    // Step 4: bottom-up width calculation, top-down placement
    // First pass: compute subtree widths. A "subtree" under a union = its children's subtrees.
    // We work bottom-up by generation.

    // For each person, compute how many slots wide their subtree is.
    // A person with no children: width = 1
    // A couple (union): width = max(sum of children widths, couple width which is 2 or 3)
    // A person with multiple spouses: each union contributes its children width,
    //   total = sum of all union child widths + the person + spouses, whichever is larger.

    var subtreeWidth = {};  // id → width in slots

    // Process generations bottom-up
    var reversedGens = sortedGens.slice().reverse();

    reversedGens.forEach(function(g_) {
      var groups = buildFamilyGroups(byGen[g_]);
      groups.forEach(function(group) {
        // Compute each person's descendant width
        group.forEach(function(id) {
          // Find all unions this person is part of
          var totalChildWidth = 0;
          var counted = {};
          data.unions.forEach(function(u) {
            if (u.p1 !== id && u.p2 !== id) return;
            var kids = childrenOf[u.uid] || [];
            kids.forEach(function(kid) {
              if (!counted[kid]) {
                counted[kid] = true;
                totalChildWidth += (subtreeWidth[kid] || 1);
              }
            });
          });
          // Also count children from single-parent edges
          for (var fromId in childrenOf) {
            if (parseInt(fromId) === id) {
              (childrenOf[fromId] || []).forEach(function(kid) {
                if (!counted[kid]) {
                  counted[kid] = true;
                  totalChildWidth += (subtreeWidth[kid] || 1);
                }
              });
            }
          }
          subtreeWidth[id] = Math.max(1, totalChildWidth);
        });

        // The group's total width = max(sum of member slots, sum of descendant widths)
        var groupOrder = orderGroup(group);
        var descendantWidth = 0;
        var countedKids = {};
        groupOrder.forEach(function(id) {
          data.unions.forEach(function(u) {
            if (u.p1 !== id && u.p2 !== id) return;
            (childrenOf[u.uid] || []).forEach(function(kid) {
              if (!countedKids[kid]) {
                countedKids[kid] = true;
                descendantWidth += (subtreeWidth[kid] || 1);
              }
            });
          });
          for (var fromId in childrenOf) {
            if (parseInt(fromId) === id) {
              (childrenOf[fromId] || []).forEach(function(kid) {
                if (!countedKids[kid]) {
                  countedKids[kid] = true;
                  descendantWidth += (subtreeWidth[kid] || 1);
                }
              });
            }
          }
        });

        var groupWidth = Math.max(groupOrder.length, descendantWidth);
        // Assign this width to each member so parent lookups work
        groupOrder.forEach(function(id) {
          subtreeWidth[id] = groupWidth / groupOrder.length;
        });
      });
    });

    // Step 5: top-down x assignment
    // For the root generation, lay out groups left to right.
    // For each group, center members, then place children centered under their parent union.

    var tempX = {};  // id → x in slot units

    function placeGroup(group, leftSlot) {
      var ordered = orderGroup(group);
      // Compute total width needed for this group's descendants
      var totalDescWidth = 0;
      var countedKids = {};
      ordered.forEach(function(id) {
        data.unions.forEach(function(u) {
          if (u.p1 !== id && u.p2 !== id) return;
          (childrenOf[u.uid] || []).forEach(function(kid) {
            if (!countedKids[kid]) {
              countedKids[kid] = true;
              totalDescWidth += (subtreeWidth[kid] || 1);
            }
          });
        });
        for (var fromId in childrenOf) {
          if (parseInt(fromId) === id) {
            (childrenOf[fromId] || []).forEach(function(kid) {
              if (!countedKids[kid]) {
                countedKids[kid] = true;
                totalDescWidth += (subtreeWidth[kid] || 1);
              }
            });
          }
        }
      });

      var groupWidth = Math.max(ordered.length, totalDescWidth);
      var centerX = leftSlot + groupWidth / 2;

      // Place group members centered
      var memberStart = centerX - ordered.length / 2;
      ordered.forEach(function(id, i) {
        tempX[id] = memberStart + i + 0.5;
      });

      return groupWidth;
    }

    // Root generation: lay out all groups
    if (sortedGens.length > 0) {
      var rootGen = sortedGens[0];
      var rootGroups = buildFamilyGroups(byGen[rootGen]);

      // Sort root groups by size (largest first for center placement)
      // Actually keep them in data order for stability
      var cursor = 0;
      rootGroups.forEach(function(group) {
        var usedWidth = placeGroup(group, cursor);
        cursor += usedWidth + 1;  // +1 gap between unrelated groups
      });

      // Now place children generation by generation
      sortedGens.forEach(function(g_) {
        // For each union or single parent in this generation, place their children
        var alreadyPlaced = {};

        // Collect all parent→children relationships from this generation
        var parentSources = [];
        data.unions.forEach(function(u) {
          if ((gen[u.p1] === g_ || gen[u.p2] === g_) && (childrenOf[u.uid] || []).length > 0) {
            parentSources.push({ fromId: u.uid, p1: u.p1, p2: u.p2 });
          }
        });
        // Single-parent edges
        byGen[g_].forEach(function(id) {
          if (childrenOf[id]) {
            parentSources.push({ fromId: id, p1: id, p2: null });
          }
        });

        // Sort by parent x position
        parentSources.sort(function(a, b) {
          var ax = (tempX[a.p1] || 0) + (a.p2 ? (tempX[a.p2] || 0) : (tempX[a.p1] || 0));
          var bx = (tempX[b.p1] || 0) + (b.p2 ? (tempX[b.p2] || 0) : (tempX[b.p1] || 0));
          return ax - bx;
        });

        parentSources.forEach(function(ps) {
          var kids = (childrenOf[ps.fromId] || []).filter(function(k) { return !alreadyPlaced[k]; });
          if (kids.length === 0) return;

          // Center children under the midpoint of parents
          var parentMidX;
          if (ps.p2 !== null) {
            parentMidX = ((tempX[ps.p1] || 0) + (tempX[ps.p2] || 0)) / 2;
          } else {
            parentMidX = tempX[ps.p1] || 0;
          }

          var totalChildWidth = 0;
          kids.forEach(function(kid) {
            var kidGroup = [kid];
            sameGenSpouses(kid).forEach(function(sid) {
              if (kidGroup.indexOf(sid) < 0) kidGroup.push(sid);
            });
            var w = Math.max(subtreeWidth[kid] || 1, kidGroup.length);
            totalChildWidth += w;
          });

          var childLeft = parentMidX - totalChildWidth / 2;
          var childCursor = childLeft;

          kids.forEach(function(kid) {
            var kidGroup = [kid];
            sameGenSpouses(kid).forEach(function(sid) {
              if (kidGroup.indexOf(sid) < 0) kidGroup.push(sid);
            });
            var w = Math.max(subtreeWidth[kid] || 1, kidGroup.length);
            placeGroup(kidGroup, childCursor);
            alreadyPlaced[kid] = true;
            kidGroup.forEach(function(sid) { alreadyPlaced[sid] = true; });
            childCursor += w;
          });
        });
      });
    }

    // Overlap resolution: nudge nodes in same generation that overlap
    sortedGens.forEach(function(g_) {
      var members = byGen[g_].slice();
      members.sort(function(a, b) { return (tempX[a] || 0) - (tempX[b] || 0); });
      for (var i = 1; i < members.length; i++) {
        var prev = members[i - 1];
        var cur = members[i];
        var minGap = 1;  // minimum 1 slot apart
        if ((tempX[cur] || 0) - (tempX[prev] || 0) < minGap) {
          tempX[cur] = (tempX[prev] || 0) + minGap;
        }
      }
    });

    // Convert slot positions to pixel positions, centering the whole tree
    var allX = personIds.map(function(id) { return tempX[id] || 0; });
    var globalMinX = Math.min.apply(null, allX);
    var globalMaxX = Math.max.apply(null, allX);
    var globalWidth = (globalMaxX - globalMinX) * SLOT;
    var globalStartX = width / 2 - globalWidth / 2;

    personIds.forEach(function(id) {
      var px = globalStartX + ((tempX[id] || 0) - globalMinX) * SLOT;
      var py = 80 + (gen[id] || 0) * V_GAP;
      nodePositions[id] = { x: px, y: py };
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
          if (!hasDragged && !viewOnly) {
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
