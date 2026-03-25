// Family Tree D3.js Visualization
(function () {
  const container = document.getElementById("tree-container");
  const rootSelect = document.getElementById("root-select");
  if (!container) return;

  const width = container.clientWidth;
  const height = container.clientHeight;

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const g = svg.append("g");

  // Pan and zoom
  const zoom = d3
    .zoom()
    .scaleExtent([0.2, 3])
    .on("zoom", (event) => {
      g.attr("transform", event.transform);
    });
  svg.call(zoom);

  const NODE_WIDTH = 160;
  const NODE_HEIGHT = 60;
  const SPOUSE_GAP = 10;
  const COUPLE_WIDTH = NODE_WIDTH * 2 + SPOUSE_GAP;
  const TREE_GAP = 100; // gap between multiple root trees

  function loadTree(rootId) {
    const url = rootId ? `/api/tree?root_id=${rootId}` : "/api/tree";
    d3.json(url).then((data) => {
      if (!data || !data.roots || data.roots.length === 0) {
        g.selectAll("*").remove();
        g.append("text")
          .attr("x", width / 2)
          .attr("y", height / 2)
          .attr("text-anchor", "middle")
          .attr("fill", "var(--pico-color)")
          .text("No family data yet. Add some people to get started!");
        return;
      }

      renderAllRoots(data.roots);
    });
  }

  function renderAllRoots(roots) {
    g.selectAll("*").remove();

    // Layout each root tree and compute their widths, then place side by side
    let currentOffsetX = 0;

    roots.forEach((rootData, index) => {
      const root = d3.hierarchy(rootData, (d) => d.children);
      const treeLayout = d3.tree().nodeSize([COUPLE_WIDTH + 40, 120]);
      treeLayout(root);

      // Find bounds of this tree
      let minX = Infinity, maxX = -Infinity;
      root.descendants().forEach((d) => {
        minX = Math.min(minX, d.x - COUPLE_WIDTH / 2);
        maxX = Math.max(maxX, d.x + COUPLE_WIDTH / 2);
      });
      const treeWidth = maxX - minX;

      // Offset so this tree starts after the previous one
      const offsetX = currentOffsetX - minX;
      const offsetY = 80;

      renderSingleTree(root, offsetX, offsetY);

      currentOffsetX += treeWidth + TREE_GAP;
    });

    // Auto-fit: zoom to fit all content
    const bounds = g.node().getBBox();
    if (bounds.width === 0 || bounds.height === 0) return;

    const padding = 60;
    const fullWidth = bounds.width + padding * 2;
    const fullHeight = bounds.height + padding * 2;
    const scale = Math.min(width / fullWidth, height / fullHeight, 1);
    const tx = width / 2 - (bounds.x + bounds.width / 2) * scale;
    const ty = height / 2 - (bounds.y + bounds.height / 2) * scale;

    svg
      .transition()
      .duration(500)
      .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  function renderSingleTree(root, offsetX, offsetY) {
    // Draw links (parent to child)
    root.links().forEach((link) => {
      const sx = link.source.x + offsetX;
      const sy = link.source.y + offsetY + NODE_HEIGHT / 2;
      const tx = link.target.x + offsetX;
      const ty = link.target.y + offsetY - NODE_HEIGHT / 2;
      const midY = (sy + ty) / 2;

      g.append("path")
        .attr("class", "link")
        .attr("fill", "none")
        .attr("stroke", "#999")
        .attr("stroke-width", 1.5)
        .attr("d", `M${sx},${sy} C${sx},${midY} ${tx},${midY} ${tx},${ty}`);
    });

    // Draw nodes
    root.descendants().forEach((d) => {
      const nx = d.x + offsetX;
      const ny = d.y + offsetY;

      const nodeG = g
        .append("g")
        .attr("class", "node")
        .attr("transform", `translate(${nx},${ny})`)
        .style("cursor", "pointer")
        .on("click", () => {
          window.location.href = `/person/${d.data.id}`;
        });

      nodeG
        .append("rect")
        .attr("x", -NODE_WIDTH / 2)
        .attr("y", -NODE_HEIGHT / 2)
        .attr("width", NODE_WIDTH)
        .attr("height", NODE_HEIGHT)
        .attr("rx", 8)
        .attr("class", "person-card");

      nodeG
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "-0.2em")
        .attr("class", "person-name")
        .text(d.data.name);

      nodeG
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "1.2em")
        .attr("class", "person-year")
        .text(d.data.birth_year ? `b. ${d.data.birth_year}` : "");

      // Draw spouse nodes
      if (d.data.spouses && d.data.spouses.length > 0) {
        d.data.spouses.forEach((spouse) => {
          const sx = nx + NODE_WIDTH / 2 + SPOUSE_GAP + NODE_WIDTH / 2;
          const sy = ny;

          // Connector line
          g.append("line")
            .attr("x1", nx + NODE_WIDTH / 2)
            .attr("y1", sy)
            .attr("x2", sx - NODE_WIDTH / 2)
            .attr("y2", sy)
            .attr("stroke", "#e74c3c")
            .attr("stroke-width", 2);

          const spouseG = g
            .append("g")
            .attr("class", "node spouse-node")
            .attr("transform", `translate(${sx},${sy})`)
            .style("cursor", "pointer")
            .on("click", () => {
              window.location.href = `/person/${spouse.id}`;
            });

          spouseG
            .append("rect")
            .attr("x", -NODE_WIDTH / 2)
            .attr("y", -NODE_HEIGHT / 2)
            .attr("width", NODE_WIDTH)
            .attr("height", NODE_HEIGHT)
            .attr("rx", 8)
            .attr("class", "person-card spouse-card");

          spouseG
            .append("text")
            .attr("text-anchor", "middle")
            .attr("dy", "-0.2em")
            .attr("class", "person-name")
            .text(spouse.name);

          spouseG
            .append("text")
            .attr("text-anchor", "middle")
            .attr("dy", "1.2em")
            .attr("class", "person-year")
            .text(spouse.birth_year ? `b. ${spouse.birth_year}` : "");
        });
      }
    });
  }

  // Initial load
  loadTree(null);

  // Root selector
  if (rootSelect) {
    rootSelect.addEventListener("change", () => {
      loadTree(rootSelect.value || null);
    });
  }
})();
