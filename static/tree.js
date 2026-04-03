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

    // --- Layout via D3 tree ---
    //
    // Strategy (inspired by family-chart):
    //   1. Build a virtual hierarchy: a synthetic root → union nodes → children.
    //      People without a parent union become direct children of the root.
    //      Spouses are NOT tree nodes — they're positioned as offsets from their union.
    //   2. Let d3.tree() compute x positions (centering children under parents).
    //   3. Map union x positions back to spouse-pair positions.
    //   4. Place any "orphan" spouses (married-in, no children of their own) adjacent.

    var SLOT = NODE_WIDTH + H_GAP;

    // Identify which people are "primary" in each union (the one who has parents
    // or more connections). The other is the "attached" spouse.
    // A person can be primary in one union and attached in none, or vice versa.

    // For each union, figure out which partner is the tree-node (has parents or
    // more descendant connections) and which is the offset spouse.
    var primaryOf = {};   // uid → person id (the one in the tree hierarchy)
    var spouseOf = {};    // uid → person id (the one placed as offset)
    var personIsSpouseIn = {};  // person_id → [uid, ...] where they are the offset spouse

    data.unions.forEach(function(u) {
      var p1HasParent = !!parentsOf[u.p1];
      var p2HasParent = !!parentsOf[u.p2];
      var p1Kids = 0, p2Kids = 0;
      data.unions.forEach(function(u2) {
        var kids = (childrenOf[u2.uid] || []).length;
        if (u2.p1 === u.p1 || u2.p2 === u.p1) p1Kids += kids;
        if (u2.p1 === u.p2 || u2.p2 === u.p2) p2Kids += kids;
      });

      // Primary = person with parents, or if both/neither have parents, the one
      // with more children connections
      var primary, spouse;
      if (p1HasParent && !p2HasParent) {
        primary = u.p1; spouse = u.p2;
      } else if (p2HasParent && !p1HasParent) {
        primary = u.p2; spouse = u.p1;
      } else {
        primary = p1Kids >= p2Kids ? u.p1 : u.p2;
        spouse = primary === u.p1 ? u.p2 : u.p1;
      }
      primaryOf[u.uid] = primary;
      spouseOf[u.uid] = spouse;
      if (!personIsSpouseIn[spouse]) personIsSpouseIn[spouse] = [];
      personIsSpouseIn[spouse].push(u.uid);
    });

    // Build the virtual tree hierarchy.
    // Tree nodes: "root" (synthetic), union uids, and person ids (for people in the tree).
    // A person is "in the tree" if they are a primary in some union, or have no union at all.
    // Children connect to their parent union node.

    // Collect all people who appear as tree nodes (not just offset spouses)
    var inTree = {};  // person_id → true
    data.nodes.forEach(function(p) {
      // A person is in the tree if they are NOT exclusively an offset spouse
      // (i.e., they have parents, or they are primary in some union, or they have no unions)
      var isPrimaryAnywhere = false;
      data.unions.forEach(function(u) {
        if (primaryOf[u.uid] === p.id) isPrimaryAnywhere = true;
      });
      var hasParents = !!parentsOf[p.id];
      var hasNoUnions = !(spousesOf[p.id] && spousesOf[p.id].length > 0);

      if (isPrimaryAnywhere || hasParents || hasNoUnions) {
        inTree[p.id] = true;
      }
    });

    // Build children map for the virtual tree:
    // root → union nodes (for unions whose parents have no grandparents) + orphan people
    // union node → children of that union (who are inTree)

    // For each union that has children, it becomes a tree node.
    // Its parent in the tree = the primary person of that union.
    // The primary person's parent = their parent union (from parentsOf), or root.

    // Actually, let's build a simpler hierarchy:
    // - Each union with children is a node
    // - Each person who is inTree is a node
    // - Parent of a person = their parent union (from data.edges), or root
    // - Parent of a union = its primary person
    // This creates: root → person → union → person → union → ...

    var treeChildren = {};  // nodeId → [childId, ...]

    function addTreeChild(parentId, childId) {
      if (!treeChildren[parentId]) treeChildren[parentId] = [];
      treeChildren[parentId].push(childId);
    }

    // Connect persons to their parent unions
    var personTreeParent = {};  // person_id → parent node id in tree
    data.nodes.forEach(function(p) {
      if (!inTree[p.id]) return;
      var from = parentsOf[p.id];
      if (from) {
        // Parent is a union or single parent
        addTreeChild(from, p.id);
        personTreeParent[p.id] = from;
      }
      // else: will be connected to root later
    });

    // Connect unions to their primary person
    data.unions.forEach(function(u) {
      var kids = childrenOf[u.uid] || [];
      if (kids.length === 0) return;  // childless unions don't need tree nodes
      addTreeChild(primaryOf[u.uid], u.uid);
    });

    // Find root-level people (no parent union) and connect to synthetic root
    var rootChildren = [];
    data.nodes.forEach(function(p) {
      if (!inTree[p.id]) return;
      if (!personTreeParent[p.id]) {
        rootChildren.push(p.id);
        addTreeChild("root", p.id);
      }
    });

    // Sort children of each node to minimize edge crossings.
    // Key heuristic: for union nodes with multiple children, place children
    // who have a cross-family spouse toward the side of that spouse's subtree.
    // For person nodes with multiple union children, sort unions so children
    // from each union cluster near that union's other parent.

    // Step 1: Sort children of union nodes.
    // Children who marry someone from a rightward root subtree go right.
    // We approximate "rightward" by root-subtree index.

    // Assign each person a root-subtree index (which root-level person's subtree they belong to)
    var rootSubtree = {};  // person_id → root person id
    function assignSubtree(nodeId, rootId) {
      if (typeof nodeId === 'number') rootSubtree[nodeId] = rootId;
      (treeChildren[nodeId] || []).forEach(function(cid) {
        assignSubtree(cid, typeof nodeId === 'number' && !rootId ? nodeId : rootId);
      });
    }
    (treeChildren["root"] || []).forEach(function(rootChildId) {
      assignSubtree(rootChildId, rootChildId);
    });

    // For each union node's children, sort by spouse's root subtree position
    // (children marrying leftward go left, rightward go right)
    var rootOrder = {};  // root person id → index
    (treeChildren["root"] || []).forEach(function(id, idx) {
      rootOrder[id] = idx;
    });

    Object.keys(treeChildren).forEach(function(parentId) {
      if (typeof parentId === 'string' && parentId.startsWith('union_')) {
        var kids = treeChildren[parentId];
        if (kids.length <= 1) return;

        kids.sort(function(a, b) {
          // Get spouse subtree index for each child
          var aSpouseIdx = -1, bSpouseIdx = -1;
          (spousesOf[a] || []).forEach(function(sid) {
            var st = rootSubtree[sid];
            if (st !== undefined && rootOrder[st] !== undefined) aSpouseIdx = rootOrder[st];
          });
          (spousesOf[b] || []).forEach(function(sid) {
            var st = rootSubtree[sid];
            if (st !== undefined && rootOrder[st] !== undefined) bSpouseIdx = rootOrder[st];
          });
          // Children with no cross-family spouse: sort by id for stability
          if (aSpouseIdx === -1 && bSpouseIdx === -1) return a - b;
          if (aSpouseIdx === -1) return -1;  // no spouse → inner
          if (bSpouseIdx === -1) return 1;
          return aSpouseIdx - bSpouseIdx;
        });
      }
    });

    // Sort children of person nodes (union children): place unions whose
    // other parent is on the left side first
    Object.keys(treeChildren).forEach(function(parentId) {
      var pid = parseInt(parentId);
      if (isNaN(pid)) return;
      var kids = treeChildren[parentId];
      if (!kids || kids.length <= 1) return;

      // Only sort union children (string ids starting with "union_")
      var unionKids = kids.filter(function(k) { return typeof k === 'string' && k.startsWith('union_'); });
      if (unionKids.length <= 1) return;

      // Sort unions by the other parent's root subtree position
      unionKids.sort(function(a, b) {
        var uA = unionByUid[a], uB = unionByUid[b];
        if (!uA || !uB) return 0;
        var otherA = uA.p1 === pid ? uA.p2 : uA.p1;
        var otherB = uB.p1 === pid ? uB.p2 : uB.p1;
        var stA = rootSubtree[otherA], stB = rootSubtree[otherB];
        var idxA = stA !== undefined ? (rootOrder[stA] !== undefined ? rootOrder[stA] : 0) : 0;
        var idxB = stB !== undefined ? (rootOrder[stB] !== undefined ? rootOrder[stB] : 0) : 0;
        return idxA - idxB;
      });

      // Rebuild kids array with sorted unions in their original positions
      var uIdx = 0;
      for (var i = 0; i < kids.length; i++) {
        if (typeof kids[i] === 'string' && kids[i].startsWith('union_')) {
          kids[i] = unionKids[uIdx++];
        }
      }
    });

    // Sort root children so families that intermarry are adjacent
    if (treeChildren["root"] && treeChildren["root"].length > 1) {
      // Build adjacency: two root people are "linked" if any of their
      // descendants marry each other
      var rootLinks = {};  // rootId → Set of linked rootIds
      data.unions.forEach(function(u) {
        var st1 = rootSubtree[u.p1], st2 = rootSubtree[u.p2];
        if (st1 !== undefined && st2 !== undefined && st1 !== st2) {
          if (!rootLinks[st1]) rootLinks[st1] = {};
          if (!rootLinks[st2]) rootLinks[st2] = {};
          rootLinks[st1][st2] = true;
          rootLinks[st2][st1] = true;
        }
      });

      // Simple greedy ordering: start with first, always pick the most-linked next
      var remaining = {};
      treeChildren["root"].forEach(function(id) { remaining[id] = true; });
      var sorted = [treeChildren["root"][0]];
      delete remaining[sorted[0]];

      while (Object.keys(remaining).length > 0) {
        var last = sorted[sorted.length - 1];
        var bestNext = null;
        var linked = rootLinks[last] || {};
        // Prefer a linked root
        for (var rid in remaining) {
          rid = parseInt(rid) || rid;
          if (linked[rid]) { bestNext = rid; break; }
        }
        if (!bestNext) bestNext = parseInt(Object.keys(remaining)[0]);
        sorted.push(bestNext);
        delete remaining[bestNext];
      }

      treeChildren["root"] = sorted;
      // Update rootOrder
      sorted.forEach(function(id, idx) { rootOrder[id] = idx; });
    }

    // Build d3 hierarchy from treeChildren
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

    // Configure d3.tree layout
    var treeLayout = d3.tree()
      .nodeSize([SLOT, V_GAP])
      .separation(function(a, b) {
        // More space between nodes that don't share a parent
        return a.parent === b.parent ? 1 : 1.2;
      });

    treeLayout(hierarchy);

    // Extract positions from the d3 layout
    // d3.tree uses x for horizontal, y for vertical (depth)
    var treeX = {};  // nodeId → x from d3
    var treeDepth = {};  // nodeId → depth level

    hierarchy.each(function(node) {
      treeX[node.data.id] = node.x;
      treeDepth[node.data.id] = node.depth;
    });

    // Compute generation for each person based on tree depth.
    // Person depth in the tree includes union intermediate nodes, so actual
    // generation = (depth - 1) / 2 for the pattern root→person→union→person→union...
    // But depth varies. Let's compute generation from parent-child edges instead.
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

    // Assign pixel positions to people who are in the tree
    personIds.forEach(function(id) {
      if (inTree[id] && treeX[id] !== undefined) {
        nodePositions[id] = {
          x: treeX[id],
          y: 80 + (gen[id] || 0) * V_GAP
        };
      }
    });

    // Place offset spouses adjacent to their primary partner
    data.unions.forEach(function(u) {
      var spouse = spouseOf[u.uid];
      var primary = primaryOf[u.uid];
      if (!spouse || !primary) return;
      if (nodePositions[spouse]) return;  // already placed (e.g., also primary in another union)
      var pPos = nodePositions[primary];
      if (!pPos) return;

      // Place spouse to the right of primary (or left if primary has another
      // spouse already to the right)
      var offset = SLOT;

      // Check if there's already a spouse on the right
      var existingRight = false;
      data.unions.forEach(function(u2) {
        if (u2.uid === u.uid) return;
        var otherSpouse = spouseOf[u2.uid];
        if (primaryOf[u2.uid] === primary && otherSpouse && nodePositions[otherSpouse]) {
          if (nodePositions[otherSpouse].x > pPos.x) existingRight = true;
        }
      });

      nodePositions[spouse] = {
        x: pPos.x + (existingRight ? -offset : offset),
        y: pPos.y
      };
    });

    // Place any remaining people not yet positioned (no unions, no parents — isolated)
    var placedCount = Object.keys(nodePositions).length;
    personIds.forEach(function(id) {
      if (nodePositions[id]) return;
      nodePositions[id] = {
        x: (placedCount++) * SLOT,
        y: 80 + (gen[id] || 0) * V_GAP
      };
    });

    // Post-layout: pull married couples toward each other.
    // For each union where both partners are in the tree (cross-family marriage),
    // shift the subtrees to bring the couple adjacent.
    data.unions.forEach(function(u) {
      var pos1 = nodePositions[u.p1];
      var pos2 = nodePositions[u.p2];
      if (!pos1 || !pos2) return;
      if (pos1.y !== pos2.y) return;  // different generations, skip

      // If they're already adjacent (within 1.5 SLOT), skip
      var dist = Math.abs(pos1.x - pos2.x);
      if (dist <= SLOT * 1.5) return;

      // Move each partner 40% toward the other
      var mid = (pos1.x + pos2.x) / 2;
      var target1 = mid - SLOT / 2;
      var target2 = mid + SLOT / 2;

      // Determine which is left, which is right
      if (pos1.x < pos2.x) {
        var shift1 = (target1 - pos1.x) * 0.4;
        var shift2 = (target2 - pos2.x) * 0.4;
      } else {
        var shift1 = (target2 - pos1.x) * 0.4;
        var shift2 = (target1 - pos2.x) * 0.4;
      }

      // Shift the partner and all their offset spouses
      pos1.x += shift1;
      pos2.x += shift2;
    });

    // Fix overlaps within each generation — spouses placed by offset may collide
    var byGen = {};
    personIds.forEach(function(id) {
      var g_ = gen[id] || 0;
      if (!byGen[g_]) byGen[g_] = [];
      byGen[g_].push(id);
    });

    // Run overlap resolution multiple times to stabilize after spouse pulls
    for (var overlapPass = 0; overlapPass < 3; overlapPass++) {
      Object.keys(byGen).forEach(function(g_) {
        var members = byGen[g_].slice();
        members.sort(function(a, b) { return nodePositions[a].x - nodePositions[b].x; });
        for (var i = 1; i < members.length; i++) {
          var prev = members[i - 1];
          var cur = members[i];
          var minDist = SLOT;

          // Extra space after an offset spouse (so siblings don't crowd the couple)
          var prevIsSpouse = false;
          data.unions.forEach(function(u) {
            if (spouseOf[u.uid] === prev && !inTree[prev]) prevIsSpouse = true;
          });
          if (prevIsSpouse) minDist = SLOT * 1.15;

          var gap = nodePositions[cur].x - nodePositions[prev].x;
          if (gap < minDist) {
            var shift = minDist - gap;
            for (var j = i; j < members.length; j++) {
              nodePositions[members[j]].x += shift;
            }
          }
        }
      });
    }

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
