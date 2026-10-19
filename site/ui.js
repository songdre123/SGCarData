/* Shared table helper: pages through every row and shows column sums (across ALL matching rows) in the footer. */
window.pagedTable = function (tbl, rows, cols, o = {}) {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = n => Number(n).toLocaleString("en-SG");
  const st = tbl._st || (tbl._st = { page: 0, size: o.size || 50 });
  if (o.reset) st.page = 0;
  tbl._rows = rows; tbl._cols = cols;
  let pg = tbl._pg;
  if (!pg) {
    pg = tbl._pg = document.createElement("div"); pg.className = "pager";
    (tbl.closest(".table-wrap") || tbl).after(pg);
    pg.onclick = e => { const b = e.target.closest("button"); if (b) { st.page += +b.dataset.d; draw(); } };
    pg.onchange = e => { if (e.target.tagName === "SELECT") { st.size = +e.target.value; st.page = 0; draw(); } };
  }
  const cell = (c, v) => c.dec != null ? Number(v).toFixed(c.dec) + (c.suf || "") : typeof v === "number" ? num(v) : esc(v);
  function draw() {
    const R = tbl._rows, C = tbl._cols, pages = Math.max(1, Math.ceil(R.length / st.size));
    st.page = Math.min(Math.max(st.page, 0), pages - 1);
    const from = st.page * st.size;
    tbl.tBodies[0].innerHTML = R.slice(from, from + st.size).map((r, i) => "<tr>" + C.map(c => `<td${c.num ? ' class="num"' : ""}>${cell(c, c.get(r, from + i))}</td>`).join("") + "</tr>").join("") || `<tr><td colspan="${C.length}">No rows match.</td></tr>`;
    const tf = tbl.tFoot || tbl.createTFoot();
    tf.innerHTML = R.length ? "<tr>" + C.map((c, i) => i === 0 ? `<td>Total (${num(R.length)} rows)</td>` : c.sum ? `<td class="num">${cell(c, R.reduce((s, r) => s + (+c.get(r) || 0), 0))}</td>` : "<td></td>").join("") + "</tr>" : "";
    pg.innerHTML = `<button data-d="-1" ${st.page ? "" : "disabled"}>Previous</button><span>Page ${st.page + 1} of ${pages}</span><button data-d="1" ${st.page < pages - 1 ? "" : "disabled"}>Next</button><label>Rows per page <select>${[25, 50, 100, 250].map(n => `<option${n === st.size ? " selected" : ""}>${n}</option>`).join("")}</select></label>`;
  }
  draw();
};
