// Minimal 3D rotation helpers. Matrices are 3x3, row-major arrays of 9 numbers.
// Rotation matrices map vectors expressed in a child frame into the parent frame
// (e.g. R_world<-head: columns are the head axes written in world coordinates).

export const DEG = Math.PI / 180;

export const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j];
    }
  }
  return r;
}

export const mulAll = (...ms) => ms.reduce((acc, m) => mul(acc, m));

export function transpose(a) {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
}

export function mulV(a, v) {
  return [
    a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
    a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
    a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
  ];
}

// a^T v without building the transpose.
export function mulTV(a, v) {
  return [
    a[0] * v[0] + a[3] * v[1] + a[6] * v[2],
    a[1] * v[0] + a[4] * v[1] + a[7] * v[2],
    a[2] * v[0] + a[5] * v[1] + a[8] * v[2],
  ];
}

export function rotX(deg) {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

export function rotY(deg) {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

export function rotZ(deg) {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

// W3C DeviceOrientation: R = Rz(alpha) * Rx(beta) * Ry(gamma), mapping device -> earth frame.
export function fromDeviceOrientation(alpha, beta, gamma) {
  return mulAll(rotZ(alpha), rotX(beta), rotY(gamma));
}

export const col = (m, j) => [m[j], m[3 + j], m[6 + j]];

export function fromColumns(a, b, c) {
  return [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];
}

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export function normalize(a) {
  const n = norm(a);
  return n > 1e-12 ? scale(a, 1 / n) : [0, 0, 0];
}

const clamp1 = (x) => Math.max(-1, Math.min(1, x));

export function angleBetween(a, b) {
  return Math.acos(clamp1(dot(normalize(a), normalize(b))));
}

export function rotationAngle(R) {
  return Math.acos(clamp1((R[0] + R[4] + R[8] - 1) / 2));
}

// Axis-angle vector (radians) of a rotation matrix.
export function rotationVector(R) {
  const th = rotationAngle(R);
  if (th < 1e-6) {
    return [(R[7] - R[5]) / 2, (R[2] - R[6]) / 2, (R[3] - R[1]) / 2];
  }
  if (Math.PI - th < 1e-3) {
    // Near 180°: recover the axis from the symmetric part.
    const xx = Math.sqrt(Math.max(0, (R[0] + 1) / 2));
    const yy = Math.sqrt(Math.max(0, (R[4] + 1) / 2));
    const zz = Math.sqrt(Math.max(0, (R[8] + 1) / 2));
    let axis;
    if (xx >= yy && xx >= zz) axis = [xx, (R[1] + R[3]) / (4 * xx), (R[2] + R[6]) / (4 * xx)];
    else if (yy >= zz) axis = [(R[1] + R[3]) / (4 * yy), yy, (R[5] + R[7]) / (4 * yy)];
    else axis = [(R[2] + R[6]) / (4 * zz), (R[5] + R[7]) / (4 * zz), zz];
    return scale(normalize(axis), th);
  }
  const k = th / (2 * Math.sin(th));
  return [(R[7] - R[5]) * k, (R[2] - R[6]) * k, (R[3] - R[1]) * k];
}

// Rotation of `deg` degrees about unit `axis` (Rodrigues).
export function axisAngle(axis, deg) {
  const [x, y, z] = normalize(axis);
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG), t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}
