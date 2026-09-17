// Type hints for the JSDoc annotations (Foundry VTT v14)

declare type EaseFunction = (x: number) => number;

declare interface EaseFunctionRegister {
	linear: EaseFunction;
	linearLoop: EaseFunction;
	quadIn: EaseFunction;
	quadOut: EaseFunction;
	quadFull: EaseFunction;
	quadLoop: EaseFunction;
	ellipseIn: EaseFunction;
	ellipseOut: EaseFunction;
	ellipseFull: EaseFunction;
	ellipseLoop: EaseFunction;
	fixedStart: EaseFunction;
	fixedEnd: EaseFunction;
}

export declare interface PropertyDelta {
	value: number | string;
	enabled: boolean;
	func?: keyof EaseFunctionRegister;
	isColor?: boolean;
}

export declare interface KeyFrame {
	/** Position of the key frame in milliseconds */
	time: number;
	angle: PropertyDelta;
	bright: PropertyDelta;
	dim: PropertyDelta;
	rotation: PropertyDelta;
	tintAlpha: PropertyDelta;
	tintColor: PropertyDelta;
}

/** Stored in `flags["df-active-lights"].anims` of an AmbientLight document */
export declare interface AnimatorData {
	offset: number;
	bounce: boolean;
	keys: KeyFrame[];
	manual: boolean;
	/** Maintained by the active GM for "manual" animations */
	tempOffset?: number;
}

export declare interface PropertyKeyFrame extends PropertyDelta {
	name: string;
	time: number;
	next?: PropertyKeyFrame;
	prev?: PropertyKeyFrame;
}
