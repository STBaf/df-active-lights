/// <reference path="./types.d.ts" />
import EaseFunctions from "./EaseFunctions.mjs";
import SETTINGS from "../common/Settings.mjs";

/** Property on the AmbientLight placeable that holds its animator (null = "has no animation"). */
const ANIMATOR = Symbol('df-active-lights.animator');
/** Property on the AmbientLight placeable that holds the animated values while the source is initialised (fallback mode). */
const OVERRIDE = Symbol('df-active-lights.override');

/** Names of all animatable properties. */
const PROPERTY_NAMES = ['dim', 'bright', 'angle', 'rotation', 'tintColor', 'tintAlpha'];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * @param {number|string|null|undefined} value
 * @returns {number}
 */
function colorToNumber(value) {
	if (typeof value === 'number') return value;
	if (value instanceof Number) return value.valueOf();
	if (typeof value !== 'string' || value.length === 0) return 0;
	return parseInt(value[0] === '#' ? value.substring(1) : value, 16) || 0;
}

/**
 * @param {number} value
 * @returns {string}
 */
function numberToColor(value) {
	return '#' + (value & 0xffffff).toString(16).padStart(6, '0');
}

export default class LightAnimator {
	/**@readonly*/ static FLAG_ANIMS = 'anims';

	/** Cached value of the "enabled" setting (otherwise it would be read on every frame). */
	static #enabled = true;
	/**
	 * Whether the prepared (non-source) values of a light document can be overwritten temporarily.
	 * null = not tested yet.
	 * @type {boolean|null}
	 */
	static #mutationSupported = null;
	/** Whether the fallback wrapper for `_getLightSourceData` has been installed. */
	static #fallbackInstalled = false;
	/** Document ids for which a flag update is currently pending (prevents update spam from the ticker). */
	static #pendingUpdates = new Set();
	/** Lights for which an error was already logged. */
	static #erroredLights = new WeakSet();

	/* -------------------------------------------- */
	/*  Setup                                       */
	/* -------------------------------------------- */

	static init() {
		// Any update of a light (flags included) invalidates its animator so the new data gets picked up
		Hooks.on('updateAmbientLight', document => LightAnimator.invalidate(document.id));
		Hooks.on('deleteAmbientLight', document => LightAnimator.#pendingUpdates.delete(document.id));
	}

	static ready() {
		LightAnimator.#enabled = !!SETTINGS.get('enabled');
		const ticker = canvas?.app?.ticker;
		if (!ticker) {
			console.warn('DF Active Lights | No canvas ticker available, light animations are disabled.');
			return;
		}
		const priority = globalThis.PIXI?.UPDATE_PRIORITY?.HIGH ?? 50;
		ticker.add(LightAnimator.#onTick, LightAnimator, priority);
	}

	/**
	 * Called whenever the world setting changes (on every client).
	 * @param {boolean} enabled
	 */
	static onEnabledChanged(enabled) {
		LightAnimator.#enabled = !!enabled;
		if (enabled || !canvas?.ready) return;
		// Restore the original state of every light
		for (const light of LightAnimator.#getLights()) {
			const hadAnimator = !!light[ANIMATOR];
			delete light[ANIMATOR];
			if (hadAnimator) LightAnimator.#reinitialize(light);
		}
		LightAnimator.#requestPerceptionUpdate();
	}

	/**
	 * Drop the cached animator of every placeable (including config previews) that represents the given light.
	 * @param {string} documentId
	 */
	static invalidate(documentId) {
		if (!canvas?.ready || !documentId) return;
		let reinitialized = false;
		for (const light of LightAnimator.#getLights()) {
			if (light.document?.id !== documentId) continue;
			const hadAnimator = !!light[ANIMATOR];
			delete light[ANIMATOR];
			LightAnimator.#erroredLights.delete(light);
			// Flag changes don't make core re-initialise the source, so reset it to the document values
			if (hadAnimator) {
				LightAnimator.#reinitialize(light);
				reinitialized = true;
			}
		}
		if (reinitialized) LightAnimator.#requestPerceptionUpdate();
	}

	/* -------------------------------------------- */
	/*  Frame Loop                                  */
	/* -------------------------------------------- */

	static #onTick() {
		if (!LightAnimator.#enabled || !canvas?.ready || !canvas.lighting) return;
		let atLeastOneLight = false;
		for (const light of LightAnimator.#getLights()) {
			if (LightAnimator.#animateLight(light))
				atLeastOneLight = true;
		}
		if (atLeastOneLight) LightAnimator.#requestPerceptionUpdate();
	}

	/**
	 * All AmbientLight placeables of the viewed scene, plus the previews shown while a light config is open.
	 * @returns {foundry.canvas.placeables.AmbientLight[]}
	 */
	static #getLights() {
		const layer = canvas?.lighting;
		if (!layer) return [];
		const AmbientLight = foundry.canvas.placeables.AmbientLight;
		const lights = [...(layer.placeables ?? [])];
		for (const child of layer.preview?.children ?? []) {
			if (child instanceof AmbientLight) lights.push(child);
		}
		return lights;
	}

	/**
	 * The persisted document that holds the animation data. Previews use a clone of the document whose flags
	 * are not updated while the animation config is edited, so always read from the scene's document.
	 * @param {foundry.canvas.placeables.AmbientLight} light
	 * @returns {foundry.documents.AmbientLightDocument}
	 */
	static #getBaseDocument(light) {
		const document = light.document;
		const scene = document.parent ?? canvas.scene;
		return (document.id && scene?.lights?.get(document.id)) || document;
	}

	/**
	 * @param {foundry.canvas.placeables.AmbientLight} light
	 * @returns {boolean} whether the light source was updated
	 */
	static #animateLight(light) {
		if (!light || light.destroyed || !light.document) return false;
		try {
			const baseDocument = LightAnimator.#getBaseDocument(light);

			// Hidden lights don't animate. For "manual" animations, turning the light off resets its start time.
			if (light.document.hidden) {
				if (light[ANIMATOR]) delete light[ANIMATOR];
				if (!light.isPreview) LightAnimator.#resetTempOffset(baseDocument);
				return false;
			}

			let animator = light[ANIMATOR];
			if (animator === undefined) {
				/**@type {import("./types").AnimatorData}*/
				const animData = baseDocument.getFlag(SETTINGS.MOD_NAME, LightAnimator.FLAG_ANIMS);
				// Ignore any light that has no animations
				if (!animData || !Array.isArray(animData.keys) || animData.keys.length <= 1) {
					light[ANIMATOR] = null;
					return false;
				}
				animator = light[ANIMATOR] = new LightAnimator(light, baseDocument, foundry.utils.deepClone(animData));
			}
			if (!animator) return false;

			// Update the animation state
			const values = animator.tick();
			if (!values) return false;

			LightAnimator.#applyValues(light, values);
			return true;
		}
		// We catch all errors that might occur and print them to the console to
		// prevent them from propagating up and crashing the lighting system
		catch (error) {
			if (!LightAnimator.#erroredLights.has(light)) {
				LightAnimator.#erroredLights.add(light);
				console.error('DF Active Lights | Failed to animate light', light.document?.id, error);
			}
			light[ANIMATOR] = null;
			return false;
		}
	}

	/**
	 * @param {foundry.documents.AmbientLightDocument} document
	 */
	static #resetTempOffset(document) {
		if (!LightAnimator.#isResponsibleGM()) return;
		if (document.getFlag(SETTINGS.MOD_NAME, `${LightAnimator.FLAG_ANIMS}.tempOffset`) === undefined) return;
		LightAnimator.#queueFlagUpdate(document, () =>
			document.unsetFlag(SETTINGS.MOD_NAME, `${LightAnimator.FLAG_ANIMS}.tempOffset`));
	}

	/**
	 * @param {foundry.documents.AmbientLightDocument} document
	 * @param {() => Promise<any>} operation
	 */
	static #queueFlagUpdate(document, operation) {
		const id = document.id;
		if (!id || LightAnimator.#pendingUpdates.has(id)) return;
		LightAnimator.#pendingUpdates.add(id);
		Promise.resolve()
			.then(operation)
			.catch(error => console.error('DF Active Lights | Failed to update light flags', error))
			.finally(() => LightAnimator.#pendingUpdates.delete(id));
	}

	/** Only one GM should write the manual-start offset. */
	static #isResponsibleGM() {
		if (!game.user?.isGM) return false;
		if (typeof game.user.isActiveGM === 'boolean') return game.user.isActiveGM;
		const activeGM = game.users?.activeGM;
		return activeGM ? activeGM === game.user : true;
	}

	static #requestPerceptionUpdate() {
		try {
			canvas.perception.update({ refreshLighting: true, refreshVision: true });
		} catch (error) {
			console.debug('DF Active Lights | perception update failed', error);
		}
	}

	/**
	 * @param {foundry.canvas.placeables.AmbientLight} light
	 */
	static #reinitialize(light) {
		if (!light || light.destroyed) return;
		try {
			light.initializeLightSource();
			LightAnimator.#refreshControls(light);
		} catch (error) {
			console.error('DF Active Lights | Failed to reset light source', error);
		}
	}

	/**
	 * @param {foundry.canvas.placeables.AmbientLight} light
	 */
	static #refreshControls(light) {
		if (!canvas.lighting?.active) return;
		try {
			light.renderFlags?.set({ refreshField: true });
		} catch { /* render flag not available in this core version */ }
	}

	/* -------------------------------------------- */
	/*  Applying the animated values                */
	/* -------------------------------------------- */

	/**
	 * @param {foundry.canvas.placeables.AmbientLight} light
	 * @param {Partial<Record<string, number|string>>} values
	 */
	static #applyValues(light, values) {
		const document = light.document;
		LightAnimator.#mutationSupported ??= LightAnimator.#testMutation(document);

		if (LightAnimator.#mutationSupported) {
			// Temporarily overwrite the prepared values (never the source data!) so that core computes everything
			// else (radius in pixels, disabled state, levels, darkness range ...) exactly as it would for real data.
			const config = document.config;
			const saved = {
				dim: config.dim,
				bright: config.bright,
				angle: config.angle,
				color: config.color,
				alpha: config.alpha,
				rotation: document.rotation
			};
			try {
				if (values.dim !== undefined) config.dim = values.dim;
				if (values.bright !== undefined) config.bright = values.bright;
				if (values.angle !== undefined) config.angle = clamp(values.angle, 0, 360);
				if (values.tintAlpha !== undefined) config.alpha = clamp(values.tintAlpha, 0, 1);
				if (values.tintColor !== undefined) config.color = foundry.utils.Color.from(values.tintColor);
				if (values.rotation !== undefined) document.rotation = values.rotation;
				light.initializeLightSource();
			} finally {
				config.dim = saved.dim;
				config.bright = saved.bright;
				config.angle = saved.angle;
				config.color = saved.color;
				config.alpha = saved.alpha;
				document.rotation = saved.rotation;
			}
		} else {
			LightAnimator.#installFallback();
			light[OVERRIDE] = values;
			try {
				light.initializeLightSource();
			} finally {
				delete light[OVERRIDE];
			}
		}
		LightAnimator.#refreshControls(light);
	}

	/**
	 * Test once whether the prepared values of the document can be assigned (and restored) directly.
	 * @param {foundry.documents.AmbientLightDocument} document
	 * @returns {boolean}
	 */
	static #testMutation(document) {
		const config = document.config;
		const test = (target, key, probe) => {
			const original = target[key];
			let ok = false;
			try {
				target[key] = probe;
				ok = target[key] === probe;
			} catch {
				ok = false;
			}
			try {
				target[key] = original;
				if (target[key] !== original) ok = false;
			} catch {
				ok = false;
			}
			return ok;
		};
		const supported = !!config
			&& test(config, 'dim', (config.dim ?? 0) + 1)
			&& test(config, 'color', config.color)
			&& test(document, 'rotation', (document.rotation ?? 0) + 1);
		if (!supported) console.info('DF Active Lights | Using the _getLightSourceData fallback.');
		return supported;
	}

	/**
	 * Fallback: override the light source data instead of the document's prepared values.
	 * Limitation: a light whose own radius or angle is 0 stays disabled in this mode.
	 */
	static #installFallback() {
		if (LightAnimator.#fallbackInstalled) return;
		LightAnimator.#fallbackInstalled = true;
		const target = 'foundry.canvas.placeables.AmbientLight.prototype._getLightSourceData';
		const wrapper = function (wrapped, ...args) {
			const data = wrapped(...args);
			const values = this[OVERRIDE];
			return values ? LightAnimator.#overrideSourceData(this, data, values) : data;
		};
		if (globalThis.libWrapper) {
			libWrapper.register(SETTINGS.MOD_NAME, target, wrapper, 'WRAPPER');
		} else {
			const proto = foundry.canvas.placeables.AmbientLight.prototype;
			const original = proto._getLightSourceData;
			proto._getLightSourceData = function (...args) {
				return wrapper.call(this, original.bind(this), ...args);
			};
		}
	}

	/**
	 * @param {foundry.canvas.placeables.AmbientLight} light
	 * @param {object} data
	 * @param {Partial<Record<string, number|string>>} values
	 * @returns {object}
	 */
	static #overrideSourceData(light, data, values) {
		const config = light.document.config;
		const dimensions = light.scene?.dimensions ?? canvas.dimensions;
		if (values.dim !== undefined || values.bright !== undefined) {
			const pixels = dimensions.distancePixels ?? (dimensions.size / dimensions.distance);
			const maxR = dimensions.maxR ?? Infinity;
			const bright = Math.abs(values.bright ?? config.bright);
			const dim = Math.max(Math.abs(values.dim ?? config.dim), bright);
			data.bright = clamp(bright * pixels, 0, maxR);
			data.dim = clamp(dim * pixels, 0, maxR);
		}
		if (values.angle !== undefined) data.angle = clamp(values.angle, 0, 360);
		if (values.rotation !== undefined) data.rotation = values.rotation;
		if (values.tintAlpha !== undefined) data.alpha = clamp(values.tintAlpha, 0, 1);
		if (values.tintColor !== undefined) data.color = foundry.utils.Color.from(values.tintColor);
		if (!(data.dim > 0 || data.bright > 0) || data.angle === 0) data.disabled = true;
		return data;
	}

	/* -------------------------------------------- */
	/*  Animator Instance                           */
	/* -------------------------------------------- */

	/**@type {import("./types").AnimatorData}*/ #data;
	/**@type {foundry.canvas.placeables.AmbientLight}*/ #light;
	/**@type {foundry.documents.AmbientLightDocument}*/ #document;
	/**@type {Map<string, import("./types").PropertyKeyFrame>}*/ #props;

	get offset() { return this.#data.offset; }
	get duration() { return this.#data.keys[this.#data.keys.length - 1].time; }
	get keys() { return this.#data.keys; }

	/**
	 * @param {foundry.canvas.placeables.AmbientLight} light
	 * @param {foundry.documents.AmbientLightDocument} document the persisted document holding the flags
	 * @param {import("./types").AnimatorData} data
	 */
	constructor(light, document, data) {
		this.#data = data;
		this.#light = light;
		this.#document = document;
		data.keys.sort((a, b) => a.time - b.time);
		if (data.keys[0].time !== 0) {
			console.warn('DF Active Lights | Malformed first keyframe! Time was not 0, forcing to zero.');
			data.keys[0].time = 0;
		}
		const keys = data.keys.slice(0).reverse();
		this.#props = new Map();

		for (const key of keys) {
			for (const deltaName of PROPERTY_NAMES) {
				const delta = key[deltaName];
				// Ignore disabled property animators
				if (!delta?.enabled) continue;
				// create the new head
				/**@type {import("./types").PropertyKeyFrame}*/
				const newProp = {
					name: deltaName,
					value: delta.value,
					func: delta.func,
					isColor: deltaName === 'tintColor' || !!delta.isColor,
					time: key.time,
					enabled: true,
					next: this.#props.get(deltaName),
				};
				// Link the old head to this new one
				if (newProp.next)
					newProp.next.prev = newProp;
				this.#props.set(deltaName, newProp);
			}
		}
	}

	/**
	 * Calculate the animated values for the current server time.
	 * @returns {Partial<Record<string, number|string>> | null}
	 */
	tick() {
		if (this.#data.keys.length <= 1 || this.#props.size === 0) return null;
		const duration = this.duration;
		if (!(duration > 0)) return null;
		let offset = Number(this.offset) || 0;
		// Handle a light source that has its start managed manually
		if (this.#data.manual) {
			const flagKey = `${LightAnimator.FLAG_ANIMS}.tempOffset`;
			// If GM and the light source just turned on, set the tempOffset to be a pad on the duration.
			if (!this.#light.isPreview && this.#data.tempOffset === undefined && LightAnimator.#isResponsibleGM()) {
				this.#data.tempOffset = duration - (game.time.serverTime % duration);
				const value = this.#data.tempOffset;
				LightAnimator.#queueFlagUpdate(this.#document, () =>
					this.#document.setFlag(SETTINGS.MOD_NAME, flagKey, value));
			}
			offset = this.#document.getFlag(SETTINGS.MOD_NAME, flagKey) ?? this.#data.tempOffset;
		}
		// Calculate the current time relative to the animation loop.
		// Until the GM has started a manual animation, it stays on its first frame.
		const time = offset === undefined ? 0 : (game.time.serverTime + offset) % duration;
		/**@type {Partial<Record<string, number|string>>}*/
		const values = {};
		for (const prop of this.#props.values()) {
			const value = this.#process(prop, time);
			if (value !== undefined) values[prop.name] = value;
		}
		return values;
	}

	/**
	 * @param {import("./types").PropertyKeyFrame} prop head of the property's key frame chain
	 * @param {number} time
	 * @returns {number|string|undefined}
	 */
	#process(prop, time) {
		let frame = prop;
		// Find the frame we are currently in
		while (frame.next && frame.next.time <= time) frame = frame.next;
		// The time has gone past the last key frame containing something to change here:
		// hold the value the last transition ended on (v12 kept this value implicitly).
		if (frame.time < time && !frame.next) {
			const prev = frame.prev;
			if (!prev) return this.#toOutput(prop, this.#convert(frame.value));
			return this.#evaluate(prop, this.#convert(prev.value), this.#convert(frame.value), prev.func, 1);
		}
		// Before the first key frame of this property (or exactly on the last one): use its value
		if (frame.time >= time || !frame.next) {
			return this.#toOutput(prop, this.#convert(frame.value));
		}
		const startValue = this.#convert(frame.value);
		const endValue = this.#convert(frame.next.value);
		// Calculate the time factor (0-1) to be passed into the easing function
		let timeFactor = clamp((time - frame.time) / (frame.next.time - frame.time), 0, 1);
		// If the time calculation produces a NaN (which can happen), we just set it to 0 and move on
		if (Number.isNaN(timeFactor)) timeFactor = 0;
		return this.#evaluate(prop, startValue, endValue, frame.func, timeFactor);
	}

	/**
	 * @param {import("./types").PropertyKeyFrame} prop
	 * @param {number} startValue
	 * @param {number} endValue
	 * @param {string|undefined} func
	 * @param {number} timeFactor
	 * @returns {number|string}
	 */
	#evaluate(prop, startValue, endValue, func, timeFactor) {
		if (this.#data.bounce)
			timeFactor = timeFactor <= 0.5
				? timeFactor / 0.5
				: (0.5 - (timeFactor - 0.5)) / 0.5;
		// Calculate the value factor from the easing function
		const ease = EaseFunctions[func] ?? EaseFunctions.linear;
		const valueFactor = ease(timeFactor);
		if (prop.isColor) {
			const r = ((startValue >> 16) & 0xff) + Math.round((((endValue >> 16) & 0xff) - ((startValue >> 16) & 0xff)) * valueFactor);
			const g = ((startValue >> 8) & 0xff) + Math.round((((endValue >> 8) & 0xff) - ((startValue >> 8) & 0xff)) * valueFactor);
			const b = (startValue & 0xff) + Math.round(((endValue & 0xff) - (startValue & 0xff)) * valueFactor);
			return numberToColor((clamp(r, 0, 255) << 16) | (clamp(g, 0, 255) << 8) | clamp(b, 0, 255));
		}
		return startValue + ((endValue - startValue) * valueFactor);
	}

	/**
	 * @param {import("./types").PropertyKeyFrame} prop
	 * @param {number} value
	 * @returns {number|string}
	 */
	#toOutput(prop, value) {
		return prop.isColor ? numberToColor(value) : value;
	}

	/**
	 * @param {number|string} value
	 * @returns {number}
	 */
	#convert(value) {
		if (typeof value === 'number') return value;
		if (typeof value === 'string') return colorToNumber(value);
		return Number(value) || 0;
	}
}
