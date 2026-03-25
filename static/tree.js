// Family Tree D3.js Visualization
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

  // Pan and zoom (pan via drag, zoom only via buttons)
  const zoom = d3
    .zoom()
    .scaleExtent([0.2, 3])
    .filter((event) => {
      // Allow drag pan, block scroll/pinch zoom
      return event.type === "mousedown" || event.type === "touchstart";
    })
    .on("zoom", (event) => {
      g.attr("transform", event.transform);
    });
  svg.call(zoom);

  let fitTransform = d3.zoomIdentity; // saved by renderTree for reset

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
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
  `;
  container.style.position = "relative";
  container.appendChild(controls);

  document.getElementById("zoom-in").addEventListener("click", () => {
    svg.transition().duration(250).call(zoom.scaleBy, 1.3);
  });
  document.getElementById("zoom-out").addEventListener("click", () => {
    svg.transition().duration(250).call(zoom.scaleBy, 0.7);
  });
  document.getElementById("zoom-reset").addEventListener("click", () => {
    svg.transition().duration(400).call(zoom.transform, fitTransform);
  });

  const NODE_WIDTH = 160;
  const NODE_HEIGHT = 60;
  const SPOUSE_GAP = 10;
  const COUPLE_WIDTH = NODE_WIDTH * 2 + SPOUSE_GAP;
  const TREE_GAP = 100;

  function loadTree() {
    d3.json("/api/tree").then((data) => {
      if (!data || !data.root) {
        g.selectAll("*").remove();
        g.append("text")
          .attr("x", width / 2)
          .attr("y", height / 2)
          .attr("text-anchor", "middle")
          .attr("fill", "#9ab5a6")
          .text("No family data yet. Add some people to get started!");
        return;
      }

      renderTree(data.root);
    });
  }

  function renderTree(rootData) {
    g.selectAll("*").remove();

    const root = d3.hierarchy(rootData, (d) => d.children);
    const treeLayout = d3.tree().nodeSize([COUPLE_WIDTH + 40, 120]);
    treeLayout(root);

    const offsetX = width / 2 - root.x;
    const offsetY = 80;

    renderSingleTree(root, offsetX, offsetY);

    // Auto-fit
    const bounds = g.node().getBBox();
    if (bounds.width === 0 || bounds.height === 0) return;

    const padding = 60;
    const fullWidth = bounds.width + padding * 2;
    const fullHeight = bounds.height + padding * 2;
    const scale = Math.min(width / fullWidth, height / fullHeight, 1);
    const tx = width / 2 - (bounds.x + bounds.width / 2) * scale;
    const ty = height / 2 - (bounds.y + bounds.height / 2) * scale;

    fitTransform = d3.zoomIdentity.translate(tx, ty).scale(scale);
    svg
      .transition()
      .duration(500)
      .call(zoom.transform, fitTransform);
  }

  function renderSingleTree(root, offsetX, offsetY) {
    // Draw links
    root.links().forEach((link) => {
      const sx = link.source.x + offsetX;
      const sy = link.source.y + offsetY + NODE_HEIGHT / 2;
      const tx = link.target.x + offsetX;
      const ty = link.target.y + offsetY - NODE_HEIGHT / 2;
      const midY = (sy + ty) / 2;

      g.append("path")
        .attr("class", "link")
        .attr("fill", "none")
        .attr("stroke", "rgba(92, 184, 120, 0.3)")
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
            .attr("stroke", "rgba(212, 168, 85, 0.5)")
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

  // Disable browser-level pinch/scroll zoom on the tree container
  container.addEventListener("wheel", (e) => { e.preventDefault(); }, { passive: false });
  container.addEventListener("touchmove", (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  container.addEventListener("gesturestart", (e) => { e.preventDefault(); }, { passive: false });
  container.addEventListener("gesturechange", (e) => { e.preventDefault(); }, { passive: false });

  // Load tree automatically
  loadTree();
})();
