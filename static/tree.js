// Family Tree D3.js Visualization — draggable nodes with union points
(function () {
  const container = document.getElementById("tree-container");
  if (!container) return;

  const familyId = container.dataset.familyId;
  const viewOnly = container.dataset.viewOnly === 'true';
  const csrfToken = container.dataset.csrfToken || '';
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

    // --- Layout via spouse-collapsing D3 tree ---

    var SLOT = NODE_WIDTH + H_GAP;

    // 1. Build couple map from unions
    var couples = {};       // uid → { p1, p2, uid, kids }
    var personCouple = {};  // person_id → uid (only for the "primary" partner)

    data.unions.forEach(function(u) {
      if (!u.p1 || !u.p2) return;  // skip single-parent units
      couples[u.uid] = { p1: u.p1, p2: u.p2, uid: u.uid, kids: (childrenOf[u.uid] || []).slice() };
    });

    // 2. Determine primary/spouse per couple
    //    Primary = the partner who has parents in the tree (is someone's child)
    //    If both or neither have parents, use p1.
    var primaryOf = {};   // uid → person_id
    var spouseOf = {};    // uid → person_id
    var personIsSpouseIn = {};  // person_id → uid

    Object.keys(couples).forEach(function(uid) {
      var c = couples[uid];
      var p1HasParent = !!parentsOf[c.p1];
      var p2HasParent = !!parentsOf[c.p2];
      var primary, spouse;
      if (p1HasParent && !p2HasParent) {
        primary = c.p1; spouse = c.p2;
      } else if (p2HasParent && !p1HasParent) {
        primary = c.p2; spouse = c.p1;
      } else {
        primary = c.p1; spouse = c.p2;
      }
      primaryOf[uid] = primary;
      spouseOf[uid] = spouse;
      personIsSpouseIn[spouse] = uid;
      if (!personCouple[primary]) personCouple[primary] = uid;
    });

    // 3. Determine which people are "representative" tree nodes
    //    A person is representative if they are:
    //    - Primary in a couple (the couple node represents them), OR
    //    - Not in any couple at all (single person node)
    //    Offset spouses are NOT tree nodes.
    var personIds = data.nodes.map(function(p) { return p.id; });

    var inCouple = {};  // person_id → uid (any couple they're in)
    Object.keys(couples).forEach(function(uid) {
      inCouple[primaryOf[uid]] = uid;
      inCouple[spouseOf[uid]] = uid;
    });

    // 4. Build virtual tree hierarchy
    //    Tree nodes are: couple UIDs (for people in couples) and person IDs (for singles)
    //    A couple node's tree-parent = the parent edge of its primary person
    var treeChildren = {};
    function addChild(parentId, childId) {
      if (!treeChildren[parentId]) treeChildren[parentId] = [];
      if (treeChildren[parentId].indexOf(childId) === -1) treeChildren[parentId].push(childId);
    }

    var treeParent = {};

    personIds.forEach(function(id) {
      // Skip offset spouses — they'll be placed adjacent to their primary
      if (personIsSpouseIn[id] && !personCouple[id]) return;

      // This person's tree node: their couple (if primary) or themselves
      var myNode = personCouple[id] || id;

      // This person's parent in the tree
      var parentFrom = parentsOf[id];  // fu_N or person_id or undefined

      if (parentFrom && !treeParent[myNode]) {
        treeParent[myNode] = parentFrom;
        addChild(parentFrom, myNode);
      }
    });

    // Connect orphans (no parent) to root
    var allRepNodes = {};
    personIds.forEach(function(id) {
      if (personCouple[id]) allRepNodes[personCouple[id]] = true;
      else if (!personIsSpouseIn[id]) allRepNodes[id] = true;
    });

    Object.keys(allRepNodes).forEach(function(nodeId) {
      if (!treeParent[nodeId]) {
        addChild("root", nodeId);
      }
    });

    // 5. Sort children for edge-crossing minimization
    //    Use birth_order first, then existing cross-family heuristics

    // Build birth_order lookup
    var birthOrderOf = {};
    data.edges.forEach(function(e) {
      if (e.birth_order != null) birthOrderOf[e.child] = e.birth_order;
    });

    // Assign root-subtree index for cross-family sorting
    var rootSubtree = {};
    function assignSubtree(nodeId, rootId) {
      if (typeof nodeId === 'number') rootSubtree[nodeId] = rootId;
      // For couple nodes, assign both partners
      if (couples[nodeId]) {
        rootSubtree[primaryOf[nodeId]] = rootId;
        rootSubtree[spouseOf[nodeId]] = rootId;
      }
      (treeChildren[nodeId] || []).forEach(function(cid) {
        assignSubtree(cid, rootId);
      });
    }
    (treeChildren["root"] || []).forEach(function(rootChildId) {
      assignSubtree(rootChildId, rootChildId);
    });

    var rootOrder = {};
    (treeChildren["root"] || []).forEach(function(id, idx) { rootOrder[id] = idx; });

    // Sort root children so intermarrying families are adjacent
    if (treeChildren["root"] && treeChildren["root"].length > 1) {
      var rootLinks = {};
      data.unions.forEach(function(u) {
        if (!u.p1 || !u.p2) return;
        var st1 = rootSubtree[u.p1], st2 = rootSubtree[u.p2];
        if (st1 !== undefined && st2 !== undefined && st1 !== st2) {
          if (!rootLinks[st1]) rootLinks[st1] = {};
          if (!rootLinks[st2]) rootLinks[st2] = {};
          rootLinks[st1][st2] = true;
          rootLinks[st2][st1] = true;
        }
      });

      var remaining = {};
      treeChildren["root"].forEach(function(id) { remaining[id] = true; });
      var sorted = [treeChildren["root"][0]];
      delete remaining[sorted[0]];
      while (Object.keys(remaining).length > 0) {
        var last = sorted[sorted.length - 1];
        var linked = rootLinks[last] || {};
        var bestNext = null;
        for (var rid in remaining) {
          if (linked[rid]) { bestNext = rid; break; }
        }
        if (!bestNext) bestNext = Object.keys(remaining)[0];
        sorted.push(bestNext);
        delete remaining[bestNext];
      }
      treeChildren["root"] = sorted;
      sorted.forEach(function(id, idx) { rootOrder[id] = idx; });
    }

    // Sort children of each parent node
    Object.keys(treeChildren).forEach(function(parentId) {
      if (parentId === "root") return;
      var kids = treeChildren[parentId];
      if (!kids || kids.length <= 1) return;

      kids.sort(function(a, b) {
        // Get the person ID for this tree node (for couples, use primary)
        var aPersonId = couples[a] ? primaryOf[a] : a;
        var bPersonId = couples[b] ? primaryOf[b] : b;

        // Birth order first
        var aOrder = birthOrderOf[aPersonId];
        var bOrder = birthOrderOf[bPersonId];
        if (aOrder != null && bOrder != null && aOrder !== bOrder) return aOrder - bOrder;
        if (aOrder != null && bOrder == null) return -1;
        if (aOrder == null && bOrder != null) return 1;

        // Cross-family spouse heuristic
        var aSpouseIdx = -1, bSpouseIdx = -1;
        (spousesOf[aPersonId] || []).forEach(function(sid) {
          var st = rootSubtree[sid];
          if (st !== undefined && rootOrder[st] !== undefined) aSpouseIdx = rootOrder[st];
        });
        (spousesOf[bPersonId] || []).forEach(function(sid) {
          var st = rootSubtree[sid];
          if (st !== undefined && rootOrder[st] !== undefined) bSpouseIdx = rootOrder[st];
        });
        if (aSpouseIdx === -1 && bSpouseIdx === -1) return aPersonId - bPersonId;
        if (aSpouseIdx === -1) return -1;
        if (bSpouseIdx === -1) return 1;
        return aSpouseIdx - bSpouseIdx;
      });
    });

    // 6. Build d3 hierarchy and run layout
    function buildHierarchy(nodeId) {
      var children = treeChildren[nodeId] || [];
      var node = { id: nodeId, children: [] };
      children.forEach(function(cid) {
        node.children.push(buildHierarchy(cid));
      });
      if (node.children.length === 0) delete node.children;
      return node;
    }

    var rootData = buildHierarchy("root");
    var hierarchy = d3.hierarchy(rootData);

    // Use COUPLE_SLOT as nodeSize so couples have enough room
    var COUPLE_SLOT = (NODE_WIDTH * 2 + H_GAP) + H_GAP;
    var treeLayout = d3.tree()
      .nodeSize([COUPLE_SLOT, V_GAP])
      .separation(function(a, b) {
        // Tighter for siblings, wider between different parents
        var aIsCouple = couples[a.data.id] ? true : false;
        var bIsCouple = couples[b.data.id] ? true : false;
        // Singles need less space
        if (!aIsCouple && !bIsCouple) return 0.55;
        if (a.parent === b.parent) return 1;
        return 1.2;
      });

    treeLayout(hierarchy);

    // 7. Compute generation for each person (from parent-child edges)
    var gen = {};
    personIds.forEach(function(id) { gen[id] = 0; });
    var changed = true, iters = 0;
    while (changed && iters < 100) {
      changed = false; iters++;
      data.edges.forEach(function(e) {
        var fromId = e.from;
        var childId = e.child;
        var parentGen;
        if (typeof fromId === 'string' && couples[fromId]) {
          var u = couples[fromId];
          parentGen = Math.max(gen[u.p1] || 0, gen[u.p2] || 0);
        } else if (typeof fromId === 'string' && unionByUid[fromId]) {
          var uu = unionByUid[fromId];
          parentGen = Math.max(gen[uu.p1] || 0, gen[uu.p2] || 0);
        } else {
          parentGen = gen[fromId] || 0;
        }
        if ((gen[childId] || 0) <= parentGen) {
          gen[childId] = parentGen + 1;
          changed = true;
        }
      });
    }

    // 8. Extract positions — split couple nodes into two person positions
    hierarchy.each(function(node) {
      var nid = node.data.id;
      if (nid === "root") return;

      if (couples[nid]) {
        // Couple node → split into two people
        var c = couples[nid];
        var primary = primaryOf[nid];
        var spouse = spouseOf[nid];
        var gen_y = 80 + (gen[primary] || 0) * V_GAP;

        // Gender hint: male left, female right (if both known). Else primary left.
        var pData = peopleById[primary];
        var sData = peopleById[spouse];
        var leftId = primary, rightId = spouse;
        if (sData && sData.gender === 'male' && pData && pData.gender !== 'male') {
          leftId = spouse; rightId = primary;
        }

        nodePositions[leftId] = { x: node.x - (NODE_WIDTH + H_GAP) / 2, y: gen_y };
        nodePositions[rightId] = { x: node.x + (NODE_WIDTH + H_GAP) / 2, y: gen_y };
      } else if (typeof nid === 'number') {
        // Single person node
        nodePositions[nid] = { x: node.x, y: 80 + (gen[nid] || 0) * V_GAP };
      }
    });

    // 9. Place remaining people not yet positioned (isolated, or offset spouses of single-parent units)
    var placedCount = Object.keys(nodePositions).length;
    personIds.forEach(function(id) {
      if (nodePositions[id]) return;

      // Check if they're a spouse in a single-parent unit (p2 is null in union)
      // or just totally unconnected
      // Try to place near their partner if they have one
      var placed = false;
      data.unions.forEach(function(u) {
        if (placed) return;
        if (u.p1 === id && u.p2 && nodePositions[u.p2]) {
          nodePositions[id] = { x: nodePositions[u.p2].x - SLOT, y: nodePositions[u.p2].y };
          placed = true;
        } else if (u.p2 === id && u.p1 && nodePositions[u.p1]) {
          nodePositions[id] = { x: nodePositions[u.p1].x + SLOT, y: nodePositions[u.p1].y };
          placed = true;
        }
      });

      if (!placed) {
        nodePositions[id] = { x: (placedCount++) * SLOT, y: 80 + (gen[id] || 0) * V_GAP };
      }
    });

    // 10. Cross-family spouse pull: bring married couples from different subtrees closer
    data.unions.forEach(function(u) {
      if (!u.p1 || !u.p2) return;
      var pos1 = nodePositions[u.p1];
      var pos2 = nodePositions[u.p2];
      if (!pos1 || !pos2) return;
      if (pos1.y !== pos2.y) return;
      var dist = Math.abs(pos1.x - pos2.x);
      if (dist <= SLOT * 1.5) return;

      // Strong pull: move each partner 70% toward adjacent position
      var mid = (pos1.x + pos2.x) / 2;
      var target1 = mid - SLOT / 2;
      var target2 = mid + SLOT / 2;
      if (pos1.x < pos2.x) {
        pos1.x += (target1 - pos1.x) * 0.7;
        pos2.x += (target2 - pos2.x) * 0.7;
      } else {
        pos1.x += (target2 - pos1.x) * 0.7;
        pos2.x += (target1 - pos2.x) * 0.7;
      }
    });

    // 11. Overlap resolution — treat coupled pairs as rigid units
    //     Build "layout groups": a coupled pair is one group, a single person is one group.
    var byGen = {};
    personIds.forEach(function(id) {
      var g_ = gen[id] || 0;
      if (!byGen[g_]) byGen[g_] = [];
      byGen[g_].push(id);
    });

    // Build a partner lookup: person_id → partner_id (if they're in a couple and both positioned)
    var partnerOf = {};
    Object.keys(couples).forEach(function(uid) {
      var c = couples[uid];
      if (nodePositions[c.p1] && nodePositions[c.p2]) {
        partnerOf[c.p1] = c.p2;
        partnerOf[c.p2] = c.p1;
      }
    });

    for (var overlapPass = 0; overlapPass < 5; overlapPass++) {
      Object.keys(byGen).forEach(function(g_) {
        var members = byGen[g_].slice();
        members.sort(function(a, b) { return nodePositions[a].x - nodePositions[b].x; });
        for (var i = 1; i < members.length; i++) {
          var prev = members[i - 1];
          var cur = members[i];
          var gap = nodePositions[cur].x - nodePositions[prev].x;
          if (gap < SLOT) {
            var shift = SLOT - gap;
            // If prev and cur are partners, they should stay at SLOT apart — don't push
            if (partnerOf[prev] === cur || partnerOf[cur] === prev) continue;

            // Push both apart equally
            var halfShift = shift / 2;

            // When pushing prev left, also push its partner
            nodePositions[prev].x -= halfShift;
            if (partnerOf[prev] && nodePositions[partnerOf[prev]]) {
              nodePositions[partnerOf[prev]].x -= halfShift;
            }

            // When pushing cur right, also push its partner
            nodePositions[cur].x += halfShift;
            if (partnerOf[cur] && nodePositions[partnerOf[cur]]) {
              nodePositions[partnerOf[cur]].x += halfShift;
            }
          }
        }
      });
    }

    // Apply saved layout positions (override algorithm)
    var savedLayout = data.layout || {};
    personIds.forEach(function(id) {
      if (savedLayout[id] && nodePositions[id]) {
        nodePositions[id].x = savedLayout[id].x;
        nodePositions[id].y = savedLayout[id].y;
      }
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
          // Row-lock: only move horizontally
          pos.x += event.dx;
          d3.select(this).attr("transform", "translate(" + pos.x + "," + pos.y + ")");
          recomputeUnionsFor(id);
          updateEdgesFor(id);
        })
        .on("end", function() {
          d3.select(this).style("cursor", "grab");
          if (!hasDragged && !viewOnly) {
            window.location.href = "/family/" + familyId + "/person/" + id + "/edit";
          } else if (hasDragged && !viewOnly) {
            // Save position to server
            fetch("/family/" + familyId + "/api/tree/layout", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
              body: JSON.stringify({ person_id: id, x: pos.x, y: pos.y })
            });
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
