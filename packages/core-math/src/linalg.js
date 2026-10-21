// =============================================================================
// linalg.js — dense linear algebra for small systems
// -----------------------------------------------------------------------------
// Mechanism problems are small (tens of unknowns), so simple dense methods are
// fast enough and easy to read. Matrices are arrays of row arrays: M[i][j].
// =============================================================================

/** Create an m×n matrix filled with zeros. */
export function zeros(m, n) {
  return Array.from({ length: m }, () => new Array(n).fill(0));
}

export function matVec(M, v) {
  return M.map((row) => row.reduce((s, a, j) => s + a * v[j], 0));
}

export function transpose(M) {
  if (M.length === 0) return [];
  return M[0].map((_, j) => M.map((row) => row[j]));
}

export const norm = (v) => Math.sqrt(v.reduce((s, a) => s + a * a, 0));
export const normInf = (v) => v.reduce((m, a) => Math.max(m, Math.abs(a)), 0);

/**
 * Solve the square system A x = b by Gaussian elimination with partial
 * pivoting. Returns null when the matrix is singular (to tolerance `tol`,
 * relative to the largest entry).
 */
export function solve(A, b, tol = 1e-12) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  let maxAbs = 0;
  for (const row of A) for (const a of row) maxAbs = Math.max(maxAbs, Math.abs(a));
  const thresh = tol * Math.max(maxAbs, 1e-300);

  for (let k = 0; k < n; k++) {
    // choose the largest pivot in column k
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (Math.abs(M[p][k]) <= thresh) return null;
    if (p !== k) [M[p], M[k]] = [M[k], M[p]];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      if (f === 0) continue;
      for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/**
 * Numerical rank of a matrix (Gaussian elimination with full pivoting).
 * Used to find the true degrees of freedom of a mechanism, which can differ
 * from the Gruebler count for special geometry (e.g. parallelograms).
 */
export function rank(A, tol = 1e-9) {
  const m = A.length;
  if (m === 0) return 0;
  const n = A[0].length;
  const M = A.map((r) => r.slice());
  let maxAbs = 0;
  for (const row of M) for (const a of row) maxAbs = Math.max(maxAbs, Math.abs(a));
  if (maxAbs === 0) return 0;
  const thresh = tol * maxAbs;
  let r = 0;
  const usedCol = new Array(n).fill(false);
  for (let step = 0; step < Math.min(m, n); step++) {
    let bi = -1, bj = -1, best = thresh;
    for (let i = r; i < m; i++) {
      for (let j = 0; j < n; j++) {
        if (usedCol[j]) continue;
        if (Math.abs(M[i][j]) > best) { best = Math.abs(M[i][j]); bi = i; bj = j; }
      }
    }
    if (bi < 0) break;
    [M[bi], M[r]] = [M[r], M[bi]];
    usedCol[bj] = true;
    for (let i = r + 1; i < m; i++) {
      const f = M[i][bj] / M[r][bj];
      if (f === 0) continue;
      for (let j = 0; j < n; j++) M[i][j] -= f * M[r][j];
    }
    r++;
  }
  return r;
}

/**
 * Damped least squares step (Levenberg–Marquardt):
 *   minimise |J dx + f|² + mu |dx|²
 * Works for square, over- and under-determined systems. For an
 * under-determined system it returns the smallest correction, which is what
 * makes dragging a partly-built mechanism feel natural.
 */
export function dampedLeastSquares(J, f, mu) {
  const m = J.length, n = m ? J[0].length : 0;
  if (n === 0) return [];
  if (m <= n) {
    // dx = -Jᵀ (J Jᵀ + mu I)⁻¹ f      (m×m system, cheap when m ≤ n)
    const JJt = zeros(m, m);
    for (let i = 0; i < m; i++) {
      for (let k = i; k < m; k++) {
        let s = 0;
        for (let j = 0; j < n; j++) s += J[i][j] * J[k][j];
        JJt[i][k] = JJt[k][i] = s;
      }
      JJt[i][i] += mu;
    }
    const y = solve(JJt, f.map((v) => -v), 1e-15);
    if (!y) return null;
    const dx = new Array(n).fill(0);
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) dx[j] += J[i][j] * y[i];
    return dx;
  }
  // dx = -(JᵀJ + mu I)⁻¹ Jᵀ f        (n×n system when m > n)
  const JtJ = zeros(n, n), Jtf = new Array(n).fill(0);
  for (let a = 0; a < n; a++) {
    for (let b = a; b < n; b++) {
      let s = 0;
      for (let i = 0; i < m; i++) s += J[i][a] * J[i][b];
      JtJ[a][b] = JtJ[b][a] = s;
    }
    JtJ[a][a] += mu;
    for (let i = 0; i < m; i++) Jtf[a] -= J[i][a] * f[i];
  }
  return solve(JtJ, Jtf, 1e-15);
}
