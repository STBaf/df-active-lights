/// <reference path="./types.d.ts" />
import SETTINGS from "../common/Settings.mjs";
import LightAnimator from "./LightAnimator.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** @type {(path: string, data: object) => Promise<string>} */
const renderTemplate = (path, data) =>
	(foundry.applications.handlebars?.renderTemplate ?? globalThis.renderTemplate)(path, data);

const TEMPLATE_CONFIG = `modules/${SETTINGS.MOD_NAME}/templates/active-light-config.hbs`;
const TEMPLATE_PROPS = `modules/${SETTINGS.MOD_NAME}/templates/active-light-props.hbs`;

/** Animatable properties, in display order. */
const PROPERTIES = [
	{ name: 'dim', label: 'DF_ACTIVE_LIGHTS.Props.Dim', isColor: false },
	{ name: 'bright', label: 'DF_ACTIVE_LIGHTS.Props.Bright', isColor: false },
	{ name: 'angle', label: 'DF_ACTIVE_LIGHTS.Props.Angle', isColor: false },
	{ name: 'rotation', label: 'DF_ACTIVE_LIGHTS.Props.Rotation', isColor: false },
	{ name: 'tintColor', label: 'DF_ACTIVE_LIGHTS.Props.TintColor', isColor: true },
	{ name: 'tintAlpha', label: 'DF_ACTIVE_LIGHTS.Props.TintAlpha', isColor: false }
];

/** Easing functions, in display order. */
const FUNCTIONS = [
	['linear', 'Linear'],
	['linearLoop', 'LinearLoop'],
	['fixedStart', 'FixedStart'],
	['fixedEnd', 'FixedEnd'],
	['quadIn', 'QuadIn'],
	['quadOut', 'QuadOut'],
	['quadFull', 'QuadFull'],
	['quadLoop', 'QuadLoop'],
	['ellipseIn', 'EllipseIn'],
	['ellipseOut', 'EllipseOut'],
	['ellipseFull', 'EllipseFull'],
	['ellipseLoop', 'EllipseLoop']
];

/**
 * @param {number} ms
 * @returns {string}
 */
function formatSeconds(ms) {
	return (Math.round(ms) / 1000).toString();
}

/**
 * @param {*} value
 * @returns {string}
 */
function toCssColor(value) {
	if (value === null || value === undefined || value === '') return '#000000';
	try {
		return foundry.utils.Color.from(value).css;
	} catch {
		return '#000000';
	}
}

export default class ActiveLightConfig extends HandlebarsApplicationMixin(ApplicationV2) {

	/** One window per light document. @type {Map<string, ActiveLightConfig>} */
	static #instances = new Map();

	static DEFAULT_OPTIONS = {
		classes: ['dfal-config'],
		tag: 'div',
		window: {
			icon: 'fa-solid fa-film',
			resizable: true
		},
		position: {
			width: 640,
			height: 'auto'
		},
		actions: {
			addKeyframe: ActiveLightConfig.#onAddKeyframe,
			selectKeyframe: ActiveLightConfig.#onSelectKeyframe,
			deleteKeyframe: ActiveLightConfig.#onDeleteKeyframe,
			randomizeOffset: ActiveLightConfig.#onRandomizeOffset
		}
	};

	static PARTS = {
		main: { template: TEMPLATE_CONFIG }
	};

	/* -------------------------------------------- */
	/*  Integration into the Ambient Light config   */
	/* -------------------------------------------- */

	static init() {
		// AmbientLightConfig is an ApplicationV2: the hook receives (application, element: HTMLElement, context, options)
		Hooks.on('renderAmbientLightConfig', ActiveLightConfig.#onRenderAmbientLightConfig);
		Hooks.on('deleteAmbientLight', document => {
			const app = ActiveLightConfig.#instances.get(document.uuid);
			ActiveLightConfig.#instances.delete(document.uuid);
			app?.close();
		});
		Hooks.on('canvasTearDown', () => {
			for (const app of ActiveLightConfig.#instances.values()) app.close();
			ActiveLightConfig.#instances.clear();
		});
	}

	/**
	 * Open (or focus) the animation config for a light.
	 * @param {foundry.documents.AmbientLightDocument} document
	 */
	static open(document) {
		let app = ActiveLightConfig.#instances.get(document.uuid);
		if (!app) {
			app = new ActiveLightConfig(document);
			ActiveLightConfig.#instances.set(document.uuid, app);
		}
		if (app.rendered) {
			if (app.minimized) app.maximize();
			app.bringToFront?.();
		}
		else app.render({ force: true });
		return app;
	}

	/**
	 * @param {foundry.applications.api.DocumentSheetV2} app
	 * @param {HTMLElement} element
	 */
	static #onRenderAmbientLightConfig(app, element) {
		if (!game.user.isGM) return;
		const lightDocument = app.document;
		// Only persisted lights can store animations (not lights that are still being created)
		if (!lightDocument || lightDocument.documentName !== 'AmbientLight' || !lightDocument.id || !lightDocument.parent) return;
		const root = element instanceof HTMLElement ? element : (element?.[0] ?? app.element);
		if (!root) return;
		// The hook also fires for partial re-renders, don't inject twice
		if (root.querySelector('button[data-dfal-open]')) return;

		const tab = root.querySelector('.tab[data-tab="animation"]')
			?? root.querySelector('section[data-tab="animation"]')
			?? root.querySelector('div[data-tab="animation"]');
		if (!tab) return;
		const container = tab.querySelector('fieldset') ?? tab;

		const button = document.createElement('button');
		button.type = 'button';
		button.dataset.dfalOpen = '';
		button.classList.add('dfal-open-button');
		button.innerHTML = `<i class="fa-solid fa-gears"></i> ${game.i18n.localize('DF_ACTIVE_LIGHTS.Config.OpenButton')}`;
		button.addEventListener('click', event => {
			event.preventDefault();
			ActiveLightConfig.open(lightDocument);
		});
		container.append(button);
	}

	/* -------------------------------------------- */
	/*  Instance                                    */
	/* -------------------------------------------- */

	/**@type {foundry.documents.AmbientLightDocument}*/ #document;
	/**@type {import("./types").AnimatorData}*/ #data;
	/** Index of the selected key frame */ #selected = 0;
	/** Guards against out-of-order async renders of the property panel */ #propsRenderId = 0;

	/**
	 * @param {foundry.documents.AmbientLightDocument} document
	 * @param {object} [options]
	 */
	constructor(document, options = {}) {
		super(foundry.utils.mergeObject({
			id: `dfal-${document.parent.id}-${document.id}`,
			window: {
				title: game.i18n.localize('DF_ACTIVE_LIGHTS.Config.Title') + (document.name || document.id)
			}
		}, options));
		this.#document = document;
		this.#loadData();
	}

	/** The light document this window configures. */
	get lightDocument() { return this.#document; }

	#loadData() {
		const document = this.#document;
		const flag = document.getFlag(SETTINGS.MOD_NAME, LightAnimator.FLAG_ANIMS);
		/**@type {import("./types").AnimatorData}*/
		let data;
		if (!flag || !Array.isArray(flag.keys) || flag.keys.length === 0) {
			data = {
				bounce: false,
				offset: 0,
				manual: false,
				keys: [ActiveLightConfig.#createKeyFrame(0, document)]
			};
		} else {
			data = foundry.utils.deepClone(flag);
			// The start offset of manual animations is maintained by the animator, never by this editor
			delete data.tempOffset;
		}
		data.bounce = !!data.bounce;
		data.manual = !!data.manual;
		data.offset = Number(data.offset) || 0;
		data.keys.sort((a, b) => a.time - b.time);
		data.keys[0].time = 0;
		// Normalise older data
		const defaults = ActiveLightConfig.#createKeyFrame(0, document);
		for (const key of data.keys) {
			for (const { name, isColor } of PROPERTIES) {
				key[name] = foundry.utils.mergeObject(foundry.utils.deepClone(defaults[name]), key[name] ?? {}, { inplace: false });
				key[name].func ??= 'linear';
				if (isColor) key[name].value = toCssColor(key[name].value);
			}
		}
		this.#data = data;
		this.#selected = 0;
	}

	/**
	 * @param {number} time
	 * @param {foundry.documents.AmbientLightDocument} [document]
	 * @returns {import("./types").KeyFrame}
	 */
	static #createKeyFrame(time, document) {
		const config = document?.config;
		return {
			time,
			angle: { enabled: false, value: config?.angle ?? 360, func: 'linear' },
			bright: { enabled: false, value: config?.bright ?? 0, func: 'linear' },
			dim: { enabled: false, value: config?.dim ?? 0, func: 'linear' },
			rotation: { enabled: false, value: document?.rotation ?? 0, func: 'linear' },
			tintAlpha: { enabled: false, value: config?.alpha ?? 0.5, func: 'linear' },
			tintColor: { enabled: false, value: toCssColor(config?.color), func: 'linear', isColor: true }
		};
	}

	/* -------------------------------------------- */
	/*  Rendering                                   */
	/* -------------------------------------------- */

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		// Always start from the stored data when the window is (re)opened
		if (options.isFirstRender) this.#loadData();
		return Object.assign(context, {
			appId: this.id,
			bounce: this.#data.bounce,
			offset: this.#data.offset === 0 ? '' : this.#data.offset,
			manual: this.#data.manual
		});
	}

	/** @override */
	async _onFirstRender(context, options) {
		await super._onFirstRender(context, options);
		// Delegated listener: the content is replaced on every render, the application element is not
		this.element.addEventListener('change', event => this.#onChange(event));
	}

	/** @override */
	async _onRender(context, options) {
		await super._onRender(context, options);
		this.#renderKeys();
		await this.#renderProps();
	}

	#renderKeys() {
		const list = this.element?.querySelector('.dfal-keys');
		if (!list) return;
		const seconds = game.i18n.localize('DF_ACTIVE_LIGHTS.Seconds');
		const deleteLabel = game.i18n.localize('DF_ACTIVE_LIGHTS.Config.DeleteKey');
		const items = this.#data.keys.map((key, index) => {
			const item = document.createElement('li');
			item.dataset.action = 'selectKeyframe';
			item.dataset.index = String(index);
			item.classList.toggle('active', index === this.#selected);
			const label = document.createElement('span');
			label.textContent = `${formatSeconds(key.time)} ${seconds}`;
			item.append(label);
			if (index > 0) {
				const remove = document.createElement('a');
				remove.classList.add('dfal-delete');
				remove.dataset.action = 'deleteKeyframe';
				remove.dataset.index = String(index);
				remove.dataset.tooltip = deleteLabel;
				remove.setAttribute('aria-label', deleteLabel);
				remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
				item.append(remove);
			}
			return item;
		});
		list.replaceChildren(...items);
		list.querySelector('li.active')?.scrollIntoView({ block: 'nearest' });
	}

	async #renderProps() {
		const container = this.element?.querySelector('.dfal-props');
		if (!container) return;
		const renderId = ++this.#propsRenderId;
		const keyFrame = this.#data.keys[this.#selected] ?? this.#data.keys[0];
		const html = await renderTemplate(TEMPLATE_PROPS, {
			appId: this.id,
			first: this.#selected === 0,
			time: keyFrame.time,
			enableLabel: game.i18n.localize('DF_ACTIVE_LIGHTS.Props.Enable'),
			props: PROPERTIES.map(({ name, label, isColor }) => {
				const delta = keyFrame[name];
				return {
					name,
					label: game.i18n.localize(label),
					isColor,
					enabled: !!delta.enabled,
					value: delta.value,
					funcs: FUNCTIONS.map(([value, key]) => ({
						value,
						label: game.i18n.localize(`DF_ACTIVE_LIGHTS.Funcs.${key}`),
						selected: value === (delta.func ?? 'linear')
					}))
				};
			})
		});
		// A newer render was started in the meantime
		if (renderId !== this.#propsRenderId || !this.element) return;
		container.innerHTML = html;
	}

	/* -------------------------------------------- */
	/*  Event Handlers                              */
	/* -------------------------------------------- */

	/**
	 * @param {Event} event
	 */
	async #onChange(event) {
		/**@type {HTMLInputElement|HTMLSelectElement}*/
		const target = event.target;
		if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
		const data = this.#data;

		switch (target.name) {
			case 'bounce':
				data.bounce = target.checked;
				return this.#save();
			case 'offset': {
				const value = Math.max(0, Math.round(target.valueAsNumber));
				data.offset = Number.isFinite(value) ? value : 0;
				return this.#save();
			}
			case 'manual':
				data.manual = target.checked;
				this.#updateManualState();
				return this.#save();
			case 'time':
				return this.#onChangeTime(target);
		}

		const row = target.closest('[data-prop]');
		const field = target.dataset.field;
		if (!row || !field) return;
		const delta = data.keys[this.#selected]?.[row.dataset.prop];
		if (!delta) return;

		switch (field) {
			case 'enabled':
				delta.enabled = target.checked;
				for (const input of row.querySelectorAll('[data-field="value"], [data-field="func"]'))
					input.disabled = !target.checked;
				break;
			case 'value':
				if (target.type === 'color') delta.value = target.value;
				else {
					const value = target.valueAsNumber;
					if (!Number.isFinite(value)) {
						target.value = String(delta.value);
						return;
					}
					delta.value = value;
				}
				break;
			case 'func':
				delta.func = target.value;
				break;
			default:
				return;
		}
		return this.#save();
	}

	/**
	 * @param {HTMLInputElement} input
	 */
	async #onChangeTime(input) {
		const keys = this.#data.keys;
		const keyFrame = keys[this.#selected];
		if (!keyFrame || this.#selected === 0) {
			input.value = '0';
			return;
		}
		const newValue = Math.round(input.valueAsNumber);
		// No keyframe other than the first can be set to zero (or below)
		if (!Number.isFinite(newValue) || newValue <= 0) {
			input.value = String(keyFrame.time);
			ui.notifications.warn(game.i18n.localize('DF_ACTIVE_LIGHTS.Warnings.KeyFrame_Zero'));
			return;
		}
		// If the value is equal to another keyframe, reset it to the previous value
		if (keys.some(x => x !== keyFrame && x.time === newValue)) {
			input.value = String(keyFrame.time);
			ui.notifications.warn(game.i18n.localize('DF_ACTIVE_LIGHTS.Warnings.KeyFrame_Exists')
				.replace('{0}', formatSeconds(newValue)));
			return;
		}
		keyFrame.time = newValue;
		keys.sort((a, b) => a.time - b.time);
		this.#selected = keys.indexOf(keyFrame);
		this.#renderKeys();
		await this.#save();
	}

	#updateManualState() {
		const manual = this.#data.manual;
		const root = this.element;
		if (!root) return;
		const offset = root.querySelector('input[name="offset"]');
		if (offset) offset.disabled = manual;
		const randomize = root.querySelector('[data-action="randomizeOffset"]');
		if (randomize) randomize.disabled = manual;
		root.querySelector('.dfal-offset-label')?.classList.toggle('dfal-strike', manual);
	}

	/**
	 * @this {ActiveLightConfig}
	 */
	static async #onAddKeyframe() {
		const keys = this.#data.keys;
		// Create KeyFrame and set time to Duration + 1 second
		const keyFrame = ActiveLightConfig.#createKeyFrame(keys[keys.length - 1].time + 1000, this.#document);
		keys.push(keyFrame);
		this.#selected = keys.length - 1;
		this.#renderKeys();
		await this.#renderProps();
		await this.#save();
	}

	/**
	 * @this {ActiveLightConfig}
	 * @param {PointerEvent} _event
	 * @param {HTMLElement} target
	 */
	static async #onSelectKeyframe(_event, target) {
		const index = Number(target.dataset.index);
		if (!Number.isInteger(index) || index === this.#selected || !this.#data.keys[index]) return;
		this.#selected = index;
		for (const item of this.element.querySelectorAll('.dfal-keys > li'))
			item.classList.toggle('active', Number(item.dataset.index) === index);
		await this.#renderProps();
	}

	/**
	 * @this {ActiveLightConfig}
	 * @param {PointerEvent} event
	 * @param {HTMLElement} target
	 */
	static async #onDeleteKeyframe(event, target) {
		event.stopPropagation();
		const index = Number(target.dataset.index);
		// The 0 second keyframe cannot be deleted
		if (!Number.isInteger(index) || index <= 0 || !this.#data.keys[index]) return;
		this.#data.keys.splice(index, 1);
		// If the keyframe was the current one, activate the previous keyframe.
		if (this.#selected === index) this.#selected = index - 1;
		else if (this.#selected > index) this.#selected -= 1;
		this.#renderKeys();
		await this.#renderProps();
		await this.#save();
	}

	/**
	 * @this {ActiveLightConfig}
	 */
	static async #onRandomizeOffset() {
		if (this.#data.manual) return;
		const max = Math.max(...this.#data.keys.map(x => x.time));
		this.#data.offset = Math.round(Math.random() * max);
		const input = this.element.querySelector('input[name="offset"]');
		if (input) input.value = this.#data.offset === 0 ? '' : String(this.#data.offset);
		await this.#save();
	}

	async #save() {
		const document = this.#document;
		try {
			if (this.#data.keys.length <= 1) {
				if (document.getFlag(SETTINGS.MOD_NAME, LightAnimator.FLAG_ANIMS) !== undefined)
					await document.unsetFlag(SETTINGS.MOD_NAME, LightAnimator.FLAG_ANIMS);
			} else {
				const { tempOffset, ...data } = foundry.utils.deepClone(this.#data);
				await document.setFlag(SETTINGS.MOD_NAME, LightAnimator.FLAG_ANIMS, data);
			}
		} catch (error) {
			console.error('DF Active Lights | Failed to save the animation', error);
			ui.notifications.error(error.message ?? String(error));
		}
		LightAnimator.invalidate(document.id);
	}
}
