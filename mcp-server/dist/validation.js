/**
 * Post-operation validation logic.
 *
 * Compares requested state with actual state after operations execute.
 * Used by actor tools when the validate parameter is true.
 */
export const TOLERANCES = {
    location: 0.1,
    rotation: 0.1,
    scale: 0.001,
};
/**
 * Compare two numeric values within a tolerance.
 */
function isClose(actual, expected, tolerance) {
    return Math.abs(actual - expected) <= tolerance;
}
/**
 * Validate a location vector.
 */
export function validateLocation(actual, expected) {
    const errors = [];
    const tol = TOLERANCES.location;
    if (!isClose(actual.x, expected.x, tol)) {
        errors.push(`Location X: expected ${expected.x}, got ${actual.x}`);
    }
    if (!isClose(actual.y, expected.y, tol)) {
        errors.push(`Location Y: expected ${expected.y}, got ${actual.y}`);
    }
    if (!isClose(actual.z, expected.z, tol)) {
        errors.push(`Location Z: expected ${expected.z}, got ${actual.z}`);
    }
    return { valid: errors.length === 0, errors };
}
/**
 * Validate a rotation.
 */
export function validateRotation(actual, expected) {
    const errors = [];
    const tol = TOLERANCES.rotation;
    if (!isClose(actual.pitch, expected.pitch, tol)) {
        errors.push(`Rotation Pitch: expected ${expected.pitch}, got ${actual.pitch}`);
    }
    if (!isClose(actual.yaw, expected.yaw, tol)) {
        errors.push(`Rotation Yaw: expected ${expected.yaw}, got ${actual.yaw}`);
    }
    if (!isClose(actual.roll, expected.roll, tol)) {
        errors.push(`Rotation Roll: expected ${expected.roll}, got ${actual.roll}`);
    }
    return { valid: errors.length === 0, errors };
}
/**
 * Validate a scale vector.
 */
export function validateScale(actual, expected) {
    const errors = [];
    const tol = TOLERANCES.scale;
    if (!isClose(actual.x, expected.x, tol)) {
        errors.push(`Scale X: expected ${expected.x}, got ${actual.x}`);
    }
    if (!isClose(actual.y, expected.y, tol)) {
        errors.push(`Scale Y: expected ${expected.y}, got ${actual.y}`);
    }
    if (!isClose(actual.z, expected.z, tol)) {
        errors.push(`Scale Z: expected ${expected.z}, got ${actual.z}`);
    }
    return { valid: errors.length === 0, errors };
}
//# sourceMappingURL=validation.js.map