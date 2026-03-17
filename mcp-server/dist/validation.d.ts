/**
 * Post-operation validation logic.
 *
 * Compares requested state with actual state after operations execute.
 * Used by actor tools when the validate parameter is true.
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
export declare const TOLERANCES: {
    readonly location: 0.1;
    readonly rotation: 0.1;
    readonly scale: 0.001;
};
/**
 * Validate a location vector.
 */
export declare function validateLocation(actual: {
    x: number;
    y: number;
    z: number;
}, expected: {
    x: number;
    y: number;
    z: number;
}): ValidationResult;
/**
 * Validate a rotation.
 */
export declare function validateRotation(actual: {
    pitch: number;
    yaw: number;
    roll: number;
}, expected: {
    pitch: number;
    yaw: number;
    roll: number;
}): ValidationResult;
/**
 * Validate a scale vector.
 */
export declare function validateScale(actual: {
    x: number;
    y: number;
    z: number;
}, expected: {
    x: number;
    y: number;
    z: number;
}): ValidationResult;
//# sourceMappingURL=validation.d.ts.map